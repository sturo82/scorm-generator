import {
  type DocumentExtractor,
  type ExtractedDoc,
  type FileRef,
  UnsupportedFormatError,
} from '@scorm/domain';
import { CsvExtractor, HtmlExtractor, PlainTextExtractor } from './text-extractors.js';
import { PdfExtractor } from './pdf-extractor.js';
import { DocxExtractor } from './docx-extractor.js';
import { XlsxExtractor } from './xlsx-extractor.js';
import { PptxExtractor } from './pptx-extractor.js';

/**
 * Registro di estrattori: seleziona il primo che supporta il MIME indicato.
 * Rifiuta i formati non supportati con UnsupportedFormatError (Requisito 3.2).
 */
export class DocumentExtractorRegistry {
  constructor(private readonly extractors: DocumentExtractor[]) {}

  supports(mimeType: string): boolean {
    return this.extractors.some((e) => e.supports(mimeType));
  }

  async extract(file: FileRef): Promise<ExtractedDoc> {
    const extractor = this.extractors.find((e) => e.supports(file.mimeType));
    if (!extractor) throw new UnsupportedFormatError(file.mimeType);
    return extractor.extract(file);
  }
}

/** Insieme di estrattori di default per tutti i formati supportati. */
export function createDefaultExtractors(): DocumentExtractor[] {
  return [
    new PlainTextExtractor(),
    new CsvExtractor(),
    new HtmlExtractor(),
    new PdfExtractor(),
    new DocxExtractor(),
    new XlsxExtractor(),
    new PptxExtractor(),
  ];
}
