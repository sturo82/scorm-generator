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
   * Sintesi CON speech marks a livello di parola: due chiamate a Polly, una per
   * l'MP3 e una per i marks (OutputFormat=json, SpeechMarkTypes=['word']). I
   * marks arrivano come NDJSON (una riga JSON per parola); li convertiamo in
   * WordMark[] con start/end in ms. Usato dal code-to-video per il sync.
   */
  async synthesizeWithMarks(input: SpeechSynthesizeInput): Promise<SpeechSynthesizeWithMarksResult> {
    const audio = await this.synthesize(input);
    const voice = input.voice ?? this.voiceForLanguage(input.language) ?? this.defaultVoice;
    const engine: Engine = input.engine ?? this.engine;

    let marksResponse;
    try {
      marksResponse = await this.client.send(
        new SynthesizeSpeechCommand({
          Text: input.text,
          OutputFormat: 'json',
          SpeechMarkTypes: ['word'],
          VoiceId: voice as never,
          Engine: engine,
        }),
      );
    } catch (err) {
      throw new ProviderUnavailableError('polly', err);
    }

    const stream = marksResponse.AudioStream;
    if (!stream) throw new ProviderUnavailableError('polly', new Error('SpeechMarks vuoti'));
    const raw = await (stream as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
    const ndjson = Buffer.from(raw).toString('utf8');
    const marks = parsePollySpeechMarks(ndjson);

    return { ...audio, marks };
  }

  private voiceForLanguage(language?: string): string | undefined {
    if (!language) return undefined;
    return VOICE_BY_LANGUAGE[language] ?? VOICE_BY_LANGUAGE[language.split('-')[0]!];
  }
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
