'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getApiClient } from './api/client';
import { useActiveJobs, useAssessments, useJobStatus, qk } from './api/hooks';
import type { ModuleView } from './api/types';

const api = getApiClient();

/** Tipo del job batch server-side che genera tutti i test mancanti. */
const BATCH_JOB_TYPE = 'course.generate_all_assessments';

/** Un test ancora da generare: un intermedio di un modulo, o il test finale. */
export interface PendingAssessment {
  scope: 'intermediate' | 'final';
  /** Presente solo per gli intermedi. */
  moduleId?: string;
  /** Etichetta leggibile (titolo modulo per gli intermedi, "Test finale" per il finale). */
  label: string;
  /**
   * True se il contenuto necessario a generare un buon test esiste già:
   *  - intermedio → il modulo ha almeno una lezione con contenuti;
   *  - finale → tutte le lezioni del corso hanno contenuti.
   * I test si basano sul RAG del contenuto delle lezioni: generarli prima dei
   * contenuti produce domande di scarsa qualità, quindi i non-pronti sono
   * "bloccati" (vanno generati i contenuti prima).
   */
  ready: boolean;
}

/**
 * Calcola i test del corso ancora DA GENERARE e offre un'azione per generarli
 * tutti con un UNICO job batch SERVER-SIDE. Il job vive sul server: resiste a
 * reload/chiusura del browser e viene ripreso dai job attivi del corso (come
 * "genera tutti i contenuti").
 *
 * "Pendente" = non esiste ancora un assessment per quello scope/modulo. "Pronto"
 * = il contenuto necessario esiste (vedi PendingAssessment.ready).
 *
 * I moduli vengono passati dal chiamante (già disponibili nella pagina).
 */
export function usePendingAssessments(courseId: string, modules: ModuleView[]) {
  const assessments = useAssessments(courseId);
  const activeJobs = useActiveJobs(courseId);
  const qc = useQueryClient();

  const list = React.useMemo(() => assessments.data ?? [], [assessments.data]);

  const pending = React.useMemo<PendingAssessment[]>(() => {
    // Niente struttura → niente test da generare (si generano per modulo/corso).
    if (modules.length === 0) return [];
    const modulesWithIntermediate = new Set(
      list.filter((a) => a.scope === 'intermediate' && a.moduleId).map((a) => a.moduleId),
    );
    const hasFinal = list.some((a) => a.scope === 'final');

    const moduleHasContent = (m: ModuleView) => m.lessons.some((l) => l.blocks.length > 0);
    // Finale pronto solo se OGNI lezione del corso ha contenuti (il test finale
    // copre l'intero corso). Serve almeno una lezione in totale.
    const allLessons = modules.flatMap((m) => m.lessons);
    const finalReady = allLessons.length > 0 && allLessons.every((l) => l.blocks.length > 0);

    const out: PendingAssessment[] = [];
    for (const m of modules) {
      if (!modulesWithIntermediate.has(m.id)) {
        out.push({ scope: 'intermediate', moduleId: m.id, label: m.title, ready: moduleHasContent(m) });
      }
    }
    if (!hasFinal) out.push({ scope: 'final', label: 'Test finale', ready: finalReady });
    return out;
  }, [modules, list]);

  // Separa i pendenti pronti (contenuti presenti) da quelli bloccati.
  const readyPending = React.useMemo(() => pending.filter((p) => p.ready), [pending]);
  const blockedPending = React.useMemo(() => pending.filter((p) => !p.ready), [pending]);

  // --- Job batch server-side (ripresa stato dopo reload/navigazione) --------
  const [batchJobId, setBatchJobId] = React.useState<string | null>(null);
  const serverBatch = React.useMemo(
    () => activeJobs.data?.find((j) => j.type === BATCH_JOB_TYPE) ?? null,
    [activeJobs.data],
  );
  // Idrata il jobId dal server se un batch è già in corso (ripresa stato).
  React.useEffect(() => {
    if (serverBatch && !batchJobId) setBatchJobId(serverBatch.id);
  }, [serverBatch, batchJobId]);

  const batchJob = useJobStatus(courseId, batchJobId);
  const running =
    Boolean(serverBatch) ||
    (Boolean(batchJobId) && (batchJob.data?.status === 'QUEUED' || batchJob.data?.status === 'RUNNING'));

  // Alla fine del batch: ricarica test e moduli, azzera il jobId una volta sola.
  const prevStatus = React.useRef<string | undefined>(undefined);
  React.useEffect(() => {
    const status = batchJob.data?.status;
    if (!batchJobId || !status) return;
    if (status !== prevStatus.current && (status === 'COMPLETED' || status === 'FAILED')) {
      qc.invalidateQueries({ queryKey: ['courses', courseId, 'assessments'] });
      qc.invalidateQueries({ queryKey: qk.modules(courseId) });
      qc.invalidateQueries({ queryKey: qk.jobs(courseId) });
      setBatchJobId(null);
    }
    prevStatus.current = status;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchJob.data?.status]);

  // Mentre il batch gira, ricarica periodicamente la lista test per mostrare i
  // test che completano uno a uno (avanzamento incrementale).
  React.useEffect(() => {
    if (!running) return;
    const t = setInterval(
      () => qc.invalidateQueries({ queryKey: ['courses', courseId, 'assessments'] }),
      2500,
    );
    return () => clearInterval(t);
  }, [running, courseId, qc]);

  /**
   * Avvia il job batch server-side che genera tutti i test mancanti di cui
   * esiste il contenuto. Ritorna true se avviato, false se non c'è nulla di
   * pronto o un batch è già in corso. Il server decide esattamente quali
   * generare (stessa regola "pronti"), quindi qui basta accodare.
   */
  const generateAllPending = React.useCallback(async (): Promise<boolean> => {
    if (running || readyPending.length === 0) return false;
    const { jobId } = await api.generateAllAssessments(courseId);
    setBatchJobId(jobId);
    qc.invalidateQueries({ queryKey: qk.jobs(courseId) });
    return true;
  }, [running, readyPending.length, courseId, qc]);

  return {
    /** Tutti i test ancora da generare (pronti + bloccati). */
    pending,
    /** Conteggio totale dei test pendenti. */
    pendingCount: pending.length,
    /** Test pendenti il cui contenuto esiste già (generabili subito). */
    readyPending,
    /** Quanti test sono pronti da generare. */
    readyCount: readyPending.length,
    /** Test pendenti bloccati: manca il contenuto delle lezioni. */
    blockedPending,
    /** Quanti test sono bloccati (contenuti mancanti). */
    blockedCount: blockedPending.length,
    /** True mentre il job batch server-side è in corso (ripreso dopo reload). */
    running,
    /** Avvia il job batch server-side. Ritorna true se avviato. */
    generateAllPending,
    /** True finché la lista dei test non è pronta. */
    loading: assessments.isLoading,
  };
}
