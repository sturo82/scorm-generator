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
  type VNode,
  type VChild,
  type RenderContext,
  type StatefulSpec,
  type StatefulState,
} from '@scorm/contracts/render-core';

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

  function rerender(): void {
    host!.innerHTML = '';
    host!.appendChild(mount(renderStateful(spec, state, resolve)));
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
      info.removeAttribute('hidden');
    });
  });
}

/** carousel: mostra uno slide per volta con prev/next e stato "Passo n di m". */
function applyCarousel(root: HTMLElement): void {
  const slides = Array.prototype.slice.call(root.querySelectorAll<HTMLElement>('[data-carousel-slide]'));
  const prev = root.querySelector<HTMLButtonElement>('[data-carousel-prev]');
  const next = root.querySelector<HTMLButtonElement>('[data-carousel-next]');
  const status = root.querySelector<HTMLElement>('[data-carousel-status]');
  let idx = 0;
  function render(): void {
    slides.forEach((s, i) => {
      if (i === idx) s.removeAttribute('hidden');
      else s.setAttribute('hidden', 'hidden');
    });
    if (status) status.textContent = 'Passo ' + (idx + 1) + ' di ' + slides.length;
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

const RenderCore = {
  renderBlock,
  isHandledByCore,
  mount,
  renderBlockDom,
  buildCourseSteps,
  groupConcepts,
};

// Espone il core sul global del browser dell'LMS (window) e supporta CommonJS
// per eventuali test in ambiente Node/jsdom.
declare const module: { exports: unknown } | undefined;
const glob: Record<string, unknown> =
  typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : (globalThis as Record<string, unknown>);
glob.RenderCore = RenderCore;
if (typeof module !== 'undefined' && module && module.exports) {
  module.exports = RenderCore;
}
