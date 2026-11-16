/**
 * Formati supportati per l'ingestion della knowledge base (Requisito 3.1).
 * Mappa MIME -> estensione canonica. I formati non elencati vengono rifiutati
 * (Requisito 3.2).
 */
export const SUPPORTED_MIME_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/html': 'html',
  'text/csv': 'csv',
  // Trascrizioni e documenti di testo ricco.
  'application/x-subrip': 'srt',
  'text/vtt': 'vtt',
  'application/rtf': 'rtf',
};

/** Estensioni → MIME canonico, per i formati che i browser dichiarano male (o non dichiarano). */
const EXTENSION_MIME: Record<string, string> = {
  srt: 'application/x-subrip',
  vtt: 'text/vtt',
  rtf: 'application/rtf',
  md: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
};

/**
 * MIME effettivo di un file caricato: il browser spesso invia `application/octet-stream`,
 * stringa vuota o un tipo non standard per .srt/.vtt/.rtf/.md. Per queste estensioni
 * vince il MIME canonico; per gli altri file resta quello dichiarato.
 */
export function resolveUploadMime(filename: string, declared: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase();
  const byExt = ext ? EXTENSION_MIME[ext] : undefined;
  if (byExt && (!isSupportedMime(declared) || declared === 'text/plain' || declared === 'application/octet-stream')) {
    return byExt;
  }
  return declared;
}

export function isSupportedMime(mime: string): boolean {
  return mime in SUPPORTED_MIME_TYPES;
}

export const SUPPORTED_MIME_LIST = Object.keys(SUPPORTED_MIME_TYPES);
