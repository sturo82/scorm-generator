import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import {
  type EmbeddingsProvider,
  ProviderUnavailableError,
} from '@scorm/domain';

export interface BedrockEmbeddingsProviderOptions {
  /** Modello di embeddings (es. amazon.titan-embed-text-v2:0). */
  modelId: string;
  /** Dimensione dei vettori prodotti dal modello (es. 1024 per Titan v2). */
  dimensions: number;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
}

/**
 * Adapter EmbeddingsProvider su Amazon Bedrock (famiglia Titan Embeddings).
 * Invoca il modello una volta per testo (Titan accetta un input alla volta) e
 * restituisce i vettori nello stesso ordine. Credenziali solo server-side.
 */
export class BedrockEmbeddingsProvider implements EmbeddingsProvider {
  readonly id = 'bedrock';
  readonly dimensions: number;
  private readonly client: BedrockRuntimeClient;
  private readonly modelId: string;

  constructor(opts: BedrockEmbeddingsProviderOptions) {
    this.modelId = opts.modelId;
    this.dimensions = opts.dimensions;
    this.client = new BedrockRuntimeClient({
      region: opts.region ?? 'us-east-1',
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

  async embed(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embedOne(text));
    }
    return results;
  }

  private async embedOne(text: string): Promise<number[]> {
    const body = JSON.stringify({ inputText: text, dimensions: this.dimensions });
    try {
      const res = await this.client.send(
        new InvokeModelCommand({
          modelId: this.modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body,
        }),
      );
      const decoded = JSON.parse(new TextDecoder().decode(res.body)) as {
        embedding?: number[];
      };
      if (!decoded.embedding) throw new ProviderUnavailableError('bedrock');
      return decoded.embedding;
    } catch (err) {
      if (err instanceof ProviderUnavailableError) throw err;
      throw new ProviderUnavailableError('bedrock', err);
    }
  }
}
