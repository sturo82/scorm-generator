/*
 * render-core/blocks/rich-text.ts — Renderer condiviso del block `rich_text`:
 * contenuto HTML fidato (già sanificato) + eventuali immagini illustrative
 * (campo `media`). Produce lo stesso markup/classi usati finora dal runtime
 * SCORM e dall'anteprima, così i CSS condivisi (INTERACTIONS_CSS) restano validi.
 */

import type { MediaRef } from '../../primitives.js';
import { h, hHtml, type VNode, type VChild, type RenderContext } from '../vnode.js';

interface RichLike {
  html?: string;
}

/**
 * Immagine di un MediaRef risolto. Ritorna null se non è un'immagine
 * materializzata (placeholder o media non-immagine): il chiamante la salta.
 */
function mediaImg(m: MediaRef, ctx: RenderContext, cls: string): VNode | null {
  if (m.kind && m.kind !== 'image') return null;
  const src = ctx.resolveMedia(m);
  if (!src) return null;
  return h('img', { class: cls, src, alt: m.alt || '', loading: 'lazy' });
}

export function renderRichText(payload: Record<string, unknown>, ctx: RenderContext): VNode {
  const content = (payload.content as RichLike) || {};
  const media = (payload.media as MediaRef[]) || [];
  const children: VChild[] = [hHtml('div', { class: 'block-rich' }, content.html || '')];
  for (const m of media) {
    const img = mediaImg(m, ctx, 'block-media');
    if (img) children.push(img);
  }
  return h('div', { class: 'block' }, children);
}
