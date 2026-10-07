// Si importa il modulo interno della libreria: l'index.js di pdf-parse contiene
// codice di debug che tenta di leggere un PDF di test all'import, fallendo fuori
// dalla sua cartella. Il modulo in lib/ espone solo la funzione di parsing.
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import type { DocumentExtractor, ExtractedDoc, FileRef } from '@scorm/domain';
import { joinSections, sectionizePlainText } from './sectioning.js';

/**
 * Estrattore PDF basato su pdf-parse. Estrae il testo complessivo e lo
 * sezionizza euristicamente (pdf-parse non espone una struttura di heading).
 */
export class PdfExtractor implements DocumentExtractor {
  readonly id = 'pdf';

  supports(mimeType: string): boolean {
    return mimeType === 'application/pdf';
  }

  async extract(file: FileRef): Promise<ExtractedDoc> {
    const result = await pdfParse(file.content);
    const text = (result.text ?? '').trim();
    const sections = sectionizePlainText(text);
    return { text: joinSections(sections), sections };
  }
}
