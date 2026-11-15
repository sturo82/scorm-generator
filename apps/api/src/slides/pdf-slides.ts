import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Una pagina del PDF: immagine PNG e testo estratto. */
export interface PdfSlidePage {
  /** Indice 1-based della pagina. */
  index: number;
  png: Buffer;
  text: string;
}

export interface PdfSlidesOptions {
  /** Numero massimo di pagine accettate. */
  maxPages: number;
  /** Larghezza in pixel dei PNG (l'altezza segue il rapporto d'aspetto). */
  widthPx: number;
  /** Timeout per ciascun comando poppler (ms). */
  timeoutMs: number;
}

export const DEFAULT_PDF_SLIDES_OPTIONS: PdfSlidesOptions = {
  maxPages: 80,
  widthPx: 1920,
  timeoutMs: 120_000,
};

/** Errore di input (PDF non valido, troppo lungo): da mappare su 400. */
export class PdfSlidesInputError extends Error {}

/** Normalizza il testo di una pagina: spazi/righe in eccesso, niente caratteri di controllo. */
export function cleanPageText(raw: string): string {
  return raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n');
}

/** Suddivide l'output di `pdftotext` (pagine separate da form-feed) in testi per pagina. */
export function splitPdfText(raw: string, pages: number): string[] {
  const parts = raw.split('\f');
  const out: string[] = [];
  for (let i = 0; i < pages; i++) out.push(cleanPageText(parts[i] ?? ''));
  return out;
}

/**
 * Rimuove le righe ripetute su almeno metà delle pagine (footer legali, intestazioni
 * ricorrenti): non fanno parte del contenuto da narrare. Con meno di 4 pagine non
 * interviene, perché la ripetizione non è un segnale affidabile.
 */
export function stripRepeatedLines(texts: string[]): string[] {
  if (texts.length < 4) return texts;
  const counts = new Map<string, number>();
  for (const t of texts) {
    for (const line of new Set(t.split('\n'))) counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  const limit = texts.length / 2;
  return texts.map((t) =>
    t
      .split('\n')
      .filter((l) => (counts.get(l) ?? 0) < limit)
      .join('\n'),
  );
}

/**
 * Converte un PDF di slide in PNG + testo per pagina, con poppler-utils
 * (`pdfinfo`, `pdftoppm`, `pdftotext`) lanciati via `execFile` (nessuna shell, i
 * percorsi sono generati da noi in una cartella temporanea privata).
 */
export async function pdfToSlides(
  pdf: Buffer,
  opts: PdfSlidesOptions = DEFAULT_PDF_SLIDES_OPTIONS,
): Promise<PdfSlidePage[]> {
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new PdfSlidesInputError('Il file non è un PDF valido');
  }
  const dir = await mkdtemp(join(tmpdir(), 'slides-'));
  const inPath = join(dir, 'in.pdf');
  const run = (cmd: string, args: string[]) =>
    execFileAsync(cmd, args, { timeout: opts.timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  try {
    await writeFile(inPath, pdf);

    let pages: number;
    try {
      const { stdout } = await run('pdfinfo', [inPath]);
      pages = Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1]);
    } catch (e) {
      throw new PdfSlidesInputError(`PDF non leggibile: ${(e as Error).message.split('\n')[0]}`);
    }
    if (!Number.isInteger(pages) || pages < 1) throw new PdfSlidesInputError('PDF senza pagine');
    if (pages > opts.maxPages) {
      throw new PdfSlidesInputError(`Troppe pagine: ${pages} (massimo ${opts.maxPages})`);
    }

    await run('pdftoppm', ['-png', '-scale-to-x', String(opts.widthPx), '-scale-to-y', '-1', inPath, join(dir, 'p')]);
    const { stdout: rawText } = await run('pdftotext', ['-enc', 'UTF-8', inPath, '-']);
    const texts = stripRepeatedLines(splitPdfText(rawText, pages));

    const files = (await readdir(dir)).filter((f) => /^p-\d+\.png$/.test(f)).sort();
    if (files.length !== pages) {
      throw new Error(`Conversione incompleta: ${files.length} immagini su ${pages} pagine`);
    }
    const out: PdfSlidePage[] = [];
    for (let i = 0; i < files.length; i++) {
      out.push({ index: i + 1, png: await readFile(join(dir, files[i]!)), text: texts[i]! });
    }
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
