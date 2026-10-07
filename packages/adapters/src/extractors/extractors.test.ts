import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { UnsupportedFormatError, type FileRef } from '@scorm/domain';
import {
  PlainTextExtractor,
  CsvExtractor,
  HtmlExtractor,
  XlsxExtractor,
  PptxExtractor,
  DocumentExtractorRegistry,
  createDefaultExtractors,
  sectionizePlainText,
} from './index.js';

function file(mime: string, content: Buffer | string): FileRef {
  return {
    filename: 'test',
    mimeType: mime,
    content: typeof content === 'string' ? Buffer.from(content) : content,
  };
}

describe('sectionizePlainText', () => {
  it('divide per heading Markdown', () => {
    const sections = sectionizePlainText('# Titolo\nparagrafo\n## Sotto\naltro');
    expect(sections).toHaveLength(2);
    expect(sections[0]?.heading).toBe('Titolo');
    expect(sections[1]?.heading).toBe('Sotto');
  });

  it('restituisce una sezione unica senza heading', () => {
    const sections = sectionizePlainText('solo testo senza struttura');
    expect(sections).toHaveLength(1);
    expect(sections[0]?.heading).toBeUndefined();
  });
});

describe('PlainTextExtractor', () => {
  const ex = new PlainTextExtractor();
  it('supporta txt e markdown', () => {
    expect(ex.supports('text/plain')).toBe(true);
    expect(ex.supports('text/markdown')).toBe(true);
    expect(ex.supports('application/pdf')).toBe(false);
  });
  it('estrae testo e sezioni', async () => {
    const doc = await ex.extract(file('text/markdown', '# A\ncorpo A\n# B\ncorpo B'));
    expect(doc.sections).toHaveLength(2);
    expect(doc.text).toContain('corpo A');
  });
});

describe('CsvExtractor', () => {
  it('estrae righe non vuote con header come heading', async () => {
    const doc = await new CsvExtractor().extract(
      file('text/csv', 'nome,ruolo\nAlice,admin\n\nBob,editor'),
    );
    expect(doc.sections[0]?.heading).toBe('nome,ruolo');
    expect(doc.text).toContain('Alice,admin');
    expect(doc.text).not.toContain('\n\n');
  });
});

describe('HtmlExtractor', () => {
  it('rimuove script/style ed estrae sezioni per heading', async () => {
    const html =
      '<html><head><style>x{}</style></head><body><h1>Intro</h1><p>testo</p>' +
      '<script>alert(1)</script><h2>Dettagli</h2><p>altro</p></body></html>';
    const doc = await new HtmlExtractor().extract(file('text/html', html));
    expect(doc.text).toContain('testo');
    expect(doc.text).not.toContain('alert');
    expect(doc.sections.map((s) => s.heading)).toEqual(['Intro', 'Dettagli']);
  });
});

describe('XlsxExtractor', () => {
  it('estrae un foglio come sezione CSV', async () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['prodotto', 'prezzo'],
      ['penna', 1.5],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'Listino');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    const doc = await new XlsxExtractor().extract(
      file(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buf,
      ),
    );
    expect(doc.sections[0]?.heading).toBe('Listino');
    expect(doc.text).toContain('prodotto,prezzo');
    expect(doc.text).toContain('penna');
  });
});

describe('PptxExtractor', () => {
  it('estrae il testo delle slide come sezioni', async () => {
    const zip = new JSZip();
    const slide = (t: string): string =>
      `<?xml version="1.0"?><p:sld xmlns:a="x"><a:t>${t}</a:t></p:sld>`;
    zip.file('ppt/slides/slide1.xml', slide('Benvenuti'));
    zip.file('ppt/slides/slide2.xml', slide('Agenda &amp; obiettivi'));
    const buf = (await zip.generateAsync({ type: 'nodebuffer' })) as Buffer;

    const doc = await new PptxExtractor().extract(
      file(
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        buf,
      ),
    );
    expect(doc.sections).toHaveLength(2);
    expect(doc.sections[0]?.heading).toBe('Slide 1');
    expect(doc.text).toContain('Benvenuti');
    // Le entità XML vengono decodificate.
    expect(doc.text).toContain('Agenda & obiettivi');
  });
});

describe('DocumentExtractorRegistry', () => {
  const registry = new DocumentExtractorRegistry(createDefaultExtractors());

  it('supporta tutti i formati previsti', () => {
    for (const mime of [
      'text/plain',
      'text/markdown',
      'text/csv',
      'text/html',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ]) {
      expect(registry.supports(mime), mime).toBe(true);
    }
  });

  it('instrada al giusto estrattore', async () => {
    const doc = await registry.extract(file('text/plain', 'ciao'));
    expect(doc.text).toContain('ciao');
  });

  it('rifiuta formati non supportati', async () => {
    await expect(
      registry.extract(file('application/x-msdownload', 'MZ')),
    ).rejects.toBeInstanceOf(UnsupportedFormatError);
  });
});
