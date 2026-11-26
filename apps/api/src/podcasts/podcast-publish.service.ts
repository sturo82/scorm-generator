import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { Prisma } from '@prisma/client';
import type { ObjectStorage } from '@scorm/domain';
import { PODCAST_COVER, type PodcastFeedVisibility } from '@scorm/contracts';
import type { AppConfig } from '../config/configuration.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OBJECT_STORAGE } from '../providers/provider.constants.js';
import { buildFeedXml, feedWarnings, type FeedEpisode } from './podcast-feed.js';
import { imageInfo } from './podcast-image.js';

type PodcastRow = Prisma.PodcastGetPayload<Record<string, never>>;
type EpisodeRow = Prisma.PodcastEpisodeGetPayload<Record<string, never>>;

const FEED_CACHE = 'public, max-age=300';
const AUDIO_CACHE = 'public, max-age=86400';
const COVER_CACHE = 'public, max-age=86400';

/** Nuovo codice segreto per i feed privati: lungo, casuale, adatto agli indirizzi. */
export function newFeedToken(): string {
  return randomBytes(24).toString('base64url');
}
export function newPublicId(): string {
  return randomUUID().replace(/-/g, '');
}

/**
 * Pubblicazione dei podcast: copia i file nell'area pubblica (servita da CloudFront sul
 * sottodominio dei podcast) e scrive il feed RSS. Il feed è un file statico riscritto a ogni
 * cambiamento: nessun server in mezzo quando Spotify o Apple lo leggono.
 *
 * Organizzazione dei file pubblici (sotto `publicPrefix`):
 *   serie pubblica:  <publicId>/feed.xml, <publicId>/<guid>.mp3, <publicId>/cover-<id>.jpg
 *   serie privata:   <publicId>/<feedToken>/feed.xml, … (il codice segreto è nell'indirizzo)
 */
@Injectable()
export class PodcastPublishService {
  private readonly logger = new Logger(PodcastPublishService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  private get cfg(): AppConfig['podcast'] {
    return this.config.get('podcast', { infer: true });
  }

  /** True se dominio e distribuzione sono configurati: senza, si può generare ma non pubblicare. */
  enabled(): boolean {
    return this.cfg.publicBaseUrl.length > 0;
  }

  // --- Indirizzi -------------------------------------------------------------

  /** Cartella dei file pubblici di una serie. */
  dirOf(p: Pick<PodcastRow, 'publicId' | 'visibility' | 'feedToken'>): string {
    return p.visibility === 'PRIVATE' ? `${p.publicId}/${p.feedToken}` : p.publicId;
  }

  private prefix(): string {
    const raw = this.cfg.publicPrefix.replace(/^\/+/, '');
    return raw && !raw.endsWith('/') ? `${raw}/` : raw;
  }

  private keyOf(dir: string, name: string): string {
    return `${this.prefix()}${dir}/${name}`;
  }

  private urlOf(dir: string, name: string): string {
    return `${this.cfg.publicBaseUrl}/${dir}/${name}`;
  }

  feedUrlOf(p: Pick<PodcastRow, 'publicId' | 'visibility' | 'feedToken'>): string | undefined {
    return this.enabled() ? this.urlOf(this.dirOf(p), 'feed.xml') : undefined;
  }

  /** Nome del file pubblico della copertina: contiene l'identificativo del file privato, così cambia con lei. */
  private coverName(coverKey: string): string {
    return `cover-${coverKey.split('/').pop()}`;
  }

  // --- Copertina -------------------------------------------------------------

  /** Salva la copertina (JPEG o PNG) e ne registra le dimensioni. Non blocca se non rispetta i requisiti: l'avviso arriva con la serie. */
  async setCover(tenantId: string, podcastId: string, file: { mimeType: string; content: Buffer }): Promise<void> {
    const podcast = await this.require(tenantId, podcastId);
    if (file.content.byteLength === 0) throw new BadRequestException('File vuoto');
    if (file.content.byteLength > PODCAST_COVER.maxBytes) throw new BadRequestException('Copertina troppo grande (massimo 10 MB)');
    const info = imageInfo(file.content);
    if (!info) throw new BadRequestException('Formato non supportato: usa un\u2019immagine JPEG o PNG');
    const key = `podcasts/${tenantId}/${podcastId}/cover-${randomUUID()}.${info.type === 'png' ? 'png' : 'jpg'}`;
    await this.storage.putObject(key, file.content, { contentType: info.type === 'png' ? 'image/png' : 'image/jpeg' });
    await this.prisma.podcast.update({ where: { id: podcastId }, data: { coverKey: key, coverWidth: info.width, coverHeight: info.height } });
    // La vecchia copertina (privata e pubblica) non serve più.
    if (podcast.coverKey) {
      await this.storage.deleteObject(podcast.coverKey).catch(() => undefined);
      await this.storage.deleteObject(this.keyOf(this.dirOf(podcast), this.coverName(podcast.coverKey))).catch(() => undefined);
    }
    if (this.enabled()) await this.refreshFeed(tenantId, podcastId);
  }

  /** Copertina pubblicabile: quadrata e nelle misure richieste da Apple. */
  coverOk(p: Pick<PodcastRow, 'coverWidth' | 'coverHeight'>): boolean {
    return (
      !!p.coverWidth &&
      p.coverWidth === p.coverHeight &&
      p.coverWidth >= PODCAST_COVER.minPx &&
      p.coverWidth <= PODCAST_COVER.maxPx
    );
  }

  warningsOf(p: PodcastRow): string[] {
    return feedWarnings(p, p.coverWidth && p.coverHeight ? { width: p.coverWidth, height: p.coverHeight } : null);
  }

  // --- Pubblica e ritira ------------------------------------------------------

  private async require(tenantId: string, podcastId: string): Promise<PodcastRow> {
    const p = await this.prisma.podcast.findFirst({ where: { id: podcastId, tenantId } });
    if (!p) throw new NotFoundException('Podcast non trovato');
    return p;
  }

  private assertEnabled(): void {
    if (!this.enabled()) throw new BadRequestException('La pubblicazione non è ancora configurata su questo ambiente.');
  }

  async publish(tenantId: string, podcastId: string, episodeId: string): Promise<void> {
    this.assertEnabled();
    const podcast = await this.require(tenantId, podcastId);
    const ep = await this.prisma.podcastEpisode.findFirst({ where: { id: episodeId, podcastId, tenantId } });
    if (!ep) throw new NotFoundException('Puntata non trovata');
    if (!ep.audioKey || ep.state !== 'READY') throw new BadRequestException('La puntata non ha ancora l\u2019audio: generalo prima di pubblicare.');
    if (ep.audioStale) throw new BadRequestException('Il copione è cambiato dopo l\u2019audio: rigenera l\u2019audio prima di pubblicare.');
    const dir = this.dirOf(podcast);
    // Ogni versione dell'audio ha un nome nuovo: Spotify, Apple e la distribuzione tengono in memoria i file per
    // indirizzo, e con lo stesso nome continuerebbero a servire il vecchio audio. Il guid resta uguale (è la
    // stessa puntata), cambia l'indirizzo del file.
    const key = this.keyOf(dir, `${ep.guid}-${Date.now().toString(36)}.mp3`);
    const oldKey = ep.publicAudioKey;
    const bytes = await this.storage.getObject(ep.audioKey);
    await this.storage.putObject(key, bytes, { contentType: 'audio/mpeg', cacheControl: AUDIO_CACHE });
    await this.prisma.podcastEpisode.update({
      where: { id: ep.id },
      data: {
        // Con una ripubblicazione la data resta quella originale: gli ascoltatori non vedono una puntata "nuova".
        publishedAt: ep.publishedAt ?? new Date(),
        publicAudioKey: key,
        publicSizeBytes: bytes.length,
        publicDurationSec: ep.durationSec ?? 1,
      },
    });
    await this.refreshFeed(tenantId, podcastId);
    // Il vecchio file si toglie solo dopo che il feed punta al nuovo.
    if (oldKey && oldKey !== key) await this.storage.deleteObject(oldKey).catch(() => undefined);
  }

  async unpublish(tenantId: string, podcastId: string, episodeId: string): Promise<void> {
    const podcast = await this.require(tenantId, podcastId);
    const ep = await this.prisma.podcastEpisode.findFirst({ where: { id: episodeId, podcastId, tenantId } });
    if (!ep) throw new NotFoundException('Puntata non trovata');
    if (ep.publicAudioKey) await this.storage.deleteObject(ep.publicAudioKey).catch(() => undefined);
    await this.prisma.podcastEpisode.update({
      where: { id: ep.id },
      data: { publishedAt: null, publicAudioKey: null, publicSizeBytes: null, publicDurationSec: null },
    });
    if (this.enabled() && podcast.id) await this.refreshFeed(tenantId, podcastId);
  }

  // --- Feed ---------------------------------------------------------------------

  /** Riscrive il feed con le puntate pubblicate (e rende pubblica la copertina). */
  async refreshFeed(tenantId: string, podcastId: string): Promise<void> {
    if (!this.enabled()) return;
    const podcast = await this.require(tenantId, podcastId);
    const published = await this.prisma.podcastEpisode.findMany({
      where: { podcastId, tenantId, publishedAt: { not: null }, publicAudioKey: { not: null } },
      orderBy: { position: 'asc' },
    });
    const dir = this.dirOf(podcast);
    let coverUrl: string | undefined;
    if (podcast.coverKey) {
      const name = this.coverName(podcast.coverKey);
      const key = this.keyOf(dir, name);
      if (!(await this.storage.exists(key))) {
        const info = podcast.coverKey.endsWith('.png') ? 'image/png' : 'image/jpeg';
        await this.storage.putObject(key, await this.storage.getObject(podcast.coverKey), { contentType: info, cacheControl: COVER_CACHE });
      }
      coverUrl = this.urlOf(dir, name);
    }
    const episodes: FeedEpisode[] = published.map((e) => ({
      guid: e.guid,
      title: e.title,
      summary: e.summary,
      position: e.position,
      durationSec: e.publicDurationSec ?? e.durationSec ?? 1,
      sizeBytes: e.publicSizeBytes ?? e.sizeBytes ?? 0,
      publishedAt: e.publishedAt!,
      audioUrl: this.urlOf(dir, basename(e.publicAudioKey!)),
    }));
    const feedUrl = this.urlOf(dir, 'feed.xml');
    const xml = buildFeedXml({
      podcast,
      feedUrl,
      siteUrl: this.cfg.publicBaseUrl,
      coverUrl,
      episodes,
    });
    await this.storage.putObject(this.keyOf(dir, 'feed.xml'), Buffer.from(xml, 'utf8'), {
      contentType: 'application/rss+xml; charset=utf-8',
      cacheControl: FEED_CACHE,
    });
  }

  // --- Visibilità e codice segreto -------------------------------------------------

  /** Sposta file e feed da una cartella all'altra (cambio di visibilità o di codice) e rimuove la vecchia. */
  private async move(podcast: PodcastRow, next: Pick<PodcastRow, 'publicId' | 'visibility' | 'feedToken'>): Promise<void> {
    const oldDir = this.dirOf(podcast);
    const newDir = this.dirOf(next);
    if (oldDir === newDir) return;
    const published = await this.prisma.podcastEpisode.findMany({
      where: { podcastId: podcast.id, publicAudioKey: { not: null } },
    });
    // Prima si scrive il nuovo, poi si aggiorna il database, poi si toglie il vecchio.
    for (const e of published) {
      const newKey = this.keyOf(newDir, basename(e.publicAudioKey!));
      await this.storage.putObject(newKey, await this.storage.getObject(e.publicAudioKey!), { contentType: 'audio/mpeg', cacheControl: AUDIO_CACHE });
      await this.prisma.podcastEpisode.update({ where: { id: e.id }, data: { publicAudioKey: newKey } });
    }
    await this.prisma.podcast.update({ where: { id: podcast.id }, data: { visibility: next.visibility, feedToken: next.feedToken } });
    await this.refreshFeed(podcast.tenantId, podcast.id);
    for (const e of published) await this.storage.deleteObject(this.keyOf(oldDir, basename(e.publicAudioKey!))).catch(() => undefined);
    if (podcast.coverKey) await this.storage.deleteObject(this.keyOf(oldDir, this.coverName(podcast.coverKey))).catch(() => undefined);
    await this.storage.deleteObject(this.keyOf(oldDir, 'feed.xml')).catch(() => undefined);
  }

  async setVisibility(tenantId: string, podcastId: string, visibility: PodcastFeedVisibility): Promise<void> {
    const podcast = await this.require(tenantId, podcastId);
    if (podcast.visibility === visibility) return;
    if (!this.enabled()) {
      await this.prisma.podcast.update({ where: { id: podcastId }, data: { visibility } });
      return;
    }
    await this.move(podcast, { publicId: podcast.publicId, visibility, feedToken: podcast.feedToken });
  }

  /** Rigenera il codice segreto del feed privato: il vecchio indirizzo smette di funzionare. */
  async rotateToken(tenantId: string, podcastId: string): Promise<void> {
    const podcast = await this.require(tenantId, podcastId);
    if (podcast.visibility !== 'PRIVATE') throw new BadRequestException('Il codice esiste solo per i feed privati.');
    const feedToken = newFeedToken();
    if (!this.enabled()) {
      await this.prisma.podcast.update({ where: { id: podcastId }, data: { feedToken } });
      return;
    }
    await this.move(podcast, { publicId: podcast.publicId, visibility: 'PRIVATE', feedToken });
  }

  // --- Pulizia ---------------------------------------------------------------------

  /** Toglie dall'area pubblica i file di una puntata (se c'erano). */
  async removeEpisodeFiles(episode: Pick<EpisodeRow, 'audioKey' | 'publicAudioKey'>): Promise<void> {
    if (episode.publicAudioKey) await this.storage.deleteObject(episode.publicAudioKey).catch(() => undefined);
    if (episode.audioKey) await this.storage.deleteObject(episode.audioKey).catch(() => undefined);
  }

  /** Toglie tutti i file di una serie (privati e pubblici), compresi feed e copertina. */
  async removeAllFiles(podcast: PodcastRow, episodes: EpisodeRow[]): Promise<void> {
    for (const e of episodes) await this.removeEpisodeFiles(e);
    if (podcast.coverKey) {
      await this.storage.deleteObject(podcast.coverKey).catch(() => undefined);
      if (this.enabled()) await this.storage.deleteObject(this.keyOf(this.dirOf(podcast), this.coverName(podcast.coverKey))).catch(() => undefined);
    }
    if (this.enabled()) await this.storage.deleteObject(this.keyOf(this.dirOf(podcast), 'feed.xml')).catch(() => undefined);
    this.logger.log(`File del podcast ${podcast.id} rimossi`);
  }
}
