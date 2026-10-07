/**
 * Porta per l'estrazione di testo dai documenti caricati nella knowledge base
 * (Requisito 3.1 / 3.2). Un extractor dichiara i MIME supportati ed estrae
 * testo + struttura in sezioni (utile per il chunking e le citazioni).
 */

export interface FileRef {
  /** Nome file originale. */
  filename: string;
  mimeType: string;
  /** Contenuto del file. */
  content: Buffer;
}

export interface ExtractedSection {
  /** Titolo/heading della sezione, se individuabile. */
  heading?: string;
  text: string;
}

export interface ExtractedDoc {
  /** Testo completo concatenato. */
  text: string;
  /** Suddivisione in sezioni per chunking e tracciamento provenienza. */
  sections: ExtractedSection[];
}

export interface DocumentExtractor {
  readonly id: string;
  /** True se l'extractor gestisce il MIME indicato. */
  supports(mimeType: string): boolean;
  extract(file: FileRef): Promise<ExtractedDoc>;
}
