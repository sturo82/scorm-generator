import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { avatarFeature, type WalletView } from '@scorm/contracts';
import type { AppConfig } from '../config/configuration.js';
import { FeatureCatalogService } from '../ecosystem/feature-catalog.service.js';
import {
  FeatureNotPricedException,
  InsufficientCreditsException,
  WalletService,
} from '../ecosystem/wallet.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantPrismaService } from '../tenancy/tenant-prisma.service.js';
import { currentPayer, type Payer } from './payer-context.js';

/** Voce di spesa: feature del listino e, per le feature a unità, le unità (elementi o minuti). */
export interface BillItem {
  feature: string;
  units?: number;
}

/** Riserva di crediti (uno o più hold), serializzabile per essere salvata con il lavoro. */
export interface Reservation {
  /** Wallet su cui sono state fatte le riserve (company o personale): capture e release vanno allo stesso. */
  companyId: string;
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
    private readonly tenantPrisma: TenantPrismaService,
    private readonly wallet: WalletService,
    private readonly catalog: FeatureCatalogService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /** Chi paga la richiesta in corso: wallet personale scelto dall'utente oppure, di default, l'azienda. */
  payerFor(tenantId: string): Payer {
    return currentPayer() ?? { companyId: tenantId, kind: 'company' };
  }

  /**
   * True se la generazione in corso si addebita in crediti: wallet abilitato sull'installazione e
   * (azienda con addebito attivo oppure utente che ha scelto di pagare con il wallet personale).
   */
  async isBilled(tenantId: string): Promise<boolean> {
    if (!(await this.wallet.isEnabled())) return false;
    if (this.payerFor(tenantId).kind === 'personal') return true;
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
    const payer = this.payerFor(tenantId);
    const lines = normalize(items, this.catalog);
    if (lines.length === 0) return { ref, companyId: payer.companyId, holds: [] };
    const holds: Reservation['holds'] = [];
    try {
      for (const l of lines) {
        const price = this.catalog.price(l.feature);
        if (price === undefined) throw new FeatureNotPricedException(l.feature);
        const unit = this.catalog.isUnit(l.feature);
        const hold = await this.wallet.hold({
          companyId: payer.companyId,
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
      await Promise.all(holds.map((h) => this.wallet.release(payer.companyId, h.holdId)));
      throw err;
    }
    return { ref, companyId: payer.companyId, holds };
  }

  /**
   * Addebita il consumo reale. `actual` indica le unità realmente consumate per feature; una
   * feature assente si addebita per intero (voci esatte). Consumo zero libera la riserva; un
   * consumo oltre la riserva si addebita fino alla riserva e si registra l'eccedenza.
   */
  async settle(_tenantId: string, res: Reservation | null, actual?: Record<string, number>): Promise<void> {
    if (!res) return;
    const company = res.companyId;
    for (const h of res.holds) {
      const a = actual?.[h.feature];
      if (a === undefined) {
        await this.wallet.capture(company, h.holdId);
        continue;
      }
      if (a <= 0) {
        await this.wallet.release(company, h.holdId);
        continue;
      }
      if (h.units === undefined) {
        await this.wallet.capture(company, h.holdId);
        continue;
      }
      if (a > h.units + 1e-9) {
        this.logger.warn(
          `Consumo oltre la riserva (${h.feature}, ref=${res.ref}): reale ${a} > riservato ${h.units}. Si addebita la riserva.`,
        );
      }
      await this.wallet.capture(company, h.holdId, { units: Math.min(a, h.units) });
    }
  }

  /** Libera tutta la riserva (operazione fallita o annullata). */
  async release(_tenantId: string, res: Reservation | null): Promise<void> {
    if (!res) return;
    await Promise.all(res.holds.map((h) => this.wallet.release(res.companyId, h.holdId)));
  }

  /**
   * Controlla che il saldo disponibile copra le voci SENZA riservare (per lavori le cui parti si
   * prenotano a fasi). Se il saldo non è leggibile non blocca: ci pensa l'hold.
   */
  async assertAvailable(tenantId: string, items: BillItem[]): Promise<void> {
    if (!(await this.isBilled(tenantId))) return;
    const q = this.quote(items);
    if (!q.priced) throw new FeatureNotPricedException(q.lines.find((l) => l.credits === null)?.feature ?? '');
    const bal = await this.wallet.getBalance(this.payerFor(tenantId).companyId);
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

  /**
   * Stato dei wallet mostrato in app: addebito attivo per chi sta generando, wallet scelto, saldo
   * dell'azienda e, se già attivato, del wallet personale. Il wallet personale NON si crea qui:
   * Manager lo crea alla prima chiamata, quindi si attiva solo quando l'utente lo sceglie.
   */
  async walletView(tenantId: string, userId: string, role: string): Promise<WalletView> {
    const walletOn = await this.wallet.isEnabled();
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { walletPayer: true, personalWalletId: true },
    });
    const payer: 'COMPANY' | 'PERSONAL' = user?.walletPayer === 'PERSONAL' && user.personalWalletId ? 'PERSONAL' : 'COMPANY';
    const companyBilled = walletOn && (await this.companyBilled(tenantId));
    const [companyBal, personalBal] = await Promise.all([
      companyBilled ? this.wallet.getBalance(tenantId) : null,
      walletOn && user?.personalWalletId ? this.wallet.getBalance(user.personalWalletId) : null,
    ]);
    const current = payer === 'PERSONAL' ? personalBal : companyBal;
    return {
      enabled: walletOn && (payer === 'PERSONAL' || companyBilled),
      payer,
      balance: current?.balance,
      available: current?.available,
      currency: 'CREDITS',
      topupUrl: payer === 'COMPANY' ? this.topupUrl() : undefined,
      canTopup: payer === 'PERSONAL' ? true : role === 'OWNER',
      company: companyBilled
        ? { balance: companyBal?.balance, available: companyBal?.available, topupUrl: this.topupUrl(), canTopup: role === 'OWNER' }
        : null,
      personal: {
        // Il wallet personale esiste solo dopo l'attivazione; prima di allora non si interroga Manager.
        active: Boolean(user?.personalWalletId),
        balance: personalBal?.balance,
        available: personalBal?.available,
      },
      personalAvailable: walletOn,
    };
  }

  /** Cambia il wallet che paga le generazioni dell'utente; il personale si attiva alla prima scelta. */
  async setPayer(tenantId: string, userId: string, kind: 'COMPANY' | 'PERSONAL'): Promise<void> {
    if (kind === 'PERSONAL') await this.ensurePersonalWallet(tenantId, userId);
    await this.tenantPrisma.runInTenant(tenantId, (tx) =>
      tx.user.updateMany({ where: { id: userId, tenantId }, data: { walletPayer: kind } }),
    );
  }

  /** Pagina di pagamento Stripe per ricaricare il wallet personale dell'utente. */
  async startPersonalTopup(tenantId: string, userId: string, amountEur: number): Promise<{ url: string }> {
    const companyId = await this.ensurePersonalWallet(tenantId, userId);
    const web = this.config.get('webAppUrl', { infer: true }).replace(/\/+$/, '');
    return this.wallet.createPersonalTopupSession({
      companyId,
      amountEur,
      successUrl: `${web}/wallet?topup=success`,
      cancelUrl: `${web}/wallet?topup=cancel`,
    });
  }

  /** company_id del wallet personale: lo chiede a Manager la prima volta e lo salva (mai ricostruito da noi). */
  private async ensurePersonalWallet(tenantId: string, userId: string): Promise<string> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { externalId: true, email: true, personalWalletId: true },
    });
    if (!user) throw new NotFoundException('Utente non trovato');
    if (user.personalWalletId) return user.personalWalletId;
    const personal = await this.wallet.getOrCreatePersonal(user.externalId, user.email);
    await this.tenantPrisma.runInTenant(tenantId, (tx) =>
      tx.user.updateMany({ where: { id: userId, tenantId }, data: { personalWalletId: personal.company_id } }),
    );
    return personal.company_id;
  }

  /** L'azienda ha l'addebito a crediti attivo (flag per azienda), indipendentemente da chi paga la richiesta. */
  private async companyBilled(tenantId: string): Promise<boolean> {
    const hit = this.billedCache.get(tenantId);
    if (hit && hit.until > Date.now()) return hit.value;
    const row = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { walletBilling: true } });
    const value = row?.walletBilling === true;
    this.billedCache.set(tenantId, { value, until: Date.now() + BILLED_CACHE_MS });
    return value;
  }

  /** Portale owner di Manager, dove l'azienda si ricarica con Stripe. */
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
