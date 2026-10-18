import {
  type GenerateCartoonInput,
  type GenerateCartoonJobResult,
  type TextToVideoProvider,
  type SpeechProvider,
  ProviderUnavailableError,
} from '@scorm/domain';
import type { VideoSpec, WordMark } from '@scorm/contracts';

/**
 * Funzione che genera il VideoSpec dallo storyboard di una scena. Iniettata
 * (viene da apps/api, che ha l'LLM): così l'adapter NON dipende da apps/api né
 * dall'LLM, e resta testabile.
 */
export type GenerateSpecFn = (input: {
  scenePrompt: string;
  language: string;
}) => Promise<{ spec: VideoSpec; usage?: { inputTokens: number; outputTokens: number }; model?: string }>;

/**
 * Funzione di RENDERING: compila VideoSpec + audio + words in un MP4 e ritorna
 * i byte. Iniettata per tenere fuori dall'adapter le dipendenze pesanti
 * (Remotion/Chromium) e per stubbarla nei test. Ritorna anche la durata reale.
 */
export type RenderFn = (input: {
  spec: VideoSpec;
  audio: Uint8Array;
  audioContentType: string;
  words: WordMark[];
}) => Promise<{ bytes: Uint8Array; durationSec: number }>;

export interface RemotionCartoonProviderOptions {
  generateSpec: GenerateSpecFn;
  speech: SpeechProvider;
  render: RenderFn;
}

interface JobState {
  status: 'processing' | 'completed' | 'failed';
  result?: { bytes: Uint8Array; contentType: string; durationSec: number };
  reason?: string;
}

/**
 * Provider "code-to-video": invece di un modello neurale, genera il cartoon per
 * programma. Pipeline di startJob (asincrona in background):
 *  1) LLM → VideoSpec (via generateSpec iniettata);
 *  2) TTS → MP3 voiceover + word-timings (SpeechProvider.synthesizeWithMarks);
 *  3) render Remotion → MP4 (via render iniettata).
 * fetchJob riporta lo stato; al termine consegna i BYTE dell'MP4, coerente col
 * resto del flusso cartoon (MediaService.applyCartoonResult). Deterministico,
 * nitido (vettoriale) ed economico (solo TTS + CPU).
 */
export class RemotionCartoonProvider implements TextToVideoProvider {
  readonly id = 'remotion';
  private readonly generateSpec: GenerateSpecFn;
  private readonly speech: SpeechProvider;
  private readonly render: RenderFn;
  /** Job in corso/conclusi, per jobRef. In-memory (una scena alla volta). */
  private readonly jobs = new Map<string, JobState>();

  constructor(opts: RemotionCartoonProviderOptions) {
    this.generateSpec = opts.generateSpec;
    this.speech = opts.speech;
    this.render = opts.render;
  }

  async startJob(input: GenerateCartoonInput): Promise<{ jobRef: string }> {
    if (typeof this.speech.synthesizeWithMarks !== 'function') {
      throw new ProviderUnavailableError('remotion', new Error('SpeechProvider senza word-timings'));
    }
    const jobRef = `remotion-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    this.jobs.set(jobRef, { status: 'processing' });
    // Esecuzione in background: non blocca startJob (come il flusso async).
    void this.run(jobRef, input);
    return { jobRef };
  }

  async fetchJob(jobRef: string): Promise<GenerateCartoonJobResult> {
    const job = this.jobs.get(jobRef);
    if (!job) return { status: 'failed', reason: 'job sconosciuto' };
    if (job.status === 'processing') return { status: 'processing' };
    if (job.status === 'failed') return { status: 'failed', reason: job.reason ?? 'errore sconosciuto' };
    return {
      status: 'completed',
      bytes: job.result!.bytes,
      contentType: job.result!.contentType,
      durationSec: job.result!.durationSec,
    };
  }

  /** Pipeline completa per un job; registra l'esito nella mappa. */
  private async run(jobRef: string, input: GenerateCartoonInput): Promise<void> {
    try {
      const language = input.language ?? 'it';
      const { spec } = await this.generateSpec({ scenePrompt: input.prompt, language });
      const tts = await this.speech.synthesizeWithMarks!({ text: spec.voiceover.text, language });
      const { bytes, durationSec } = await this.render({
        spec,
        audio: tts.bytes,
        audioContentType: tts.contentType,
        words: tts.marks,
      });
      this.jobs.set(jobRef, {
        status: 'completed',
        result: { bytes, contentType: 'video/mp4', durationSec },
      });
    } catch (err) {
      this.jobs.set(jobRef, { status: 'failed', reason: describeError(err) });
    }
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message) return cause.message;
    return err.message;
  }
  return typeof err === 'string' ? err : 'errore sconosciuto';
}
