/**
 * Porta per la generazione di VIDEO da testo (text-to-video), usata per i
 * mini-cartoon delle scene nel formato "pillole" (libro-game). A differenza di
 * VideoGenerationProvider (avatar parlante che recita uno script), qui il
 * provider genera una SCENA animata da un prompt descrittivo (storyboard).
 *
 * Il flusso è ASINCRONO: startJob avvia la generazione e ritorna un riferimento
 * persistibile; fetchJob ne recupera lo stato e, al termine, la posizione del
 * video prodotto. Default provider: Amazon Nova Reel (Bedrock), che scrive
 * l'output su un bucket S3 — per questo il risultato espone un `s3Uri` (non un
 * URL scaricabile come HeyGen). Il mock produce un video "finto" deterministico.
 */

/** Parametri per avviare la generazione di un mini-cartoon di scena. */
export interface GenerateCartoonInput {
  /** Descrizione/storyboard della scena da animare (prompt text-to-video). */
  prompt: string;
  /**
   * Durata desiderata in secondi. I modelli generano in incrementi (Nova Reel:
   * multipli di 6). L'adapter arrotonda al valore valido più vicino.
   */
  durationSec?: number;
  /** Codice lingua (per audit/eventuali didascalie), es. "it". */
  language?: string;
  /** Rapporto d'aspetto desiderato (es. "16:9"). */
  aspectRatio?: string;
  /**
   * Motore TTS per il voiceover del cartoon: 'neural' (qualità superiore) o
   * 'standard' (economico). Risolto a monte (preferenza del corso → default
   * d'ambiente). Se assente, il provider usa il proprio default.
   */
  speechEngine?: 'standard' | 'neural';
}

/** Esito del recupero di un job di generazione cartoon asincrono. */
export type GenerateCartoonJobResult =
  | { status: 'processing' }
  | {
      status: 'completed';
      /**
       * Byte dell'MP4 prodotto. L'adapter li recupera dall'output del modello
       * (su S3, nella region del provider) e li consegna già pronti: così il
       * servizio li salva nella key canonica dei media SENZA doversi occupare
       * di bucket/region del provider (che possono differire da quelli dell'app).
       */
      bytes: Uint8Array;
      /** Content-type del video (default video/mp4). */
      contentType?: string;
      /** Durata effettiva del video in secondi, se nota (per il metering). */
      durationSec?: number;
    }
  | { status: 'failed'; reason: string };

/** Porta provider-agnostica per la generazione di cartoon da testo. */
export interface TextToVideoProvider {
  readonly id: string;
  /**
   * Avvia la generazione di un cartoon di scena e ritorna un riferimento
   * persistibile (es. l'invocationArn di Bedrock). Lancia in caso di errore del
   * provider (rete, quota, parametri non validi).
   */
  startJob(input: GenerateCartoonInput): Promise<{ jobRef: string }>;
  /**
   * Recupera lo stato/risultato di un job avviato con startJob. Idempotente:
   * può essere richiamato dopo un riavvio del processo.
   */
  fetchJob(jobRef: string): Promise<GenerateCartoonJobResult>;
}
