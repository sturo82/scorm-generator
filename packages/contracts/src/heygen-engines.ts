/*
 * heygen-engines.ts — Fonte di verità unica (condivisa backend/frontend) sui
 * MOTORI di rendering HeyGen e sui loro costi. L'engine è una scelta CONSAPEVOLE
 * fatta al momento della generazione del video (non un valore fisso in env):
 * ogni engine ha caratteristiche e prezzo diversi, e il prezzo mostrato al
 * cliente è il costo provider markuppato (vedi computeQuote in pricing.ts).
 *
 * Il costo HeyGen (self-serve / Pay-As-You-Go) dipende da ENGINE **e** da TIPO
 * di avatar. Esistono TRE tipi, con prezzi distinti:
 *  - 'photo'        = avatar da singola foto (i nostri avatar custom "da foto"
 *                      e "da prompt" sono photo_avatar).
 *  - 'studio'       = avatar STOCK/pubblici del catalogo HeyGen (già pronti,
 *                      creazione a costo 0).
 *  - 'digital_twin' = avatar personale "digital twin" (training da video reale).
 *
 * Prezzi self-serve per MINUTO di video (fatturati per secondo effettivo),
 * rielaborati per conformità dal listino HeyGen. Devono restare allineati alle
 * righe PricingRate (model "heygen-<engine>-<tipo>"). NB: non tutte le
 * combinazioni esistono (es. Avatar V è SOLO digital_twin).
 */

import { computeQuote, PricingQuoteInput } from './pricing.js';

/** Id degli engine HeyGen supportati. */
export type HeyGenEngineId = 'avatar_iii' | 'avatar_iv' | 'avatar_v';

/** Tipo di avatar ai fini del prezzo. */
export type HeyGenAvatarBillingType = 'photo' | 'studio' | 'digital_twin';

export interface HeyGenEngineInfo {
  id: HeyGenEngineId;
  /** Etichetta breve (es. "Avatar III"). */
  label: string;
  /** Descrizione di cosa offre l'engine, per la scelta consapevole. */
  description: string;
  /**
   * Costo provider in USD per MINUTO di video, per tipo di avatar. Una chiave
   * ASSENTE significa che quella combinazione NON è offerta dall'engine (es.
   * Avatar V ha solo 'digital_twin'). Chi consuma deve gestire l'assenza.
   */
  costPerMinUsd: Partial<Record<HeyGenAvatarBillingType, number>>;
  /**
   * True se l'engine è adatto ai PHOTO avatar (i nostri avatar custom e gli
   * stock "studio" si comportano da photo-based). Avatar V è pensato per i
   * digital twin da video reale: NON per i photo avatar.
   */
  supportsPhoto: boolean;
}

/**
 * Catalogo degli engine. Prezzi self-serve HeyGen per minuto:
 *   III  — Digital Twin $0.60 | Studio $0.99 | Photo $0.99
 *   IV   — Photo $2.31 | Digital Twin $4.83 | Studio $4.83
 *   V    — Digital Twin $7.20 (solo digital twin)
 */
export const HEYGEN_ENGINES: readonly HeyGenEngineInfo[] = [
  {
    id: 'avatar_iii',
    label: 'Avatar III',
    description:
      'Lip-sync veloce, preciso e consistente. Pipeline dedicata foto→video. ' +
      'La scelta più economica, ideale per i tuoi avatar da foto.',
    costPerMinUsd: { photo: 0.99, studio: 0.99, digital_twin: 0.6 },
    supportsPhoto: true,
  },
  {
    id: 'avatar_iv',
    label: 'Avatar IV',
    description:
      'Espressioni facciali e movimenti generati, più espressivo e naturale. ' +
      'Adatto a photo avatar e personaggi. Costo intermedio.',
    costPerMinUsd: { photo: 2.31, studio: 4.83, digital_twin: 4.83 },
    supportsPhoto: true,
  },
  {
    id: 'avatar_v',
    label: 'Avatar V',
    description:
      'Massima fedeltà e realismo full-body. Disponibile SOLO per i digital ' +
      'twin (training da video reale), non per i photo avatar. È il più costoso.',
    costPerMinUsd: { digital_twin: 7.2 },
    supportsPhoto: false,
  },
];

/** Mappa id → info per lookup rapido. */
export const HEYGEN_ENGINE_BY_ID: Record<HeyGenEngineId, HeyGenEngineInfo> = Object.fromEntries(
  HEYGEN_ENGINES.map((e) => [e.id, e]),
) as Record<HeyGenEngineId, HeyGenEngineInfo>;

/** Engine di default se non specificato (il più economico per i photo avatar). */
export const DEFAULT_HEYGEN_ENGINE: HeyGenEngineId = 'avatar_iii';

/** True se la stringa è un id engine valido. */
export function isHeyGenEngineId(v: unknown): v is HeyGenEngineId {
  return v === 'avatar_iii' || v === 'avatar_iv' || v === 'avatar_v';
}

/** True se l'engine offre una tariffa per il tipo di avatar indicato. */
export function heygenEngineSupports(engine: HeyGenEngineId, avatarType: HeyGenAvatarBillingType): boolean {
  return HEYGEN_ENGINE_BY_ID[engine]?.costPerMinUsd[avatarType] !== undefined;
}

/**
 * Costo PROVIDER in USD per minuto, per engine+tipo. 0 se la combinazione non
 * esiste (chi consuma dovrebbe prima filtrare con heygenEngineSupports).
 */
export function heygenCostPerMinUsd(engine: HeyGenEngineId, avatarType: HeyGenAvatarBillingType): number {
  return HEYGEN_ENGINE_BY_ID[engine]?.costPerMinUsd[avatarType] ?? 0;
}

/**
 * Prezzo AL CLIENTE per minuto di video (costo provider markuppato), per un dato
 * engine e tipo di avatar. Usa il markup/buffer di default del preventivo così
 * backend e frontend mostrano lo stesso numero. Passare `pricing` per override.
 */
export function heygenCustomerPricePerMinUsd(
  engine: HeyGenEngineId,
  avatarType: HeyGenAvatarBillingType,
  pricing?: Partial<PricingQuoteInput>,
): number {
  const cost = heygenCostPerMinUsd(engine, avatarType);
  const input = PricingQuoteInput.parse(pricing ?? {});
  return computeQuote(cost, input).priceUsd;
}

/** Tipo di avatar CREABILE dalla piattaforma (via API HeyGen). */
export type HeyGenCreatableAvatarType = 'photo' | 'prompt';

/**
 * Metadati dei tipi di avatar che l'utente può creare dalla piattaforma, con
 * descrizione delle CARATTERISTICHE (cosa si ottiene) per una scelta informata.
 * Entrambi producono un "photo avatar" lato HeyGen (stesso costo di creazione e
 * stesse tariffe video), ma partono da input diversi.
 */
export interface HeyGenCreatableAvatarInfo {
  type: HeyGenCreatableAvatarType;
  /** Etichetta breve per il toggle (es. "Da foto"). */
  label: string;
  /** Riga sintetica: da cosa parte. */
  tagline: string;
  /** Descrizione estesa delle caratteristiche e del risultato atteso. */
  description: string;
}

export const HEYGEN_CREATABLE_AVATAR_TYPES: readonly HeyGenCreatableAvatarInfo[] = [
  {
    type: 'photo',
    label: 'Da foto',
    tagline: 'Carichi una tua foto',
    description:
      'Parti da una singola foto di un volto reale (ben illuminato, frontale). ' +
      "L'avatar riprodurrà quel volto che parla, con lip-sync sul copione. " +
      'Ideale per dare un volto riconoscibile (es. un relatore reale).',
  },
  {
    type: 'prompt',
    label: 'Da descrizione',
    tagline: 'Descrivi il personaggio',
    description:
      'Nessuna foto: descrivi a parole il personaggio (età, genere, aspetto, ' +
      "stile) e l'IA genera un volto nuovo e originale. Ideale quando non hai " +
      'una foto o vuoi un presentatore generico, senza usare un volto reale.',
  },
];

/** Costo di CREAZIONE avatar via API (una tantum, per chiamata), in USD. */
export const HEYGEN_AVATAR_CREATION_COST_USD: Record<'photo' | 'digital_twin' | 'studio', number> = {
  // Avatar da foto (i nostri 'photo' e 'prompt').
  photo: 1.32,
  // Digital twin (training da video) — più costoso; non creato dal prodotto oggi.
  digital_twin: 2.13,
  // Avatar stock: già pronti, nessuna chiamata di creazione.
  studio: 0,
};

/**
 * Prezzo AL CLIENTE della creazione di un avatar (costo provider markuppato),
 * per tipo creabile. Usa lo stesso markup/buffer del preventivo di default così
 * backend e frontend mostrano lo stesso numero.
 */
export function heygenAvatarCreationCustomerPriceUsd(
  type: 'photo' | 'digital_twin',
  pricing?: Partial<PricingQuoteInput>,
): number {
  const cost = HEYGEN_AVATAR_CREATION_COST_USD[type];
  const input = PricingQuoteInput.parse(pricing ?? {});
  return computeQuote(cost, input).priceUsd;
}

/**
 * Engine di rendering scelto AUTOMATICAMENTE dal server in base al tipo di
 * avatar (l'utente non lo sceglie più). Avatar III è la pipeline foto→video,
 * la più economica e adatta a photo e studio; i digital twin usano comunque III
 * come default economico (resta configurabile lato server se serve più qualità).
 */
export function defaultEngineForAvatarType(_avatarType: HeyGenAvatarBillingType): HeyGenEngineId {
  return DEFAULT_HEYGEN_ENGINE;
}

/**
 * Etichetta leggibile del TIPO di avatar per la UI. Deriva dal `groupType`
 * HeyGen (per gli avatar dell'account) o dalla sorgente (stock). Normalizza i
 * vari valori possibili a tre categorie comprensibili all'autore.
 */
export function heygenAvatarTypeLabel(opts: {
  source?: 'mine' | 'stock';
  groupType?: string;
}): string {
  if (opts.source === 'stock') return 'Stock HeyGen';
  const g = (opts.groupType ?? '').toUpperCase();
  if (g.includes('PHOTO')) return 'Da foto';
  if (g.includes('TALKING_PHOTO')) return 'Da foto';
  if (g.includes('VIDEO') || g.includes('TWIN')) return 'Digital twin';
  // Avatar dell'account senza groupType noto: etichetta generica "I miei".
  return opts.source === 'mine' ? 'Mio avatar' : 'Avatar';
}

/**
 * Tipo di avatar ai fini del PREZZO, dedotto da sorgente/groupType. I nostri
 * avatar custom (photo/prompt) sono 'photo'; gli stock sono 'studio'; i digital
 * twin (video/twin) sono 'digital_twin'. Default prudenziale 'studio'.
 */
export function heygenBillingTypeFor(opts: {
  source?: 'mine' | 'stock';
  groupType?: string;
}): HeyGenAvatarBillingType {
  if (opts.source === 'stock') return 'studio';
  const g = (opts.groupType ?? '').toUpperCase();
  if (g.includes('PHOTO') || g.includes('TALKING_PHOTO')) return 'photo';
  if (g.includes('VIDEO') || g.includes('TWIN')) return 'digital_twin';
  // Avatar dell'account senza groupType: i nostri sono photo avatar.
  return opts.source === 'mine' ? 'photo' : 'studio';
}
