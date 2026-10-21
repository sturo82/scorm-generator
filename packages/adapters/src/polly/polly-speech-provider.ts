import { Buffer } from 'node:buffer';
import { PollyClient, SynthesizeSpeechCommand, type Engine } from '@aws-sdk/client-polly';
import {
  type SpeechProvider,
  type SpeechSynthesizeInput,
  type SpeechSynthesizeResult,
  type SpeechSynthesizeWithMarksResult,
  type SpeechWordMark,
  ProviderUnavailableError,
} from '@scorm/domain';

export interface PollySpeechProviderOptions {
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  /** Engine Polly: "neural" (default) o "standard". */
  engine?: Engine;
  /** Voce di default se non specificata nell'input e lingua non mappata. */
  defaultVoice?: string;
}

/**
 * Voce neurale di default per lingua (Amazon Polly). Copre le lingue più comuni
 * dei corsi; per lingue non mappate si usa `defaultVoice`.
 */
const VOICE_BY_LANGUAGE: Record<string, string> = {
  it: 'Bianca',
  'it-IT': 'Bianca',
  en: 'Joanna',
  'en-US': 'Joanna',
  'en-GB': 'Amy',
  es: 'Lucia',
  'es-ES': 'Lucia',
  fr: 'Lea',
  'fr-FR': 'Lea',
  de: 'Vicki',
  'de-DE': 'Vicki',
  pt: 'Ines',
  'pt-PT': 'Ines',
};

/**
 * Adapter SpeechProvider su Amazon Polly (text-to-speech batch). Sintetizza il
 * testo in un MP3 con una voce neurale coerente con la lingua. Le credenziali
 * restano server-side (Requisito 10.5): opzioni o default credential chain.
 */
export class PollySpeechProvider implements SpeechProvider {
  readonly id = 'polly';
  private readonly client: PollyClient;
  private readonly engine: Engine;
  private readonly defaultVoice: string;

  constructor(opts: PollySpeechProviderOptions = {}) {
    this.engine = opts.engine ?? 'neural';
    this.defaultVoice = opts.defaultVoice ?? 'Joanna';
    this.client = new PollyClient({
      region: opts.region ?? 'us-west-2',
      credentials:
        opts.accessKeyId && opts.secretAccessKey
          ? {
              accessKeyId: opts.accessKeyId,
              secretAccessKey: opts.secretAccessKey,
              sessionToken: opts.sessionToken,
            }
          : undefined,
    });
  }

  async synthesize(input: SpeechSynthesizeInput): Promise<SpeechSynthesizeResult> {
    const voice = input.voice ?? this.voiceForLanguage(input.language) ?? this.defaultVoice;
    // Engine per-richiesta (scelta del corso/generazione) con fallback al default
    // del provider. Le voci usate (Bianca, Joanna, Amy, Lucia, Lea, Vicki, Ines)
    // supportano sia 'standard' sia 'neural' su Polly.
    const engine: Engine = input.engine ?? this.engine;

    let response;
    try {
      response = await this.client.send(
        new SynthesizeSpeechCommand({
          Text: input.text,
          OutputFormat: 'mp3',
          VoiceId: voice as never,
          Engine: engine,
        }),
      );
    } catch (err) {
      throw new ProviderUnavailableError('polly', err);
    }

    const stream = response.AudioStream;
    if (!stream) throw new ProviderUnavailableError('polly', new Error('AudioStream vuoto'));
    const bytes = await (stream as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();

    // Riporta l'engine effettivo ai fini del metering. Il port espone solo le
    // due classi di costo rilevanti ('standard'|'neural'); gli engine Polly più
    // nuovi (generative/long-form) non sono usati qui, ma se lo fossero li
    // riconduciamo a 'neural' (classe di costo premium) per sicurezza.
    const reportedEngine: 'standard' | 'neural' = engine === 'standard' ? 'standard' : 'neural';

    return {
      bytes: Buffer.from(bytes),
      contentType: 'audio/mpeg',
      voice,
      engine: reportedEngine,
    };
  }

  /**
   * Sintesi CON speech marks a livello di parola. Polly ha un limite di ~3000
   * caratteri FATTURABILI per chiamata sincrona (SynthesizeSpeechCommand): i
   * voiceover lunghi (video-lezione di qualche minuto) lo superano e
   * fallirebbero con TextLengthExceededException. Per questo spezziamo il testo
   * in CHUNK ai confini di frase (<= MAX_TTS_CHARS), sintetizziamo ciascun chunk
   * (MP3 + marks) e CONCATENIAMO: gli MP3 in sequenza, i word-marks con offset
   * cumulativo (il tempo di ogni chunk riparte da 0, quindi va traslato della
   * durata dei chunk precedenti). Il taglio ai confini di frase riduce al minimo
   * il drift di sync tra un chunk e il successivo.
   */
  async synthesizeWithMarks(input: SpeechSynthesizeInput): Promise<SpeechSynthesizeWithMarksResult> {
    const voice = input.voice ?? this.voiceForLanguage(input.language) ?? this.defaultVoice;
    const engine: Engine = input.engine ?? this.engine;
    const chunks = splitTextForTts(input.text, MAX_TTS_CHARS);

    // Caso comune (testo breve): una sola chiamata, nessun offset. Veloce.
    if (chunks.length <= 1) {
      const only = await this.synthesizeChunk(input.text, voice, engine);
      return {
        bytes: only.audio,
        contentType: 'audio/mpeg',
        voice,
        engine: only.reportedEngine,
        marks: only.marks,
      };
    }

    // Testo lungo: sintetizza ogni chunk e concatena audio + marks (offset).
    const audioParts: Buffer[] = [];
    const allMarks: SpeechWordMark[] = [];
    let offsetMs = 0;
    let reportedEngine: 'standard' | 'neural' = 'neural';
    for (const chunk of chunks) {
      const res = await this.synthesizeChunk(chunk, voice, engine);
      reportedEngine = res.reportedEngine;
      audioParts.push(res.audio);
      for (const m of res.marks) {
        allMarks.push({ word: m.word, startMs: m.startMs + offsetMs, endMs: m.endMs + offsetMs });
      }
      // Avanza l'offset della durata stimata di questo chunk: fine dell'ultima
      // parola + una piccola coda (pausa di frase). Senza decodificare l'MP3,
      // l'ultimo mark è la stima migliore della durata del chunk.
      const lastMark = res.marks[res.marks.length - 1];
      const chunkEndMs = lastMark ? Math.max(lastMark.startMs, lastMark.endMs) : 0;
      offsetMs += chunkEndMs + CHUNK_GAP_MS;
    }
    // Ricalcola endMs come start della parola successiva (coerente con la
    // semantica di parsePollySpeechMarks), così il karaoke scorre senza buchi.
    for (let i = 0; i < allMarks.length - 1; i++) {
      allMarks[i]!.endMs = allMarks[i + 1]!.startMs;
    }

    return {
      bytes: Buffer.concat(audioParts),
      contentType: 'audio/mpeg',
      voice,
      engine: reportedEngine,
      marks: allMarks,
    };
  }

  /** Sintesi di UN chunk: MP3 + word-marks, con una coppia di chiamate Polly. */
  private async synthesizeChunk(
    text: string,
    voice: string,
    engine: Engine,
  ): Promise<{ audio: Buffer; marks: SpeechWordMark[]; reportedEngine: 'standard' | 'neural' }> {
    let audioResponse;
    let marksResponse;
    try {
      audioResponse = await this.client.send(
        new SynthesizeSpeechCommand({
          Text: text,
          OutputFormat: 'mp3',
          VoiceId: voice as never,
          Engine: engine,
        }),
      );
      marksResponse = await this.client.send(
        new SynthesizeSpeechCommand({
          Text: text,
          OutputFormat: 'json',
          SpeechMarkTypes: ['word'],
          VoiceId: voice as never,
          Engine: engine,
        }),
      );
    } catch (err) {
      throw new ProviderUnavailableError('polly', err);
    }

    const audioStream = audioResponse.AudioStream;
    if (!audioStream) throw new ProviderUnavailableError('polly', new Error('AudioStream vuoto'));
    const audioBytes = await (audioStream as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();

    const marksStream = marksResponse.AudioStream;
    if (!marksStream) throw new ProviderUnavailableError('polly', new Error('SpeechMarks vuoti'));
    const marksRaw = await (marksStream as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
    const marks = parsePollySpeechMarks(Buffer.from(marksRaw).toString('utf8'));

    const reportedEngine: 'standard' | 'neural' = engine === 'standard' ? 'standard' : 'neural';
    return { audio: Buffer.from(audioBytes), marks, reportedEngine };
  }

  private voiceForLanguage(language?: string): string | undefined {
    if (!language) return undefined;
    return VOICE_BY_LANGUAGE[language] ?? VOICE_BY_LANGUAGE[language.split('-')[0]!];
  }
}

/**
 * Limite di caratteri per chunk TTS. Polly consente ~3000 caratteri FATTURABILI
 * per SynthesizeSpeechCommand sincrona; stiamo sotto con margine per sicurezza.
 */
export const MAX_TTS_CHARS = 2800;

/** Coda (ms) aggiunta tra un chunk e il successivo (pausa naturale di frase). */
const CHUNK_GAP_MS = 150;

/**
 * Spezza un testo in chunk <= maxChars tagliando ai confini di FRASE (., !, ?,
 * newline), così ogni chunk è pronunciabile in modo naturale e il punto di
 * giunzione cade su una pausa. Se una singola frase supera maxChars, la spezza
 * ulteriormente ai confini di parola. Funzione pura: testabile.
 */
export function splitTextForTts(text: string, maxChars = MAX_TTS_CHARS): string[] {
  const trimmed = (text ?? '').trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  // Spezza in frasi conservando la punteggiatura di chiusura.
  const sentences = trimmed.match(/[^.!?\n]+[.!?\n]*\s*/g) ?? [trimmed];
  const chunks: string[] = [];
  let current = '';
  const pushCurrent = (): void => {
    const c = current.trim();
    if (c.length > 0) chunks.push(c);
    current = '';
  };
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      // Frase troppo lunga: svuota il buffer e spezza per parole.
      pushCurrent();
      let wordBuf = '';
      for (const word of sentence.split(/\s+/)) {
        if ((wordBuf + ' ' + word).trim().length > maxChars) {
          const w = wordBuf.trim();
          if (w.length > 0) chunks.push(w);
          wordBuf = word;
        } else {
          wordBuf = wordBuf ? `${wordBuf} ${word}` : word;
        }
      }
      if (wordBuf.trim().length > 0) current = wordBuf.trim();
      continue;
    }
    if ((current + sentence).length > maxChars) pushCurrent();
    current += sentence;
  }
  pushCurrent();
  return chunks;
}

/**
 * Converte l'output NDJSON degli speech marks di Polly in WordMark[]. Ogni riga
 * è un JSON tipo `{"time":500,"type":"word","start":5,"end":10,"value":"mondo"}`
 * dove `time` è l'offset in ms della parola. `endMs` di ciascuna parola è lo
 * `startMs` della successiva (l'ultima resta senza fine nota: endMs = startMs).
 * Robusto a righe vuote/malformate (ignorate). Funzione pura: testabile.
 */
export function parsePollySpeechMarks(ndjson: string): SpeechWordMark[] {
  const marks: SpeechWordMark[] = [];
  for (const line of ndjson.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: { time?: unknown; type?: unknown; value?: unknown };
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue; // riga non JSON: ignorata
    }
    if (obj.type !== 'word') continue;
    const time = typeof obj.time === 'number' ? obj.time : Number(obj.time);
    const value = typeof obj.value === 'string' ? obj.value : '';
    if (!Number.isFinite(time)) continue;
    marks.push({ word: value, startMs: time, endMs: time });
  }
  // endMs = start della parola successiva (ultima parola: resta uguale a start).
  for (let i = 0; i < marks.length - 1; i++) {
    marks[i]!.endMs = marks[i + 1]!.startMs;
  }
  return marks;
}
