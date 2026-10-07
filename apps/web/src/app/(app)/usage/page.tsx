'use client';

import { Check, Minus } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useUsage } from '@/lib/api/hooks';

const RESOURCE_LABELS: Record<string, string> = {
  courses: 'Corsi',
  brands: 'Brand',
  knowledgeMb: 'Knowledge (MB)',
  exportsPerMonth: 'Export / mese',
  users: 'Utenti',
};

const FLAG_LABELS: Record<string, string> = {
  scorm12Export: 'Export SCORM 1.2',
  advancedInteractions: 'Interazioni avanzate',
  dataDeletion: 'Cancellazione dati',
  sso: 'Single Sign-On',
};

export default function UsagePage() {
  const usage = useUsage();

  return (
    <>
      <PageHeader title="Utilizzo e piano" description="Consumo delle risorse rispetto ai limiti del tuo piano." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quote</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {usage.isLoading &&
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            {usage.data?.quotas.map((q) => {
              const pct = q.limit ? (q.current / q.limit) * 100 : 0;
              return (
                <div key={q.resource} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{RESOURCE_LABELS[q.resource] ?? q.resource}</span>
                    <span className="text-muted-foreground">
                      {Math.round(q.current)} / {q.limit === null ? '∞' : q.limit}
                    </span>
                  </div>
                  {q.limit !== null ? (
                    <Progress value={pct} />
                  ) : (
                    <div className="h-2 w-full rounded-full bg-accent" />
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Funzionalità del piano</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {usage.isLoading &&
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            {usage.data &&
              Object.entries(usage.data.featureFlags).map(([key, enabled]) => (
                <div key={key} className="flex items-center justify-between rounded-lg border px-4 py-2.5">
                  <span className="text-sm">{FLAG_LABELS[key] ?? key}</span>
                  {enabled ? (
                    <Badge variant="success">
                      <Check className="mr-1 size-3" /> Attiva
                    </Badge>
                  ) : (
                    <Badge variant="secondary">
                      <Minus className="mr-1 size-3" /> Non inclusa
                    </Badge>
                  )}
                </div>
              ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
