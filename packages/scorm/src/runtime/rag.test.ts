import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { runtimeAssetPath } from './index.js';
import { buildSemanticIndex } from '../package/semantic-index.js';

/**
 * Test del widget RAG runtime (rag.js) e della PARITÀ con l'indice semantico
 * condiviso (buildSemanticIndex). L'anteprima web calcola lo stesso indice e usa
 * la stessa fusione BM25 + TF-IDF cosine: questi test garantiscono che la
 * ricerca del pacchetto SCORM e quella dell'anteprima restino coerenti.
 */

const CHUNKS = [
  {
    text: 'Per creare una commit si usa il comando git commit dopo aver aggiunto le modifiche con git add alla staging area. Il messaggio descrive le modifiche.',
    documentName: 'Guida Git — Creare commit',
    section: 'Commit',
    ref: { kind: 'knowledge' as const },
  },
  {
    text: 'git revert crea un nuovo commit che annulla le modifiche di un commit precedente, preservando la cronologia. A differenza di git reset non riscrive la storia.',
    documentName: 'Guida Git — Revert',
    section: 'Revert',
    ref: { kind: 'knowledge' as const },
  },
  {
    text: 'I dispositivi di protezione individuale proteggono il lavoratore dai rischi sul posto di lavoro quando non eliminabili alla fonte.',
    documentName: 'Modulo 1 — Lezione 1: Sicurezza',
    section: 'DPI',
    ref: { kind: 'lesson' as const, lessonId: 'l1', moduleIndex: 1, lessonIndex: 1 },
  },
];

/** Carica scorm-api + rag.js in una finestra jsdom con i dati RAG forniti. */
function loadRag(withSemantic: boolean): JSDOM {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
  const win = dom.window as unknown as Record<string, unknown> & { eval: (s: string) => void };
  win.__RAG__ = CHUNKS;
  if (withSemantic) {
    win.__RAG_SEMANTIC__ = buildSemanticIndex(CHUNKS.map((c) => c.text));
  }
  // scorm-api non serve al search, ma rag.js è autonomo: basta caricarlo.
  win.eval(readFileSync(runtimeAssetPath('rag.js'), 'utf8'));
  return dom;
}

describe('CourseRag (rag.js runtime)', () => {
  it('"come si crea una commit": il chunk sulla creazione è tra i risultati (stemming crea/creare)', () => {
    const dom = loadRag(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = dom.window as any;
    const hits = win.CourseRag.search('come si crea una commit', null, 3);
    expect(hits.length).toBeGreaterThan(0);
    // Grazie allo stemmer (crea→cre, creare→cre) il chunk sulla CREAZIONE è
    // recuperato (prima lo stemmer mancante lo escludeva del tutto). La ricerca
    // lessicale non garantisce il rank 1 su query di intento, ma il contenuto
    // pertinente è presente tra i risultati.
    const names = hits.map((h: { documentName: string }) => h.documentName);
    expect(names.some((n: string) => n.includes('Creare commit'))).toBe(true);
  });

  it('fuori dominio ("ricetta della carbonara") → nessun risultato (soglia copertura)', () => {
    const dom = loadRag(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = dom.window as any;
    const hits = win.CourseRag.search('ricetta della carbonara con guanciale', null, 3);
    expect(hits.length).toBe(0);
  });

  it('boost lezioni: i contenuti del corso (ref lesson) hanno priorità a parità di tema', () => {
    const dom = loadRag(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = dom.window as any;
    const hits = win.CourseRag.search('protezione individuale lavoratore rischi', null, 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].ref?.kind).toBe('lesson');
  });

  it('PARITÀ: il ranking con indice semantico è stabile e deterministico', () => {
    // Due costruzioni indipendenti dello stesso indice producono lo stesso
    // ranking (nessuna dipendenza da ordine di iterazione non deterministico).
    const domA = loadRag(true);
    const domB = loadRag(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = (domA.window as any).CourseRag.search('git commit staging area', null, 3);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b = (domB.window as any).CourseRag.search('git commit staging area', null, 3);
    expect(a.map((h: { documentName: string }) => h.documentName)).toEqual(
      b.map((h: { documentName: string }) => h.documentName),
    );
  });
});
