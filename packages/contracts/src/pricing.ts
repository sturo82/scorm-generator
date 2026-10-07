import { z } from 'zod';

/**
 * Metering costi AI e pricing cost-plus (listino + markup). Fonte di verità
 * unica condivisa da backend e frontend. I costi lato dominio sono in USD a
 * granularità fine (il listino dei provider AWS è in USD); eventuale conversione
 * valuta e formattazione restano responsabilità della UI.
 */

/** Provider/servizio a pagamento misurato. */
export const MeterProvider = z.enum(['BEDROCK_LLM', 'BEDROCK_IMAGE', 'POLLY', 'TRANSCRIBE']);
export type MeterProvider = z.infer<typeof MeterProvider>;

/** Unità di consumo misurata. */
export const MeterUnit = z.enum(['INPUT_TOKENS', 'OUTPUT_TOKENS', 'IMAGES', 'CHARACTERS', 'SECONDS']);
export type MeterUnit = z.infer<typeof MeterUnit>;

/**
 * Fase/operazione sorgente del consumo, per il breakdown nel pannello costi.
 * Stabile e usata come chiave di raggruppamento nel riepilogo.
 */
export const UsageSource = z.enum([
  'outline',
  'lesson_content',
  'assessment',
  'image_prompt',
  'image',
  'cover',
  'narration',
]);
export type UsageSource = z.infer<typeof UsageSource>;

/** Voce di breakdown del costo per sorgente/unità. */
export const CostLine = z.object({
  source: z.string(),
  provider: MeterProvider,
  unit: MeterUnit,
  /** Quantità totale consumata (token/immagini/caratteri). */
  quantity: z.number().int().nonnegative(),
  /** Numero di addebiti aggregati in questa voce. */
  calls: z.number().int().nonnegative(),
  /** Costo in USD della voce. */
  costUsd: z.number().nonnegative(),
});
export type CostLine = z.infer<typeof CostLine>;

/** Riepilogo costi di un corso (consuntivo: somma degli UsageRecord). */
export const CourseCostSummary = z.object({
  courseId: z.string(),
  /** Costo provider totale in USD (somma delle voci). */
  providerCostUsd: z.number().nonnegative(),
  /** Dettaglio per sorgente. */
  lines: z.array(CostLine),
  /** Numero totale di addebiti misurati. */
  totalCalls: z.number().int().nonnegative(),
  /** Timestamp dell'ultimo consumo misurato, se presente. */
  lastUsageAt: z.string().datetime().nullable().default(null),
});
export type CourseCostSummary = z.infer<typeof CourseCostSummary>;

/**
 * Preventivo di prezzo al cliente a partire dal costo provider.
 *   price = cost * (1 + markupPct/100) * (1 + bufferPct/100) + flatFeeUsd
 * `bufferPct` copre la variabilità dei costi (output token non noti a priori);
 * `markupPct` è il margine commerciale.
 */
export const PricingQuoteInput = z.object({
  /** Margine commerciale percentuale (es. 60 = +60%). */
  markupPct: z.number().min(0).max(1000).default(60),
  /** Buffer di sicurezza percentuale sulla variabilità dei costi. */
  bufferPct: z.number().min(0).max(500).default(15),
  /** Fee fissa aggiuntiva in USD (setup, gestione, ecc.). */
  flatFeeUsd: z.number().min(0).default(0),
});
export type PricingQuoteInput = z.infer<typeof PricingQuoteInput>;

/** Preventivo calcolato: costo, prezzo e margine risultante. */
export const PricingQuote = z.object({
  providerCostUsd: z.number().nonnegative(),
  markupPct: z.number(),
  bufferPct: z.number(),
  flatFeeUsd: z.number(),
  /** Costo con buffer applicato (base su cui si calcola il prezzo). */
  bufferedCostUsd: z.number().nonnegative(),
  /** Prezzo finale al cliente in USD. */
  priceUsd: z.number().nonnegative(),
  /** Margine assoluto (price - providerCost) in USD. */
  marginUsd: z.number(),
  /** Margine percentuale sul prezzo di vendita. */
  marginPctOfPrice: z.number(),
});
export type PricingQuote = z.infer<typeof PricingQuote>;

/**
 * Calcolo puro del preventivo. Centralizzato nei contracts così backend e
 * frontend producono gli stessi numeri. Il buffer protegge dalla variabilità;
 * il markup è il margine. Il margine% è sul prezzo di vendita (gross margin).
 */
export function computeQuote(providerCostUsd: number, input: PricingQuoteInput): PricingQuote {
  const { markupPct, bufferPct, flatFeeUsd } = PricingQuoteInput.parse(input);
  const bufferedCostUsd = providerCostUsd * (1 + bufferPct / 100);
  const priceUsd = bufferedCostUsd * (1 + markupPct / 100) + flatFeeUsd;
  const marginUsd = priceUsd - providerCostUsd;
  const marginPctOfPrice = priceUsd > 0 ? (marginUsd / priceUsd) * 100 : 0;
  return {
    providerCostUsd,
    markupPct,
    bufferPct,
    flatFeeUsd,
    bufferedCostUsd,
    priceUsd,
    marginUsd,
    marginPctOfPrice,
  };
}

/** Costo in USD di una quantità, dato un prezzo di listino per `perUnits`. */
export function computeCostUsd(quantity: number, unitPriceUsd: number, perUnits: number): number {
  if (perUnits <= 0) return 0;
  return (quantity / perUnits) * unitPriceUsd;
}
