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

export interface LumaRayProviderOptions {
  /** ID del modello (default: luma.ray-v2:0). */
  modelId?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  /**
   * URI S3 di base dove Luma scrive l'output (es. "s3://bucket/luma-output").
   * DEVE stare nella stessa region del servizio Bedrock (region sopra). Il video
   * MP4 viene scritto in una sottocartella per invocazione.
   */
  outputS3Uri: string;
  /** Risoluzione di default ("540p" | "720p"). Default 720p. */
  resolution?: '540p' | '720p';
}

/** Luma Ray 2 accetta SOLO 5s o 9s: scegli il valore valido più vicino. */
function clampDuration(sec?: number): '5s' | '9s' {
  const s = typeof sec === 'number' && sec > 0 ? sec : 5;
  return s >= 7 ? '9s' : '5s';
}

/**
 * Adapter TextToVideoProvider su Luma Ray 2 (Bedrock), per i mini-cartoon delle
 * scene "pillole". Usa l'API ASINCRONA di Bedrock Runtime:
 *  - StartAsyncInvoke avvia la generazione e ritorna un invocationArn;
 *  - l'output (MP4) viene scritto da Bedrock su S3 (outputS3Uri, stessa region);
 *  - GetAsyncInvoke(invocationArn) riporta lo stato e l'S3 di output al termine.
 * Luma genera clip di 5s o 9s (540p/720p). Le credenziali restano server-side.
 */
export class LumaRayProvider implements TextToVideoProvider {
  readonly id = 'luma-ray';
  private readonly client: BedrockRuntimeClient;
  private readonly s3: S3Client;
  private readonly modelId: string;
  private readonly outputS3Uri: string;
  private readonly resolution: '540p' | '720p';

  constructor(opts: LumaRayProviderOptions) {
    this.modelId = opts.modelId ?? 'luma.ray-v2:0';
    this.outputS3Uri = opts.outputS3Uri.replace(/\/+$/, '');
    this.resolution = opts.resolution ?? '720p';
    const region = opts.region ?? 'us-west-2';
    const credentials =
      opts.accessKeyId && opts.secretAccessKey
        ? {
            accessKeyId: opts.accessKeyId,
            secretAccessKey: opts.secretAccessKey,
            sessionToken: opts.sessionToken,
          }
        : undefined;
    this.client = new BedrockRuntimeClient({ region, credentials });
    // S3 nella STESSA region del modello: l'output Luma è scritto lì, e può
    // essere una region diversa dal bucket assets dell'app.
    this.s3 = new S3Client({ region, credentials });
  }

  async startJob(input: GenerateCartoonInput): Promise<{ jobRef: string }> {
    const duration = clampDuration(input.durationSec);
    try {
      const commandInput: StartAsyncInvokeCommandInput = {
        modelId: this.modelId,
        modelInput: {
          // Luma limita a 5000 char e ~300 token: tronchiamo prudenzialmente.
          prompt: input.prompt.slice(0, 1500),
          aspect_ratio: input.aspectRatio ?? '16:9',
          loop: false,
          duration,
          resolution: this.resolution,
        },
        outputDataConfig: {
          s3OutputDataConfig: { s3Uri: this.outputS3Uri },
        },
      };
      const res = await this.client.send(new StartAsyncInvokeCommand(commandInput));
      if (!res.invocationArn) throw new Error('Nessun invocationArn restituito da Luma Ray');
      return { jobRef: res.invocationArn };
    } catch (err) {
      throw new ProviderUnavailableError('luma-ray', err);
    }
  }

  async fetchJob(jobRef: string): Promise<GenerateCartoonJobResult> {
    let res;
    try {
      res = await this.client.send(new GetAsyncInvokeCommand({ invocationArn: jobRef }));
    } catch (err) {
      throw new ProviderUnavailableError('luma-ray', err);
    }
    const status = res.status;
    if (status === 'InProgress') return { status: 'processing' };
    if (status === 'Failed') {
      return { status: 'failed', reason: res.failureMessage || 'Generazione Luma Ray fallita' };
    }
    if (status === 'Completed') {
      // Bedrock scrive l'MP4 nella CARTELLA S3 dell'invocazione (il nome esatto
      // può variare). Individuiamo l'MP4 nella cartella e ne scarichiamo i byte,
      // così il servizio li salva senza occuparsi di bucket/region del provider.
      const base = res.outputDataConfig?.s3OutputDataConfig?.s3Uri || this.outputS3Uri;
      try {
        const bytes = await this.downloadOutputMp4(base);
        return { status: 'completed', bytes, contentType: 'video/mp4' };
      } catch (err) {
        return { status: 'failed', reason: `Output video non recuperato da S3: ${errMsg(err)}` };
      }
    }
    return { status: 'processing' };
  }

  /** Trova il primo .mp4 nella cartella S3 dell'output e ne scarica i byte. */
  private async downloadOutputMp4(s3Folder: string): Promise<Uint8Array> {
    const m = /^s3:\/\/([^/]+)\/?(.*)$/.exec(s3Folder.replace(/\/+$/, ''));
    if (!m) throw new Error(`URI S3 non valido: ${s3Folder}`);
    const bucket = m[1]!;
    const prefix = m[2] ? `${m[2]}/` : '';
    const listed = await this.s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }),
    );
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
