'use client';

import * as React from 'react';
import { PageHeader } from '@/components/app/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { EditorialStatusBadge } from '@/components/status-badge';
import { CourseWizard } from '@/components/courses/course-wizard';
import { GeneratingBadge } from '@/components/courses/generating-badge';
import { useDynamicRouteId } from '@/lib/use-dynamic-route-id';
import { useCourse, useActiveJobs, useAutopilot } from '@/lib/api/hooks';
import { AutopilotScreen } from '@/components/courses/autopilot-screen';
import { SlideStudio } from '@/components/courses/slide-studio';
import { Button } from '@/components/ui/button';

/** Vista di dettaglio corso: shell client, dati risolti a runtime via API. */
export function CourseDetailClient() {
  // Export statico: la pagina è lo shell "placeholder" servito per ogni id dal
  // CDN. useParams() restituirebbe "placeholder" (il param di build), quindi
  // leggiamo l'id reale dall'URL del browser.
  const courseId = useDynamicRouteId('courses');
  const course = useCourse(courseId);
  const activeJobs = useActiveJobs(courseId);
  // Generazione automatica: finché non è chiusa, la sua schermata sostituisce i passi guidati.
  const autopilot = useAutopilot(courseId);
  const generating = (activeJobs.data?.length ?? 0) > 0;
  // Corsi nati da slide: lo Studio video al posto dei passi guidati (si può tornare all'editor classico).
  const [classic, setClassic] = React.useState(false);
  React.useEffect(() => {
    try {
      setClassic(window.localStorage.getItem(`course-classic:${courseId}`) === '1');
    } catch {
      /* storage non disponibile */
    }
  }, [courseId]);
  const setClassicMode = (on: boolean) => {
    setClassic(on);
    try {
      if (on) window.localStorage.setItem(`course-classic:${courseId}`, '1');
      else window.localStorage.removeItem(`course-classic:${courseId}`);
    } catch {
      /* storage non disponibile */
    }
  };

  // Finché l'id non è risolto dall'URL (pre-idratazione) o il corso sta
  // caricando, mostriamo lo skeleton: così non lampeggia "Corso non trovato".
  if (!courseId || course.isLoading || autopilot.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!course.data) return <p className="text-muted-foreground">Corso non trovato.</p>;
  const slidesImportId = course.data.slidesImportId;

  return (
    <>
      <PageHeader
        title={course.data.title}
        description={slidesImportId && !classic ? 'Rivedi il video, correggi i copioni e pubblica.' : 'Contenuti, impostazioni e pubblicazione del corso.'}
        actions={
          <div className="flex items-center gap-2">
            {generating && <GeneratingBadge />}
            <EditorialStatusBadge status={course.data.status} />
          </div>
        }
      />
      {autopilot.data ? (
        <AutopilotScreen courseId={courseId} view={autopilot.data} />
      ) : slidesImportId && !classic ? (
        <SlideStudio courseId={courseId} importId={slidesImportId} onOpenClassic={() => setClassicMode(true)} />
      ) : (
        <>
          {slidesImportId && (
            <div className="mb-4 flex justify-end">
              <Button variant="outline" size="sm" onClick={() => setClassicMode(false)}>
                Torna allo Studio video
              </Button>
            </div>
          )}
          <CourseWizard courseId={courseId} />
        </>
      )}
    </>
  );
}
