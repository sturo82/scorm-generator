import {
  TranscribeClient,
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  type MediaFormat,
} from '@aws-sdk/client-transcribe';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import {
  type TranscriptionProvider,
  type TranscribeInput,
  type TranscribeResult,
  type TranscribeJobResult,
  type TranscriptSegment,
  ProviderUnavailableError,
} from '@scorm/domain';

export interface TranscribeProviderOptions {
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  /** Bucket S3 che contiene i file di input (video caricati). */
  inputBucket: string;
  /** Bucket S3 dove Transcribe scrive il JSON di output (default: inputBucket). */
  outputBucket?: string;
  /** Lingua di default se non indicata nell'input (altrimenti auto-detect). */
  defaultLanguage?: string;
  /** Timeout massimo del polling in ms (default 10 min). */
  pollTimeoutMs?: number;
  /** Intervallo di polling in ms (default 5s). */
  pollIntervalMs?: number;
}

/** Risultato grezzo del JSON di Amazon Transcribe (parti che ci servono). */
interface TranscribeJson {
  results?: {
    items?: Array<{
      start_time?: string;
      end_time?: string;
      type?: string;
      alternatives?: Array<{ content?: string }>;
    }>;
    audio_segments?: Array<{ start_time?: string; end_time?: string; transcript?: string }>;
  };
}

/**
 * Adapter TranscriptionProvider su Amazon Transcribe. Flusso asincrono:
 * StartTranscriptionJob (legge il media da S3, scrive il JSON su S3) → polling
 * di GetTranscriptionJob fino a COMPLETED → fetch e parse del JSON in segmenti
 * con timestamp. Usa `audio_segments` quando disponibili (frasi già aggregate),
 * altrimenti aggrega gli `items` parola per parola.
 *
 * Le credenziali restano server-side: opzioni o default credential chain AWS.
 */
export class TranscribeProvider implements TranscriptionProvider {
  readonly id = 'transcribe';
  private readonly client: TranscribeClient;
  private readonly s3: S3Client;
  private readonly inputBucket: string;
  private readonly outputBucket: string;
  private readonly defaultLanguage?: string;
  private readonly pollTimeoutMs: number;
  private readonly pollIntervalMs: number;

  constructor(opts: TranscribeProviderOptions) {
    this.inputBucket = opts.inputBucket;
    this.outputBucket = opts.outputBucket ?? opts.inputBucket;
    this.defaultLanguage = opts.defaultLanguage;
    this.pollTimeoutMs = opts.pollTimeoutMs ?? 10 * 60_000;
    this.pollIntervalMs = opts.pollIntervalMs ?? 5_000;
    const region = opts.region ?? 'us-east-1';
    const credentials =
      opts.accessKeyId && opts.secretAccessKey
        ? {
            accessKeyId: opts.accessKeyId,
            secretAccessKey: opts.secretAccessKey,
            sessionToken: opts.sessionToken,
          }
        : undefined;
    this.client = new TranscribeClient({ region, credentials });
    // Il JSON di output è scritto nel nostro bucket (privato): va letto con le
    // credenziali via SDK, non con una fetch dell'URL pubblico (che tornerebbe
    // un XML "Access Denied"). Stessa region del bucket di output.
    this.s3 = new S3Client({ region, credentials });
  }

  /** Chiave S3 dell'output JSON, derivata in modo deterministico dal job name. */
  private outputKeyFor(jobRef: string): string {
    return `transcripts/${jobRef}.json`;
  }

  /** Avvia un job Transcribe e ritorna il suo nome come riferimento persistibile. */
  async startJob(input: TranscribeInput): Promise<{ jobRef: string }> {
    const jobName = `scorm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const mediaFormat = formatForContentType(input.contentType) ?? 'mp4';
    try {
      await this.client.send(
        new StartTranscriptionJobCommand({
          TranscriptionJobName: jobName,
          Media: { MediaFileUri: `s3://${this.inputBucket}/${input.storageKey}` },
          MediaFormat: mediaFormat as MediaFormat,
          OutputBucketName: this.outputBucket,
          OutputKey: this.outputKeyFor(jobName),
          ...(input.language || this.defaultLanguage
            ? { LanguageCode: (input.language ?? this.defaultLanguage) as never }
            : { IdentifyLanguage: true }),
        }),
      );
    } catch (err) {
      throw new ProviderUnavailableError('transcribe', err);
    }
    return { jobRef: jobName };
  }

  /**
   * Recupera lo stato di un job avviato con startJob. Idempotente: funziona
   * anche dopo un riavvio del processo (interroga AWS per nome job e, se
   * completato, legge il JSON dal nostro bucket via SDK).
   */
  async fetchJob(jobRef: string): Promise<TranscribeJobResult> {
    let job;
    try {
      const res = await this.client.send(
        new GetTranscriptionJobCommand({ TranscriptionJobName: jobRef }),
      );
      job = res.TranscriptionJob;
    } catch (err) {
      // Job inesistente o errore AWS: trattalo come fallimento recuperabile.
      return { status: 'failed', reason: err instanceof Error ? err.message : 'Job non trovato' };
    }
    const status = job?.TranscriptionJobStatus;
    if (status === 'FAILED') {
      return { status: 'failed', reason: job?.FailureReason ?? 'Job fallito' };
    }
    if (status !== 'COMPLETED') {
      return { status: 'processing' };
    }
    // Completato: leggi il JSON dal NOSTRO bucket via SDK (il bucket è privato,
    // una fetch dell'URL pubblico tornerebbe un XML di Access Denied).
    try {
      const obj = await this.s3.send(
        new GetObjectCommand({ Bucket: this.outputBucket, Key: this.outputKeyFor(jobRef) }),
      );
      const body = await obj.Body?.transformToString();
      if (!body) throw new Error('Corpo trascrizione vuoto');
      const json = JSON.parse(body) as TranscribeJson;
      return {
        status: 'completed',
        result: { segments: parseSegments(json), language: job?.LanguageCode },
      };
    } catch (err) {
      return { status: 'failed', reason: err instanceof Error ? err.message : 'Lettura risultato fallita' };
    }
  }

  /**
   * Trascrizione sincrona: avvia il job e attende (polling) il risultato.
   * Costruita su startJob/fetchJob. Non resiliente a un riavvio del processo
   * durante l'attesa (per quello usare startJob + fetchJob dal chiamante).
   */
  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    const { jobRef } = await this.startJob(input);
    const deadline = Date.now() + this.pollTimeoutMs;
    for (;;) {
      if (Date.now() > deadline) {
        throw new ProviderUnavailableError('transcribe', new Error('Timeout trascrizione'));
      }
      await sleep(this.pollIntervalMs);
      const r = await this.fetchJob(jobRef);
      if (r.status === 'completed') return r.result;
      if (r.status === 'failed') {
        throw new ProviderUnavailableError('transcribe', new Error(r.reason));
      }
    }
  }
}

/** Estrae i segmenti con timestamp dal JSON di Transcribe. */
function parseSegments(json: TranscribeJson): TranscriptSegment[] {
  const r = json.results;
  if (!r) return [];
  // Preferisci gli items (parole con timestamp al millisecondo): permettono
  // cue brevi e un karaoke ben sincronizzato. Gli audio_segments di Transcribe
  // possono essere lunghi 15-30s (una cue sola = evidenziazione inutile), quindi
  // li usiamo solo come fallback quando gli items non sono disponibili.
  const items = r.items ?? [];
  if (items.length > 0) {
    return splitItemsIntoCues(items);
  }
  // Fallback: usa audio_segments ma spezza quelli troppo lunghi in finestre
  // temporali uniformi, così da non avere mai una singola cue monolitica.
  if (Array.isArray(r.audio_segments) && r.audio_segments.length > 0) {
    return r.audio_segments
      .filter((s) => s.transcript && s.transcript.trim())
      .flatMap((s) =>
        splitLongSegment(Number(s.start_time ?? 0), Number(s.end_time ?? 0), (s.transcript ?? '').trim()),
      );
  }
  return [];
}

/** Durata massima (s) e numero massimo di parole per una cue karaoke. */
const MAX_CUE_SECONDS = 6;
const MAX_CUE_WORDS = 12;

/**
 * Aggrega gli items (parole + punteggiatura) in cue brevi. Chiude la cue
 * corrente quando: supera la durata/parole massime, oppure incontra una
 * punteggiatura forte (. ! ? …), oppure c'è una pausa evidente tra parole.
 */
function splitItemsIntoCues(
  items: Array<{ start_time?: string; end_time?: string; type?: string; alternatives?: Array<{ content?: string }> }>,
): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let cur: { start: number; end: number; words: string[] } | null = null;
  const flush = () => {
    if (cur && cur.words.length > 0) {
      const text = cur.words.join(' ').replace(/\s+([.,!?;:…])/g, '$1').trim();
      // Scarta cue vuote o di durata nulla (es. filler finale "um."): non
      // possono evidenziare nulla nel karaoke.
      if (text && cur.end > cur.start) {
        segments.push({ start: cur.start, end: cur.end, text });
      }
    }
    cur = null;
  };
  let prevEnd = 0;
  for (const it of items) {
    const word = it.alternatives?.[0]?.content ?? '';
    if (!word) continue;
    if (it.type === 'punctuation') {
      if (cur) cur.words.push(word);
      // Punteggiatura forte: chiude la frase (confine naturale).
      if (/[.!?…]/.test(word)) flush();
      continue;
    }
    const start = Number(it.start_time ?? prevEnd);
    const end = Number(it.end_time ?? start);
    // Pausa evidente (> 0.6s) dall'ultima parola: confine naturale.
    if (cur && start - prevEnd > 0.6) flush();
    if (!cur) cur = { start, end, words: [] };
    cur.words.push(word);
    cur.end = end;
    prevEnd = end;
    // Limiti di durata/lunghezza: chiude per mantenere le cue brevi.
    if (cur.end - cur.start >= MAX_CUE_SECONDS || cur.words.length >= MAX_CUE_WORDS) flush();
  }
  flush();
  return segments;
}

/**
 * Spezza un segmento lungo (senza timestamp per parola) in cue più corte
 * distribuendo le parole uniformemente nell'intervallo [start, end]. Non è
 * preciso quanto gli items, ma evita cue monolitiche nel fallback.
 */
function splitLongSegment(start: number, end: number, text: string): TranscriptSegment[] {
  const duration = Math.max(0, end - start);
  if (duration <= MAX_CUE_SECONDS) return [{ start, end, text }];
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const chunks = Math.ceil(duration / MAX_CUE_SECONDS);
  const wordsPerChunk = Math.ceil(words.length / chunks);
  const perChunkSec = duration / chunks;
  const out: TranscriptSegment[] = [];
  for (let i = 0; i < chunks; i++) {
    const slice = words.slice(i * wordsPerChunk, (i + 1) * wordsPerChunk);
    if (slice.length === 0) continue;
    out.push({
      start: Number((start + i * perChunkSec).toFixed(3)),
      end: Number((start + (i + 1) * perChunkSec).toFixed(3)),
      text: slice.join(' '),
    });
  }
  return out;
}

function formatForContentType(ct?: string): string | null {
  if (!ct) return null;
  if (ct.includes('mp4')) return 'mp4';
  if (ct.includes('webm')) return 'webm';
  if (ct.includes('mpeg') || ct.includes('mp3')) return 'mp3';
  if (ct.includes('wav')) return 'wav';
  if (ct.includes('ogg')) return 'ogg';
  if (ct.includes('flac')) return 'flac';
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
