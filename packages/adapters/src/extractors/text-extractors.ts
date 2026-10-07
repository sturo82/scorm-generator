import { parse as parseHtml } from 'node-html-parser';
import type { DocumentExtractor, ExtractedDoc, ExtractedSection, FileRef } from '@scorm/domain';
import { joinSections, sectionizePlainText } from './sectioning.js';

/** Estrattore per testo semplice e Markdown. */
export class PlainTextExtractor implements DocumentExtractor {
  readonly id = 'plain-text';
  private readonly mimes = new Set(['text/plain', 'text/markdown']);

  supports(mimeType: string): boolean {
    return this.mimes.has(mimeType);
  }

  async extract(file: FileRef): Promise<ExtractedDoc> {
    const text = file.content.toString('utf8');
    const sections = sectionizePlainText(text);
    return { text: joinSections(sections), sections };
  }
}

/** Estrattore CSV: ogni riga diventa testo tabellare leggibile. */
export class CsvExtractor implements DocumentExtractor {
  readonly id = 'csv';

  supports(mimeType: string): boolean {
    return mimeType === 'text/csv';
  }

  async extract(file: FileRef): Promise<ExtractedDoc> {
    const raw = file.content.toString('utf8');
    const rows = raw
      .replace(/\r\n/g, '\n')
      .split('\n')
      .filter((r) => r.trim().length > 0);
    const text = rows.join('\n');
    // Una sezione per il CSV, con l'intestazione come heading se presente.
    const heading = rows[0];
    const section: ExtractedSection = { heading, text };
    return { text, sections: [section] };
  }
}

/** Estrattore HTML: rimuove script/style e normalizza il testo visibile. */
export class HtmlExtractor implements DocumentExtractor {
  readonly id = 'html';

  supports(mimeType: string): boolean {
    return mimeType === 'text/html';
  }

  async extract(file: FileRef): Promise<ExtractedDoc> {
    const root = parseHtml(file.content.toString('utf8'));
    root.querySelectorAll('script, style, noscript').forEach((el) => el.remove());

    const sections: ExtractedSection[] = [];
    let currentHeading: string | undefined;
    let buffer: string[] = [];

    const flush = (): void => {
      const body = buffer.join('\n').trim();
      if (body.length > 0 || currentHeading) {
        sections.push({ heading: currentHeading, text: body });
      }
      buffer = [];
    };

    // Scorre gli elementi di blocco; gli heading aprono nuove sezioni.
    const blocks = root.querySelectorAll(
      'h1, h2, h3, h4, h5, h6, p, li, td, th, pre, blockquote',
    );
    for (const el of blocks) {
      const tag = el.tagName?.toLowerCase() ?? '';
      const content = el.text.replace(/\s+/g, ' ').trim();
      if (!content) continue;
      if (/^h[1-6]$/.test(tag)) {
        flush();
        currentHeading = content;
      } else {
        buffer.push(content);
      }
    }
    flush();

    if (sections.length === 0) {
      const fallback = root.text.replace(/\s+/g, ' ').trim();
      return { text: fallback, sections: [{ text: fallback }] };
    }
    return { text: joinSections(sections), sections };
  }
}
