import type { Block } from '@scorm/contracts';

/**
 * Applica il tetto di immagini di una lezione: tiene le prime `max` immagini nell'ordine dei block e
 * toglie le altre. Le immagini facoltative (media di testi, timeline, slide del carousel, scene) si
 * rimuovono; un "image_hotspot" oltre il tetto si elimina per intero, perché senza immagine non ha
 * senso. Così la lezione resta completa e senza segnaposto vuoti, e le immagini da generare non
 * superano mai il tetto del pacchetto.
 */
export function capLessonImages<T extends Block>(blocks: T[], max: number): { blocks: T[]; removed: number } {
  let kept = 0;
  let removed = 0;
  const isImage = (v: unknown): boolean =>
    v !== null && typeof v === 'object' && !Array.isArray(v) && (v as { kind?: unknown }).kind === 'image';

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        if (isImage(node[i])) {
          if (kept < max) kept++;
          else {
            node.splice(i, 1);
            i--;
            removed++;
          }
        } else visit(node[i]);
      }
      return;
    }
    if (node === null || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (isImage(value)) {
        if (kept < max) kept++;
        else {
          delete obj[key];
          removed++;
        }
      } else visit(value);
    }
  };

  const out: T[] = [];
  for (const b of blocks) {
    const block = structuredClone(b);
    if ((block as { type?: string }).type === 'image_hotspot') {
      if (kept >= max) {
        removed++;
        continue;
      }
      kept++;
      // L'immagine principale è contata: si visitano solo gli altri campi del payload.
      const payload = (block as { payload?: Record<string, unknown> }).payload ?? {};
      for (const key of Object.keys(payload)) {
        if (key === 'image') continue;
        if (isImage(payload[key])) {
          if (kept < max) kept++;
          else {
            delete payload[key];
            removed++;
          }
        } else visit(payload[key]);
      }
    } else {
      visit(block);
    }
    out.push(block);
  }
  return { blocks: out, removed };
}
