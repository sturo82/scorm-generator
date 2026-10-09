'use client';

/*
 * vnode-to-react.tsx — Adapter React del renderer condiviso. Proietta un VNode
 * (prodotto da @scorm/contracts/render-core) in elementi React. È l'equivalente
 * React dell'adapter DOM del runtime SCORM (render-core-entry.ts): stessa fonte
 * di verità, due proiezioni meccaniche → anteprima ed export non divergono.
 *
 * I `behavior` dichiarativi (toggle/tabs/hotspot/carousel) sono interpretati qui
 * con stato React, leggendo gli stessi `data-*` hook emessi dal core, così il
 * comportamento combacia con l'adapter DOM.
 */

import * as React from 'react';
import {
  isVNode,
  initialState,
  reduce,
  renderStateful,
  type VNode,
  type VChild,
  type Behavior,
  type StatefulSpec,
  type StatefulState,
} from '@scorm/contracts/render-core';

/**
 * Converte una stringa CSS inline ("left:50%;top:30%") nell'oggetto che React
 * richiede per la prop `style`. Il core (condiviso col player DOM) emette lo
 * style come stringa; in React va trasformato in { camelCase: valore }.
 */
function cssStringToObject(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of css.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const rawProp = decl.slice(0, i).trim();
    const value = decl.slice(i + 1).trim();
    if (!rawProp || !value) continue;
    // kebab-case → camelCase (le custom property --x restano invariate).
    const prop = rawProp.startsWith('--')
      ? rawProp
      : rawProp.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    out[prop] = value;
  }
  return out;
}

/** Mappa gli attributi VNode in props React (class→className, attr→attr). */
function toReactProps(attrs: VNode['attrs']): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  if (!attrs) return props;
  for (const key of Object.keys(attrs)) {
    const v = attrs[key];
    if (v === undefined || v === false) continue;
    if (key === 'class') props.className = String(v);
    else if (key === 'for') props.htmlFor = String(v);
    // React vuole un oggetto per `style`; il core lo emette come stringa CSS.
    else if (key === 'style') props.style = typeof v === 'string' ? cssStringToObject(v) : v;
    else props[key] = v === true ? '' : v;
  }
  return props;
}

/** Attributo (eventualmente assente) di un VNode. */
function attr(node: VNode, name: string): string | undefined {
  const v = node.attrs?.[name];
  return v == null ? undefined : String(v);
}

/** Clona superficialmente un VNode applicando un patch sugli attributi. */
function withAttrs(node: VNode, patch: Record<string, string | number | boolean | undefined>): VNode {
  return { ...node, attrs: { ...(node.attrs || {}), ...patch } };
}

/** Renderizza un singolo VChild (nodo, testo o niente) come React node. */
export function renderVChild(child: VChild, key?: React.Key): React.ReactNode {
  if (child == null) return null;
  if (typeof child === 'string' || typeof child === 'number') return child;
  if (!isVNode(child)) return null;
  return <VNodeView key={key} node={child} />;
}

/** Componente che proietta un VNode in elementi React. */
export function VNodeView({ node }: { node: VNode }): React.ReactElement {
  // Se il nodo porta un behavior interattivo, delega al gestore con stato.
  if (node.behavior) {
    return <BehaviorView node={node} behavior={node.behavior} />;
  }
  return <PlainVNode node={node} />;
}

/** Proiezione "pura" di un VNode (nessuna interazione). */
function PlainVNode({ node }: { node: VNode }): React.ReactElement {
  const props = toReactProps(node.attrs);
  if (typeof node.html === 'string') {
    return React.createElement(node.tag, { ...props, dangerouslySetInnerHTML: { __html: node.html } });
  }
  const children = (node.children ?? []).map((c, i) => renderVChild(c, i));
  return React.createElement(node.tag, props, ...children);
}

/* -------------------------------------------------------------------------- */
/*  Behavior: interazioni con stato React sugli stessi data-* hook del core.  */
/* -------------------------------------------------------------------------- */

/** Visita ricorsiva: applica `fn` a ogni VNode dell'albero (ritorna nuovo albero). */
function mapTree(node: VNode, fn: (n: VNode) => VNode): VNode {
  const mapped = fn(node);
  if (typeof mapped.html === 'string' || !mapped.children) return mapped;
  return {
    ...mapped,
    children: mapped.children.map((c) => (isVNode(c) ? mapTree(c, fn) : c)),
  };
}

function BehaviorView({ node, behavior }: { node: VNode; behavior: Behavior }): React.ReactElement {
  switch (behavior.kind) {
    case 'toggle':
      return <ToggleView node={node} />;
    case 'tabs':
      return <TabsView node={node} initialTabId={behavior.initialTabId} />;
    case 'hotspot':
      return <HotspotView node={node} />;
    case 'carousel':
      return <CarouselView node={node} />;
    case 'stateful':
      return <StatefulView node={node} spec={behavior.spec} />;
    case 'video-karaoke':
      return <VideoKaraokeView node={node} />;
    default:
      return <PlainVNode node={node} />;
  }
}

/** Media resolver per lo stateful in anteprima (storageKey già URL firmato). */
const previewResolve = (m: Record<string, unknown>): string | null =>
  m && typeof m.storageKey === 'string' ? (m.storageKey as string) : null;

/** stateful: stato React, re-render via renderStateful del core; click+drag delegati. */
function StatefulView({ node, spec }: { node: VNode; spec: StatefulSpec }): React.ReactElement {
  const [state, setState] = React.useState<StatefulState>(() => initialState(spec));
  const dragValue = React.useRef<string | null>(null);

  function dispatch(ev: string, arg?: string, arg2?: string): void {
    setState((s) => reduce(spec, s, { ev, arg, arg2 }));
  }
  function onClick(e: React.MouseEvent<HTMLDivElement>): void {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-ev]');
    if (!t) return;
    if (t.getAttribute('aria-disabled') === 'true' || (t as HTMLButtonElement).disabled) return;
    dispatch(t.getAttribute('data-ev')!, t.getAttribute('data-arg') || undefined, t.getAttribute('data-arg2') || undefined);
  }
  function onDragStart(e: React.DragEvent<HTMLDivElement>): void {
    const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-dnd-chip]');
    if (chip) {
      dragValue.current = chip.getAttribute('data-dnd-chip');
      e.dataTransfer.setData('text/plain', dragValue.current || '');
    }
  }
  function onDragOver(e: React.DragEvent<HTMLDivElement>): void {
    if ((e.target as HTMLElement).closest('[data-dnd-slot],[data-dnd-bucket]')) e.preventDefault();
  }
  function onDrop(e: React.DragEvent<HTMLDivElement>): void {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-dnd-slot],[data-dnd-bucket]');
    if (!target) return;
    e.preventDefault();
    const value = e.dataTransfer.getData('text/plain') || dragValue.current || '';
    const ev = target.getAttribute('data-ev') || 'drop';
    dispatch(ev === 'clear' ? 'drop' : ev, target.getAttribute('data-arg') || '', value);
    dragValue.current = null;
  }

  // Il guscio (.block + prompt) viene dal node; il contenuto [data-stateful] è
  // ri-renderizzato dal core in base allo stato.
  const inner = renderStateful(spec, state, previewResolve);
  const shell = mapTree(node, (n) =>
    n.attrs && n.attrs['data-stateful'] !== undefined ? { ...n, children: [inner] } : n,
  );
  const props = toReactProps(shell.attrs);
  const children = (shell.children ?? []).map((c, i) => renderVChild(c, i));
  return React.createElement(shell.tag, { ...props, onClick, onDragStart, onDragOver, onDrop }, ...children);
}

/** video-karaoke: tab attivo + evidenziazione cue su timeupdate + click-to-seek. */
function VideoKaraokeView({ node }: { node: VNode }): React.ReactElement {
  const rootRef = React.useRef<HTMLDivElement>(null);
  // Tab iniziale: il primo [data-tab-btn].
  const firstTab = React.useMemo(() => findFirstTab(node), [node]);
  const [activeTab, setActiveTab] = React.useState(firstTab);
  const [activeCue, setActiveCue] = React.useState(-1);

  // Karaoke + seek: operano sul <video> reale montato (ref sul root).
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const video = root.querySelector<HTMLVideoElement>('[data-video-el]');
    if (!video) return;
    const cues = Array.prototype.slice.call(root.querySelectorAll<HTMLElement>('.transcript-cue'));
    const starts = cues.map((c) => Number(c.getAttribute('data-seek') || '0'));
    const onTime = (): void => {
      const tt = video.currentTime;
      let idx = -1;
      for (let i = 0; i < starts.length; i++) {
        if (starts[i]! <= tt) idx = i;
        else break;
      }
      setActiveCue((prev) => (prev !== idx ? idx : prev));
    };
    video.addEventListener('timeupdate', onTime);
    return () => video.removeEventListener('timeupdate', onTime);
  }, [activeTab]);

  function onClick(e: React.MouseEvent<HTMLDivElement>): void {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-tab-btn]');
    if (btn) {
      setActiveTab(btn.getAttribute('data-tab-btn') || firstTab);
      return;
    }
    const cue = (e.target as HTMLElement).closest<HTMLElement>('.transcript-cue');
    if (cue && rootRef.current) {
      const video = rootRef.current.querySelector<HTMLVideoElement>('[data-video-el]');
      if (video) {
        video.currentTime = Number(cue.getAttribute('data-seek') || '0');
        void video.play().catch(() => undefined);
      }
    }
  }

  // Proietta: tab attivo (aria-selected/is-active + pannelli hidden) e cue attiva.
  let cueSeq = 0;
  const projected = mapTree(node, (n) => {
    const btnId = n.attrs?.['data-tab-btn'];
    if (btnId !== undefined) {
      const on = String(btnId) === activeTab;
      const base = String(n.attrs?.class || '').replace(/\s*is-active/g, '');
      return withAttrs(n, { 'aria-selected': on ? 'true' : 'false', class: on ? base + ' is-active' : base });
    }
    const panelId = n.attrs?.['data-tab-panel'];
    if (panelId !== undefined) {
      return withAttrs(n, { hidden: String(panelId) === activeTab ? undefined : 'hidden' });
    }
    if (n.attrs && String(n.attrs.class || '').indexOf('transcript-cue') >= 0) {
      const on = cueSeq === activeCue;
      cueSeq++;
      const base = String(n.attrs.class).replace(/\s*is-active/g, '');
      return withAttrs(n, { class: on ? base + ' is-active' : base });
    }
    return n;
  });

  const props = toReactProps(projected.attrs);
  const children = (projected.children ?? []).map((c, i) => renderVChild(c, i));
  return React.createElement(projected.tag, { ...props, ref: rootRef, onClick }, ...children);
}

/** Trova l'id del primo tab nel VNode (per lo stato iniziale). */
function findFirstTab(node: VNode): string {
  let found = '';
  mapTree(node, (n) => {
    if (!found && n.attrs?.['data-tab-btn'] !== undefined) found = String(n.attrs['data-tab-btn']);
    return n;
  });
  return found;
}

/** toggle: triggers (aria-expanded + body hidden) e self-flip (aria-pressed). */
function ToggleView({ node }: { node: VNode }): React.ReactElement {
  // Stato per chiave stabile: usa l'id del body/trigger o l'indice.
  const [openKeys, setOpenKeys] = React.useState<Record<string, boolean>>({});
  const [flipped, setFlipped] = React.useState<Record<string, boolean>>({});
  let triggerSeq = 0;
  let selfSeq = 0;

  const projected = mapTree(node, (n) => {
    if (n.attrs && n.attrs['data-toggle-self'] !== undefined) {
      const key = attr(n, 'id') || 'self-' + selfSeq++;
      const on = !!flipped[key];
      return withAttrs(n, { 'aria-pressed': on ? 'true' : 'false', 'data-rk': key });
    }
    if (n.attrs && n.attrs['data-toggle-trigger'] !== undefined) {
      const key = attr(n, 'id') || 'trg-' + triggerSeq++;
      const on = !!openKeys[key];
      return withAttrs(n, { 'aria-expanded': on ? 'true' : 'false', 'data-rk': key });
    }
    return n;
  });

  // Dopo la proiezione, i body vanno mostrati/nascosti in base all'apertura del
  // trigger che li precede. Lo facciamo in un secondo passaggio sui figli.
  function onClick(e: React.MouseEvent<HTMLDivElement>): void {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-rk]');
    if (!target) return;
    const key = target.getAttribute('data-rk')!;
    if (target.hasAttribute('data-toggle-self')) {
      setFlipped((s) => ({ ...s, [key]: !s[key] }));
    } else if (target.hasAttribute('data-toggle-trigger')) {
      setOpenKeys((s) => ({ ...s, [key]: !s[key] }));
    }
  }

  // Applica hidden ai body in base allo stato (il body è il nodo che segue un trigger).
  const withBodies = applyToggleBodies(projected, openKeys);
  const props = toReactProps(withBodies.attrs);
  const children = (withBodies.children ?? []).map((c, i) => renderVChild(c, i));
  return React.createElement(withBodies.tag, { ...props, onClick }, ...children);
}

/** Imposta `hidden` sui body [data-toggle-body] in base all'apertura del trigger precedente. */
function applyToggleBodies(node: VNode, openKeys: Record<string, boolean>): VNode {
  if (!node.children) return node;
  const children = node.children.map((c) => (isVNode(c) ? applyToggleBodies(c, openKeys) : c));
  for (let i = 0; i < children.length; i++) {
    const body = children[i];
    const prev = children[i - 1];
    if (isVNode(body) && body.attrs && body.attrs['data-toggle-body'] !== undefined && isVNode(prev)) {
      const key = attr(prev, 'data-rk');
      const open = key ? !!openKeys[key] : false;
      children[i] = withAttrs(body, { hidden: open ? undefined : 'hidden' });
    }
  }
  return { ...node, children };
}

/** tabs: un pannello attivo per volta. */
function TabsView({ node, initialTabId }: { node: VNode; initialTabId: string }): React.ReactElement {
  const [activeId, setActiveId] = React.useState(initialTabId);
  const projected = mapTree(node, (n) => {
    const btnId = n.attrs && n.attrs['data-tab-btn'];
    if (btnId !== undefined) {
      const on = String(btnId) === activeId;
      const base = String(n.attrs?.class || '').replace(/\s*is-active/g, '');
      return withAttrs(n, { 'aria-selected': on ? 'true' : 'false', class: on ? base + ' is-active' : base });
    }
    const panelId = n.attrs && n.attrs['data-tab-panel'];
    if (panelId !== undefined) {
      return withAttrs(n, { hidden: String(panelId) === activeId ? undefined : 'hidden' });
    }
    return n;
  });
  function onClick(e: React.MouseEvent<HTMLDivElement>): void {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-tab-btn]');
    if (btn) setActiveId(btn.getAttribute('data-tab-btn') || initialTabId);
  }
  const props = toReactProps(projected.attrs);
  const children = (projected.children ?? []).map((c, i) => renderVChild(c, i));
  return React.createElement(projected.tag, { ...props, onClick }, ...children);
}

/** hotspot: dot esclusivi + box info che mostra il contenuto del dot attivo. */
function HotspotView({ node }: { node: VNode }): React.ReactElement {
  const [activeDot, setActiveDot] = React.useState<string | null>(null);
  // Raccoglie i contenuti [data-hotspot-content="i"] per iniettarli nel box info.
  const contentById: Record<string, string> = {};
  mapTree(node, (n) => {
    const cid = n.attrs?.['data-hotspot-content'];
    if (cid !== undefined && typeof n.html === 'string') contentById[String(cid)] = n.html;
    return n;
  });
  const projected = mapTree(node, (n) => {
    const dotId = n.attrs?.['data-hotspot-dot'];
    if (dotId !== undefined) {
      return withAttrs(n, { 'aria-pressed': String(dotId) === activeDot ? 'true' : 'false' });
    }
    if (n.attrs?.['data-hotspot-info'] !== undefined) {
      if (activeDot == null) return withAttrs(n, { hidden: 'hidden' });
      // Inietta il contenuto del dot attivo come html del box.
      return { ...n, html: contentById[activeDot] || '', children: undefined, attrs: { ...(n.attrs || {}), hidden: undefined } };
    }
    return n;
  });
  function onClick(e: React.MouseEvent<HTMLDivElement>): void {
    const dot = (e.target as HTMLElement).closest<HTMLElement>('[data-hotspot-dot]');
    if (!dot) return;
    const id = dot.getAttribute('data-hotspot-dot');
    setActiveDot((cur) => (cur === id ? null : id));
  }
  const props = toReactProps(projected.attrs);
  const children = (projected.children ?? []).map((c, i) => renderVChild(c, i));
  return React.createElement(projected.tag, { ...props, onClick }, ...children);
}

/** carousel: mostra uno slide per volta con prev/next e stato. */
function CarouselView({ node }: { node: VNode }): React.ReactElement {
  const [idx, setIdx] = React.useState(0);
  let slideCount = 0;
  mapTree(node, (n) => {
    if (n.attrs?.['data-carousel-slide'] !== undefined) slideCount++;
    return n;
  });
  let seq = 0;
  const projected = mapTree(node, (n) => {
    if (n.attrs?.['data-carousel-slide'] !== undefined) {
      const on = seq === idx;
      seq++;
      return withAttrs(n, { hidden: on ? undefined : 'hidden' });
    }
    if (n.attrs?.['data-carousel-status'] !== undefined) {
      return { ...n, children: ['Passo ' + (idx + 1) + ' di ' + slideCount], html: undefined };
    }
    if (n.attrs?.['data-carousel-prev'] !== undefined) {
      return withAttrs(n, { disabled: idx === 0 ? 'true' : undefined });
    }
    if (n.attrs?.['data-carousel-next'] !== undefined) {
      return withAttrs(n, { disabled: idx >= slideCount - 1 ? 'true' : undefined });
    }
    return n;
  });
  function onClick(e: React.MouseEvent<HTMLDivElement>): void {
    const t = e.target as HTMLElement;
    if (t.closest('[data-carousel-prev]')) setIdx((i) => Math.max(0, i - 1));
    else if (t.closest('[data-carousel-next]')) setIdx((i) => Math.min(slideCount - 1, i + 1));
  }
  const props = toReactProps(projected.attrs);
  const children = (projected.children ?? []).map((c, i) => renderVChild(c, i));
  return React.createElement(projected.tag, { ...props, onClick }, ...children);
}
