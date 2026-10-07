import type { ExtractedSection } from '@scorm/domain';

export interface Chunk {
  text: string;
  section?: string;
}

export interface ChunkOptions {
  /** Dimensione massima del chunk in caratteri (approssima i token). */
  maxChars?: number;
  /** Sovrapposizione in caratteri tra chunk consecutivi. */
  overlapChars?: number;
}

const DEFAULT_MAX_CHARS = 1200;
const DEFAULT_OVERLAP = 150;

/**
 * Chunking semantico con overlap (Requisito 3.4). Procede per sezione (così il
 * confine di sezione è anche un confine di chunk, utile per le citazioni) e,
 * all'interno della sezione, spezza su confini di frase/paragrafo quando
 * possibile, con una sovrapposizione tra chunk consecutivi per preservare il
 * contesto.
 */
export function chunkSections(
  sections: ExtractedSection[],
  options: ChunkOptions = {},
): Chunk[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const overlap = Math.min(options.overlapChars ?? DEFAULT_OVERLAP, Math.floor(maxChars / 2));
  const chunks: Chunk[] = [];

  for (const section of sections) {
    const body = section.text.trim();
    if (body.length === 0) continue;
    for (const piece of splitWithOverlap(body, maxChars, overlap)) {
      chunks.push({ text: piece, section: section.heading });
    }
  }
  return chunks;
}

/**
 * Spezza un testo in finestre di ~maxChars con overlap, cercando di tagliare su
 * un confine di frase/spazio vicino al limite invece che a metà parola.
 */
function splitWithOverlap(text: string, maxChars: number, overlap: number): string[] {
  if (text.length <= maxChars) return [text];
  const pieces: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      // Cerca un confine naturale (fine frase o spazio) nell'ultima parte.
      const window = text.slice(start, end);
      const boundary = lastBoundary(window);
      if (boundary > overlap) {
        end = start + boundary;
      }
    }
    pieces.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return pieces.filter((p) => p.length > 0);
}

/** Indice dell'ultimo confine di frase (., !, ?, newline) o spazio nella stringa. */
function lastBoundary(s: string): number {
  const sentence = Math.max(
    s.lastIndexOf('. '),
    s.lastIndexOf('.\n'),
    s.lastIndexOf('! '),
    s.lastIndexOf('? '),
    s.lastIndexOf('\n'),
  );
  if (sentence > 0) return sentence + 1;
  const space = s.lastIndexOf(' ');
  return space > 0 ? space : s.length;
}
