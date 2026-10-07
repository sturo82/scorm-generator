'use client';

import * as React from 'react';
import { Receipt, TrendingUp, Info } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useCourseCost, useCourseQuote } from '@/lib/api/hooks';
import type { MeterUnit } from '@scorm/contracts';

/** Etichette leggibili per sorgente di costo. */
const SOURCE_LABEL: Record<string, string> = {
  outline: 'Struttura (outline)',
  lesson_content: 'Contenuti lezioni',
  assessment: 'Test e quiz',
  image_prompt: 'Preparazione immagini',
  image: 'Immagini lezioni',
  cover: 'Copertina',
  narration: 'Narrazione audio',
  video_transcript: 'Trascrizione video',
};

const UNIT_LABEL: Record<MeterUnit, string> = {
  INPUT_TOKENS: 'token in',
  OUTPUT_TOKENS: 'token out',
  IMAGES: 'immagini',
  CHARACTERS: 'caratteri',
  SECONDS: 'secondi',
};

/** Formatta un importo USD con granularità adatta ai micro-costi. */
function usd(n: number): string {
  if (n > 0 && n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function numberFmt(n: number): string {
  return new Intl.NumberFormat('it-IT').format(n);
}

/**
 * Pannello costi & prezzo del corso. Mostra il costo reale di produzione
 * (consuntivo misurato, per sorgente) e calcola il prezzo al cliente applicando
 * markup, buffer di sicurezza e fee fissa. I numeri del preventivo arrivano dal
 * backend (stessa formula dei contracts), così UI e server concordano.
 */
export function CoursePricingPanel({ courseId }: { courseId: string }) {
  const cost = useCourseCost(courseId);
  const [markupPct, setMarkupPct] = React.useState(60);
  const [bufferPct, setBufferPct] = React.useState(15);
  const [flatFeeUsd, setFlatFeeUsd] = React.useState(0);
  const quote = useCourseQuote(courseId, { markupPct, bufferPct, flatFeeUsd });

  const summary = cost.data;
  const hasUsage = (summary?.totalCalls ?? 0) > 0;

  return (
    <Card>
      <CardContent className="space-y-6 pt-6">
        <header className="flex items-start gap-3">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Receipt className="size-5" />
          </span>
          <div>
            <h3 className="text-base font-semibold">Costi &amp; prezzo del corso</h3>
            <p className="text-sm text-muted-foreground">
              Costo reale di produzione (consumo AI misurato) e prezzo di vendita con il tuo margine.
            </p>
          </div>
        </header>

        {/* Breakdown costo consuntivo */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Costo di produzione (consuntivo)</Label>
            {cost.isLoading ? (
              <Skeleton className="h-5 w-20" />
            ) : (
              <span className="font-mono text-sm font-semibold">{usd(summary?.providerCostUsd ?? 0)}</span>
            )}
          </div>

          {cost.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : !hasUsage ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Nessun consumo misurato ancora. Il costo compare dopo aver generato struttura,
              contenuti, immagini o narrazione del corso.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Voce</th>
                    <th className="px-3 py-2 text-right font-medium">Quantità</th>
                    <th className="px-3 py-2 text-right font-medium">Costo</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {summary!.lines.map((line, i) => (
                    <tr key={`${line.source}-${line.unit}-${i}`}>
                      <td className="px-3 py-2">
                        <span className="font-medium">{SOURCE_LABEL[line.source] ?? line.source}</span>
                        <span className="block text-xs text-muted-foreground">
                          {line.calls} {line.calls === 1 ? 'chiamata' : 'chiamate'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">
                        {numberFmt(line.quantity)} {UNIT_LABEL[line.unit]}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{usd(line.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 bg-muted/30">
                  <tr>
                    <td className="px-3 py-2 font-semibold" colSpan={2}>
                      Totale costo provider
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">
                      {usd(summary!.providerCostUsd)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

        {/* Pricing: markup / buffer / fee */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="size-4 text-primary" />
            <Label className="m-0">Prezzo al cliente</Label>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="markup">Markup %</Label>
              <Input
                id="markup"
                type="number"
                min={0}
                value={markupPct}
                onChange={(e) => setMarkupPct(clamp(Number(e.target.value), 0, 1000))}
              />
              <p className="text-xs text-muted-foreground">Il tuo margine commerciale.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="buffer">Buffer sicurezza %</Label>
              <Input
                id="buffer"
                type="number"
                min={0}
                value={bufferPct}
                onChange={(e) => setBufferPct(clamp(Number(e.target.value), 0, 500))}
              />
              <p className="text-xs text-muted-foreground">Copre la variabilità dei costi.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="fee">Fee fissa $</Label>
              <Input
                id="fee"
                type="number"
                min={0}
                step="0.01"
                value={flatFeeUsd}
                onChange={(e) => setFlatFeeUsd(clamp(Number(e.target.value), 0, 1_000_000))}
              />
              <p className="text-xs text-muted-foreground">Setup/gestione una tantum.</p>
            </div>
          </div>

          {/* Esito preventivo */}
          <div className="grid gap-3 rounded-xl border bg-accent/30 p-4 sm:grid-cols-3">
            <Metric label="Prezzo al cliente" value={quote.data ? usd(quote.data.priceUsd) : '—'} emphasis />
            <Metric label="Margine" value={quote.data ? usd(quote.data.marginUsd) : '—'} />
            <Metric
              label="Margine sul prezzo"
              value={quote.data ? `${quote.data.marginPctOfPrice.toFixed(1)}%` : '—'}
            />
          </div>

          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            Prezzo = costo × (1 + buffer%) × (1 + markup%) + fee. Il costo di produzione è il consumo
            reale misurato dai provider AI (listino ufficiale), così il prezzo resta sempre sopra il
            costo con il margine che scegli.
          </p>
        </section>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={emphasis ? 'text-2xl font-bold text-primary' : 'text-lg font-semibold'}>{value}</p>
    </div>
  );
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}
