'use client';

import * as React from 'react';
import { Info } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { KnowledgeDocCard } from '@/components/knowledge/knowledge-doc-card';
import { useToast } from '@/components/ui/toast';
import { useKnowledge, useDeleteKnowledge, useReprocessKnowledge, useCourse } from '@/lib/api/hooks';

/**
 * Pannello "Fonti del corso": elenca la knowledge COURSE del corso (articoli
 * raccolti dal flusso "da argomento" + documenti caricati per il corso), con
 * download ed eliminazione. È il posto dove l'autore ritrova e gestisce i
 * contenuti su cui il corso è costruito — che NON compaiono nella Knowledge
 * globale (riusabile), avendo scope di corso.
 */
export function CourseSourcesPanel({ courseId }: { courseId: string }) {
  const toast = useToast();
  const docs = useKnowledge('COURSE', courseId);
  const course = useCourse(courseId);
  const del = useDeleteKnowledge();
  const reprocess = useReprocessKnowledge();

  // Documenti marcati come fonti costitutive del corso (brief.courseSourceDocIds).
  const sourceIds = React.useMemo(
    () => new Set(course.data?.brief?.courseSourceDocIds ?? []),
    [course.data?.brief?.courseSourceDocIds],
  );

  function handleDelete(id: string, name: string) {
    // Conferma consapevole: rimuovere una fonte incide sulle FUTURE
    // rigenerazioni, non sul contenuto già prodotto.
    if (
      !confirm(
        `Eliminare "${name}"? Verrà rimossa dalle future rigenerazioni del corso (il contenuto già generato resta invariato). Si rimuovono anche i relativi embeddings.`,
      )
    ) {
      return;
    }
    void del
      .mutateAsync(id)
      .then(() => toast.show('Fonte eliminata', 'success'))
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
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        Questi sono i contenuti su cui è costruito il corso: gli articoli raccolti quando il corso
        è stato creato da un argomento, più gli eventuali documenti caricati per questo corso. Puoi
        scaricarli o rimuoverli. Non compaiono nella Knowledge globale perché appartengono a questo
        corso.
      </p>

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
            Questo corso non ha fonti dedicate. Le fonti si creano generando il corso da un
            argomento, oppure caricando documenti nello step «Brief».
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
              badge={
                sourceIds.has(doc.id) ? (
                  <span className="inline-flex shrink-0 items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    Fonte
                  </span>
                ) : undefined
              }
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
