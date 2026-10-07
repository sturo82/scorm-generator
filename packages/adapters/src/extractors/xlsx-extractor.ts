import * as XLSX from 'xlsx';
import type { DocumentExtractor, ExtractedDoc, ExtractedSection, FileRef } from '@scorm/domain';
import { joinSections } from './sectioning.js';

/**
 * Estrattore XLSX basato su SheetJS. Ogni foglio diventa una sezione, con il
 * nome del foglio come heading e il contenuto in formato CSV leggibile.
 */
export class XlsxExtractor implements DocumentExtractor {
  readonly id = 'xlsx';

  supports(mimeType: string): boolean {
    return (
      mimeType ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
  }

  async extract(file: FileRef): Promise<ExtractedDoc> {
    const workbook = XLSX.read(file.content, { type: 'buffer' });
    const sections: ExtractedSection[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) continue;
      const csv = XLSX.utils.sheet_to_csv(sheet).trim();
      if (csv.length === 0) continue;
      sections.push({ heading: sheetName, text: csv });
    }

    if (sections.length === 0) {
      return { text: '', sections: [{ text: '' }] };
    }
    return { text: joinSections(sections), sections };
  }
}
