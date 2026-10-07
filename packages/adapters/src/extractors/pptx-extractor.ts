import JSZip from 'jszip';
import type { DocumentExtractor, ExtractedDoc, ExtractedSection, FileRef } from '@scorm/domain';
import { joinSections } from './sectioning.js';

/**
 * Estrattore PPTX. Un file .pptx è un archivio ZIP: il testo delle slide è in
 * `ppt/slides/slideN.xml` dentro gli elementi `<a:t>`. Ogni slide diventa una
 * sezione (heading "Slide N").
 */
export class PptxExtractor implements DocumentExtractor {
  readonly id = 'pptx';

  supports(mimeType: string): boolean {
    return (
      mimeType ===
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    );
  }

  async extract(file: FileRef): Promise<ExtractedDoc> {
    const zip = await JSZip.loadAsync(file.content);
    const slidePaths = Object.keys(zip.files)
      .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
      .sort(bySlideNumber);

    const sections: ExtractedSection[] = [];
    let index = 0;
    for (const path of slidePaths) {
      index += 1;
      const xml = await zip.files[path]!.async('string');
      const text = extractRunText(xml);
      if (text.trim().length === 0) continue;
      sections.push({ heading: `Slide ${index}`, text: text.trim() });
    }

    if (sections.length === 0) {
      return { text: '', sections: [{ text: '' }] };
    }
    return { text: joinSections(sections), sections };
  }
}

/** Ordina i path delle slide per numero (slide2 < slide10). */
function bySlideNumber(a: string, b: string): number {
  const na = Number(/slide(\d+)\.xml$/.exec(a)?.[1] ?? 0);
  const nb = Number(/slide(\d+)\.xml$/.exec(b)?.[1] ?? 0);
  return na - nb;
}

/** Concatena il testo degli elementi <a:t> preservando le interruzioni. */
function extractRunText(xml: string): string {
  const matches = xml.match(/<a:t>([\s\S]*?)<\/a:t>/g) ?? [];
  return matches
    .map((m) => m.replace(/<a:t>([\s\S]*?)<\/a:t>/, '$1'))
    .map(decodeXmlEntities)
    .join(' ')
    .replace(/\s+/g, ' ');
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
