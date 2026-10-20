/*
 * render-core-entry.ts — Entry del bundle IIFE del renderer condiviso per il
 * runtime SCORM. esbuild lo bundla (con il core di @scorm/contracts/render-core)
 * in `assets/render-core.js`, esposto come `window.RenderCore`. Gli asset del
 * runtime (renderers.js) lo usano per costruire i nodi DOM dei block migrati.
 *
 * NON importa nulla di Node/React: solo il core puro + l'adapter DOM qui sotto.
 */

import {
  renderBlock,
  isHandledByCore,
  initialState,
  reduce,
  renderStateful,
  buildCourseSteps,
  groupConcepts,
  renderVideoFirstLesson,
  renderPillolaLesson,
  renderPillolaInterattivaLesson,
  type VNode,
  type VChild,
  type RenderContext,
  type StatefulSpec,
  type StatefulState,
} from '@scorm/contracts/render-core';
import { courseLabels, resolveLessonLayout, type CourseLabels } from '@scorm/contracts';

/**
 * Etichette dei block nella lingua del corso, lette dal global __COURSE__
 * (iniettato dal builder). Usate dalle re-render stateful per restare coerenti
 * con il render iniziale. Fallback inglese.
 */
function runtimeLabels(): CourseLabels {
  const g = (typeof window !== 'undefined' ? window : globalThis) as Record<string, unknown>;
  const course = (g.__COURSE__ as { language?: string } | undefined) || undefined;
  return courseLabels(course?.language);
}

/** True se il valore è un VNode. */
function isVNode(x: VChild): x is VNode {
  return typeof x === 'object' && x !== null && typeof (x as VNode).tag === 'string';
}

/**
 * Monta un VNode in un nodo DOM reale. Applica attributi (class/html/attr),
 * figli (ricorsivo), e interpreta i `behavior` dichiarativi con listener
 * vanilla. In Fase 0 nessun behavior è ancora usato (rich_text è statico): la
 * gestione è predisposta per le fasi successive.
 */
function mount(vnode: VChild): Node {
  if (vnode == null) return document.createComment('');
  if (typeof vnode === 'string' || typeof vnode === 'number') {
    return document.createTextNode(String(vnode));
  }
  const node = document.createElement(vnode.tag);
  const attrs = vnode.attrs || {};
  Object.keys(attrs).forEach(function (k) {
    const v = attrs[k];
    if (v === undefined || v === false) return;
    if (k === 'class') node.className = String(v);
    else node.setAttribute(k, v === true ? '' : String(v));
  });
  if (typeof vnode.html === 'string') {
    node.innerHTML = vnode.html;
  } else {
    (vnode.children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(isVNode(c) ? mount(c) : document.createTextNode(String(c)));
    });
  }
  if (vnode.behavior) applyBehavior(node, vnode.behavior);
  return node;
}

/**
 * Attiva l'interazione dichiarativa su un sottoalbero già montato, interrogando
 * i `data-*` hook emessi dal core. Una sola implementazione per il backend DOM.
 * (L'adapter React implementa gli stessi comportamenti con hook/stato.)
 */
function applyBehavior(node: HTMLElement, behavior: NonNullable<VNode['behavior']>): void {
  switch (behavior.kind) {
    case 'toggle':
      return applyToggle(node);
    case 'tabs':
      return applyTabs(node, behavior.initialTabId);
    case 'hotspot':
      return applyHotspot(node);
    case 'carousel':
      return applyCarousel(node);
    case 'stateful':
      return applyStateful(node, behavior.spec);
    case 'video-karaoke':
      return applyVideoKaraoke(node);
    default:
      return;
  }
}

/** stateful: ri-renderizza il contenuto a ogni evento (reduce nel core). */
function applyStateful(root: HTMLElement, spec: StatefulSpec): void {
  const host = root.querySelector<HTMLElement>('[data-stateful]');
  if (!host) return;
  const resolve = (m: Record<string, unknown>): string | null =>
    m && typeof m.storageKey === 'string' ? (m.storageKey as string) : null;
  let state: StatefulState = initialState(spec);
  const labels = runtimeLabels();

  function rerender(): void {
    host!.innerHTML = '';
    host!.appendChild(mount(renderStateful(spec, state, resolve, labels)));
    applyScenarioVideoGate(host!);
  }
  function dispatch(ev: string, arg?: string, arg2?: string): void {
    state = reduce(spec, state, { ev, arg, arg2 });
    rerender();
  }

  // Click sugli elementi con data-ev.
  host.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-ev]');
    if (!t || !host.contains(t)) return;
    if (t.getAttribute('aria-disabled') === 'true' || (t as HTMLButtonElement).disabled) return;
    dispatch(t.getAttribute('data-ev')!, t.getAttribute('data-arg') || undefined, t.getAttribute('data-arg2') || undefined);
  });

  // Drag & drop: i chip espongono data-dnd-chip (valore), i target
  // data-dnd-slot (match) o data-dnd-bucket (sort) con data-ev=drop/place.
  host.addEventListener('dragstart', (e) => {
    const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-dnd-chip]');
    if (chip && e.dataTransfer) e.dataTransfer.setData('text/plain', chip.getAttribute('data-dnd-chip')!);
  });
  host.addEventListener('dragover', (e) => {
    if ((e.target as HTMLElement).closest('[data-dnd-slot],[data-dnd-bucket]')) e.preventDefault();
  });
  host.addEventListener('drop', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-dnd-slot],[data-dnd-bucket]');
    if (!target || !e.dataTransfer) return;
    e.preventDefault();
    const value = e.dataTransfer.getData('text/plain');
    const ev = target.getAttribute('data-ev') || 'drop';
    const arg = target.getAttribute('data-arg') || '';
    dispatch(ev === 'clear' ? 'drop' : ev, arg, value);
  });

  rerender();
}

/**
 * Libro-game "pillole": in una scena con video "gated" (data-scenario-video=
 * "gate"), nascondi le scelte finché il video non termina, poi rivelale. Se il
 * video non è riproducibile o l'utente usa i controlli, resta un fallback:
 * le scelte compaiono comunque al primo 'ended'. Idempotente per render.
 */
function applyScenarioVideoGate(host: HTMLElement): void {
  // Qualsiasi video di scena (gate o free): all'ingresso nella scena riparte
  // dall'inizio e va in autoplay, così navigando tra le scene parte SEMPRE il
  // video (con audio) della scena corrente, non quello lasciato in pausa prima.
  const sceneVideo = host.querySelector<HTMLVideoElement>('video.scenario-video');
  if (sceneVideo) {
    try {
      sceneVideo.currentTime = 0;
      const pr = sceneVideo.play();
      if (pr && typeof (pr as Promise<void>).catch === 'function') {
        // L'autoplay con audio può essere bloccato dal browser al primo caricamento
        // (prima di un'interazione utente): in tal caso restano i controlli manuali.
        (pr as Promise<void>).catch(() => undefined);
      }
    } catch {
      /* play() non disponibile (es. jsdom): ininfluente */
    }
  }

  // FULLSCREEN premium: il pulsante custom manda a schermo intero lo STAGE
  // (contenitore video + overlay), NON il <video>, così le scelte restano
  // sovrapposte e visibili anche in fullscreen. Idempotente per render.
  const stage = host.querySelector<HTMLElement>('.scenario-stage');
  const fsBtn = host.querySelector<HTMLButtonElement>('[data-scenario-fullscreen]');
  if (stage && fsBtn && !fsBtn.getAttribute('data-fs-bound')) {
    fsBtn.setAttribute('data-fs-bound', '1');
    fsBtn.addEventListener('click', () => {
      const doc = document as Document & { webkitFullscreenElement?: Element | null };
      const el = stage as HTMLElement & {
        webkitRequestFullscreen?: () => void;
      };
      const d = document as Document & { webkitExitFullscreen?: () => void };
      const inFs = !!(document.fullscreenElement || doc.webkitFullscreenElement);
      try {
        if (inFs) {
          if (document.exitFullscreen) void document.exitFullscreen();
          else if (d.webkitExitFullscreen) d.webkitExitFullscreen();
        } else if (el.requestFullscreen) {
          void el.requestFullscreen();
        } else if (el.webkitRequestFullscreen) {
          el.webkitRequestFullscreen();
        }
      } catch {
        /* Fullscreen API non disponibile o bloccata: nessuna azione */
      }
    });
  }

  const video = host.querySelector<HTMLVideoElement>('video[data-scenario-video="gate"]');
  const choices = host.querySelector<HTMLElement>('.scenario-choices[data-choices-gated="1"]');
  if (!video || !choices) return;
  // Stato iniziale: scelte nascoste finché il video non finisce.
  choices.setAttribute('hidden', 'hidden');
  const reveal = (): void => choices.removeAttribute('hidden');
  video.addEventListener('ended', reveal, { once: true });
}

/** video-karaoke: tab + evidenziazione cue su timeupdate + click-to-seek. */
function applyVideoKaraoke(root: HTMLElement): void {
  // Tab (riusa la logica dei pannelli): un pannello attivo per volta.
  const btns = root.querySelectorAll<HTMLElement>('[data-tab-btn]');
  const panels = root.querySelectorAll<HTMLElement>('[data-tab-panel]');
  function activate(id: string): void {
    btns.forEach((b) => {
      const on = b.getAttribute('data-tab-btn') === id;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.className = on
        ? b.className.replace(/\s*is-active/g, '') + ' is-active'
        : b.className.replace(/\s*is-active/g, '');
    });
    panels.forEach((pnl) => {
      if (pnl.getAttribute('data-tab-panel') === id) pnl.removeAttribute('hidden');
      else pnl.setAttribute('hidden', 'hidden');
    });
  }
  btns.forEach((b) => b.addEventListener('click', () => activate(b.getAttribute('data-tab-btn') || '')));

  const video = root.querySelector<HTMLVideoElement>('[data-video-el]');
  const cues = Array.prototype.slice.call(root.querySelectorAll<HTMLElement>('.transcript-cue'));

  // Click-to-seek.
  cues.forEach((row) => {
    row.addEventListener('click', () => {
      if (!video) return;
      const t = Number(row.getAttribute('data-seek') || '0');
      video.currentTime = t;
      try {
        const pr = video.play();
        if (pr && pr.catch) pr.catch(() => undefined);
      } catch (e) {
        /* play() non disponibile (es. jsdom): seek comunque applicato */
      }
    });
  });

  // Karaoke highlight.
  if (video && cues.length > 0) {
    const starts = cues.map((c) => Number(c.getAttribute('data-seek') || '0'));
    let lastIdx = -1;
    video.addEventListener('timeupdate', () => {
      const tt = video.currentTime;
      let idx = -1;
      for (let i = 0; i < starts.length; i++) {
        if (starts[i]! <= tt) idx = i;
        else break;
      }
      if (idx === lastIdx) return;
      lastIdx = idx;
      cues.forEach((c) => (c.className = 'transcript-cue'));
      if (idx >= 0 && cues[idx]) {
        cues[idx].className = 'transcript-cue is-active';
        if (cues[idx].scrollIntoView) cues[idx].scrollIntoView({ block: 'nearest' });
      }
    });
  }
}

/** toggle: trigger con aria-expanded + body [hidden]; o self-flip (aria-pressed). */
function applyToggle(root: HTMLElement): void {
  const selfs = root.querySelectorAll<HTMLElement>('[data-toggle-self]');
  selfs.forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.setAttribute('aria-pressed', btn.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
    });
  });
  const triggers = root.querySelectorAll<HTMLElement>('[data-toggle-trigger]');
  triggers.forEach((btn) => {
    const body = btn.nextElementSibling as HTMLElement | null;
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', open ? 'false' : 'true');
      if (!body) return;
      if (open) body.setAttribute('hidden', 'hidden');
      else body.removeAttribute('hidden');
    });
  });
}

/** tabs: un pannello attivo per volta, bottoni con aria-selected. */
function applyTabs(root: HTMLElement, initialTabId: string): void {
  const btns = root.querySelectorAll<HTMLElement>('[data-tab-btn]');
  const panels = root.querySelectorAll<HTMLElement>('[data-tab-panel]');
  function activate(id: string): void {
    btns.forEach((b) => {
      const on = b.getAttribute('data-tab-btn') === id;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.className = on ? b.className.replace(/\s*is-active/g, '') + ' is-active' : b.className.replace(/\s*is-active/g, '');
    });
    panels.forEach((pnl) => {
      const on = pnl.getAttribute('data-tab-panel') === id;
      if (on) pnl.removeAttribute('hidden');
      else pnl.setAttribute('hidden', 'hidden');
    });
  }
  btns.forEach((b) => {
    b.addEventListener('click', () => activate(b.getAttribute('data-tab-btn') || ''));
  });
  activate(initialTabId);
}

/** hotspot: dot esclusivi (aria-pressed) + box info condiviso che cambia testo. */
function applyHotspot(root: HTMLElement): void {
  const dots = root.querySelectorAll<HTMLElement>('[data-hotspot-dot]');
  const info = root.querySelector<HTMLElement>('[data-hotspot-info]');
  dots.forEach((dot) => {
    dot.addEventListener('click', () => {
      const wasActive = dot.getAttribute('aria-pressed') === 'true';
      dots.forEach((d) => d.setAttribute('aria-pressed', 'false'));
      if (!info) return;
      if (wasActive) {
        info.setAttribute('hidden', 'hidden');
        return;
      }
      dot.setAttribute('aria-pressed', 'true');
      const src = root.querySelector<HTMLElement>(
        '[data-hotspot-content="' + dot.getAttribute('data-hotspot-dot') + '"]',
      );
      info.innerHTML = src ? src.innerHTML : '';
      positionHotspotInfo(info, dot);
      info.removeAttribute('hidden');
    });
  });
}

/**
 * Posiziona il popover info accanto al pallino attivo: stesse coordinate (%)
 * del dot, con la "coda" sopra/sotto a seconda che il dot sia nella metà
 * inferiore o superiore dell'immagine (così il fumetto non esce dal bordo).
 */
function positionHotspotInfo(info: HTMLElement, dot: HTMLElement): void {
  const left = dot.style.left || '50%';
  const top = dot.style.top || '50%';
  const yPct = parseFloat(top);
  const below = yPct < 50; // dot in alto → popover sotto; dot in basso → sopra
  info.style.left = left;
  info.style.top = top;
  info.setAttribute('data-pos', below ? 'below' : 'above');
}

/** carousel: mostra uno slide per volta con prev/next e stato "Passo n di m". */
function applyCarousel(root: HTMLElement): void {
  const slides = Array.prototype.slice.call(root.querySelectorAll<HTMLElement>('[data-carousel-slide]'));
  const prev = root.querySelector<HTMLButtonElement>('[data-carousel-prev]');
  const next = root.querySelector<HTMLButtonElement>('[data-carousel-next]');
  const status = root.querySelector<HTMLElement>('[data-carousel-status]');
  const L = runtimeLabels();
  let idx = 0;
  function render(): void {
    slides.forEach((s, i) => {
      if (i === idx) s.removeAttribute('hidden');
      else s.setAttribute('hidden', 'hidden');
    });
    if (status) status.textContent = L.carouselStatus(idx + 1, slides.length);
    if (prev) prev.disabled = idx === 0;
    if (next) next.disabled = idx >= slides.length - 1;
  }
  if (prev) prev.addEventListener('click', () => { if (idx > 0) { idx--; render(); } });
  if (next) next.addEventListener('click', () => { if (idx < slides.length - 1) { idx++; render(); } });
  render();
}

/** Costruisce il nodo DOM di un block tramite il core condiviso. */
function renderBlockDom(block: { type: string; payload?: Record<string, unknown> }, ctx: RenderContext): HTMLElement {
  const vnode = renderBlock(block, ctx);
  return mount(vnode) as HTMLElement;
}

/** Costruisce il nodo DOM della lezione VIDEO-FIRST a due colonne (video + tab). */
function renderVideoFirstLessonDom(
  blocks: Array<{ id?: string; type: string; payload?: Record<string, unknown> }>,
  ctx: RenderContext,
): HTMLElement {
  return mount(renderVideoFirstLesson(blocks, ctx)) as HTMLElement;
}

/** Costruisce il nodo DOM della lezione PILLOLA (contenitore scorrevole a card). */
function renderPillolaLessonDom(
  blocks: Array<{ id?: string; type: string; payload?: Record<string, unknown> }>,
  ctx: RenderContext,
): HTMLElement {
  return mount(renderPillolaLesson(blocks, ctx)) as HTMLElement;
}

/** Costruisce il nodo DOM della lezione PILLOLA INTERATTIVA (libro-game). */
function renderPillolaInterattivaLessonDom(
  blocks: Array<{ id?: string; type: string; payload?: Record<string, unknown> }>,
  ctx: RenderContext,
): HTMLElement {
  return mount(renderPillolaInterattivaLesson(blocks, ctx)) as HTMLElement;
}

const RenderCore = {
  renderBlock,
  isHandledByCore,
  mount,
  renderBlockDom,
  renderVideoFirstLesson,
  renderVideoFirstLessonDom,
  renderPillolaLesson,
  renderPillolaLessonDom,
  renderPillolaInterattivaLesson,
  renderPillolaInterattivaLessonDom,
  resolveLessonLayout,
  buildCourseSteps,
  groupConcepts,
  courseLabels,
};

// Espone il core sul global dell'ambiente di esecuzione: `window` nel browser
// dell'LMS, `globalThis` sotto jsdom nei test. Il consumo avviene SEMPRE via
// questo global (window.RenderCore) — vedi renderers.js, player.js e
// render-core-dom.test.ts — quindi non serve alcun export CommonJS (che oltre a
// essere inutilizzato generava un warning esbuild in un package "type":"module").
const glob: Record<string, unknown> =
  typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : (globalThis as Record<string, unknown>);
glob.RenderCore = RenderCore;
