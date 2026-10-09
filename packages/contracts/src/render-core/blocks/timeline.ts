/*
 * render-core/blocks/timeline.ts — Block `timeline`: elenco ordinato di eventi
 * (data — titolo, media opzionale, contenuto rich). Markup canonico del runtime
 * SCORM: <ol class="block timeline"> con <li> per evento.
 */

import type { MediaRef } from '../../primitives.js';
import { h, hHtml, type VNode, type VChild, type RenderContext } from '../vnode.js';
import { mediaImage } from './media.js';

interface RichLike {
  html?: string;
}
interface TimelineEvent {
  id?: string;
  date?: string;
  title?: string;
  content?: RichLike;
  media?: MediaRef;
}

export function renderTimeline(payload: Record<string, unknown>, ctx: RenderContext): VNode {
  const events = (payload.events as TimelineEvent[]) || [];
  const items: VChild[] = events.map((ev) => {
    const li: VChild[] = [h('strong', undefined, [(ev.date || '') + ' — ' + (ev.title || '')])];
    const img = mediaImage(ev.media, ctx);
    if (img) li.push(img);
    li.push(hHtml('div', { class: 'block-rich' }, ev.content?.html || ''));
    return h('li', undefined, li);
  });
  return h('ol', { class: 'block timeline' }, items);
}
