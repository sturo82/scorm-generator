import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { FeedProvider, ObjectStorage } from '@scorm/domain';
import {
  PodcastArticleRef,
  PodcastBrief,
  PodcastHosts,
  PodcastScript,
  podcastScriptWords,
  type CreatePodcast,
  type PodcastHost,
  type PodcastEpisodeView,
  type PodcastEstimateView,
  type PodcastListItem,
  type PodcastSource,
  type PodcastTurnTiming,
  type PodcastView,
  type UpdatePodcast,
  type UpdatePodcastEpisodes,
} from '@scorm/contracts';
import { BillingService } from '../billing/billing.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OBJECT_STORAGE } from '../providers/provider.constants.js';
import { scriptChars, tidyScript } from './podcast-audio.js';
import { PodcastGenerationService } from './podcast-generation.service.js';
import { newFeedToken, newPublicId, PodcastPublishService } from './podcast-publish.service.js';
import { PodcastVoicesService } from './podcast-voices.service.js';
import { PODCAST_FEED } from './podcast.constants.js';

type PodcastRow = Prisma.PodcastGetPayload<Record<string, never>>;
type EpisodeRow = Prisma.PodcastEpisodeGetPayload<Record<string, never>>;

const MAX_PODCASTS_PER_TENANT = 50;
const URL_TTL_SEC = 3600;
const LEASE_MS = 5 * 60_000;

function slug(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'podcast'
  );
}

/** Tempo per SRT (virgola) o VTT (punto). */
function stamp(ms: number, sep: ',' | '.'): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3_600_000);
  const m = Math.floor((t % 3_600_000) / 60_000);
  const s = Math.floor((t % 60_000) / 1000);
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(t % 1000, 3)}`;
}

/** Serie e puntate: elenco, creazione, modifica, trascritto e preventivo. */
@Injectable()
export class PodcastsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(PODCAST_FEED) private readonly feeds: FeedProvider,
    private readonly generation: PodcastGenerationService,
    private readonly voices: PodcastVoicesService,
    private readonly publish: PodcastPublishService,
    private readonly billing: BillingService,
  ) {}

  // --- Lettura ----------------------------------------------------------------

  async list(tenantId: string): Promise<PodcastListItem[]> {
    const rows = await this.prisma.podcast.findMany({
      where: { tenantId },
      orderBy: { updatedAt: 'desc' },
      include: { episodes: { select: { state: true, publishedAt: true } } },
    });
    return rows.map((p) => ({
      id: p.id,
      title: p.title,
      language: p.language,
      episodeCount: p.episodes.length,
      readyCount: p.episodes.filter((e) => e.state === 'READY').length,
      publishedCount: p.episodes.filter((e) => e.publishedAt).length,
      updatedAt: p.updatedAt.toISOString(),
    }));
  }

  private async require(tenantId: string, id: string): Promise<PodcastRow> {
    const p = await this.prisma.podcast.findFirst({ where: { id, tenantId } });
    if (!p) throw new NotFoundException('Podcast non trovato');
    return p;
  }

  private async requireEpisode(tenantId: string, podcastId: string, episodeId: string): Promise<EpisodeRow> {
    const e = await this.prisma.podcastEpisode.findFirst({ where: { id: episodeId, podcastId, tenantId } });
    if (!e) throw new NotFoundException('Puntata non trovata');
    return e;
  }

  async get(tenantId: string, id: string): Promise<PodcastView> {
    const p = await this.require(tenantId, id);
    const eps = await this.prisma.podcastEpisode.findMany({ where: { podcastId: id, tenantId }, orderBy: { position: 'asc' } });
    return this.toView(p, eps);
  }

  private async toView(p: PodcastRow, eps: EpisodeRow[]): Promise<PodcastView> {
    const feedUrl = this.publish.feedUrlOf(p);
    let cover: PodcastView['cover'];
    if (p.coverKey && p.coverWidth && p.coverHeight) {
      cover = {
        url: await this.storage.getSignedUrl(p.coverKey, { expiresInSec: URL_TTL_SEC }),
        width: p.coverWidth,
        height: p.coverHeight,
        ok: this.publish.coverOk(p),
      };
    }
    return {
      id: p.id,
      title: p.title,
      description: p.description,
      language: p.language,
      category: p.category,
      author: p.author ?? undefined,
      contactEmail: p.contactEmail ?? undefined,
      explicit: p.explicit,
      hosts: PodcastHosts.parse(p.hosts),
      brief: PodcastBrief.parse(p.brief),
      knowledgeDocIds: z.array(z.string()).catch([]).parse(p.knowledgeDocIds),
      articles: z.array(PodcastArticleRef).catch([]).parse(p.articles),
      visibility: p.visibility,
      cover,
      feedUrl,
      feedWarnings: this.publish.warningsOf(p),
      publishingEnabled: this.publish.enabled(),
      episodes: eps.map((e) => this.episodeView(e)),
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  private episodeView(e: EpisodeRow): PodcastEpisodeView {
    const script = PodcastScript.safeParse(e.script);
    return {
      id: e.id,
      position: e.position,
      title: e.title,
      summary: e.summary,
      targetMinutes: e.targetMinutes,
      state: e.state,
      error: e.error ?? undefined,
      script: script.success ? script.data : null,
      words: script.success ? podcastScriptWords(script.data) : 0,
      audioStale: e.audioStale,
      hasAudio: Boolean(e.audioKey),
      durationSec: e.durationSec ?? undefined,
      sizeBytes: e.sizeBytes ?? undefined,
      turnTimings: Array.isArray(e.turnTimings) ? (e.turnTimings as unknown as PodcastTurnTiming[]) : undefined,
      sources: z.array(z.object({ kind: z.enum(['document', 'article']), title: z.string(), url: z.string().optional() })).catch([]).parse(e.sources) as PodcastSource[],
      published: Boolean(e.publishedAt),
      publishedAt: e.publishedAt?.toISOString(),
    };
  }

  // --- Creazione e modifica ----------------------------------------------------

  /** Verifica che le voci scelte esistano per la lingua della serie. */
  private async assertVoices(hosts: PodcastHost[], language: string): Promise<void> {
    for (const h of hosts) {
      if (!(await this.voices.isValid(h.voice.id, language))) {
        throw new BadRequestException(`La voce di ${h.name} non è disponibile per questa lingua: scegline un'altra.`);
      }
    }
  }

  async create(tenantId: string, userId: string | undefined, dto: CreatePodcast): Promise<PodcastView> {
    if ((await this.prisma.podcast.count({ where: { tenantId } })) >= MAX_PODCASTS_PER_TENANT) {
      throw new BadRequestException(`Hai raggiunto il massimo di ${MAX_PODCASTS_PER_TENANT} podcast.`);
    }
    if (dto.knowledgeDocIds.length === 0 && dto.articles.length === 0 && dto.brief.topic.trim().length < 3) {
      throw new BadRequestException('Indica un tema o almeno una fonte.');
    }
    await this.assertVoices(dto.hosts, dto.language);
    // I crediti si riservano prima di creare qualsiasi cosa: se non bastano, niente resta a metà.
    const reservation = await this.generation.reservePlan(tenantId, 'new');
    let created: PodcastRow;
    try {
      const lease = new Date(Date.now() + LEASE_MS);
      created = await this.prisma.podcast.create({
        data: {
          tenantId,
          title: dto.title,
          description: dto.description,
          language: dto.language,
          category: dto.category,
          author: dto.author ?? null,
          contactEmail: dto.contactEmail ?? null,
          explicit: dto.explicit,
          hosts: dto.hosts as unknown as Prisma.InputJsonValue,
          brief: dto.brief as unknown as Prisma.InputJsonValue,
          knowledgeDocIds: dto.knowledgeDocIds as unknown as Prisma.InputJsonValue,
          articles: dto.articles as unknown as Prisma.InputJsonValue,
          publicId: newPublicId(),
          feedToken: newFeedToken(),
          createdBy: userId ?? null,
          episodes: {
            create: Array.from({ length: dto.episodeCount }, (_, i) => ({
              tenantId,
              position: i + 1,
              title: `Puntata ${i + 1}`,
              targetMinutes: dto.episodeMinutes,
              state: 'WRITING' as const,
              leaseUntil: lease,
              billing: reservation ? (reservation as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
              guid: randomUUID(),
            })),
          },
        },
      });
    } catch (err) {
      await this.billing.release(tenantId, reservation).catch(() => undefined);
      throw err;
    }
    this.generation.planInBackground(tenantId, created.id, reservation);
    return this.get(tenantId, created.id);
  }

  async update(tenantId: string, id: string, dto: UpdatePodcast): Promise<PodcastView> {
    const p = await this.require(tenantId, id);
    if (dto.hosts) await this.assertVoices(dto.hosts, p.language);
    await this.prisma.podcast.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.author !== undefined ? { author: dto.author } : {}),
        ...(dto.contactEmail !== undefined ? { contactEmail: dto.contactEmail } : {}),
        ...(dto.explicit !== undefined ? { explicit: dto.explicit } : {}),
        ...(dto.hosts ? { hosts: dto.hosts as unknown as Prisma.InputJsonValue } : {}),
      },
    });
    // Voci diverse = audio diverso: le puntate già registrate risultano da rigenerare.
    if (dto.hosts && JSON.stringify(dto.hosts.map((h) => h.voice)) !== JSON.stringify(PodcastHosts.parse(p.hosts).map((h) => h.voice))) {
      await this.prisma.podcastEpisode.updateMany({ where: { podcastId: id, tenantId, audioKey: { not: null } }, data: { audioStale: true } });
    }
    // I dati del feed cambiano con titolo, descrizione, autore e categoria.
    if (this.publish.enabled()) await this.publish.refreshFeed(tenantId, id);
    return this.get(tenantId, id);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const p = await this.require(tenantId, id);
    const eps = await this.prisma.podcastEpisode.findMany({ where: { podcastId: id, tenantId } });
    if (eps.some((e) => e.state === 'WRITING' || e.state === 'VOICING')) {
      throw new ConflictException('C\u2019è un lavoro in corso: annullalo o attendi che finisca.');
    }
    await this.publish.removeAllFiles(p, eps);
    await this.prisma.podcast.delete({ where: { id } });
  }

  /** Piano: ordine, titoli e sintesi delle puntate; puntate nuove e puntate tolte. */
  async updateEpisodes(tenantId: string, id: string, dto: UpdatePodcastEpisodes): Promise<PodcastView> {
    const p = await this.require(tenantId, id);
    const current = await this.prisma.podcastEpisode.findMany({ where: { podcastId: id, tenantId }, orderBy: { position: 'asc' } });
    if (current.some((e) => e.state === 'WRITING' || e.state === 'VOICING')) {
      throw new ConflictException('C\u2019è un lavoro in corso su questa serie: attendi che finisca.');
    }
    const byId = new Map(current.map((e) => [e.id, e]));
    for (const item of dto.episodes) {
      if (item.id && !byId.has(item.id)) throw new BadRequestException('Puntata inesistente');
    }
    const keep = new Set(dto.episodes.map((e) => e.id).filter(Boolean));
    const removed = current.filter((e) => !keep.has(e.id));
    const defaultMinutes = current[0]?.targetMinutes ?? 8;
    await this.prisma.$transaction(async (tx) => {
      for (const e of removed) await tx.podcastEpisode.delete({ where: { id: e.id } });
      for (const [i, item] of dto.episodes.entries()) {
        if (item.id) {
          await tx.podcastEpisode.update({
            where: { id: item.id },
            data: { position: i + 1, title: item.title, summary: item.summary, ...(item.targetMinutes ? { targetMinutes: item.targetMinutes } : {}) },
          });
        } else {
          await tx.podcastEpisode.create({
            data: { podcastId: id, tenantId, position: i + 1, title: item.title, summary: item.summary, targetMinutes: item.targetMinutes ?? defaultMinutes, state: 'DRAFT', guid: randomUUID() },
          });
        }
      }
    });
    for (const e of removed) await this.publish.removeEpisodeFiles(e);
    if (removed.some((e) => e.publishedAt) || dto.episodes.length > 0) await this.publish.refreshFeed(tenantId, id).catch(() => undefined);
    void p;
    return this.get(tenantId, id);
  }

  /** Copione modificato a mano. Se l'audio c'era, resta ma risulta da rigenerare. */
  async updateScript(tenantId: string, id: string, episodeId: string, input: PodcastScript): Promise<PodcastView> {
    await this.require(tenantId, id);
    const e = await this.requireEpisode(tenantId, id, episodeId);
    if (e.state === 'WRITING' || e.state === 'VOICING') throw new ConflictException('La puntata è in lavorazione: attendi che finisca.');
    const tidy = tidyScript(input);
    if (tidy.problems.length > 0) throw new BadRequestException(`Copione non valido: ${tidy.problems.join('; ')}`);
    await this.prisma.podcastEpisode.update({
      where: { id: episodeId },
      data: {
        script: tidy.script as unknown as Prisma.InputJsonValue,
        error: null,
        state: e.audioKey ? 'READY' : 'SCRIPT_READY',
        audioStale: Boolean(e.audioKey),
      },
    });
    return this.get(tenantId, id);
  }

  // --- Ascolto e trascritto -------------------------------------------------------

  async audioUrl(tenantId: string, id: string, episodeId: string): Promise<{ url: string; downloadUrl: string }> {
    const e = await this.requireEpisode(tenantId, id, episodeId);
    if (!e.audioKey) throw new NotFoundException('Questa puntata non ha ancora l\u2019audio');
    const name = `${String(e.position).padStart(2, '0')}-${slug(e.title)}.mp3`;
    return {
      url: await this.storage.getSignedUrl(e.audioKey, { expiresInSec: URL_TTL_SEC }),
      downloadUrl: await this.storage.getSignedUrl(e.audioKey, { expiresInSec: URL_TTL_SEC, downloadFilename: name }),
    };
  }

  /** Trascritto di una puntata in testo, SRT o VTT (questi ultimi usano i tempi per battuta). */
  async transcript(tenantId: string, id: string, episodeId: string, format: 'txt' | 'srt' | 'vtt'): Promise<{ filename: string; contentType: string; body: string }> {
    const p = await this.require(tenantId, id);
    const e = await this.requireEpisode(tenantId, id, episodeId);
    const script = PodcastScript.safeParse(e.script);
    if (!script.success) throw new NotFoundException('Questa puntata non ha ancora il copione');
    const names = new Map(PodcastHosts.parse(p.hosts).map((h) => [h.key, h.name]));
    const base = `${String(e.position).padStart(2, '0')}-${slug(e.title)}`;
    const turns = script.data.turns;
    if (format === 'txt') {
      return {
        filename: `${base}.txt`,
        contentType: 'text/plain; charset=utf-8',
        body: `${e.title}\n\n${turns.map((t) => `${names.get(t.host) ?? t.host}: ${t.text}`).join('\n\n')}\n`,
      };
    }
    const timings = Array.isArray(e.turnTimings) ? (e.turnTimings as unknown as PodcastTurnTiming[]) : null;
    if (!timings || timings.length !== turns.length || e.audioStale) {
      throw new BadRequestException('I sottotitoli richiedono l\u2019audio aggiornato: rigenera l\u2019audio della puntata.');
    }
    const sep = format === 'srt' ? ',' : '.';
    const cues = turns
      .map((t, i) => `${format === 'srt' ? `${i + 1}\n` : ''}${stamp(timings[i]!.startMs, sep)} --> ${stamp(timings[i]!.endMs, sep)}\n${names.get(t.host) ?? t.host}: ${t.text}`)
      .join('\n\n');
    return {
      filename: `${base}.${format}`,
      contentType: format === 'srt' ? 'application/x-subrip; charset=utf-8' : 'text/vtt; charset=utf-8',
      body: `${format === 'vtt' ? 'WEBVTT\n\n' : ''}${cues}\n`,
    };
  }

  // --- Preventivo e fonti ----------------------------------------------------------

  async estimateNew(tenantId: string, episodeCount: number, minutes: number): Promise<PodcastEstimateView> {
    return this.generation.estimate(await this.billing.isBilled(tenantId), {
      plan: true,
      scripts: episodeCount,
      audio: Array.from({ length: episodeCount }, () => ({ minutes })),
    });
  }

  /** Preventivo del lavoro ancora da fare su una serie: copioni mancanti e audio da generare. */
  async estimateExisting(tenantId: string, id: string): Promise<PodcastEstimateView> {
    await this.require(tenantId, id);
    const eps = await this.prisma.podcastEpisode.findMany({ where: { podcastId: id, tenantId }, orderBy: { position: 'asc' } });
    const withoutScript = eps.filter((e) => !PodcastScript.safeParse(e.script).success);
    const needAudio = eps.filter((e) => !e.audioKey || e.audioStale);
    return this.generation.estimate(await this.billing.isBilled(tenantId), {
      plan: false,
      scripts: withoutScript.length,
      audio: needAudio.map((e) => {
        const s = PodcastScript.safeParse(e.script);
        return s.success ? { minutes: e.targetMinutes, chars: scriptChars(s.data) } : { minutes: e.targetMinutes };
      }),
    });
  }

  /** Articoli recenti di un feed RSS, per sceglierli come fonte. */
  async feedItems(url: string): Promise<{ feedTitle?: string; items: Array<{ title: string; link?: string; summary: string; isoDate?: string }> }> {
    const clean = (url ?? '').trim();
    if (!clean) throw new BadRequestException('Indirizzo del feed mancante');
    try {
      const res = await this.feeds.listItems(clean, { maxItems: 30 });
      return { feedTitle: res.feedTitle, items: res.items.map((i) => ({ title: i.title, link: i.link, summary: i.summary.slice(0, 400), isoDate: i.isoDate })) };
    } catch (err) {
      throw new BadRequestException(`Feed non valido o non raggiungibile: ${err instanceof Error ? err.message : 'errore'}`);
    }
  }
}
