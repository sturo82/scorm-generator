'use client';

import * as React from 'react';
import { FileText, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { IngestStatusBadge } from '@/components/status-badge';
import { Dropzone } from '@/components/knowledge/dropzone';
import { useToast } from '@/components/ui/toast';
import { useKnowledge, useUploadKnowledge, useDeleteKnowledge } from '@/lib/api/hooks';
import { formatBytes } from '@/lib/format';

const ACCEPT =
  '.pdf,.docx,.pptx,.xlsx,.txt,.md,.html,.csv,application/pdf,text/plain,text/markdown,text/html,text/csv';

export default function KnowledgePage() {
  const docs = useKnowledge('GLOBAL');
  const upload = useUploadKnowledge();
  const del = useDeleteKnowledge();
  const toast = useToast();

  async function handleFiles(files: File[]) {
    for (const file of files) {
      try {
        await upload.mutateAsync({ file, scope: 'GLOBAL' });
        toast.show(`"${file.name}" caricato`, 'success');
      } catch (err) {
        toast.show(err instanceof Error ? err.message : 'Upload non riuscito', 'error');
      }
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Eliminare "${name}"? Verranno rimossi anche i relativi embeddings.`)) return;
    try {
      await del.mutateAsync(id);
      toast.show('Documento eliminato', 'success');
    } catch {
      toast.show('Eliminazione non riuscita', 'error');
    }
  }

  return (
    <>
      <PageHeader
        title="Knowledge base"
        description="Carica documenti per dare contesto all'AI. La knowledge globale è riusabile da tutti i corsi."
      />

      <div className="mb-8">
        <Dropzone onFiles={handleFiles} accept={ACCEPT} disabled={upload.isPending} />
        {upload.isPending && <p className="mt-2 text-sm text-muted-foreground">Caricamento in corso…</p>}
      </div>

      <h2 className="mb-3 text-lg font-semibold">Documenti</h2>

      {docs.isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

      {docs.data && docs.data.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-muted-foreground">
            Nessun documento. Carica il primo file per iniziare.
          </CardContent>
        </Card>
      )}

      <ul className="space-y-2">
        {docs.data?.map((doc) => (
          <li key={doc.id}>
            <Card>
              <CardContent className="flex items-center gap-4 p-4">
                <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
                  <FileText className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{doc.filename}</p>
                  <p className="text-sm text-muted-foreground">{formatBytes(doc.sizeBytes)}</p>
                </div>
                <IngestStatusBadge status={doc.status} />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Elimina documento"
                  className="text-muted-foreground"
                  onClick={() => handleDelete(doc.id, doc.filename)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}
