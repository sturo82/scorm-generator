'use client';
import { cn } from '@/lib/cn';
import { useCreditQuote } from '@/lib/api/hooks';
import type { CreditQuoteItem } from '@scorm/contracts';

/**
 * Costo in crediti di una generazione, mostrato accanto al pulsante che la avvia. Non compare per
 * le aziende che non pagano a crediti. Le feature a minuti si arrotondano per eccesso al minuto
 * intero (come l'addebito); il consumo reale può risultare inferiore.
 */
export function CreditCost({
  items,
  prefix = ' · ',
  suffix = '',
  className,
}: {
  items: CreditQuoteItem[];
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  const quote = useCreditQuote(items);
  if (!quote.data?.billed) return null;
  if (!quote.data.priced) {
    return <span className={cn('whitespace-nowrap opacity-80', className)}>{prefix}non disponibile</span>;
  }
  return (
    <span className={cn('whitespace-nowrap', className)}>
      {prefix}
      {quote.data.total.toLocaleString('it-IT')} crediti{suffix}
    </span>
  );
}
