import { Buffer } from 'node:buffer';
import { PollyClient, SynthesizeSpeechCommand, type Engine } from '@aws-sdk/client-polly';
import {
  type SpeechProvider,
  type SpeechSynthesizeInput,
  type SpeechSynthesizeResult,
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

  private voiceForLanguage(language?: string): string | undefined {
    if (!language) return undefined;
    return VOICE_BY_LANGUAGE[language] ?? VOICE_BY_LANGUAGE[language.split('-')[0]!];
  }
}
