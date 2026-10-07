import { Badge } from '@/components/ui/badge';
import type { EditorialStatus, IngestStatus } from '@/lib/api/types';

const EDITORIAL: Record<EditorialStatus, { label: string; variant: 'secondary' | 'warning' | 'success' }> = {
  DRAFT: { label: 'Bozza', variant: 'secondary' },
  IN_REVIEW: { label: 'In revisione', variant: 'warning' },
  APPROVED: { label: 'Approvato', variant: 'success' },
};

const INGEST: Record<IngestStatus, { label: string; variant: 'secondary' | 'warning' | 'success' | 'destructive' }> = {
  PENDING: { label: 'In coda', variant: 'secondary' },
  PROCESSING: { label: 'Elaborazione', variant: 'warning' },
  READY: { label: 'Pronto', variant: 'success' },
  FAILED: { label: 'Errore', variant: 'destructive' },
};

export function EditorialStatusBadge({ status }: { status: EditorialStatus }) {
  const s = EDITORIAL[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export function IngestStatusBadge({ status }: { status: IngestStatus }) {
  const s = INGEST[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}
