'use client';

import * as React from 'react';
import { PageHeader } from '@/components/app/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Dropzone } from '@/components/knowledge/dropzone';
import { KnowledgeDocCard } from '@/components/knowledge/knowledge-doc-card';
import { useToast } from '@/components/ui/toast';
import {
  useCourses,
  useKnowledge,
  useUploadKnowledge,
  useDeleteKnowledge,
  useReprocessKnowledge,
} from '@/lib/api/hooks';

const ACCEPT =
  '.pdf,.docx,.pptx,.xlsx,.txt,.md,.html,.csv,application/pdf,text/plain,text/markdown,text/html,text/csv';

export default function KnowledgePage() {
  const toast = useToast();
  const upload = useUploadKnowledge();
  const del = useDeleteKnowledge();
  const reprocess = useReprocessKnowledge();

  // Vista: knowledge GLOBALE (riusabile) oppure le fonti di uno specifico corso.
  // '' = globale; altrimenti l'id del corso selezionato.
  const [courseFilter, setCourseFilter] = React.useState('');
  const isCourseView = courseFilter !== '';

  const courses = useCourses();
  const docs = useKnowledge(isCourseView ? 'COURSE' : 'GLOBAL', isCourseView ? courseFilter : undefined);

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

  function handleDelete(id: string, name: string) {
    // La conferma spiega la conseguenza reale: per le fonti di un corso, la
    // rimozione incide sulle FUTURE rigenerazioni, non sul contenuto già prodotto.
    const msg = isCourseView
      ? `Eliminare "${name}"? È una fonte del corso: verrà rimossa dalle future rigenerazioni (il contenuto già generato resta). Si rimuovono anche i relativi embeddings.`
      : `Eliminare "${name}"? Verranno rimossi anche i relativi embeddings.`;
    if (!confirm(msg)) return;
    void del
      .mutateAsync(id)
      .then(() => toast.show('Documento eliminato', 'success'))
      .catch(() => toast.show('Eliminazione non riuscita', 'error'));
  }

  function handleReprocess(id: string) {
    void reprocess
      .mutateAsync(id)
      .then(() => toast.show('Riprocessamento avviato', 'success'))
      .catch((err) =>
        toast.show(err instanceof Error ? err.message : 'Riprocessamento non riuscito', 'error'),
      );
  }

  return (
    <>
      <PageHeader
        title="Knowledge base"
        description="Carica documenti per dare contesto all'AI. La knowledge globale è riusabile da tutti i corsi; le fonti di un corso sono i contenuti su cui quel corso è costruito."
      />

      {/* Selettore vista: Globale vs fonti di un corso specifico. */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <label htmlFor="kb-scope" className="text-sm font-medium">
          Mostra
        </label>
        <Select
          id="kb-scope"
          value={courseFilter}
          className="max-w-xs"
          onChange={(e) => setCourseFilter(e.target.value)}
        >
          <option value="">Knowledge globale (riusabile)</option>
          <optgroup label="Fonti di un corso">
            {(courses.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </optgroup>
        </Select>
      </div>

      {/* Upload: solo per la knowledge GLOBALE. Le fonti di un corso si creano
          dal corso (flusso "da argomento" o upload nello step del brief). */}
      {!isCourseView && (
        <div className="mb-8">
          <Dropzone onFiles={handleFiles} accept={ACCEPT} disabled={upload.isPending} />
          {upload.isPending && (
            <p className="mt-2 text-sm text-muted-foreground">Caricamento in corso…</p>
          )}
        </div>
      )}

      <h2 className="mb-3 text-lg font-semibold">
        {isCourseView ? 'Fonti del corso' : 'Documenti'}
      </h2>

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
            {isCourseView
              ? 'Questo corso non ha ancora fonti. Si creano generando il corso da un argomento o caricando documenti dallo step «Brief».'
              : 'Nessun documento. Carica il primo file per iniziare.'}
          </CardContent>
        </Card>
      )}

      <ul className="space-y-2">
        {docs.data?.map((doc) => (
          <li key={doc.id}>
            <KnowledgeDocCard
              doc={doc}
              onReprocess={handleReprocess}
              reprocessing={reprocess.isPending}
              onDelete={handleDelete}
            />
          </li>
        ))}
      </ul>
    </>
  );
}
