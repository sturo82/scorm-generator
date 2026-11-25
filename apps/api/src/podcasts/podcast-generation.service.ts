import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { FeedProvider, LLMProvider, ObjectStorage, SpeechProvider } from '@scorm/domain';
import {
  PODCAST_LIMITS,
  PodcastBrief,
  PodcastHosts,
  PodcastScript,
  podcastScriptFit,
  podcastScriptWords,
  type PodcastEstimateView,
  type PodcastSource,
} from '@scorm/contracts';
import type { AppConfig } from '../config/configuration.js';
import { BillingService, type BillItem, type Reservation } from '../billing/billing.service.js';
import { RetrievalService } from '../knowledge/retrieval.service.js';
import { formatContext } from '../generation/prompts.js';
import { UsageMeterService } from '../metering/usage-meter.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LLM_PROVIDER, OBJECT_STORAGE } from '../providers/provider.constants.js';
import { assembleAudio, scriptChars, tidyScript } from './podcast-audio.js';
import { PLAN_SCHEMA, SCRIPT_SCHEMA, planPrompt, scriptPrompt } from './podcast-prompts.js';
import { PODCAST_FEED, PODCAST_SPEECH } from './podcast.constants.js';
import { PodcastVoicesService, podcastLocale } from './podcast-voices.service.js';

const LEASE_MS = 5 * 60_000;
const HEARTBEAT_MS = 60_000;
const MAX_CONTEXT_CHARS = 30_000;
const ARTICLE_CHARS = 5_000;
/** Caratteri medi per parola in italiano (spazi compresi), per stimare il costo dell'audio prima di scrivere il copione. */
const CHARS_PER_WORD = 6.5;
const INTERRUPTED = 'Il lavoro è stato interrotto da un riavvio del servizio: riprova.';

const PlanOut = z.object({ episodes: z.array(z.object({ title: z.string().trim().min(1), summary: z.string().trim() })) });
const ScriptOut = z.object({ turns: z.array(z.object({ host: z.string(), text: z.string() })) });

type Episode = Prisma.PodcastEpisodeGetPayload<Record<string, never>>;
type PodcastRow = Prisma.PodcastGetPayload<Record<string, never>>;

/** Messaggio leggibile per l'utente a partire da un errore. */
function userMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/\s+/g, ' ').slice(0, 280) || 'Errore sconosciuto';
}

/**
 * Generazione dei podcast: piano della serie, copioni a due conduttori e audio. Ogni passo è un
 * lavoro in background con crediti riservati prima e addebitati solo per il lavoro riuscito.
 * Se il servizio si riavvia il lavoro non riprende da solo: le puntate interrotte tornano in
 * errore, la riserva si libera e l'utente può riprovare.
 */
@Injectable()
export class PodcastGenerationService implements OnModuleInit {
  private readonly logger = new Logger(PodcastGenerationService.name);
  /** Serie con un lavoro in corso in questo processo. */
  private readonly active = new Set<string>();
  /** Serie per cui l'utente ha chiesto di annullare. */
  private readonly cancelled = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LLM_PROVIDER) private readonly llm: LLMProvider,
    @Inject(PODCAST_SPEECH) private readonly speech: SpeechProvider,
    @Inject(PODCAST_FEED) private readonly feeds: FeedProvider,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly retrieval: RetrievalService,
    private readonly billing: BillingService,
    private readonly meter: UsageMeterService,
    private readonly voices: PodcastVoicesService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  onModuleInit(): void {
    // Dopo l'avvio, libera i lavori rimasti a metà (con un deploy a rotazione i lavori dell'istanza
    // precedente hanno il lease ancora valido e non si toccano).
    const t = setTimeout(() => void this.recoverStale().catch((e) => this.logger.warn(`Recupero lavori podcast: ${userMessage(e)}`)), 20_000);
    t.unref?.();
  }

  // --- Stato e controlli ----------------------------------------------------

  private async requirePodcast(tenantId: string, podcastId: string): Promise<PodcastRow> {
    const p = await this.prisma.podcast.findFirst({ where: { id: podcastId, tenantId } });
    if (!p) throw new NotFoundException('Podcast non trovato');
    return p;
  }

  private async episodesOf(tenantId: string, podcastId: string): Promise<Episode[]> {
    return this.prisma.podcastEpisode.findMany({ where: { podcastId, tenantId }, orderBy: { position: 'asc' } });
  }

  private assertIdle(eps: Episode[]): void {
    if (eps.some((e) => e.state === 'WRITING' || e.state === 'VOICING')) {
      throw new ConflictException('C\u2019è già un lavoro in corso su questa serie: attendi che finisca.');
    }
  }

  /** Chiede di fermare il lavoro in corso: si ferma prima della prossima puntata e si addebita il già fatto. */
  cancel(podcastId: string): void {
    if (this.active.has(podcastId)) this.cancelled.add(podcastId);
  }

  /** Libera i lavori interrotti da un riavvio: puntate in errore e riserve di crediti rilasciate. */
  async recoverStale(): Promise<void> {
    const stale = await this.prisma.podcastEpisode.findMany({
      where: { state: { in: ['WRITING', 'VOICING'] }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] },
    });
    if (stale.length === 0) return;
    const released = new Set<string>();
    for (const e of stale) {
      const res = e.billing as unknown as Reservation | null;
      if (res?.ref && !released.has(res.ref)) {
        released.add(res.ref);
        await this.billing.release(e.tenantId, res).catch((err) => this.logger.warn(`Rilascio riserva ${res.ref}: ${userMessage(err)}`));
      }
      await this.prisma.podcastEpisode.update({
        where: { id: e.id },
        data: { state: 'FAILED', error: INTERRUPTED, leaseUntil: null, billing: Prisma.DbNull },
      });
    }
    this.logger.log(`Puntate podcast interrotte liberate: ${stale.length}`);
  }

  private heartbeat(ids: string[]): NodeJS.Timeout {
    const t = setInterval(() => {
      void this.prisma.podcastEpisode
        .updateMany({ where: { id: { in: ids }, state: { in: ['WRITING', 'VOICING'] } }, data: { leaseUntil: new Date(Date.now() + LEASE_MS) } })
        .catch(() => undefined);
    }, HEARTBEAT_MS);
    t.unref?.();
    return t;
  }

  // --- Fonti ----------------------------------------------------------------

  /** Contesto per l'AI: passaggi dei documenti scelti e testo degli articoli scelti. */
  private async buildContext(tenantId: string, podcast: PodcastRow, query: string): Promise<{ text: string; sources: PodcastSource[] }> {
    const parts: string[] = [];
    const sources: PodcastSource[] = [];
    const docIds = z.array(z.string()).catch([]).parse(podcast.knowledgeDocIds);
    if (docIds.length > 0) {
      const found = await this.retrieval.retrieve({ tenantId, text: query, documentIds: docIds, topK: 8 });
      const ctx = formatContext(found.chunks);
      if (ctx) parts.push(ctx);
      for (const c of found.citations) sources.push({ kind: 'document', title: c.documentName });
    }
    const articles = z
      .array(z.object({ title: z.string(), url: z.string() }))
      .catch([])
      .parse(podcast.articles);
    const texts: string[] = [];
    for (const a of articles) {
      try {
        const fetched = await this.feeds.fetchArticle(a.url);
        const text = fetched.text.replace(/\s+/g, ' ').trim().slice(0, ARTICLE_CHARS);
        if (text) {
          texts.push(`### ${a.title}\n(${a.url})\n${text}`);
          sources.push({ kind: 'article', title: a.title, url: a.url });
        }
      } catch (err) {
        this.logger.warn(`Articolo non letto (${a.url}): ${userMessage(err)}`);
      }
    }
    if (texts.length > 0) parts.push(`Articoli di riferimento:\n${texts.join('\n\n')}`);
    return { text: parts.join('\n\n').slice(0, MAX_CONTEXT_CHARS), sources };
  }

  private async callLlm(tenantId: string, source: string, system: string, user: string, schema: object, maxTokens: number, temperature = 0.6): Promise<string> {
    const result = await this.llm.generate({
      system,
      messages: [{ role: 'user', content: user }],
      schema: schema as Record<string, unknown>,
      temperature,
      maxTokens,
    });
    for (const unit of ['INPUT_TOKENS', 'OUTPUT_TOKENS'] as const) {
      await this.meter.record({
        tenantId,
        courseId: null,
        provider: 'BEDROCK_LLM',
        model: result.model,
        unit,
        quantity: unit === 'INPUT_TOKENS' ? result.usage.inputTokens : result.usage.outputTokens,
        source,
      });
    }
    return result.text;
  }

  // --- Preventivo -----------------------------------------------------------

  /** Preventivo in crediti. Per l'audio si stima dalla durata (o dal copione, se c'è già). */
  estimate(
    billed: boolean,
    work: { plan: boolean; scripts: number; audio: Array<{ minutes: number; chars?: number }> },
  ): PodcastEstimateView {
    const lines: PodcastEstimateView['lines'] = [];
    const add = (kind: 'plan' | 'scripts' | 'audio', quantity: number, items: BillItem[]): void => {
      if (quantity <= 0) return;
      const q = this.billing.quote(items);
      lines.push({ kind, quantity: Math.round(quantity * 10) / 10, credits: q.priced ? q.total : null });
    };
    if (work.plan) add('plan', 1, [{ feature: 'text_light', units: 1 }]);
    if (work.scripts > 0) add('scripts', work.scripts, [{ feature: 'text_standard', units: work.scripts }]);
    const units = work.audio.reduce((n, a) => n + (a.chars ?? a.minutes * PODCAST_LIMITS.wordsPerMinute * CHARS_PER_WORD) / 1000, 0);
    if (units > 0) add('audio', units, [{ feature: 'audio_narration', units: this.margin(units) }]);
    return {
      billed,
      priced: lines.every((l) => l.credits !== null),
      total: lines.reduce((n, l) => n + (l.credits ?? 0), 0),
      lines,
    };
  }

  /** Margine sulle unità riservate per l'audio: il copione può uscire un po' più lungo del previsto. */
  private margin(units: number): number {
    return Math.ceil(units * 1.1 * 10) / 10;
  }

  // --- Piano ----------------------------------------------------------------

  /** Riserva i crediti del piano. Restituisce null se l'azienda non paga a crediti. */
  async reservePlan(tenantId: string, podcastKey: string): Promise<Reservation | null> {
    return this.billing.reserve(tenantId, `kscorm:podcast-plan:${podcastKey}:${randomUUID()}`, [{ feature: 'text_light', units: 1 }]);
  }

  /** Rilancia il piano di una serie (le puntate tornano segnaposto). */
  async startPlan(tenantId: string, podcastId: string): Promise<void> {
    await this.requirePodcast(tenantId, podcastId);
    const eps = await this.episodesOf(tenantId, podcastId);
    if (eps.length === 0) throw new BadRequestException('La serie non ha puntate');
    this.assertIdle(eps);
    if (eps.some((e) => e.script || e.audioKey)) {
      throw new BadRequestException('La serie ha già copioni o audio: il piano non si può rifare. Modifica le puntate o creane una nuova serie.');
    }
    const reservation = await this.reservePlan(tenantId, podcastId);
    await this.prisma.podcastEpisode.updateMany({
      where: { podcastId, tenantId },
      data: {
        state: 'WRITING',
        error: null,
        script: Prisma.DbNull,
        audioStale: false,
        leaseUntil: new Date(Date.now() + LEASE_MS),
        billing: reservation ? (reservation as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    });
    this.planInBackground(tenantId, podcastId, reservation);
  }

  /** Avvia in background la scrittura del piano; le puntate segnaposto sono già in stato WRITING. */
  planInBackground(tenantId: string, podcastId: string, reservation: Reservation | null): void {
    this.active.add(podcastId);
    void this.runPlan(tenantId, podcastId, reservation).finally(() => this.active.delete(podcastId));
  }

  private async runPlan(tenantId: string, podcastId: string, reservation: Reservation | null): Promise<void> {
    const ids = (await this.episodesOf(tenantId, podcastId)).map((e) => e.id);
    const hb = this.heartbeat(ids);
    try {
      const podcast = await this.requirePodcast(tenantId, podcastId);
      const brief = PodcastBrief.parse(podcast.brief);
      const hosts = PodcastHosts.parse(podcast.hosts);
      const eps = await this.episodesOf(tenantId, podcastId);
      const ctx = await this.buildContext(tenantId, podcast, [brief.topic, ...brief.objectives].join('. '));
      const { system, user } = planPrompt({
        language: podcast.language,
        title: podcast.title,
        brief,
        hosts,
        episodeCount: eps.length,
        minutes: eps[0]?.targetMinutes ?? 8,
        context: ctx.text,
      });
      const raw = await this.callLlm(tenantId, 'podcast_plan', system, user, PLAN_SCHEMA, 3000);
      const plan = PlanOut.parse(JSON.parse(raw));
      if (plan.episodes.length < eps.length) throw new Error(`Il piano proposto ha ${plan.episodes.length} puntate invece di ${eps.length}`);
      for (const [i, e] of eps.entries()) {
        const p = plan.episodes[i]!;
        await this.prisma.podcastEpisode.update({
          where: { id: e.id },
          data: {
            title: p.title.slice(0, 140),
            summary: p.summary.slice(0, 1000),
            state: 'DRAFT',
            error: null,
            leaseUntil: null,
            billing: Prisma.DbNull,
            sources: ctx.sources as unknown as Prisma.InputJsonValue,
          },
        });
      }
      await this.billing.settle(tenantId, reservation, { text_light: 1 });
    } catch (err) {
      this.logger.error(`Piano podcast ${podcastId} fallito: ${userMessage(err)}`);
      await this.prisma.podcastEpisode.updateMany({
        where: { podcastId, tenantId, state: 'WRITING' },
        data: { state: 'FAILED', error: `Piano non riuscito: ${userMessage(err)}`, leaseUntil: null, billing: Prisma.DbNull },
      });
      await this.billing.release(tenantId, reservation).catch(() => undefined);
    } finally {
      clearInterval(hb);
    }
  }

  // --- Copioni --------------------------------------------------------------

  /** Avvia la scrittura dei copioni. Senza `episodeIds`: tutte le puntate ancora senza copione. */
  async startScripts(tenantId: string, podcastId: string, episodeIds?: string[]): Promise<{ started: number }> {
    await this.requirePodcast(tenantId, podcastId);
    const all = await this.episodesOf(tenantId, podcastId);
    this.assertIdle(all);
    const todo = episodeIds?.length ? all.filter((e) => episodeIds.includes(e.id)) : all.filter((e) => !e.script);
    if (todo.length === 0) throw new BadRequestException('Nessuna puntata da scrivere');
    const reservation = await this.billing.reserve(tenantId, `kscorm:podcast-scripts:${podcastId}:${randomUUID()}`, [
      { feature: 'text_standard', units: todo.length },
    ]);
    await this.prisma.podcastEpisode.updateMany({
      where: { id: { in: todo.map((e) => e.id) }, tenantId },
      data: {
        state: 'WRITING',
        error: null,
        leaseUntil: new Date(Date.now() + LEASE_MS),
        billing: reservation ? (reservation as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    });
    this.active.add(podcastId);
    void this.runScripts(tenantId, podcastId, todo, all, reservation).finally(() => {
      this.active.delete(podcastId);
      this.cancelled.delete(podcastId);
    });
    return { started: todo.length };
  }

  private async runScripts(tenantId: string, podcastId: string, todo: Episode[], all: Episode[], reservation: Reservation | null): Promise<void> {
    const hb = this.heartbeat(todo.map((e) => e.id));
    let done = 0;
    try {
      const podcast = await this.requirePodcast(tenantId, podcastId);
      const brief = PodcastBrief.parse(podcast.brief);
      const hosts = PodcastHosts.parse(podcast.hosts);
      for (const e of todo) {
        if (this.cancelled.has(podcastId)) {
          await this.restore(e.id, e.script ? 'SCRIPT_READY' : 'DRAFT');
          continue;
        }
        try {
          const previous = all.filter((x) => x.position < e.position).map((x) => ({ title: x.title, summary: x.summary }));
          const ctx = await this.buildContext(tenantId, podcast, `${e.title}. ${e.summary}. ${brief.topic}`);
          const script = await this.writeScript(tenantId, podcast, brief, hosts, e, all.length, previous, ctx.text);
          await this.prisma.podcastEpisode.update({
            where: { id: e.id },
            data: {
              script: script as unknown as Prisma.InputJsonValue,
              state: 'SCRIPT_READY',
              error: null,
              leaseUntil: null,
              billing: Prisma.DbNull,
              sources: ctx.sources as unknown as Prisma.InputJsonValue,
              // Un copione nuovo rende obsoleto un audio già generato.
              audioStale: Boolean(e.audioKey),
            },
          });
          done += 1;
        } catch (err) {
          this.logger.error(`Copione podcast ${e.id} fallito: ${userMessage(err)}`);
          await this.prisma.podcastEpisode.update({
            where: { id: e.id },
            data: { state: 'FAILED', error: `Copione non riuscito: ${userMessage(err)}`, leaseUntil: null, billing: Prisma.DbNull },
          });
        }
      }
    } finally {
      clearInterval(hb);
      await this.billing.settle(tenantId, reservation, { text_standard: done }).catch((err) => this.logger.warn(`Addebito copioni: ${userMessage(err)}`));
    }
  }

  private async restore(episodeId: string, state: 'DRAFT' | 'SCRIPT_READY'): Promise<void> {
    await this.prisma.podcastEpisode.update({ where: { id: episodeId }, data: { state, leaseUntil: null, billing: Prisma.DbNull } });
  }

  /** Scrive il copione di una puntata: se esce fuori misura chiede una seconda versione tarata sulla durata. */
  private async writeScript(
    tenantId: string,
    podcast: PodcastRow,
    brief: PodcastBrief,
    hosts: ReturnType<typeof PodcastHosts.parse>,
    e: Episode,
    total: number,
    previous: Array<{ title: string; summary: string }>,
    context: string,
  ): Promise<PodcastScript> {
    let best: PodcastScript | null = null;
    let retry: { words: number; text: string } | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const { system, user, budget } = scriptPrompt({
        language: podcast.language,
        title: podcast.title,
        brief,
        hosts,
        episode: { position: e.position, total, title: e.title, summary: e.summary, minutes: e.targetMinutes },
        previous,
        context,
        retry,
      });
      const raw = await this.callLlm(tenantId, 'podcast_script', system, user, SCRIPT_SCHEMA, Math.min(16_000, Math.ceil(budget.max * 2.4) + 400));
      const tidy = tidyScript(ScriptOut.parse(JSON.parse(raw)));
      if (tidy.problems.length > 0) {
        if (attempt === 1 && !best) throw new Error(`Copione non valido: ${tidy.problems.join('; ')}`);
        continue;
      }
      best = tidy.script;
      const words = podcastScriptWords(tidy.script);
      if (podcastScriptFit(words, e.targetMinutes).status === 'ok') return tidy.script;
      retry = { words, text: tidy.script.turns.map((t) => `${t.host}: ${t.text}`).join('\n') };
    }
    if (!best) throw new Error('Copione non generato');
    return PodcastScript.parse(best);
  }

  // --- Audio ----------------------------------------------------------------

  /** Avvia la sintesi dell'audio. Senza `episodeIds`: le puntate con copione e senza audio aggiornato. */
  async startAudio(tenantId: string, podcastId: string, episodeIds?: string[]): Promise<{ started: number }> {
    const podcast = await this.requirePodcast(tenantId, podcastId);
    const all = await this.episodesOf(tenantId, podcastId);
    this.assertIdle(all);
    const withScript = (e: Episode): boolean => PodcastScript.safeParse(e.script).success;
    const todo = episodeIds?.length
      ? all.filter((e) => episodeIds.includes(e.id))
      : all.filter((e) => withScript(e) && (!e.audioKey || e.audioStale));
    if (todo.length === 0) throw new BadRequestException('Nessuna puntata da registrare');
    const missing = todo.find((e) => !withScript(e));
    if (missing) throw new BadRequestException(`La puntata «${missing.title}» non ha ancora il copione`);
    const hosts = PodcastHosts.parse(podcast.hosts);
    for (const h of hosts) {
      if (!(await this.voices.isValid(h.voice.id, podcast.language))) {
        throw new BadRequestException(`La voce di ${h.name} non è disponibile per questa lingua: sceglierne un'altra`);
      }
    }
    const chars = todo.reduce((n, e) => n + scriptChars(PodcastScript.parse(e.script)), 0);
    const reservation = await this.billing.reserve(tenantId, `kscorm:podcast-audio:${podcastId}:${randomUUID()}`, [
      { feature: 'audio_narration', units: this.margin(chars / 1000) },
    ]);
    await this.prisma.podcastEpisode.updateMany({
      where: { id: { in: todo.map((e) => e.id) }, tenantId },
      data: {
        state: 'VOICING',
        error: null,
        leaseUntil: new Date(Date.now() + LEASE_MS),
        billing: reservation ? (reservation as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    });
    this.active.add(podcastId);
    void this.runAudio(tenantId, podcast, todo, reservation).finally(() => {
      this.active.delete(podcastId);
      this.cancelled.delete(podcastId);
    });
    return { started: todo.length };
  }

  private async runAudio(tenantId: string, podcast: PodcastRow, todo: Episode[], reservation: Reservation | null): Promise<void> {
    const hb = this.heartbeat(todo.map((e) => e.id));
    let chars = 0;
    try {
      for (const e of todo) {
        if (this.cancelled.has(podcast.id)) {
          await this.restore(e.id, 'SCRIPT_READY');
          continue;
        }
        try {
          chars += await this.voiceEpisode(tenantId, podcast, e);
        } catch (err) {
          this.logger.error(`Audio podcast ${e.id} fallito: ${userMessage(err)}`);
          await this.prisma.podcastEpisode.update({
            where: { id: e.id },
            data: { state: 'FAILED', error: `Audio non riuscito: ${userMessage(err)}`, leaseUntil: null, billing: Prisma.DbNull },
          });
        }
      }
    } finally {
      clearInterval(hb);
      await this.billing
        .settle(tenantId, reservation, { audio_narration: Math.round((chars / 1000) * 100) / 100 })
        .catch((err) => this.logger.warn(`Addebito audio: ${userMessage(err)}`));
    }
  }

  /** Sintetizza una puntata battuta per battuta, unisce l'audio e lo salva. Restituisce i caratteri sintetizzati. */
  private async voiceEpisode(tenantId: string, podcast: PodcastRow, e: Episode): Promise<number> {
    const cfg = this.config.get('podcast', { infer: true });
    const script = PodcastScript.parse(e.script);
    const hosts = PodcastHosts.parse(podcast.hosts);
    const voiceOf = new Map(hosts.map((h) => [h.key, h.voice.id]));
    const locale = podcastLocale(podcast.language);
    const parts: Array<{ bytes: Uint8Array; text: string }> = [];
    let chars = 0;
    for (const turn of script.turns) {
      const res = await this.synthWithRetry(turn.text, locale, voiceOf.get(turn.host)!, cfg.speechEngine);
      parts.push({ bytes: res.bytes, text: turn.text });
      chars += turn.text.length;
    }
    const { audio, timings, durationMs } = assembleAudio(parts);
    const key = `podcasts/${tenantId}/${podcast.id}/${e.id}.mp3`;
    await this.storage.putObject(key, audio, { contentType: 'audio/mpeg' });
    await this.meter.record({
      tenantId,
      courseId: null,
      provider: 'POLLY',
      model: `polly-${cfg.speechEngine}`,
      unit: 'CHARACTERS',
      quantity: chars,
      source: 'podcast_audio',
      region: cfg.speechRegion,
    });
    await this.prisma.podcastEpisode.update({
      where: { id: e.id },
      data: {
        state: 'READY',
        error: null,
        leaseUntil: null,
        billing: Prisma.DbNull,
        audioKey: key,
        audioStale: false,
        durationSec: Math.max(1, Math.round(durationMs / 1000)),
        sizeBytes: audio.length,
        turnTimings: timings as unknown as Prisma.InputJsonValue,
      },
    });
    return chars;
  }

  /** Una battuta: fino a 3 tentativi con attesa crescente (limiti di frequenza o errori passeggeri). */
  private async synthWithRetry(text: string, language: string, voice: string, engine: 'standard' | 'neural' | 'generative') {
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.speech.synthesize({ text, language, voice, engine });
      } catch (err) {
        last = err;
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    throw new Error(`Sintesi vocale non riuscita (${userMessage(last)}): «${text.slice(0, 40)}…»`);
  }
}
