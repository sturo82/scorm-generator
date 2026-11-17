/**
 * "Segui la trascrizione": mentre il video avanza, la riga attiva della trascrizione
 * resta sempre alla STESSA altezza del pannello (circa un terzo dall'alto) e il testo
 * scorre verso l'alto. Scorre solo il contenitore della trascrizione, mai la pagina
 * (a differenza di scrollIntoView). Se l'utente scorre a mano, il follow si sospende
 * per qualche secondo così può rileggere senza essere riportato indietro.
 *
 * Senza dipendenze da React: lo usano sia l'anteprima web sia il player SCORM.
 */

/** Frazione dell'altezza del pannello a cui viene tenuta la riga attiva. */
const ANCHOR = 0.33;
/** Pausa del follow dopo un'interazione manuale dell'utente (ms). */
const USER_PAUSE_MS = 4000;

export interface TranscriptFollower {
  /** Porta la riga attiva all'altezza di riferimento (se il follow non è in pausa). */
  follow(cue: HTMLElement | null | undefined): void;
  /** Rimuove i listener. */
  dispose(): void;
}

/** Primo antenato scrollabile verticalmente della riga (il corpo del pannello). */
function scrollContainerOf(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node && node !== document.body) {
    const oy = getComputedStyle(node).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return null;
}

export function createTranscriptFollower(root: HTMLElement): TranscriptFollower {
  let pausedUntil = 0;
  const pause = (): void => {
    pausedUntil = Date.now() + USER_PAUSE_MS;
  };
  // Segnali di interazione dell'utente (non l'evento "scroll", che scatta anche per il follow).
  const events: Array<keyof HTMLElementEventMap> = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
  const targets = Array.prototype.slice.call(root.querySelectorAll<HTMLElement>('.video-panel-body')) as HTMLElement[];
  targets.forEach((t) => events.forEach((e) => t.addEventListener(e, pause, { passive: true })));

  return {
    follow(cue) {
      if (!cue || Date.now() < pausedUntil) return;
      const box = scrollContainerOf(cue);
      if (!box) return; // pannello nascosto o trascrizione corta: niente da scorrere
      const boxRect = box.getBoundingClientRect();
      const cueRect = cue.getBoundingClientRect();
      const delta = cueRect.top - boxRect.top - box.clientHeight * ANCHOR;
      if (Math.abs(delta) < 2) return;
      const top = Math.max(0, Math.min(box.scrollHeight - box.clientHeight, box.scrollTop + delta));
      if (typeof box.scrollTo === 'function') box.scrollTo({ top, behavior: 'smooth' });
      else box.scrollTop = top;
    },
    dispose() {
      targets.forEach((t) => events.forEach((e) => t.removeEventListener(e, pause)));
    },
  };
}
