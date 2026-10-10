'use client';

import * as React from 'react';
import { PageHeader } from '@/components/app/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { EditorialStatusBadge } from '@/components/status-badge';
import { CourseWizard } from '@/components/courses/course-wizard';
import { GeneratingBadge } from '@/components/courses/generating-badge';
import { useDynamicRouteId } from '@/lib/use-dynamic-route-id';
import { useCourse, useActiveJobs } from '@/lib/api/hooks';

/** Vista di dettaglio corso: shell client, dati risolti a runtime via API. */
export function CourseDetailClient() {
  // Export statico: la pagina è lo shell "placeholder" servito per ogni id dal
  // CDN. useParams() restituirebbe "placeholder" (il param di build), quindi
  // leggiamo l'id reale dall'URL del browser.
  const courseId = useDynamicRouteId('courses');
  const course = useCourse(courseId);
  const activeJobs = useActiveJobs(courseId);
  const generating = (activeJobs.data?.length ?? 0) > 0;

  // Finché l'id non è risolto dall'URL (pre-idratazione) o il corso sta
  // caricando, mostriamo lo skeleton: così non lampeggia "Corso non trovato".
  if (!courseId || course.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!course.data) return <p className="text-muted-foreground">Corso non trovato.</p>;

  return (
    <>
      <PageHeader
        title={course.data.title}
        description="Segui i passi guidati: dal brief all’export del pacchetto SCORM."
        actions={
          <div className="flex items-center gap-2">
            {generating && <GeneratingBadge />}
            <EditorialStatusBadge status={course.data.status} />
          </div>
        }
      />
      <CourseWizard courseId={courseId} />
    </>
  );
}
