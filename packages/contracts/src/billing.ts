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

/** Stato del wallet mostrato in app. */
export interface WalletView {
  enabled: boolean;
  balance?: number;
  available?: number;
  currency: 'CREDITS';
  topupUrl?: string;
  canTopup: boolean;
}
