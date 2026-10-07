'use client';

import { ScrollText } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useAudit } from '@/lib/api/hooks';
import { formatDate } from '@/lib/format';

export default function AuditPage() {
  const audit = useAudit();

  return (
    <>
      <PageHeader title="Audit trail" description="Registro delle azioni rilevanti del workspace." />

      {audit.isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      )}

      {audit.data && audit.data.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center text-muted-foreground">
            <div className="grid size-12 place-items-center rounded-xl bg-accent text-accent-foreground">
              <ScrollText className="size-6" />
            </div>
            Nessun evento registrato. Le azioni compariranno qui.
          </CardContent>
        </Card>
      )}

      {audit.data && audit.data.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {audit.data.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <Badge variant="outline" className="font-mono">
                    {e.action}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {e.resourceType}
                    {e.resourceId ? ` · ${e.resourceId}` : ''}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">{formatDate(e.createdAt)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}
