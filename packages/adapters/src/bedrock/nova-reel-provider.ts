import {
  BedrockRuntimeClient,
  StartAsyncInvokeCommand,
  GetAsyncInvokeCommand,
  type StartAsyncInvokeCommandInput,
} from '@aws-sdk/client-bedrock-runtime';
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import {
  type GenerateCartoonInput,
  type GenerateCartoonJobResult,
  type TextToVideoProvider,
  ProviderUnavailableError,
} from '@scorm/domain';

export interface NovaReelProviderOptions {
  /** ID del modello (default: amazon.nova-reel-v1:0). */
  modelId?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  /**
   * URI S3 di base dove Nova Reel scrive l'output (es. "s3://bucket/nova-reel").
   * Ogni invocazione crea una sottocartella; il video è "<...>/output.mp4".
   */
  outputS3Uri: string;
}

/** Nova Reel genera in incrementi di 6s. Arrotonda al multiplo valido più vicino (6..120). */
function clampDuration(sec?: number): number {
  const s = typeof sec === 'number' && sec > 0 ? sec : 6;
  const rounded = Math.round(s / 6) * 6;
  return Math.min(120, Math.max(6, rounded));
}

/**
 * Adapter TextToVideoProvider su Amazon Nova Reel (Bedrock), per i mini-cartoon
 * delle scene "pillole". Usa l'API ASINCRONA di Bedrock Runtime:
 *  - StartAsyncInvoke avvia la generazione e ritorna un invocationArn;
 *  - l'output (MP4) viene scritto da Bedrock direttamente su S3 (outputS3Uri);
 *  - GetAsyncInvoke(invocationArn) riporta lo stato e l'S3 di output al termine.
 * Le credenziali restano server-side (default credential chain o opzioni).
 */
export class NovaReelProvider implements TextToVideoProvider {
  readonly id = 'nova-reel';
  private readonly client: BedrockRuntimeClient;
  private readonly s3: S3Client;
  private readonly modelId: string;
  private readonly outputS3Uri: string;

  constructor(opts: NovaReelProviderOptions) {
    this.modelId = opts.modelId ?? 'amazon.nova-reel-v1:0';
    this.outputS3Uri = opts.outputS3Uri.replace(/\/+$/, '');
    const region = opts.region ?? 'us-east-1';
    const credentials =
      opts.accessKeyId && opts.secretAccessKey
        ? {
            accessKeyId: opts.accessKeyId,
            secretAccessKey: opts.secretAccessKey,
            sessionToken: opts.sessionToken,
          }
        : undefined;
    this.client = new BedrockRuntimeClient({ region, credentials });
    this.s3 = new S3Client({ region, credentials });
  }

  async startJob(input: GenerateCartoonInput): Promise<{ jobRef: string }> {
    const durationSeconds = clampDuration(input.durationSec);
    try {
      // modelInput è un "document" (JSON libero) lato SDK: costruiamo l'oggetto
      // Nova Reel e lo passiamo come input tipizzato del comando.
      const commandInput: StartAsyncInvokeCommandInput = {
        modelId: this.modelId,
        modelInput: {
          taskType: 'TEXT_VIDEO',
          textToVideoParams: { text: input.prompt.slice(0, 4000) },
          videoGenerationConfig: {
            durationSeconds,
            fps: 24,
            dimension: '1280x720',
          },
        },
        outputDataConfig: {
          s3OutputDataConfig: { s3Uri: this.outputS3Uri },
        },
      };
      const res = await this.client.send(new StartAsyncInvokeCommand(commandInput));
      if (!res.invocationArn) {
        throw new Error('Nessun invocationArn restituito da Nova Reel');
      }
      return { jobRef: res.invocationArn };
    } catch (err) {
      throw new ProviderUnavailableError('nova-reel', err);
    }
  }

  async fetchJob(jobRef: string): Promise<GenerateCartoonJobResult> {
    let res;
    try {
      res = await this.client.send(new GetAsyncInvokeCommand({ invocationArn: jobRef }));
    } catch (err) {
      throw new ProviderUnavailableError('nova-reel', err);
    }
    const status = res.status;
    if (status === 'InProgress') return { status: 'processing' };
    if (status === 'Failed') {
      return { status: 'failed', reason: res.failureMessage || 'Generazione Nova Reel fallita' };
    }
    if (status === 'Completed') {
      // Bedrock scrive l'MP4 nella cartella S3 dell'invocazione: lo individuiamo
      // e ne scarichiamo i byte (coerente con la port text-to-video).
      const base = res.outputDataConfig?.s3OutputDataConfig?.s3Uri || this.outputS3Uri;
      try {
        const bytes = await this.downloadOutputMp4(base);
        return { status: 'completed', bytes, contentType: 'video/mp4' };
      } catch (err) {
        return { status: 'failed', reason: `Output video non recuperato da S3: ${errMsg(err)}` };
      }
    }
    // Stato sconosciuto: trattalo come ancora in corso (verrà ripollato).
    return { status: 'processing' };
  }

  /** Trova il primo .mp4 nella cartella S3 dell'output e ne scarica i byte. */
  private async downloadOutputMp4(s3Folder: string): Promise<Uint8Array> {
    const m = /^s3:\/\/([^/]+)\/?(.*)$/.exec(s3Folder.replace(/\/+$/, ''));
    if (!m) throw new Error(`URI S3 non valido: ${s3Folder}`);
    const bucket = m[1]!;
    const prefix = m[2] ? `${m[2]}/` : '';
    const listed = await this.s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
    const obj = (listed.Contents ?? []).find((o) => (o.Key ?? '').toLowerCase().endsWith('.mp4'));
    if (!obj?.Key) throw new Error('Nessun MP4 trovato nella cartella di output');
    const got = await this.s3.send(new GetObjectCommand({ Bucket: bucket, Key: obj.Key }));
    const body = got.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
    if (!body?.transformToByteArray) throw new Error('Corpo S3 non leggibile');
    return body.transformToByteArray();
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : 'errore sconosciuto';
}
