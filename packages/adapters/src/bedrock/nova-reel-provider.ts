import {
  BedrockRuntimeClient,
  StartAsyncInvokeCommand,
  GetAsyncInvokeCommand,
  type StartAsyncInvokeCommandInput,
} from '@aws-sdk/client-bedrock-runtime';
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
  private readonly modelId: string;
  private readonly outputS3Uri: string;

  constructor(opts: NovaReelProviderOptions) {
    this.modelId = opts.modelId ?? 'amazon.nova-reel-v1:0';
    this.outputS3Uri = opts.outputS3Uri.replace(/\/+$/, '');
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
      // Bedrock scrive l'output nella cartella S3 indicata; il video è output.mp4.
      const base = res.outputDataConfig?.s3OutputDataConfig?.s3Uri || this.outputS3Uri;
      const s3Uri = `${base.replace(/\/+$/, '')}/output.mp4`;
      return { status: 'completed', s3Uri };
    }
    // Stato sconosciuto: trattalo come ancora in corso (verrà ripollato).
    return { status: 'processing' };
  }
}
