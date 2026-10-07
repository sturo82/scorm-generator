/**
 * Errori di dominio. Gli adapter traducono gli errori specifici del provider
 * in queste classi, così che la logica di dominio non dipenda da dettagli
 * infrastrutturali (Requisito 10.1).
 */

export class DomainError extends Error {
  readonly code: string;

  constructor(message: string, code: string, cause?: unknown) {
    // Usa l'opzione standard `cause` di Error (ES2022).
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = new.target.name;
    this.code = code;
  }
}

/** Il provider non è disponibile (rete, rate limit, errore interno). */
export class ProviderUnavailableError extends DomainError {
  constructor(provider: string, cause?: unknown) {
    super(`Provider non disponibile: ${provider}`, 'provider_unavailable', cause);
  }
}

/** Input non valido rispetto alle regole di dominio. */
export class ValidationError extends DomainError {
  constructor(message: string, cause?: unknown) {
    super(message, 'validation_error', cause);
  }
}

/** Risorsa non trovata (documento, oggetto, job). */
export class NotFoundError extends DomainError {
  constructor(resource: string, cause?: unknown) {
    super(`Risorsa non trovata: ${resource}`, 'not_found', cause);
  }
}

/** Formato di file non supportato in ingestion (Requisito 3.2). */
export class UnsupportedFormatError extends DomainError {
  constructor(mime: string, cause?: unknown) {
    super(`Formato non supportato: ${mime}`, 'unsupported_format', cause);
  }
}
