import type { PipPosition, SlideShot } from '@scorm/contracts';
import { pngLumaGrid, type LumaGrid } from './png-luma.js';

/**
 * Regia automatica del video "slide + avatar" (layout dynamic): per ogni slide sceglie
 * l'INQUADRATURA in base al ruolo e alla densità del testo, e l'ANGOLO in cui mettere il
 * cerchio dell'avatar cercando la zona più "vuota" dell'immagine, così da non coprire
 * contenuti. Deterministica e gratuita (niente LLM): l'utente può poi correggerla.
 */

export interface DirectionInput {
  index: number;
  /** Testo estratto dalla slide (vuoto per le slide "extra"). */
  text: string;
  /** Immagine della slide; assente per le slide "extra" disegnate dal renderer. */
  png?: Buffer;
  /** True per le slide "extra" create dalla knowledge. */
  extra?: boolean;
}

export interface SlideDirection {
  index: number;
  shot: SlideShot;
  corner: PipPosition;
  /** Parole considerate (diagnostica e anteprima nella UI). */
  words: number;
}

const CORNERS: PipPosition[] = ['bottom-right', 'top-right', 'bottom-left', 'top-left'];

/** Diciture legali e di copyright ricorrenti nei piè di pagina: non sono contenuto della slide. */
const LEGAL_LINE = /(copyright|©|confidential|riservat|propert|propriet|internal use|uso interno|all rights reserved|tutti i diritti|divulgazione|disclosure)/i;

function wordCount(text: string): number {
  return text
    .split('\n')
    .filter((line) => !LEGAL_LINE.test(line))
    .join(' ')
    .split(/\s+/)
    .filter((w) => /[a-zà-ÿ0-9]{2,}/i.test(w)).length;
}

/** Griglia di analisi: celle da 20 px su una slide 1920×1080. */
const GRID_COLS = 96;
const GRID_ROWS = 54;
/** Ingombro del cerchio dell'inquadratura "focus" (px su 1920×1080). */
const CIRCLE = 300;
const MARGIN = 44;
/** Variazione di luminanza tra celle vicine oltre la quale una cella "contiene qualcosa". */
const BUSY = 9;
/** Fascia del piè di pagina (diciture legali): coprirla pesa meno che coprire il contenuto. */
const FOOTER_FROM_PX = 1030;

/**
 * Quota di celle "occupate" (testo, linee, grafica) nell'ingombro esatto del cerchio in un
 * angolo. 0 = zona vuota.
 */
function cornerScore(g: LumaGrid, p: PipPosition): number {
  const cell = 1920 / GRID_COLS; // 20 px
  const right = p.endsWith('right');
  const bottom = p.startsWith('bottom');
  const x0 = right ? 1920 - MARGIN - CIRCLE : MARGIN;
  const y0 = bottom ? 1080 - MARGIN - CIRCLE : MARGIN;
  const c0 = Math.floor(x0 / cell);
  const c1 = Math.ceil((x0 + CIRCLE) / cell);
  const r0 = Math.floor(y0 / cell);
  const r1 = Math.ceil((y0 + CIRCLE) / cell);
  const cx = (x0 + CIRCLE / 2) / cell;
  const cy = (y0 + CIRCLE / 2) / cell;
  const rad = CIRCLE / 2 / cell;
  let busy = 0;
  let total = 0;
  for (let r = Math.max(0, r0); r < Math.min(g.rows, r1); r++) {
    for (let c = Math.max(0, c0); c < Math.min(g.cols, c1); c++) {
      if ((c + 0.5 - cx) ** 2 + (r + 0.5 - cy) ** 2 > rad * rad) continue; // solo dentro il cerchio
      const v = g.cells[r * g.cols + c]!;
      const right1 = c + 1 < g.cols ? g.cells[r * g.cols + c + 1]! : v;
      const down = r + 1 < g.rows ? g.cells[(r + 1) * g.cols + c]! : v;
      const weight = r * cell >= FOOTER_FROM_PX ? 0.3 : 1;
      if (Math.abs(v - right1) + Math.abs(v - down) > BUSY) busy += weight;
      total += 1;
    }
  }
  return total ? busy / total : 1;
}

/**
 * Angolo più libero per il cerchio dell'avatar: a parità di vuoto vince l'ordine di
 * preferenza (in basso a destra prima).
 */
export function emptiestCorner(png: Buffer): PipPosition {
  const g = pngLumaGrid(png, GRID_COLS, GRID_ROWS);
  let best: PipPosition = 'bottom-right';
  let bestScore = Number.POSITIVE_INFINITY;
  CORNERS.forEach((p, i) => {
    const score = cornerScore(g, p) + i * 0.01;
    if (score < bestScore) {
      bestScore = score;
      best = p;
    }
  });
  return best;
}

/** Punteggi per angolo (diagnostica). */
export function cornerScores(png: Buffer): Record<PipPosition, number> {
  const g = pngLumaGrid(png, GRID_COLS, GRID_ROWS);
  return Object.fromEntries(CORNERS.map((p) => [p, Math.round(cornerScore(g, p) * 100) / 100])) as Record<PipPosition, number>;
}

/** Inquadratura per ruolo e densità della slide. */
export function shotFor(slide: DirectionInput, position: { first: boolean; last: boolean }): SlideShot {
  if (slide.extra) return 'side';
  const words = wordCount(slide.text);
  if (position.first || position.last) return 'presenter';
  // Slide divisorie ("1 INTRODUCTION", "Thank you"): poche parole → il presentatore in primo piano.
  if (words <= 5) return 'presenter';
  if (words <= 30) return 'side';
  if (words <= 85) return 'focus';
  return 'mini';
}

/** Regia completa per le slide incluse nel video, in ordine. */
export function autoDirection(slides: DirectionInput[]): SlideDirection[] {
  return slides.map((s, i) => {
    let corner: PipPosition = 'bottom-right';
    if (s.png) {
      try {
        corner = emptiestCorner(s.png);
      } catch {
        /* immagine non analizzabile: angolo di default */
      }
    }
    return {
      index: s.index,
      shot: shotFor(s, { first: i === 0, last: i === slides.length - 1 }),
      corner,
      words: wordCount(s.text),
    };
  });
}
