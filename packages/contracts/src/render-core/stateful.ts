/*
 * render-core/stateful.ts — Renderer di stato per i block interattivi complessi
 * (dragdrop_match, sorting_categories, dragdrop_order, branching_scenario). Il
 * core possiede markup, classi e logica (scoring incluso); gli adapter tengono
 * solo lo stato e, a ogni evento, chiamano `renderStateful(spec, state)` per
 * ottenere il nuovo VNode interno. Così DOM ed export restano identici.
 *
 * Convenzione eventi: gli elementi interattivi espongono `data-ev` (nome
 * evento) e `data-arg`/`data-arg2`; l'adapter intercetta il click, chiama
 * `reduce(spec, state, event)` e re-renderizza. Nessun listener per-nodo nel core.
 */

import { h, hHtml, type VNode, type VChild, type StatefulSpec } from './vnode.js';

/* ----------------------------- Tipi di stato ----------------------------- */

export interface DndMatchState {
  assign: Record<string, string>; // leftId -> rightValue
  picked: string | null; // rightValue "preso" (click-to-assign)
}
export interface DndSortState {
  placement: Record<string, string>; // itemId -> categoryId
  picked: string | null; // itemId preso
}
export interface DndOrderState {
  order: string[]; // itemId nell'ordine corrente
}
export interface ScenarioState {
  currentId: string;
  score: number;
  ended: boolean;
}
export type StatefulState = DndMatchState | DndSortState | DndOrderState | ScenarioState;

export interface StatefulEvent {
  ev: string;
  arg?: string;
  arg2?: string;
}

/* --------------------------- Stato iniziale ------------------------------ */

export function initialState(spec: StatefulSpec): StatefulState {
  switch (spec.type) {
    case 'dnd-match':
      return { assign: {}, picked: null } as DndMatchState;
    case 'dnd-sort':
      return { placement: {}, picked: null } as DndSortState;
    case 'dnd-order':
      return { order: items(spec).map((it) => it.id) } as DndOrderState;
    case 'scenario':
      return { currentId: String(spec.payload.startNodeId || ''), score: 0, ended: false } as ScenarioState;
  }
}

/* ------------------------------- Reducer --------------------------------- */

export function reduce(spec: StatefulSpec, state: StatefulState, e: StatefulEvent): StatefulState {
  switch (spec.type) {
    case 'dnd-match':
      return reduceMatch(state as DndMatchState, e);
    case 'dnd-sort':
      return reduceSort(state as DndSortState, e);
    case 'dnd-order':
      return reduceOrder(spec, state as DndOrderState, e);
    case 'scenario':
      return reduceScenario(spec, state as ScenarioState, e);
  }
}

function reduceMatch(s: DndMatchState, e: StatefulEvent): DndMatchState {
  if (e.ev === 'pick') return { ...s, picked: s.picked === e.arg ? null : e.arg! };
  if (e.ev === 'drop') {
    const value = e.arg2 ?? s.picked;
    if (!value) return s;
    const assign: Record<string, string> = {};
    for (const k of Object.keys(s.assign)) if (s.assign[k] !== value) assign[k] = s.assign[k]!;
    assign[e.arg!] = value;
    return { assign, picked: null };
  }
  if (e.ev === 'clear') {
    const assign = { ...s.assign };
    delete assign[e.arg!];
    return { ...s, assign };
  }
  return s;
}

function reduceSort(s: DndSortState, e: StatefulEvent): DndSortState {
  if (e.ev === 'pick') return { ...s, picked: s.picked === e.arg ? null : e.arg! };
  if (e.ev === 'place') {
    const value = e.arg2 ?? s.picked;
    if (!value) return s;
    return { placement: { ...s.placement, [value]: e.arg! }, picked: null };
  }
  if (e.ev === 'unplace') {
    const placement = { ...s.placement };
    delete placement[e.arg!];
    return { ...s, placement };
  }
  return s;
}

function reduceOrder(spec: StatefulSpec, s: DndOrderState, e: StatefulEvent): DndOrderState {
  const order = s.order.slice();
  if (e.ev === 'move') {
    const from = Number(e.arg);
    const to = Number(e.arg2);
    if (to < 0 || to >= order.length) return s;
    const [it] = order.splice(from, 1);
    if (it !== undefined) order.splice(to, 0, it);
    return { order };
  }
  return s;
}

function reduceScenario(spec: StatefulSpec, s: ScenarioState, e: StatefulEvent): ScenarioState {
  if (e.ev === 'choose') {
    const node = nodeById(spec, s.currentId);
    const choice = (node?.choices || []).find((c) => c.id === e.arg);
    const delta = choice && typeof choice.score === 'number' ? choice.score : 0;
    const nextScore = s.score + delta;
    if (choice?.nextNodeId) return { currentId: choice.nextNodeId, score: nextScore, ended: false };
    return { ...s, score: nextScore, ended: true };
  }
  if (e.ev === 'restart') return { currentId: String(spec.payload.startNodeId || ''), score: 0, ended: false };
  return s;
}

/* ------------------------------- Render ---------------------------------- */

/** Media resolver iniettato (uguale al RenderContext.resolveMedia). */
export type MediaResolver = (m: Record<string, unknown>) => string | null;

/** Ritorna il VNode interno per lo stato corrente del block interattivo. */
export function renderStateful(
  spec: StatefulSpec,
  state: StatefulState,
  resolveMedia: MediaResolver,
): VNode {
  switch (spec.type) {
    case 'dnd-match':
      return renderMatch(spec, state as DndMatchState);
    case 'dnd-sort':
      return renderSort(spec, state as DndSortState);
    case 'dnd-order':
      return renderOrder(spec, state as DndOrderState);
    case 'scenario':
      return renderScenario(spec, state as ScenarioState, resolveMedia);
  }
}

/* -- dnd-match -- */
interface Pair {
  id: string;
  left: string;
  right: string;
}
function renderMatch(spec: StatefulSpec, s: DndMatchState): VNode {
  const pairs = (spec.payload.pairs as Pair[]) || [];
  const rights = pairs.map((p) => p.right);
  const used: Record<string, boolean> = {};
  for (const k of Object.keys(s.assign)) used[s.assign[k]!] = true;

  const chips: VChild[] = rights.map((r) => {
    const isUsed = !!used[r];
    const cls =
      'dnd-chip' + (isUsed ? ' is-used' : '') + (s.picked === r ? ' is-picked' : '');
    return h(
      'button',
      {
        class: cls,
        type: 'button',
        draggable: 'true',
        'data-value': r,
        'aria-disabled': isUsed ? 'true' : 'false',
        'aria-pressed': s.picked === r ? 'true' : 'false',
        ...(isUsed ? {} : { 'data-ev': 'pick', 'data-arg': r }),
        'data-dnd-chip': r,
      },
      [r],
    );
  });
  const pool = h('div', { class: 'dnd-pool' }, chips);

  const rows: VChild[] = pairs.map((pair) => {
    const value = s.assign[pair.id];
    const slot = h(
      'button',
      {
        class: 'dnd-slot' + (value ? ' is-filled' : ''),
        type: 'button',
        'data-left': pair.id,
        'data-dnd-slot': pair.id,
        'data-ev': value ? 'clear' : 'drop',
        'data-arg': pair.id,
      },
      [value || 'Trascina o clicca qui…'],
    );
    return h('div', { class: 'dnd-row' }, [h('span', { class: 'dnd-left' }, [pair.left]), slot]);
  });
  const slotsWrap = h('div', { class: 'dnd-slots' }, rows);
  return h('div', { class: 'dnd-inner' }, [pool, slotsWrap]);
}

/* -- dnd-sort -- */
interface SortItem {
  id: string;
  label: string;
  categoryId: string;
}
interface SortCat {
  id: string;
  label: string;
}
function renderSort(spec: StatefulSpec, s: DndSortState): VNode {
  const items = (spec.payload.items as SortItem[]) || [];
  const categories = (spec.payload.categories as SortCat[]) || [];
  const done = items.every((it) => s.placement[it.id]);
  let correct = 0;

  const poolChips: VChild[] = items
    .filter((it) => !s.placement[it.id])
    .map((it) =>
      h(
        'button',
        {
          class: 'dnd-chip' + (s.picked === it.id ? ' is-picked' : ''),
          type: 'button',
          draggable: 'true',
          'data-item': it.id,
          'data-dnd-chip': it.id,
          'data-ev': 'pick',
          'data-arg': it.id,
        },
        [it.label],
      ),
    );
  const pool = h('div', { class: 'dnd-pool sorting-pool' }, poolChips);

  const buckets: VChild[] = categories.map((cat) => {
    const placedChips: VChild[] = items
      .filter((it) => s.placement[it.id] === cat.id)
      .map((it) => {
        const ok = it.categoryId === cat.id;
        if (done && ok) correct++;
        const cls = 'dnd-chip is-placed' + (done ? (ok ? ' is-correct' : ' is-wrong') : '');
        return h(
          'button',
          { class: cls, type: 'button', 'data-item': it.id, 'data-ev': 'unplace', 'data-arg': it.id },
          [it.label],
        );
      });
    const zone = h('div', { class: 'sorting-zone' }, placedChips);
    return h(
      'div',
      { class: 'sorting-bucket', 'data-cat': cat.id, 'data-dnd-bucket': cat.id, 'data-ev': 'place', 'data-arg': cat.id },
      [h('p', { class: 'sorting-bucket-title' }, [cat.label]), zone],
    );
  });
  const grid = h('div', { class: 'sorting-grid' }, buckets);

  const children: VChild[] = [pool, grid];
  if (done) {
    const allOk = correct === items.length;
    children.push(
      h('p', { class: 'assessment-feedback ' + (allOk ? 'is-pass' : 'is-fail') }, [
        allOk
          ? 'Tutto corretto!'
          : correct + ' su ' + items.length + ' corretti. Clicca un elemento per rimetterlo nel pozzo.',
      ]),
    );
  }
  return h('div', { class: 'dnd-inner' }, children);
}

/* -- dnd-order -- */
interface OrderItem {
  id: string;
  label: string;
}
function items(spec: StatefulSpec): OrderItem[] {
  return (spec.payload.items as OrderItem[]) || [];
}
function renderOrder(spec: StatefulSpec, s: DndOrderState): VNode {
  const byId: Record<string, OrderItem> = {};
  items(spec).forEach((it) => (byId[it.id] = it));
  const rows: VChild[] = s.order.map((id, idx) => {
    const it = byId[id];
    const handle = h('span', { class: 'order-handle', 'aria-hidden': 'true' }, ['⋮⋮']);
    const num = h('span', { class: 'order-num' }, [String(idx + 1)]);
    const label = h('span', { class: 'order-label' }, [it ? it.label : '']);
    const up = h(
      'button',
      {
        class: 'order-btn',
        type: 'button',
        'aria-label': 'Sposta su',
        disabled: idx === 0 ? 'true' : undefined,
        'data-ev': 'move',
        'data-arg': String(idx),
        'data-arg2': String(idx - 1),
      },
      ['↑'],
    );
    const down = h(
      'button',
      {
        class: 'order-btn',
        type: 'button',
        'aria-label': 'Sposta giù',
        disabled: idx === s.order.length - 1 ? 'true' : undefined,
        'data-ev': 'move',
        'data-arg': String(idx),
        'data-arg2': String(idx + 1),
      },
      ['↓'],
    );
    return h('li', { class: 'order-row', 'data-order-row': id, 'data-idx': String(idx) }, [
      handle,
      num,
      label,
      h('span', { class: 'order-actions' }, [up, down]),
    ]);
  });
  return h('ol', { class: 'order-list' }, rows);
}

/* -- scenario -- */
interface Choice {
  id: string;
  label: string;
  nextNodeId?: string;
  score?: number;
}
interface ScenarioNode {
  id: string;
  content?: { html?: string };
  choices?: Choice[];
  media?: Record<string, unknown>;
}
function nodeById(spec: StatefulSpec, id: string): ScenarioNode | undefined {
  return ((spec.payload.nodes as ScenarioNode[]) || []).find((n) => n.id === id);
}
function renderScenario(spec: StatefulSpec, s: ScenarioState, resolveMedia: MediaResolver): VNode {
  const node = nodeById(spec, s.currentId);
  const children: VChild[] = [];
  if (!node) {
    children.push(h('p', { class: 'scenario-end' }, ['Scenario senza nodo iniziale.']));
    return h('div', { class: 'scenario-view', 'aria-live': 'polite' }, children);
  }
  if (node.media) {
    const src = resolveMedia(node.media);
    if (src) children.push(h('img', { class: 'block-media', src, alt: String(node.media.alt || ''), loading: 'lazy' }));
  }
  children.push(hHtml('div', { class: 'block-rich' }, node.content?.html || ''));
  const noChoices = (node.choices || []).length === 0;
  if (!s.ended && !noChoices) {
    (node.choices || []).forEach((ch) => {
      children.push(
        h('button', { class: 'scenario-choice', type: 'button', 'data-ev': 'choose', 'data-arg': ch.id }, [ch.label]),
      );
    });
  }
  if (s.ended || noChoices) {
    children.push(h('p', { class: 'scenario-end' }, ['Fine scenario. Punteggio: ' + s.score]));
    children.push(
      h('button', { class: 'scenario-restart', type: 'button', 'data-ev': 'restart' }, ['Ricomincia']),
    );
  }
  return h('div', { class: 'scenario-view', 'aria-live': 'polite' }, children);
}
