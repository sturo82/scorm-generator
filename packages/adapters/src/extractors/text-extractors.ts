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

/**
 * Estrattore di sottotitoli (SRT e WebVTT): scarta numeri di riga, timestamp,
 * intestazioni e tag, e unisce le righe in paragrafi di testo continuo. Pensato
 * per le trascrizioni di registrazioni, che arrivano spesso in questi formati.
 * Le righe del parlato vengono riunite in paragrafi (circa ogni 8 righe o a ogni
 * pausa lunga) per dare al chunking un testo scorrevole e non una riga per cue.
 */
export class SubtitleExtractor implements DocumentExtractor {
  readonly id = 'subtitles';
  private readonly mimes = new Set(['application/x-subrip', 'text/vtt']);
  supports(mimeType: string): boolean {
    return this.mimes.has(mimeType);
  }
  async extract(file: FileRef): Promise<ExtractedDoc> {
    const raw = file.content
      .toString('utf8')
      .replace(/^\uFEFF/, '')
      .replace(/\r\n?/g, '\n');
    const cues: Array<{ start: number; text: string }> = [];
    for (const block of raw.split(/\n{2,}/)) {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      const t = lines.findIndex((l) => l.includes('-->'));
      if (t === -1) continue; // intestazione WEBVTT, NOTE, STYLE, numeri isolati
      const m = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/.exec(lines[t]!);
      const start = m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
      const text = lines
        .slice(t + 1)
        .join(' ')
        .replace(/<[^>]+>/g, '') // tag VTT/SRT (<i>, <c>, <00:00:01.000>)
        .replace(/\{\\[^}]*\}/g, '') // stili ASS/SSA
        .replace(/\s+/g, ' ')
        .trim();
      if (text) cues.push({ start, text });
    }
    const paragraphs: string[] = [];
    let buf: string[] = [];
    let last = cues[0]?.start ?? 0;
    for (const c of cues) {
      if (buf.length >= 8 || (buf.length > 0 && c.start - last > 4)) {
        paragraphs.push(buf.join(' '));
        buf = [];
      }
      buf.push(c.text);
      last = c.start;
    }
    if (buf.length) paragraphs.push(buf.join(' '));
    const text = paragraphs.join('\n\n');
    const sections = sectionizePlainText(text);
    return { text: joinSections(sections), sections };
  }
}

/**
 * Estrattore RTF: converte il testo in chiaro ignorando tabelle di font/colori e
 * gruppi di controllo, gestendo gli escape `\'hh` (Windows-1252) e `\uN`. Copre i
 * documenti RTF comuni (Word, TextEdit); non interpreta immagini né tabelle.
 */
export class RtfExtractor implements DocumentExtractor {
  readonly id = 'rtf';
  private readonly mimes = new Set(['application/rtf', 'text/rtf']);
  supports(mimeType: string): boolean {
    return this.mimes.has(mimeType);
  }
  async extract(file: FileRef): Promise<ExtractedDoc> {
    const text = rtfToText(file.content.toString('latin1'));
    const sections = sectionizePlainText(text);
    return { text: joinSections(sections), sections };
  }
}

const CP1252: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰',
  0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•',
  0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

/** Gruppi RTF il cui contenuto non è testo del documento. */
const RTF_SKIP_DESTINATIONS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'headerl', 'headerr',
  'footerl', 'footerr', 'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'listtable',
  'listoverridetable', 'rsidtbl', 'generator', 'xmlnstbl', 'object', 'fldinst',
]);

export function rtfToText(rtf: string): string {
  const out: string[] = [];
  // Stack di gruppi: true = il gruppo corrente è da ignorare.
  const skipStack: boolean[] = [];
  let skip = false;
  let ucSkip = 1; // caratteri sostitutivi dopo \uN
  let pendingSkip = 0;
  let i = 0;
  const n = rtf.length;
  while (i < n) {
    const ch = rtf[i]!;
    if (ch === '{') {
      skipStack.push(skip);
      i++;
      // Destinazione speciale: {\*\xxx ...} o {\fonttbl ...}
      const m = /^\\(\*\\)?([a-zA-Z]+)/.exec(rtf.slice(i, i + 40));
      if (m && (m[1] || RTF_SKIP_DESTINATIONS.has(m[2]!))) skip = true;
      continue;
    }
    if (ch === '}') {
      skip = skipStack.pop() ?? false;
      i++;
      continue;
    }
    if (ch === '\\') {
      const next = rtf[i + 1] ?? '';
      if (next === "'") {
        const code = parseInt(rtf.slice(i + 2, i + 4), 16);
        i += 4;
        if (pendingSkip > 0) { pendingSkip--; continue; }
        if (!skip && Number.isFinite(code)) out.push(CP1252[code] ?? String.fromCharCode(code));
        continue;
      }
      if (next === '\\' || next === '{' || next === '}') {
        if (!skip) out.push(next);
        i += 2;
        continue;
      }
      // Backslash + a capo = fine paragrafo (TextEdit/Cocoa).
      if (next === '\n' || next === '\r') {
        if (!skip) out.push('\n');
        i += next === '\r' && rtf[i + 2] === '\n' ? 3 : 2;
        continue;
      }
      if (next === '~') { if (!skip) out.push(' '); i += 2; continue; }
      if (next === '-' || next === '_') { if (!skip && next === '_') out.push('-'); i += 2; continue; }
      const w = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i, i + 40));
      if (w) {
        i += w[0].length;
        const word = w[1]!;
        const arg = w[2] !== undefined ? Number(w[2]) : undefined;
        if (word === 'par' || word === 'line' || word === 'row') { if (!skip) out.push('\n'); }
        else if (word === 'tab') { if (!skip) out.push(' '); }
        else if (word === 'endash') { if (!skip) out.push('–'); }
        else if (word === 'emdash') { if (!skip) out.push('—'); }
        else if (word === 'bullet') { if (!skip) out.push('•'); }
        else if (word === 'lquote') { if (!skip) out.push('‘'); }
        else if (word === 'rquote') { if (!skip) out.push('’'); }
        else if (word === 'ldblquote') { if (!skip) out.push('“'); }
        else if (word === 'rdblquote') { if (!skip) out.push('”'); }
        else if (word === 'uc' && arg !== undefined) ucSkip = arg;
        else if (word === 'u' && arg !== undefined) {
          const cp = arg < 0 ? arg + 65536 : arg;
          if (!skip) out.push(String.fromCharCode(cp));
          pendingSkip = ucSkip;
        }
        continue;
      }
      i += 2;
      continue;
    }
    if (ch === '\n' || ch === '\r') { i++; continue; }
    i++;
    if (ch === '\t') { if (!skip && pendingSkip === 0) out.push(' '); continue; }
    if (pendingSkip > 0) { pendingSkip--; continue; }
    if (!skip) out.push(ch);
  }
  return out
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Estrattore di trascrizioni in JSON. Riconosce:
 *  - Amazon Transcribe (`results.audio_segments[].transcript` oppure
 *    `results.transcripts[0].transcript`);
 *  - formati "stile Whisper" con `segments[].text` o un `text`/`transcript` di primo livello.
 * Un JSON di altra forma viene rifiutato con un messaggio esplicito: non si indovina il
 * contenuto di strutture arbitrarie.
 */
export class TranscriptJsonExtractor implements DocumentExtractor {
  readonly id = 'transcript-json';
  supports(mimeType: string): boolean {
    return mimeType === 'application/json';
  }
  async extract(file: FileRef): Promise<ExtractedDoc> {
    let data: unknown;
    try {
      data = JSON.parse(file.content.toString('utf8').replace(/^\uFEFF/, ''));
    } catch {
      throw new Error('JSON non valido');
    }
    const parts = transcriptPartsFromJson(data);
    if (parts.length === 0) {
      throw new Error(
        'JSON non riconosciuto: è supportato solo l\'output di trascrizione (Amazon Transcribe o simili con "text"/"segments")',
      );
    }
    // Unisce i segmenti in paragrafi di circa 6 frasi per un chunking scorrevole.
    const paragraphs: string[] = [];
    for (let i = 0; i < parts.length; i += 6) paragraphs.push(parts.slice(i, i + 6).join(' '));
    const text = paragraphs.join('\n\n');
    const sections = sectionizePlainText(text);
    return { text: joinSections(sections), sections };
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function str(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
}

/** Frammenti di testo (in ordine) estratti da un JSON di trascrizione noto; [] se non riconosciuto. */
export function transcriptPartsFromJson(data: unknown): string[] {
  const root = asRecord(data);
  if (!root) return [];
  // Amazon Transcribe.
  const results = asRecord(root['results']);
  if (results) {
    const segs = Array.isArray(results['audio_segments']) ? results['audio_segments'] : [];
    const fromSegs = segs.map((s) => str(asRecord(s)?.['transcript'])).filter(Boolean);
    if (fromSegs.length > 0) return fromSegs;
    const tr = Array.isArray(results['transcripts']) ? results['transcripts'] : [];
    const full = tr.map((t) => str(asRecord(t)?.['transcript'])).filter(Boolean).join(' ');
    if (full) return splitSentences(full);
  }
  // Stile Whisper e simili.
  const segments = Array.isArray(root['segments']) ? root['segments'] : [];
  const fromSegments = segments.map((s) => str(asRecord(s)?.['text'])).filter(Boolean);
  if (fromSegments.length > 0) return fromSegments;
  const full = str(root['text']) || str(root['transcript']);
  return full ? splitSentences(full) : [];
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}
