import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ObjectStorage, TranscriptionProvider } from '@scorm/domain';
import type {
  CreateExternalVideo,
  UpdateVideoAsset,
  VideoAssetView,
} from '@scorm/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { OBJECT_STORAGE, TRANSCRIPTION_PROVIDER } from '../providers/provider.constants.js';

const VIDEO_URL_TTL_SEC = 6 * 3600;

/** Filtri per la lista della libreria video. */
export interface ListVideosFilter {
  /** Filtra per sorgente (upload/youtube/vimeo/twitch). */
  source?: 'upload' | 'youtube' | 'vimeo' | 'twitch';
  /** Filtra per canale/raccolta. */
  channel?: string;
}

/**
 * Repository video per-tenant: video caricati (storage) e riferimenti esterni
 * (YouTube/Vimeo/Twitch). I video caricati vengono trascritti automaticamente
 * (ASR) in background. Un VideoAsset è riutilizzabile nei block video_checkpoint.
 */
@Injectable()
export class VideosService {
  private readonly logger = new Logger(VideosService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(TRANSCRIPTION_PROVIDER) private readonly transcription: TranscriptionProvider,
  ) {}

  async list(tenantId: string, filter: ListVideosFilter = {}): Promise<VideoAssetView[]> {
    const where: { tenantId: string; source?: 'UPLOAD' | 'YOUTUBE' | 'VIMEO' | 'TWITCH'; channel?: string } = {
      tenantId,
    };
    if (filter.source) where.source = filter.source.toUpperCase() as typeof where.source;
    if (filter.channel) where.channel = filter.channel;
    const rows = await this.prisma.videoAsset.findMany({ where, orderBy: { createdAt: 'desc' } });
    return Promise.all(rows.map((r) => this.toView(r)));
  }

  /** Elenco dei canali distinti (per raggruppare la libreria). */
  async channels(tenantId: string): Promise<string[]> {
    const rows = await this.prisma.videoAsset.findMany({
      where: { tenantId, channel: { not: null } },
      select: { channel: true },
      distinct: ['channel'],
      orderBy: { channel: 'asc' },
    });
    return rows.map((r) => r.channel!).filter(Boolean);
  }

  async get(tenantId: string, id: string): Promise<VideoAssetView> {
    const row = await this.prisma.videoAsset.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Video non trovato');
    return this.toView(row);
  }

  /** Registra un video esterno (YouTube/Vimeo/Twitch) nella libreria. */
  async createExternal(tenantId: string, input: CreateExternalVideo): Promise<VideoAssetView> {
    const externalId = parseExternalId(input.source, input.externalUrl);
    if (!externalId) {
      throw new BadRequestException(`URL ${input.source} non valido o non riconosciuto`);
    }
    const row = await this.prisma.videoAsset.create({
      data: {
        tenantId,
        title: input.title,
        description: input.description ?? '',
        source: input.source.toUpperCase() as 'YOUTUBE' | 'VIMEO' | 'TWITCH',
        externalUrl: input.externalUrl,
        externalId,
        channel: input.channel ?? null,
      },
    });
    return this.toView(row);
  }

  /** Carica un file video nella libreria e avvia la trascrizione ASR. */
  async uploadVideo(
    tenantId: string,
    file: { mimeType: string; content: Buffer; filename?: string },
    meta: { title?: string; channel?: string },
  ): Promise<VideoAssetView> {
    const ext = extForVideoMime(file.mimeType);
    if (!ext) throw new BadRequestException('Formato video non supportato (usa MP4 o WebM).');
    const MAX_BYTES = 200 * 1024 * 1024;
    if (file.content.byteLength > MAX_BYTES) {
      throw new BadRequestException('Video troppo grande (max 200MB).');
    }
    const key = `videos/${tenantId}/${randomUUID()}.${ext}`;
    await this.storage.putObject(key, file.content, { contentType: file.mimeType });
    const title = (meta.title ?? file.filename ?? 'Video').replace(/\.[^.]+$/, '').slice(0, 140) || 'Video';
    const row = await this.prisma.videoAsset.create({
      data: {
        tenantId,
        title,
        source: 'UPLOAD',
        storageKey: key,
        mimeType: file.mimeType,
        sizeBytes: file.content.byteLength,
        channel: meta.channel ?? null,
        transcriptStatus: 'PROCESSING',
      },
    });
    // ASR in background (non blocca la risposta dell'upload).
    void this.transcribeInBackground(row.id, key, file.mimeType);
    return this.toView(row);
  }

  async update(tenantId: string, id: string, input: UpdateVideoAsset): Promise<VideoAssetView> {
    await this.get(tenantId, id);
    const row = await this.prisma.videoAsset.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.channel !== undefined ? { channel: input.channel } : {}),
      },
    });
    return this.toView(row);
  }

  async delete(tenantId: string, id: string): Promise<void> {
    const row = await this.prisma.videoAsset.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Video non trovato');
    // Best-effort: rimuove anche il file dallo storage (se caricato).
    if (row.storageKey) {
      try {
        await this.storage.deleteObject(row.storageKey);
      } catch {
        /* file non rimovibile: si procede comunque con la cancellazione del record */
      }
    }
    await this.prisma.videoAsset.delete({ where: { id } });
  }

  /** Trascrive un video caricato e salva le cue nel record. Best-effort. */
  private async transcribeInBackground(id: string, storageKey: string, contentType: string): Promise<void> {
    try {
      const result = await this.transcription.transcribe({ storageKey, contentType });
      const transcript = result.segments.map((s, i) => ({
        id: `cue-${i}`,
        start: s.start,
        end: s.end,
        ...(s.speaker ? { speaker: s.speaker } : {}),
        text: s.text,
      }));
      await this.prisma.videoAsset.update({
        where: { id },
        data: { transcript: transcript as object, transcriptStatus: 'READY' },
      });
      this.logger.log(`Trascrizione video ${id}: ${transcript.length} segmenti`);
    } catch (err) {
      this.logger.warn(`Trascrizione video ${id} fallita: ${err instanceof Error ? err.message : 'errore'}`);
      await this.prisma.videoAsset
        .update({ where: { id }, data: { transcriptStatus: 'FAILED' } })
        .catch(() => undefined);
    }
  }

  private async toView(row: {
    id: string;
    title: string;
    description: string;
    source: string;
    storageKey: string | null;
    externalUrl: string | null;
    externalId: string | null;
    channel: string | null;
    thumbnailKey: string | null;
    durationSec: number | null;
    transcript: unknown;
    transcriptStatus: string;
    createdAt: Date;
  }): Promise<VideoAssetView> {
    const sign = async (key: string | null): Promise<string | null> => {
      if (!key) return null;
      try {
        return await this.storage.getSignedUrl(key, { expiresInSec: VIDEO_URL_TTL_SEC });
      } catch {
        return null;
      }
    };
    const url = row.source === 'UPLOAD' ? await sign(row.storageKey) : row.externalUrl;
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      source: row.source.toLowerCase() as VideoAssetView['source'],
      url,
      externalUrl: row.externalUrl,
      externalId: row.externalId,
      channel: row.channel,
      thumbnailUrl: await sign(row.thumbnailKey),
      durationSec: row.durationSec,
      transcript: Array.isArray(row.transcript) ? (row.transcript as VideoAssetView['transcript']) : [],
      transcriptStatus: row.transcriptStatus.toLowerCase() as VideoAssetView['transcriptStatus'],
      createdAt: row.createdAt.toISOString(),
    };
  }
}

/** Estrae l'id del video dalla piattaforma esterna a partire dall'URL. */
export function parseExternalId(source: 'youtube' | 'vimeo' | 'twitch', url: string): string | null {
  if (source === 'youtube') {
    const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/))([\w-]{11})/);
    return m ? m[1]! : null;
  }
  if (source === 'vimeo') {
    const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    return m ? m[1]! : null;
  }
  if (source === 'twitch') {
    const m = url.match(/twitch\.tv\/videos\/(\d+)/);
    return m ? m[1]! : null;
  }
  return null;
}

/** Estensione file per i MIME video supportati (null se non supportato). */
function extForVideoMime(mime: string): string | null {
  switch (mime) {
    case 'video/mp4':
      return 'mp4';
    case 'video/webm':
      return 'webm';
    default:
      return null;
  }
}
