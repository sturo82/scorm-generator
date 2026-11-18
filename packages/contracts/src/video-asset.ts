import { z } from 'zod';
import { MediaSource } from './primitives.js';
import { TranscriptCue } from './blocks.js';

/**
 * Repository video per-tenant: DTO condivisi tra API e web. Un VideoAsset è un
 * video caricato (storage) o un riferimento a video esterno (YouTube/Vimeo/
 * Twitch), riutilizzabile nei block video_checkpoint delle lezioni.
 */

export const VideoTranscriptStatus = z.enum(['none', 'processing', 'ready', 'failed']);
export type VideoTranscriptStatus = z.infer<typeof VideoTranscriptStatus>;

/** Creazione/registrazione di un video esterno nella libreria. */
export const CreateExternalVideo = z.object({
  title: z.string().trim().min(1).max(140),
  description: z.string().trim().max(2000).default(''),
  /** Sorgente esterna (upload si fa via endpoint multipart dedicato). */
  source: z.enum(['youtube', 'vimeo', 'twitch']),
  /** URL del video sulla piattaforma esterna. */
  externalUrl: z.string().url(),
  /** Canale/raccolta di appartenenza (facoltativo), per raggruppare. */
  channel: z.string().trim().max(140).optional(),
});
export type CreateExternalVideo = z.infer<typeof CreateExternalVideo>;

/** Aggiornamento dei metadati di un video in libreria. */
export const UpdateVideoAsset = z.object({
  title: z.string().trim().min(1).max(140).optional(),
  description: z.string().trim().max(2000).optional(),
  channel: z.string().trim().max(140).nullable().optional(),
});
export type UpdateVideoAsset = z.infer<typeof UpdateVideoAsset>;

/** Payload per salvare/correggere a mano la trascrizione di un block video. */
export const SetVideoTranscript = z.object({
  transcript: z.array(TranscriptCue).default([]),
});
export type SetVideoTranscript = z.infer<typeof SetVideoTranscript>;

/** Vista di un VideoAsset per il client (URL firmati risolti a lettura). */
export const VideoAssetView = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  source: MediaSource,
  /** URL firmato del file (video caricati) o URL esterno (embed). */
  url: z.string().nullable(),
  /** URL firmato che forza il download del file (solo video caricati o creati in piattaforma). */
  downloadUrl: z.string().nullable().default(null),
  externalUrl: z.string().nullable(),
  externalId: z.string().nullable(),
  channel: z.string().nullable(),
  /** URL firmato della thumbnail, se presente. */
  thumbnailUrl: z.string().nullable(),
  durationSec: z.number().int().nullable(),
  transcript: z.array(TranscriptCue).default([]),
  transcriptStatus: VideoTranscriptStatus.default('none'),
  /** Import "video da slide" da cui è nato il video (modificabile da lì), se creato da slide. */
  slideImportId: z.string().nullable().default(null),
  /**
   * Costo di generazione dei video creati da slide. Con i crediti attivi solo in crediti addebitati
   * (`totalCredits`); altrimenti consuntivo misurato in USD (`totalUsd`, uso interno).
   */
  generationCost: z
    .object({
      totalUsd: z.number().optional(),
      totalCredits: z.number().optional(),
      breakdown: z.array(z.object({ label: z.string(), usd: z.number().optional(), credits: z.number().optional() })),
      /** Video nati dallo stesso import (con più sezioni il costo è dell'intero import). */
      sharedBy: z.number().int().positive(),
    })
    .nullable()
    .default(null),
  createdAt: z.string(),
});
export type VideoAssetView = z.infer<typeof VideoAssetView>;
