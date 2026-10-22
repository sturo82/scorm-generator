import {
  type GenerateCartoonInput,
  type GenerateCartoonJobResult,
  type TextToVideoProvider,
  type SpeechProvider,
  type ImageProvider,
  ProviderUnavailableError,
} from '@scorm/domain';
import { Buffer } from 'node:buffer';
import type { VideoSpec, WordMark } from '@scorm/contracts';

/**
 * Suffisso di stile applicato ai prompt delle illustrazioni di scena, per avere
 * un look "cartoon explainer" coerente tra le scene (stile Brain Bites).
 */
const ILLUSTRATION_STYLE_SUFFIX =
  ', modern corporate flat vector illustration, clean professional editorial style, ' +
  'refined muted palette (deep blues, teal, slate grey, subtle accents), ' +
  'polished business characters (adults, smart professional attire), contemporary office setting, ' +
  'crisp geometric shapes, soft depth, tasteful, enterprise explainer look, ' +
  'no text, no childish or cartoonish faces, high quality, consistent style';

/**
 * Funzione che genera il VideoSpec dallo storyboard di una scena. Iniettata
 * (viene da apps/api, che ha l'LLM): così l'adapter NON dipende da apps/api né
 * dall'LLM, e resta testabile.
 */
export type GenerateSpecFn = (input: {
  scenePrompt: string;
  language: string;
  /** true = video-lezione multi-scena (voiceover esteso); false = clip breve. */
  multiScene?: boolean;
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

/** Logger minimale iniettabile (default: console) per diagnostica in CloudWatch. */
export interface CartoonLogger {
  log: (msg: string) => void;
  warn: (msg: string) => void;
}

export interface RemotionCartoonProviderOptions {
  generateSpec: GenerateSpecFn;
  speech: SpeechProvider;
  render: RenderFn;
  /**
   * Generatore di immagini (Bedrock): produce le illustrazioni di scena (stile
   * B). Se assente, le scene restano senza illustrazione (solo grafica/testo).
   */
  images?: ImageProvider;
  /** Logger per diagnosticare la pipeline (default: console). */
  logger?: CartoonLogger;
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
  private readonly images?: ImageProvider;
  private readonly logger: CartoonLogger;
  /** Job in corso/conclusi, per jobRef. In-memory (una scena alla volta). */
  private readonly jobs = new Map<string, JobState>();

  constructor(opts: RemotionCartoonProviderOptions) {
    this.generateSpec = opts.generateSpec;
    this.speech = opts.speech;
    this.render = opts.render;
    this.images = opts.images;
    this.logger = opts.logger ?? {
      log: (m) => console.log(m),
      warn: (m) => console.warn(m),
    };
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
      const { spec } = await this.generateSpec({
        scenePrompt: input.prompt,
        language,
        multiScene: input.multiScene,
      });
      // Stile B: genera le illustrazioni delle scene (Bedrock) e popola src.
      await this.resolveIllustrations(spec);
      // Video-lezione multi-scena: costruisci l'SSML del voiceover con pause
      // (break) ai confini di scena e dopo i punti, per dare respiro/intonazione.
      // Clip mono-scena: testo semplice (comportamento invariato).
      const useSsml = input.multiScene === true && spec.scenes.some((s) => s.wordRange);
      const voiceInput = useSsml
        ? { text: buildVoiceoverSsml(spec), language, engine: input.speechEngine, ssml: true }
        : { text: spec.voiceover.text, language, engine: input.speechEngine };
      const tts = await this.speech.synthesizeWithMarks!(voiceInput);
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

  /**
   * Per ogni scena con un'illustrazione richiesta (illustration.prompt), genera
   * l'immagine cartoon con l'ImageProvider e ne imposta `src` come data URL
   * (così il render — in-process o Lambda — la usa come sfondo senza storage
   * esterno). Best-effort per scena: se una generazione fallisce, la scena resta
   * senza illustrazione (ripiega sui layer/testo), senza bloccare il video.
   */
  private async resolveIllustrations(spec: VideoSpec): Promise<void> {
    if (!this.images) {
      this.logger.warn(
        '[cartoon] resolveIllustrations SALTATO: ImageProvider non iniettato ' +
          '→ le scene resteranno senza illustrazione (solo titolo/sottotitoli).',
      );
      return;
    }
    const withPrompt = spec.scenes.filter((s) => s.illustration?.prompt && !s.illustration.src);
    this.logger.log(
      `[cartoon] resolveIllustrations: ${spec.scenes.length} scena/e, ` +
        `${withPrompt.length} con prompt illustrazione da generare.`,
    );
    let ok = 0;
    let fail = 0;
    for (const scene of spec.scenes) {
      const ill = scene.illustration;
      if (!ill || ill.src || !ill.prompt) continue;
      try {
        const res = await this.images.generate({
          prompt: ill.prompt + ILLUSTRATION_STYLE_SUFFIX,
          width: 1280,
          height: 768,
        });
        const b64 = Buffer.from(res.bytes).toString('base64');
        ill.src = `data:${res.contentType};base64,${b64}`;
        ok += 1;
        this.logger.log(
          `[cartoon] illustrazione scena "${scene.id}" OK: ${res.contentType}, ` +
            `${Math.round(b64.length / 1024)}KB base64. prompt="${ill.prompt.slice(0, 80)}"`,
        );
      } catch (err) {
        fail += 1;
        this.logger.warn(
          `[cartoon] illustrazione scena "${scene.id}" FALLITA: ${describeError(err)}. ` +
            `prompt="${ill.prompt.slice(0, 120)}"`,
        );
        // scena senza illustrazione: il render userà i layer/testo.
      }
    }
    this.logger.log(`[cartoon] resolveIllustrations esito: ${ok} ok, ${fail} falliti.`);
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

/** Escape dei caratteri speciali XML per inserire testo sicuro nell'SSML. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Costruisce l'SSML del voiceover di un video-lezione multi-scena per dare
 * RESPIRO e INTONAZIONE: una pausa LUNGA ai confini di scena (stacco tra
 * micro-argomenti) e una pausa BREVE dopo i punti fermi. Mantiene l'ordine e
 * il numero delle parole invariati (i tag non sono parole), così i word-marks
 * restano allineati con i wordRange usati dalla Caption.
 *
 * Nota: inseriamo i break ai CONFINI DI PAROLA usando i wordRange delle scene;
 * un leggero <prosody rate="97%"> dà un ritmo più pacato e naturale.
 */
function buildVoiceoverSsml(spec: VideoSpec): string {
  const text = spec.voiceover.text;
  // Tokenizza il voiceover in parole (stessa nozione usata dai word-marks).
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  // Indici di parola dove inizia una NUOVA scena (confini): inserisci break lì.
  const sceneStarts = new Set<number>();
  for (const s of spec.scenes) {
    if (s.wordRange && s.wordRange.start > 0) sceneStarts.add(s.wordRange.start);
  }
  const parts: string[] = [];
  for (let i = 0; i < words.length; i++) {
    // Pausa LUNGA ai confini di scena: dà tempo alla "scheda di sezione" di
    // essere letta (la card dura quanto questo silenzio) prima che riparta la
    // voce. Deve stare allineata a SCENE_BREAK_MS del timing (video-spec-timing).
    if (sceneStarts.has(i)) parts.push('<break time="2500ms"/>');
    parts.push(escapeXml(words[i]!));
    // Pausa breve dopo punteggiatura forte di fine frase (respiro naturale).
    if (/[.!?:]$/.test(words[i]!) && !sceneStarts.has(i + 1)) {
      parts.push('<break time="350ms"/>');
    }
  }
  // NB: niente <prosody> wrapper qui. Il voiceover lungo viene spezzato in più
  // <speak> da splitSsmlForTts (al confine dei <break>): un tag <prosody> che
  // avvolge tutto resterebbe aperto a cavallo dei chunk → "Invalid SSML
  // request". Il respiro è dato dai soli <break>; l'intonazione la mette
  // l'engine. Ogni chunk è così un <speak> autosufficiente e valido.
  return `<speak>${parts.join(' ')}</speak>`;
}
