import type { Anchor, Scene, WordMark } from './video-spec.js';

/**
 * Logica di timing PURA per il code-to-video: converte il timing LOGICO del
 * VideoSpec (ancore a parole + durate 'auto') nei frame concreti usati dal
 * renderer. Nessuna dipendenza da Remotion: testabile a unità in isolamento.
 */

/** Confini di una scena, in frame assoluti sulla timeline del video. */
export interface SceneBounds {
  /** Frame di inizio scena (assoluto). */
  startFrame: number;
  /** Frame di fine scena (assoluto, esclusivo). */
  endFrame: number;
  /** Durata in frame (= endFrame - startFrame). */
  length: number;
}

/** Converte millisecondi in numero di frame, arrotondando. */
export function msToFrame(ms: number, fps: number): number {
  return Math.round((ms / 1000) * fps);
}

/**
 * Risolve un'ancora in un frame ASSOLUTO sulla timeline del video.
 * - 'sceneStart'/'sceneEnd': estremi della scena.
 * - { word: N }: inizio della parola N del voiceover; se N è fuori range, si
 *   fa clamp sui confini della scena (mai fuori dalla scena).
 */
export function resolveFrame(
  anchor: Anchor,
  bounds: SceneBounds,
  words: WordMark[],
  fps: number,
): number {
  if (anchor === 'sceneStart') return bounds.startFrame;
  if (anchor === 'sceneEnd') return bounds.endFrame;
  // Ancora a parola.
  const idx = anchor.word;
  if (!Number.isInteger(idx) || idx < 0 || idx >= words.length) {
    // Indice non valido/oltre il parlato: clamp a inizio scena (fallback sicuro).
    return bounds.startFrame;
  }
  const frame = msToFrame(words[idx]!.startMs, fps);
  // Non uscire mai dai confini della scena.
  if (frame < bounds.startFrame) return bounds.startFrame;
  if (frame > bounds.endFrame) return bounds.endFrame;
  return frame;
}

/**
 * Calcola i confini (in frame) di una scena a partire dal frame di inizio.
 *
 * Durata:
 * - numero (ms): durata esplicita.
 * - 'auto': copre TUTTO il voiceover della scena (fino alla fine dell'ultima
 *   parola), più una piccola coda, così l'audio non viene mai troncato. Se non
 *   ci sono word-timings, si usa `fallbackMs`. NB: ogni clip pillola è autonoma
 *   e `words` contiene solo il voiceover di quella scena.
 *
 * `startFrame` è il frame assoluto dove la scena inizia (= fine della scena
 * precedente, 0 per la prima).
 */
/** Coda (ms) aggiunta dopo l'ultima parola, così l'ultima sillaba non è tagliata. */
const TAIL_MS = 600;

export function computeSceneBounds(
  scene: Scene,
  words: WordMark[],
  startFrame: number,
  fps: number,
  fallbackMs = 3000,
): SceneBounds {
  let length: number;
  if (typeof scene.durationHint === 'number') {
    length = Math.max(1, msToFrame(scene.durationHint, fps));
  } else {
    // 'auto': la durata è l'INTERO voiceover della scena (fine dell'ultima
    // parola) + una coda, NON la parola ancorata nei layer: così la voce non
    // viene mai tagliata a metà. Fallback se non ci sono word-timings.
    const lastWordEndMs = words.length > 0 ? words[words.length - 1]!.endMs : -1;
    const totalMs = lastWordEndMs >= 0 ? lastWordEndMs + TAIL_MS : fallbackMs;
    length = Math.max(1, msToFrame(totalMs, fps));
  }
  const endFrame = startFrame + length;
  return { startFrame, endFrame, length };
}

/**
 * Confini di una scena MULTI-SCENA ancorati a una FINESTRA di parole del
 * voiceover globale: la scena va dall'inizio della parola `start` alla fine
 * della parola `end-1`. Gli indici fuori range sono clampati. Così, con un
 * UNICO voiceover condiviso, le scene NON si sommano: ognuna copre esattamente
 * la sua porzione di parlato e resta allineata all'audio.
 */
function boundsFromWordRange(
  range: { start: number; end: number },
  words: WordMark[],
  fps: number,
  fallbackMs: number,
): SceneBounds {
  if (words.length === 0) {
    const length = Math.max(1, msToFrame(fallbackMs, fps));
    return { startFrame: 0, endFrame: length, length };
  }
  const start = Math.max(0, Math.min(range.start, words.length - 1));
  const endIdx = Math.max(start, Math.min(range.end - 1, words.length - 1));
  const startMs = words[start]!.startMs;
  const endMs = words[endIdx]!.endMs;
  const startFrame = Math.max(0, msToFrame(startMs, fps));
  const endFrame = Math.max(startFrame + 1, msToFrame(endMs, fps));
  return { startFrame, endFrame, length: endFrame - startFrame };
}

/**
 * Calcola i confini di TUTTE le scene. Due modelli:
 *  - MULTI-SCENA (scene con `wordRange`): ogni scena è ancorata alla sua
 *    finestra di parole nel voiceover UNICO; l'ultima estende l'endFrame con
 *    una coda così l'audio finale non viene troncato.
 *  - SEQUENZIALE classico (nessun `wordRange`): ogni scena inizia dove finisce
 *    la precedente, durata da `durationHint`/'auto' (clip autonome, compat.).
 * Ritorna un array parallelo a `scenes`.
 */
export function computeAllSceneBounds(
  scenes: Scene[],
  words: WordMark[],
  fps: number,
  fallbackMs = 3000,
): SceneBounds[] {
  const usesWordRanges = scenes.some((s) => s.wordRange);
  if (usesWordRanges) {
    const tailFrames = msToFrame(TAIL_MS, fps);
    const lastWordEndFrame = words.length > 0 ? msToFrame(words[words.length - 1]!.endMs, fps) + tailFrames : 0;
    return scenes.map((scene, i) => {
      // Scene senza wordRange in un video multi-scena: le distribuiamo in modo
      // uniforme come fallback (raro: l'LLM dovrebbe sempre fornirle).
      const range = scene.wordRange ?? { start: 0, end: Math.max(1, words.length) };
      const b = boundsFromWordRange(range, words, fps, fallbackMs);
      // L'ultima scena si estende fino alla fine reale dell'audio + coda.
      if (i === scenes.length - 1 && lastWordEndFrame > b.endFrame) {
        return { startFrame: b.startFrame, endFrame: lastWordEndFrame, length: lastWordEndFrame - b.startFrame };
      }
      return b;
    });
  }
  const out: SceneBounds[] = [];
  let cursor = 0;
  for (const scene of scenes) {
    const b = computeSceneBounds(scene, words, cursor, fps, fallbackMs);
    out.push(b);
    cursor = b.endFrame;
  }
  return out;
}
