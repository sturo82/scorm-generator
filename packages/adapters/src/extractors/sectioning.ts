import type { ExtractedSection } from '@scorm/domain';

/**
 * Suddivide testo semplice in sezioni. Euristica: una riga che sembra un
 * heading (Markdown `#`, oppure riga breve senza punteggiatura finale seguita da
 * contenuto) apre una nuova sezione. In assenza di heading, raggruppa per
 * blocchi separati da righe vuote. Utile per il chunking e il tracciamento della
 * provenienza (citazioni).
 */
export function sectionizePlainText(text: string): ExtractedSection[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
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

  for (const raw of lines) {
    const line = raw.trimEnd();
    const mdHeading = /^#{1,6}\s+(.+)$/.exec(line);
    if (mdHeading) {
      flush();
      currentHeading = mdHeading[1]?.trim();
      continue;
    }
    buffer.push(raw);
  }
  flush();

  // Se non è stata individuata alcuna struttura, restituisce una sezione unica.
  if (sections.length === 0) {
    return [{ text: text.trim() }];
  }
  return sections.filter((s) => s.text.length > 0 || s.heading);
}

/** Concatena le sezioni in un testo completo coerente. */
export function joinSections(sections: ExtractedSection[]): string {
  return sections
    .map((s) => (s.heading ? `${s.heading}\n${s.text}` : s.text))
    .join('\n\n')
    .trim();
}
