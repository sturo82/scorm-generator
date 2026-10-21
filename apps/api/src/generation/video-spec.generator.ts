import { VideoSpec, videoSpecJsonSchema, type VideoSpec as VideoSpecType, type Scene } from '@scorm/contracts';
import type { LLMProvider, TokenUsage } from '@scorm/domain';
import { videoSpecPrompt } from './prompts.js';

/**
 * Collassa lo spec a UNA SOLA scena. Un clip pillola = una scena breve, con un
 * UNICO voiceover: così i frame della Sequence sono assoluti (nessun re-basing)
 * e audio/karaoke/illustrazione restano sincronizzati. Se l'LLM produce più
 * scene (lo schema lo consente), le fondiamo in una: teniamo la prima
 * illustrazione disponibile e uniamo i layer (esclusa la Caption, che il
 * renderer inietta da sé), forzando durationHint 'auto' (copre tutto il
 * voiceover). Il voiceover è già unico a livello di VideoSpec, quindi non va
 * toccato.
 */
export function collapseToSingleScene(spec: VideoSpecType): VideoSpecType {
  if (spec.scenes.length <= 1) {
    // Anche con una sola scena, normalizza la durata a 'auto' (tutto il voiceover).
    const only = spec.scenes[0];
    if (only) only.durationHint = 'auto';
    return spec;
  }
  const first = spec.scenes[0]!;
  const illustration = spec.scenes.find((s) => s.illustration)?.illustration;
  const layers = spec.scenes
    .flatMap((s) => s.layers)
    .filter((l) => l.component !== 'Caption');
  const merged: Scene = {
    id: first.id,
    durationHint: 'auto',
    background: first.background,
    illustration,
    layers,
  };
  return { ...spec, scenes: [merged] };
}

export interface GenerateVideoSpecInput {
  /** Storyboard della scena (placeholderPrompt/alt). */
  scenePrompt: string;
  language: string;
  palette?: string[];
  bg?: string;
  /**
   * Video-LEZIONE multi-scena: se true, genera uno spec di PIÙ scene con
   * voiceover esteso (il video È la lezione) e NON lo collassa in una scena
   * sola. Se false/assente, resta il clip breve mono-scena (comportamento
   * classico di scenari e hook).
   */
  multiScene?: boolean;
}

export interface GenerateVideoSpecResult {
  spec: VideoSpecType;
  usage: TokenUsage;
  model: string;
}

/**
 * Genera un VideoSpec valido dallo storyboard di una scena, invocando l'LLM.
 * Robusto: se l'output non è un VideoSpec valido, fa UN tentativo di
 * riparazione (self-repair) rimandando all'LLM l'errore di validazione; se
 * fallisce ancora, lancia un errore chiaro. Funzione pura rispetto alla DI:
 * riceve l'LLMProvider, così è testabile con un mock.
 */
export async function generateVideoSpec(
  llm: LLMProvider,
  input: GenerateVideoSpecInput,
): Promise<GenerateVideoSpecResult> {
  const prompt = videoSpecPrompt(input);
  const schema = videoSpecJsonSchema as Record<string, unknown>;
  // Video-lezione multi-scena: NON collassare (serve il multi-scena) e dare più
  // token (lo spec con N scene + voiceover esteso è molto più grande).
  const multi = input.multiScene === true;
  const normalize = (spec: VideoSpecType): VideoSpecType => (multi ? spec : collapseToSingleScene(spec));
  const maxTokens = multi ? 12000 : 4000;

  // Tentativo 1.
  const first = await llm.generate({
    system: 'Sei un motion designer: produci SOLO JSON conforme allo schema VideoSpec richiesto.',
    messages: [{ role: 'user', content: prompt }],
    schema,
    temperature: 0.4,
    maxTokens,
  });
  const parsed1 = tryParse(first.text);
  if (parsed1.success) {
    return { spec: normalize(parsed1.data), usage: first.usage, model: first.model };
  }

  // Tentativo 2 (self-repair): rimanda l'output errato + il motivo.
  const repair = await llm.generate({
    system: 'Sei un motion designer: produci SOLO JSON conforme allo schema VideoSpec richiesto.',
    messages: [
      { role: 'user', content: prompt },
      { role: 'assistant', content: first.text },
      {
        role: 'user',
        content:
          'Il JSON precedente NON è valido secondo lo schema VideoSpec. ' +
          `Errori: ${parsed1.error}. ` +
          'Correggi e restituisci SOLO il JSON valido, senza testo attorno.',
      },
    ],
    schema,
    temperature: 0.2,
    maxTokens,
  });
  const parsed2 = tryParse(repair.text);
  if (parsed2.success) {
    // Somma i token dei due tentativi per un metering onesto.
    return {
      spec: normalize(parsed2.data),
      usage: {
        inputTokens: first.usage.inputTokens + repair.usage.inputTokens,
        outputTokens: first.usage.outputTokens + repair.usage.outputTokens,
      },
      model: repair.model,
    };
  }

  throw new Error(`VideoSpec non valido dopo riparazione: ${parsed2.error}`);
}

type ParseOutcome =
  | { success: true; data: VideoSpecType }
  | { success: false; error: string };

/** Parsa il testo (anche se avvolto in testo/markdown) e valida col VideoSpec. */
function tryParse(text: string): ParseOutcome {
  const json = extractJson(text);
  if (json === null) return { success: false, error: 'output non è JSON' };
  const result = VideoSpec.safeParse(json);
  if (result.success) return { success: true, data: result.data };
  return { success: false, error: summarizeZodError(result.error) };
}

/**
 * Estrae l'oggetto JSON dal testo del modello: prova il parse diretto e, se
 * fallisce, cerca il primo blocco { ... } bilanciato (robustezza a eventuali
 * testi/markdown attorno). Ritorna null se non trova JSON valido.
 */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Cerca dal primo '{' all'ultimo '}'.
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** Riassume un ZodError in una stringa breve (path: messaggio), per il repair. */
function summarizeZodError(err: { issues: Array<{ path: Array<string | number>; message: string }> }): string {
  return err.issues
    .slice(0, 8)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}
