import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration.js';
import { EcosystemHttpService } from './ecosystem-http.service.js';
import { EcosystemSettingsService, type EnforceMode } from './ecosystem-settings.service.js';

/** Chiave canonica di default di questo prodotto nell'ecosistema. */
export const PRODUCT_KEY = 'kscorm';
/** Nome visibile del prodotto (per i messaggi utente). */
export const PRODUCT_DISPLAY_NAME = 'K Scorm';

/** Stato di un contratto prodotto, come riportato da Manager. */
export type EntitlementStatus = 'active' | 'grace' | 'suspended' | 'expired' | 'none';

export interface ProductEntitlement {
  product: string;
  /** Installazione specifica (prodotti multi-installazione); null = mono. */
  installationId?: string | null;
  /** Manager ha reso disponibile il prodotto per la company. */
  available?: boolean;
  status: EntitlementStatus;
  /** ISO date fino a cui vale il periodo di grazia, se status = 'grace'. */
  graceUntil?: string | null;
}

interface EntitlementsResponse {
  products?: ProductEntitlement[];
}

interface CacheEntry {
  entitlement: ProductEntitlement | null;
  expiresAtMs: number;
}

/**
 * Gate di entitlement a livello company. Manager è la fonte di verità: questo
 * servizio legge lo stato del contratto di `kscorm` per la company e decide se
 * consentire l'accesso. Comportamento controllato da `ENTITLEMENT_ENFORCE`:
 *
 *  - 'off'  → nessun controllo (default, integrazione non attiva);
 *  - 'soft' → verifica ma non blocca mai; se Manager è irraggiungibile o non ha
 *             dati, consente e logga un warning (fase di rollout);
 *  - 'hard' → nega l'accesso (403) se la company non ha contratto active/grace.
 *
 * Cache breve per company per non interrogare Manager a ogni richiesta.
 */
@Injectable()
export class EntitlementService {
  private readonly logger = new Logger(EntitlementService.name);
  private readonly cfg: AppConfig['ecosystem'];
  private readonly cache = new Map<string, CacheEntry>();
  /** Chiave prodotto effettiva (da config, default 'kscorm'). */
  private readonly productKey: string;
  /** Id installazione; filtra l'entitlement per prodotti multi-installazione. */
  private readonly installationId: string;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly http: EcosystemHttpService,
    private readonly settings: EcosystemSettingsService,
  ) {
    this.cfg = config.get('ecosystem', { infer: true });
    this.productKey = this.cfg.productKey || PRODUCT_KEY;
    this.installationId = this.cfg.installationId;
  }

  /** Modalità gate effettiva (Manager comanda; env è fallback). */
  get mode(): EnforceMode {
    return this.settings.enforce;
  }

  /**
   * Verifica l'accesso della company al prodotto. Lancia ForbiddenException in
   * modalità 'hard' se non c'è un contratto active/grace. In 'off'/'soft' non
   * lancia mai per motivi di entitlement.
   */
  async assertCompanyEntitled(companyId: string): Promise<void> {
    if (this.mode === 'off') return;

    let entitlement: ProductEntitlement | null;
    try {
      entitlement = await this.getEntitlement(companyId);
    } catch (err) {
      // Fallimento di rete/token: in soft/hard non blocchiamo su errore
      // infrastrutturale (fail-open) ma logghiamo per diagnostica.
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Entitlement non verificabile per company=${companyId}: ${reason} (fail-open)`);
      return;
    }

    // Regola Manager: accesso = available AND status ∈ {active, grace}.
    // `available` è opzionale nella risposta: se assente (vecchie risposte) non
    // blocca sul solo flag, ci si basa sullo status.
    const statusOk = entitlement
      ? entitlement.status === 'active' || entitlement.status === 'grace'
      : false;
    const availableOk = entitlement ? entitlement.available !== false : false;
    const allowed = statusOk && availableOk;

    if (allowed) return;

    const status = entitlement?.status ?? 'none';
    if (this.mode === 'soft') {
      this.logger.warn(
        `[soft] company=${companyId} senza contratto attivo per ${this.productKey} (status=${status}); accesso consentito`,
      );
      return;
    }

    // hard
    throw new ForbiddenException({
      error: 'entitlement_required',
      product: this.productKey,
      status,
      message: `La tua azienda non ha un contratto attivo per ${PRODUCT_DISPLAY_NAME}.`,
    });
  }

  /** Entitlement del prodotto per la company (null se assente), con cache. */
  async getEntitlement(companyId: string): Promise<ProductEntitlement | null> {
    const now = Date.now();
    const hit = this.cache.get(companyId);
    if (hit && hit.expiresAtMs > now) return hit.entitlement;

    const res = await this.http.get<EntitlementsResponse>('entitlements', {
      company_id: companyId,
    });
    // Match sul prodotto; per prodotti multi-installazione filtra anche per
    // installationId (quando Manager lo valorizza). Prodotto mono: ignora il campo.
    const entitlement =
      res.products?.find(
        (p) =>
          p.product === this.productKey &&
          (!p.installationId || p.installationId === this.installationId),
      ) ?? null;

    this.cache.set(companyId, {
      entitlement,
      expiresAtMs: now + this.cfg.entitlementCacheTtlSec * 1000,
    });
    return entitlement;
  }

  /** Svuota la cache (utile nei test o dopo cambi contratto noti). */
  clearCache(companyId?: string): void {
    if (companyId) this.cache.delete(companyId);
    else this.cache.clear();
  }
}
