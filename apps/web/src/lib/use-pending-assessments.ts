'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getApiClient } from './api/client';
import { useAssessments, qk } from './api/hooks';
import type { ModuleView } from './api/types';

const api = getApiClient();

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

/** Attende il completamento di un job di generazione (polling imperativo). */
async function waitForJob(courseId: string, jobId: string, signal: { cancelled: boolean }): Promise<void> {
  // Limite di sicurezza: ~4 min (200 × 1200ms) per singolo test, poi smette di
  // attendere e passa al successivo (il job prosegue comunque sul server).
  for (let i = 0; i < 200; i++) {
    if (signal.cancelled) return;
    const job = await api.getJob(courseId, jobId);
    if (job.status === 'COMPLETED' || job.status === 'FAILED') return;
    await new Promise((r) => setTimeout(r, 1200));
  }
}

/**
 * Calcola i test del corso ancora DA GENERARE e offre un'azione per generarli
 * tutti in sequenza. "Pendente" = non esiste ancora un assessment per quello
 * scope/modulo (stessa euristica usata dalla gestione test): un modulo senza
 * test intermedio collegato, più il test finale se assente.
 *
 * I moduli vengono passati dal chiamante (già disponibili nella pagina), così
 * si evita una fetch duplicata.
 */
export function usePendingAssessments(courseId: string, modules: ModuleView[]) {
  const assessments = useAssessments(courseId);
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

  // Stato della generazione in blocco (una sequenza alla volta per corso).
  const [running, setRunning] = React.useState(false);
  const [progress, setProgress] = React.useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const cancelRef = React.useRef<{ cancelled: boolean }>({ cancelled: false });

  React.useEffect(() => {
    return () => {
      cancelRef.current.cancelled = true;
    };
  }, []);

  /**
   * Genera in sequenza i test pendenti PRONTI (quelli il cui contenuto esiste).
   * I bloccati vengono ignorati: prima vanno generati i contenuti. Ritorna il
   * numero di test avviati.
   */
  const generateAllPending = React.useCallback(async (): Promise<number> => {
    if (running) return 0;
    const items = readyPending;
    if (items.length === 0) return 0;
    const signal = { cancelled: false };
    cancelRef.current = signal;
    setRunning(true);
    setProgress({ done: 0, total: items.length });
    try {
      for (let i = 0; i < items.length; i++) {
        if (signal.cancelled) break;
        const it = items[i]!;
        const { jobId } = await api.generateAssessment(courseId, {
          scope: it.scope,
          moduleId: it.moduleId,
        });
        await waitForJob(courseId, jobId, signal);
        // Aggiorna la lista test man mano che completano.
        qc.invalidateQueries({ queryKey: ['courses', courseId, 'assessments'] });
        setProgress({ done: i + 1, total: items.length });
      }
      return items.length;
    } finally {
      if (!signal.cancelled) setRunning(false);
      qc.invalidateQueries({ queryKey: ['courses', courseId, 'assessments'] });
      qc.invalidateQueries({ queryKey: qk.jobs(courseId) });
    }
  }, [running, readyPending, courseId, qc]);

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
    /** True mentre la generazione in blocco è in corso. */
    running,
    /** Avanzamento della generazione in blocco. */
    progress,
    /** Genera in sequenza i soli test pronti. */
    generateAllPending,
    /** True finché la lista dei test non è pronta. */
    loading: assessments.isLoading,
  };
}
