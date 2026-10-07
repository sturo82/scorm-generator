import { HttpException, HttpStatus } from '@nestjs/common';
import type { QuotaResource } from '@scorm/contracts';

/**
 * Errore sollevato quando un'operazione supererebbe il limite del piano
 * (Requisito 1.5). Usa 402 Payment Required per distinguere il superamento
 * quota da un 403 di autorizzazione. Il corpo è strutturato e azionabile.
 */
export class QuotaExceededException extends HttpException {
  constructor(
    readonly resource: QuotaResource,
    readonly limit: number,
    readonly current: number,
    readonly requested: number,
  ) {
    super(
      {
        error: 'quota_exceeded',
        resource,
        limit,
        current,
        requested,
        message: `Limite del piano superato per "${resource}": consentito ${limit}, attuale ${current}, richiesto +${requested}. Aggiorna il piano o rimuovi risorse esistenti.`,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
