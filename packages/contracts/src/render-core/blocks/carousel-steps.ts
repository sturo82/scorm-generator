/*
 * render-core/blocks/carousel-steps.ts — Block `carousel_steps`: step mostrati
 * uno per volta con navigazione prev/next e stato "Passo n di m". behavior
 * 'carousel'. Tutti gli slide sono nel markup (nascosti tranne l'attivo), così
 * entrambi gli adapter cambiano solo la visibilità.
 */

import type { MediaRef } from '../../primitives.js';
import { h, hHtml, withBehavior, type VNode, type VChild, type RenderContext } from '../vnode.js';
import { mediaImage } from './media.js';

interface RichLike {
  html?: string;
}
interface StepItem {
  id?: string;
  title: string;
  content?: RichLike;
  media?: MediaRef;
}

export function renderCarouselSteps(payload: Record<string, unknown>, ctx: RenderContext): VNode {
  const steps = (payload.steps as StepItem[]) || [];
  const slides: VChild[] = steps.map((s, i) => {
    const inner: VChild[] = [h('h4', undefined, [s.title])];
    const img = mediaImage(s.media, ctx);
    if (img) inner.push(img);
    inner.push(hHtml('div', { class: 'block-rich' }, s.content?.html || ''));
    return h(
      'div',
      { class: 'carousel-slide', 'data-carousel-slide': '', hidden: i === 0 ? undefined : 'hidden' },
      inner,
    );
  });
  const view = h('div', { class: 'carousel-view', role: 'group', 'aria-live': 'polite' }, slides);
  const prev = h('button', { 'aria-label': 'Precedente', 'data-carousel-prev': '' }, ['‹']);
  const status = h('span', { class: 'carousel-status', 'data-carousel-status': '' }, [
    'Passo 1 di ' + steps.length,
  ]);
  const next = h('button', { 'aria-label': 'Successivo', 'data-carousel-next': '' }, ['›']);
  const nav = h('div', { class: 'carousel-nav' }, [prev, status, next]);
  return withBehavior(h('div', { class: 'block carousel' }, [view, nav]), { kind: 'carousel', count: steps.length });
}
