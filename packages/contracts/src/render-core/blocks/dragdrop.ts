/*
 * render-core/blocks/dragdrop.ts — Block interattivi con stato gestiti dal core
 * via renderStateful: dragdrop_match, sorting_categories, dragdrop_order,
 * branching_scenario. Ogni renderer costruisce il guscio (.block + contenitore
 * [data-stateful]) con il contenuto iniziale, e marca il behavior 'stateful' che
 * gli adapter usano per re-renderizzare a ogni evento.
 */

import { h, withBehavior, type VNode, type StatefulSpec } from '../vnode.js';
import { initialState, renderStateful, type MediaResolver } from '../stateful.js';
import type { RenderContext } from '../vnode.js';

function statefulBlock(blockClass: string, spec: StatefulSpec, resolve: MediaResolver, promptText?: string): VNode {
  const inner = renderStateful(spec, initialState(spec), resolve);
  const children = [];
  if (promptText) children.push(h('p', { class: 'dnd-prompt' }, [promptText]));
  children.push(h('div', { 'data-stateful': '' }, [inner]));
  return withBehavior(h('div', { class: blockClass }, children), { kind: 'stateful', spec });
}

export function renderDragDropMatch(payload: Record<string, unknown>, ctx: RenderContext): VNode {
  const spec: StatefulSpec = { type: 'dnd-match', payload };
  return statefulBlock('block dragdrop-match dnd', spec, mkResolve(ctx), payload.prompt as string | undefined);
}

export function renderSortingCategories(payload: Record<string, unknown>, ctx: RenderContext): VNode {
  const spec: StatefulSpec = { type: 'dnd-sort', payload };
  return statefulBlock('block sorting dnd', spec, mkResolve(ctx), payload.prompt as string | undefined);
}

export function renderDragDropOrder(payload: Record<string, unknown>, ctx: RenderContext): VNode {
  const spec: StatefulSpec = { type: 'dnd-order', payload };
  return statefulBlock('block dragdrop-order dnd', spec, mkResolve(ctx), payload.prompt as string | undefined);
}

export function renderBranchingScenario(payload: Record<string, unknown>, ctx: RenderContext): VNode {
  const spec: StatefulSpec = { type: 'scenario', payload };
  const inner = renderStateful(spec, initialState(spec), mkResolve(ctx));
  return withBehavior(h('div', { class: 'block scenario' }, [h('div', { 'data-stateful': '' }, [inner])]), {
    kind: 'stateful',
    spec,
  });
}

/** Adatta RenderContext.resolveMedia alla firma MediaResolver dello stateful. */
function mkResolve(ctx: RenderContext): MediaResolver {
  return (m) => ctx.resolveMedia(m as never);
}
