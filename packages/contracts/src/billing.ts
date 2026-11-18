/**
 * Fatturazione a crediti (wallet di Manager): nomi delle feature del listino e mappe condivise
 * tra API e web. I PREZZI non sono qui: li decide solo Manager e arrivano dal suo listino.
 */

/** Fascia di tariffa avatar HeyGen secondo engine e tipo di avatar (come nel listino di Manager). */
export function avatarFeature(engine: string, avatarType: string): string {
  const e = engine.toLowerCase();
  if (e === 'avatar_v') return 'video_avatar_v';
  if (e === 'avatar_iv') return avatarType === 'photo' ? 'video_avatar_iv_photo' : 'video_avatar_iv';
  return avatarType === 'digital_twin' ? 'video_avatar_iii_twin' : 'video_avatar_iii';
}

/** Voce di un preventivo in crediti: feature e, per quelle a unità, le unità (elementi o minuti). */
export interface CreditQuoteItem {
  feature: string;
  units?: number;
}

/** Risposta del preventivo: `billed` indica se l'azienda paga davvero la generazione. */
export interface CreditQuoteView {
  billed: boolean;
  lines: Array<{ feature: string; units: number; credits: number | null }>;
  total: number;
  priced: boolean;
}

/** Wallet a crediti di un soggetto pagante (azienda o personale). */
export interface WalletBlock {
  balance?: number;
  available?: number;
  /** Data (ISO) dell'ultima ricarica, se Manager la espone. */
  lastTopupAt?: string;
}

/**
 * Accesso dell'utente a un wallet di azienda:
 * - `active`: l'azienda paga a crediti e il suo wallet è raggiungibile;
 * - `billing_off`: l'utente ha un'azienda ma non paga a crediti;
 * - `unavailable`: wallet non abilitato o non raggiungibile in questo momento;
 * - `none`: nessuna azienda (spazio personale).
 */
export type CompanyWalletAccess = 'active' | 'billing_off' | 'unavailable' | 'none';

/** Movimento del wallet che cambia il saldo (ricarica, addebito, rettifica, rimborso). */
export interface WalletTransaction {
  id: string;
  type: string;
  amount: number;
  feature?: string;
  product?: string;
  balanceAfter?: number;
  createdAt: string;
}

export interface WalletTransactionsView {
  page: number;
  pages: number;
  total: number;
  results: WalletTransaction[];
}

/**
 * Stato dei wallet mostrato in app. I campi `enabled/balance/available/topupUrl/canTopup` riguardano
 * il wallet che paga le generazioni in corso (`payer`); `company` e `personal` descrivono i due
 * wallet per la pagina di gestione.
 */
export interface WalletView {
  /** True se le generazioni di chi sta usando l'app si addebitano in crediti. */
  enabled: boolean;
  /** Wallet scelto per pagare: azienda o personale. */
  payer: 'COMPANY' | 'PERSONAL';
  balance?: number;
  available?: number;
  currency: 'CREDITS';
  topupUrl?: string;
  canTopup: boolean;
  /** Wallet dell'azienda; assente se l'azienda non paga a crediti. */
  company: (WalletBlock & { topupUrl?: string; canTopup: boolean }) | null;
  /** Se e perché l'utente può usare un wallet di azienda. */
  companyAccess: CompanyWalletAccess;
  /** Identificativo dell'azienda a cui appartiene l'utente (assente nello spazio personale). */
  companyId?: string;
  /** Wallet personale: `active` è false finché l'utente non lo attiva (Manager lo crea alla prima richiesta). */
  personal: WalletBlock & { active: boolean };
  /** True se il wallet è abilitato sull'installazione (quindi l'utente può attivare quello personale). */
  personalAvailable: boolean;
  /** True se l'utente lavora nel proprio spazio personale (senza company): paga sempre il wallet personale. */
  personalSpace: boolean;
  /** True se Stripe è in modalità di prova: le ricariche non sono reali. Assente se non ancora noto. */
  stripeTestMode?: boolean;
}
