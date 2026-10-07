import mammoth from 'mammoth';
import type { DocumentExtractor, ExtractedDoc, FileRef } from '@scorm/domain';
import { HtmlExtractor } from './text-extractors.js';

/**
 * Estrattore DOCX basato su mammoth. Converte in HTML (API tipizzata) e riusa
 * l'HtmlExtractor per il sezionamento: gli heading di Word diventano <h1..h6>,
 * che mappano sulle sezioni (utile per chunking e citazioni).
 */
export class DocxExtractor implements DocumentExtractor {
  readonly id = 'docx';
  private readonly html = new HtmlExtractor();

  supports(mimeType: string): boolean {
    return (
      mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
  }

  async extract(file: FileRef): Promise<ExtractedDoc> {
    const result = await mammoth.convertToHtml({ buffer: file.content });
    const html = result.value ?? '';
    return this.html.extract({
      filename: file.filename,
      mimeType: 'text/html',
      content: Buffer.from(html, 'utf8'),
    });
  }
}
