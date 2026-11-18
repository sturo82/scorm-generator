import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { avatarFeature } from '@scorm/contracts';
import type { AppConfig } from '../config/configuration.js';
import { FeatureCatalogService } from '../ecosystem/feature-catalog.service.js';
import {
  FeatureNotPricedException,
  InsufficientCreditsException,
  WalletService,
} from '../ecosystem/wallet.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Voce di spesa: feature del listino e, per le feature a unità, le unità (elementi o minuti). */
export interface BillItem {
  feature: string;
  units?: number;
}

/** Riserva di crediti (uno o più hold), serializzabile per essere salvata con il lavoro. */
export interface Reservation {
  /** Prefisso del `reference` (ogni hold usa `${ref}:${feature}`). */
  ref: string;
  holds: Array<{ feature: string; holdId: string; units?: number; credits: number }>;
}

export interface QuoteLine {
  feature: string;
  units: number;
  /** Crediti per questa voce; null se la feature non è ancora prezzata. */
  credits: number | null;
}

export interface Quote {
  lines: QuoteLine[];
  /** Totale in crediti delle voci prezzate. */
  total: number;
  /** False se almeno una voce non è prezzata (l'operazione non sarebbe prenotabile). */
  priced: boolean;
}

export { avatarFeature };

/** Margine sulle unità stimate quando la durata si conosce solo a lavoro finito (clip avatar). */
export const ESTIMATE_MARGIN = 1.25;

const BILLED_CACHE_MS = 30_000;

/**
 * Addebito in crediti delle generazioni, sopra il wallet di Manager. Il prezzo lo decide solo
 * Manager (`FeatureCatalogService`); qui si prenota prima (`reserve`), si addebita il consumo
 * reale a fine lavoro (`settle`) e si libera su errore (`release`).
 *
 * L'addebito è attivo solo se il wallet è abilitato sull'installazione E l'azienda ha il flag
 * `walletBilling`: altrimenti ogni metodo è un no-op (le aziende non addebitate continuano a
 * generare senza crediti).
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly billedCache = new Map<string, { value: boolean; until: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly catalog: FeatureCatalogService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /** True se le generazioni di questa azienda si addebitano in crediti. */
  async isBilled(tenantId: string): Promise<boolean> {
    if (!(await this.wallet.isEnabled())) return false;
    const hit = this.billedCache.get(tenantId);
    if (hit && hit.until > Date.now()) return hit.value;
    const row = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { walletBilling: true } });
    const value = row?.walletBilling === true;
    this.billedCache.set(tenantId, { value, until: Date.now() + BILLED_CACHE_MS });
    return value;
  }

  /** Preventivo in crediti (calcolo puro sul listino, senza toccare il wallet). */
  quote(items: BillItem[]): Quote {
    const lines: QuoteLine[] = normalize(items, this.catalog).map((i) => ({
      feature: i.feature,
      units: i.units,
      credits: this.catalog.credits(i.feature, i.units) ?? null,
    }));
    return {
      lines,
      total: lines.reduce((n, l) => n + (l.credits ?? 0), 0),
      priced: lines.every((l) => l.credits !== null),
    };
  }

  /**
   * Prenota i crediti prima di eseguire. Ritorna null se l'azienda non è addebitata. Se una voce
   * non basta, libera quelle già prenotate e lancia 402; se non è prezzata lancia 503.
   */
  async reserve(tenantId: string, ref: string, items: BillItem[]): Promise<Reservation | null> {
    if (!(await this.isBilled(tenantId))) return null;
    const lines = normalize(items, this.catalog);
    if (lines.length === 0) return { ref, holds: [] };
    const holds: Reservation['holds'] = [];
    try {
      for (const l of lines) {
        const price = this.catalog.price(l.feature);
        if (price === undefined) throw new FeatureNotPricedException(l.feature);
        const unit = this.catalog.isUnit(l.feature);
        const hold = await this.wallet.hold({
          companyId: tenantId,
          feature: l.feature,
          reference: `${ref}:${l.feature}`,
          ...(unit ? { units: l.units } : { amount: price }),
        });
        holds.push({
          feature: l.feature,
          holdId: hold.holdId,
          ...(unit ? { units: l.units } : {}),
          credits: this.catalog.credits(l.feature, l.units) ?? 0,
        });
      }
    } catch (err) {
      await Promise.all(holds.map((h) => this.wallet.release(tenantId, h.holdId)));
      throw err;
    }
    return { ref, holds };
  }

  /**
   * Addebita il consumo reale. `actual` indica le unità realmente consumate per feature; una
   * feature assente si addebita per intero (voci esatte). Consumo zero libera la riserva; un
   * consumo oltre la riserva si addebita fino alla riserva e si registra l'eccedenza.
   */
  async settle(tenantId: string, res: Reservation | null, actual?: Record<string, number>): Promise<void> {
    if (!res) return;
    for (const h of res.holds) {
      const a = actual?.[h.feature];
      if (a === undefined) {
        await this.wallet.capture(tenantId, h.holdId);
        continue;
      }
      if (a <= 0) {
        await this.wallet.release(tenantId, h.holdId);
        continue;
      }
      if (h.units === undefined) {
        await this.wallet.capture(tenantId, h.holdId);
        continue;
      }
      if (a > h.units + 1e-9) {
        this.logger.warn(
          `Consumo oltre la riserva (${h.feature}, ref=${res.ref}): reale ${a} > riservato ${h.units}. Si addebita la riserva.`,
        );
      }
      await this.wallet.capture(tenantId, h.holdId, { units: Math.min(a, h.units) });
    }
  }

  /** Libera tutta la riserva (operazione fallita o annullata). */
  async release(tenantId: string, res: Reservation | null): Promise<void> {
    if (!res) return;
    await Promise.all(res.holds.map((h) => this.wallet.release(tenantId, h.holdId)));
  }

  /**
   * Controlla che il saldo disponibile copra le voci SENZA riservare (per lavori le cui parti si
   * prenotano a fasi). Se il saldo non è leggibile non blocca: ci pensa l'hold.
   */
  async assertAvailable(tenantId: string, items: BillItem[]): Promise<void> {
    if (!(await this.isBilled(tenantId))) return;
    const q = this.quote(items);
    if (!q.priced) throw new FeatureNotPricedException(q.lines.find((l) => l.credits === null)?.feature ?? '');
    const bal = await this.wallet.getBalance(tenantId);
    if (bal && bal.available < q.total) {
      throw new InsufficientCreditsException(q.lines[0]?.feature ?? '', q.total, bal.available);
    }
  }

  /**
   * Esegue `work` dentro una riserva: addebita il consumo reale restituito (`actual`) se riesce,
   * libera se lancia.
   */
  async run<T>(
    tenantId: string,
    ref: string,
    items: BillItem[],
    work: () => Promise<{ result: T; actual?: Record<string, number> }>,
  ): Promise<T> {
    const res = await this.reserve(tenantId, ref, items);
    try {
      const { result, actual } = await work();
      await this.settle(tenantId, res, actual);
      return result;
    } catch (err) {
      await this.release(tenantId, res);
      throw err;
    }
  }

  /** Stato del wallet mostrato in app: addebito attivo, saldo e link alla pagina di ricarica. */
  async walletView(tenantId: string): Promise<{
    enabled: boolean;
    balance?: number;
    available?: number;
    currency: 'CREDITS';
    topupUrl?: string;
  }> {
    const enabled = await this.isBilled(tenantId);
    if (!enabled) return { enabled: false, currency: 'CREDITS' };
    const bal = await this.wallet.getBalance(tenantId);
    return {
      enabled: true,
      balance: bal?.balance,
      available: bal?.available,
      currency: 'CREDITS',
      topupUrl: this.topupUrl(),
    };
  }

  /** Portale owner di Manager, dove si ricarica con Stripe. */
  private topupUrl(): string | undefined {
    const base = this.config.get('ecosystem', { infer: true }).managerUrl;
    if (!base) return undefined;
    try {
      return `${new URL(base).origin}/owner/`;
    } catch {
      return undefined;
    }
  }
}

/** Unisce le voci per feature, scarta quelle vuote e porta le unità a un valore valido. */
function normalize(items: BillItem[], catalog: FeatureCatalogService): Array<{ feature: string; units: number }> {
  const merged = new Map<string, number>();
  for (const i of items) {
    const unit = catalog.isUnit(i.feature);
    const u = unit ? (i.units ?? 1) : 1;
    if (!(u > 0)) continue;
    merged.set(i.feature, unit ? (merged.get(i.feature) ?? 0) + u : 1);
  }
  return [...merged.entries()].map(([feature, units]) => ({ feature, units }));
}
