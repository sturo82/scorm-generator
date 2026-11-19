'use client';

/** " · N crediti" accanto a un pulsante, solo se i crediti sono attivi e il prezzo è noto. */
export function CreditsTag({ value, billed, prefix = ' · ' }: { value: number | null | undefined; billed: boolean | undefined; prefix?: string }) {
  if (!billed || value === null || value === undefined) return null;
  return (
    <span className="font-normal opacity-80">
      {prefix}
      {value.toLocaleString('it-IT')} crediti
    </span>
  );
}
