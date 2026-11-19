import {
  plannedLessonCount,
  plannedLessonFormats,
  plannedModuleCount,
  type Brief,
  type CourseOutline,
  type LessonOutline,
} from '@scorm/contracts';

/** Parole significative di un titolo (minuscole, senza punteggiatura, almeno 3 lettere). */
function words(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3),
  );
}

/** Somiglianza tra due titoli (parole in comune / parole totali). */
function similarity(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / (wa.size + wb.size - common);
}

/**
 * Riporta la struttura generata dall'AI al piano del brief, che è anche il preventivo:
 *  - non più lezioni di quelle previste. Con un'anteprima si tolgono quelle che non corrispondono a
 *    nessun argomento previsto (es. un'introduzione aggiunta), altrimenti le ultime;
 *  - non più moduli del massimo: si uniscono i moduli vicini più piccoli;
 *  - formato di ogni lezione dal piano (formato globale, eccezioni dell'autore, default), quando
 *    il piano lo stabilisce.
 * Non aggiunge mai lezioni: se l'AI ne propone meno, il corso costa meno del preventivo.
 */
export function enforceOutlinePlan(outline: CourseOutline, brief: Brief): { outline: CourseOutline; changes: string[] } {
  const changes: string[] = [];
  const maxLessons = plannedLessonCount(brief);
  const maxModules = plannedModuleCount(maxLessons);
  const suggested = brief.suggestedLessons ?? [];

  // Lezioni con la posizione del modulo, per poterle togliere mantenendo la struttura.
  let modules = outline.modules.map((m) => ({ ...m, lessons: [...m.lessons] }));
  const all = () => modules.flatMap((m, mi) => m.lessons.map((l, li) => ({ l, mi, li })));

  while (all().length > maxLessons) {
    const items = all();
    let victim = items[items.length - 1]!;
    if (suggested.length > 0) {
      let worst = Infinity;
      for (const it of items) {
        const best = Math.max(...suggested.map((s) => similarity(it.l.title, s)));
        if (best < worst) {
          worst = best;
          victim = it;
        }
      }
    }
    modules[victim.mi]!.lessons.splice(victim.li, 1);
    changes.push(`tolta la lezione «${victim.l.title}» (oltre le ${maxLessons} previste)`);
    modules = modules.filter((m) => m.lessons.length > 0);
  }

  while (modules.length > maxModules) {
    // Unisce la coppia di moduli vicini con meno lezioni in totale.
    let at = 0;
    let size = Infinity;
    for (let i = 0; i + 1 < modules.length; i++) {
      const s = modules[i]!.lessons.length + modules[i + 1]!.lessons.length;
      if (s < size) {
        size = s;
        at = i;
      }
    }
    const a = modules[at]!;
    const b = modules[at + 1]!;
    modules.splice(at, 2, { ...a, lessons: [...a.lessons, ...b.lessons], summary: [a.summary, b.summary].filter(Boolean).join(' ') || undefined });
    changes.push(`uniti i moduli «${a.title}» e «${b.title}» (massimo ${maxModules} moduli)`);
  }

  const formats = plannedLessonFormats(brief);
  let i = 0;
  modules = modules.map((m) => ({
    ...m,
    lessons: m.lessons.map((l): LessonOutline => {
      const f = formats[i++] ?? null;
      if (!f || l.format === f) return l;
      return { ...l, format: f, videoFirst: f === 'video_first' };
    }),
  }));

  return { outline: { ...outline, modules }, changes };
}
