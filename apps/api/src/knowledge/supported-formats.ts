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
};

export function isSupportedMime(mime: string): boolean {
  return mime in SUPPORTED_MIME_TYPES;
}

export const SUPPORTED_MIME_LIST = Object.keys(SUPPORTED_MIME_TYPES);
