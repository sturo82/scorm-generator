import { Buffer } from 'node:buffer';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import {
  type ImageGenerateInput,
  type ImageGenerateResult,
  type ImageProvider,
  ProviderUnavailableError,
} from '@scorm/domain';

export interface BedrockImageProviderOptions {
  /** ID del modello (default: stability.stable-image-core-v1:1). */
  modelId?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  /** Formato di output immagine ("png" | "jpeg" | "webp"). Default png. */
  outputFormat?: 'png' | 'jpeg' | 'webp';
}

const CONTENT_TYPE: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

interface StableImageResponse {
  seeds?: number[];
  finish_reasons?: Array<string | null>;
  images?: string[];
}

/**
 * Adapter ImageProvider su Amazon Bedrock con i modelli Stability AI
 * (Stable Image Core/Ultra). Genera immagini da testo via InvokeModel: il body
 * contiene il prompt, la risposta immagini in base64. Le credenziali restano
 * server-side (Requisito 10.5): opzioni o default credential chain.
 */
export class BedrockImageProvider implements ImageProvider {
  readonly id = 'bedrock-stability';
  private readonly client: BedrockRuntimeClient;
  private readonly modelId: string;
  private readonly outputFormat: 'png' | 'jpeg' | 'webp';

  constructor(opts: BedrockImageProviderOptions = {}) {
    this.modelId = opts.modelId ?? 'stability.stable-image-core-v1:1';
    this.outputFormat = opts.outputFormat ?? 'png';
    this.client = new BedrockRuntimeClient({
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

  async generate(input: ImageGenerateInput): Promise<ImageGenerateResult> {
    const body: Record<string, unknown> = {
      prompt: input.prompt,
      output_format: this.outputFormat,
    };
    if (input.negativePrompt) body.negative_prompt = input.negativePrompt;
    if (typeof input.seed === 'number') body.seed = input.seed;
    if (input.width && input.height) {
      body.aspect_ratio = aspectRatio(input.width, input.height);
    }

    let response;
    try {
      response = await this.client.send(
        new InvokeModelCommand({
          modelId: this.modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify(body),
        }),
      );
    } catch (err) {
      throw new ProviderUnavailableError('bedrock-stability', err);
    }

    const parsed = JSON.parse(Buffer.from(response.body).toString('utf-8')) as StableImageResponse;
    const reason = parsed.finish_reasons?.[0];
    if (reason) {
      // null = successo; qualsiasi stringa indica un filtro o un errore.
      throw new ProviderUnavailableError('bedrock-stability', new Error(reason));
    }
    const b64 = parsed.images?.[0];
    if (!b64) throw new ProviderUnavailableError('bedrock-stability', new Error('Nessuna immagine prodotta'));

    return {
      bytes: new Uint8Array(Buffer.from(b64, 'base64')),
      contentType: CONTENT_TYPE[this.outputFormat] ?? 'image/png',
      model: this.modelId,
    };
  }
}

/**
 * Converte una coppia larghezza/altezza nell'aspect ratio supportato più vicino
 * (Stable Image accetta un set discreto, non dimensioni arbitrarie).
 */
export function aspectRatio(width: number, height: number): string {
  const supported: Array<[string, number]> = [
    ['21:9', 21 / 9],
    ['16:9', 16 / 9],
    ['3:2', 3 / 2],
    ['5:4', 5 / 4],
    ['1:1', 1],
    ['4:5', 4 / 5],
    ['2:3', 2 / 3],
    ['9:16', 9 / 16],
    ['9:21', 9 / 21],
  ];
  const target = width / height;
  let best = supported[0]!;
  for (const entry of supported) {
    if (Math.abs(entry[1] - target) < Math.abs(best[1] - target)) best = entry;
  }
  return best[0];
}
