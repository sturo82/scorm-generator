/*
 * render-core/blocks/media.ts — Helper condiviso per il rendering delle
 * immagini dei block. Risolve il MediaRef nell'URL (anteprima o export) e, se
 * l'immagine proviene da una libreria stock (campo `attribution`), avvolge
 * l'<img> in una <figure> con un <figcaption> che accredita autore e fonte.
 * L'attribuzione è obbligatoria per le licenze royalty-free (es. Unsplash) e
 * deve comparire sia in anteprima sia nel pacchetto SCORM esportato.
 */

import type { MediaRef, MediaAttribution } from '../../primitives.js';
import type { CourseLabels } from '../../course-labels.js';
import { h, hHtml, blockLabels, type VNode, type VChild, type RenderContext } from '../vnode.js';

/**
 * Costruisce lo slot VISIBILE per un placeholder immagine non riempito (solo
 * contesto AUTORE/anteprima). Mostra un riquadro tratteggiato con un'icona,
 * l'etichetta "Immagine da inserire", la descrizione suggerita dal generatore
 * (placeholderPrompt) e, se presente, il testo alternativo. Non è interattivo:
 * l'inserimento vero avviene nella scheda "Struttura e contenuti". È pensato per
 * essere passato come RenderContext.renderPlaceholder dall'anteprima web.
 */
export function imagePlaceholderSlot(m: MediaRef, labels: CourseLabels): VNode {
  const prompt = (m.placeholderPrompt || '').trim();
  const alt = (m.alt || '').trim();
  const children: VChild[] = [
    h('div', { class: 'block-media-ph-head' }, [
      h('span', { class: 'block-media-ph-ico', 'aria-hidden': 'true' }, ['🖼']),
      h('span', { class: 'block-media-ph-badge' }, [labels.imagePlaceholderBadge]),
    ]),
  ];
  if (prompt) {
    children.push(h('p', { class: 'block-media-ph-prompt' }, [prompt]));
  }
  if (alt) {
    children.push(
      hHtml('p', { class: 'block-media-ph-alt' }, `<strong>${escapeText(labels.imagePlaceholderAltLabel)}:</strong> ${escapeText(alt)}`),
    );
  }
  children.push(h('p', { class: 'block-media-ph-hint' }, [labels.imagePlaceholderHint]));
  return h(
    'figure',
    { class: 'block-media-placeholder', 'data-image-placeholder': 'true', role: 'img', 'aria-label': alt || prompt || labels.imagePlaceholderBadge },
    children,
  );
}

/** Escape minimale per iniettare testo in un frammento HTML fidato. */
function escapeText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Etichetta leggibile del provider (es. 'unsplash' → 'Unsplash'). */
function providerLabel(provider: string): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

/** Costruisce il credito (figcaption) a partire dall'attribuzione. */
function creditCaption(attr: MediaAttribution, labels: CourseLabels): VNode {
  const parts: VChild[] = [labels.photoCreditBy];
  parts.push(
    attr.authorUrl
      ? h('a', { href: attr.authorUrl, target: '_blank', rel: 'noopener noreferrer' }, [attr.authorName])
      : attr.authorName,
  );
  parts.push(labels.photoCreditOn);
  const label = providerLabel(attr.provider);
  parts.push(
    attr.sourceUrl
      ? h('a', { href: attr.sourceUrl, target: '_blank', rel: 'noopener noreferrer' }, [label])
      : label,
  );
  return h('figcaption', { class: 'block-media-credit' }, parts);
}

/**
 * Rende un'immagine di un MediaRef. Ritorna null se non è un'immagine
 * materializzata (placeholder o media non-immagine): il chiamante la salta.
 * Se è presente l'attribuzione (immagine stock) l'<img> è avvolta in <figure>
 * con il credito; altrimenti ritorna la sola <img> (markup invariato).
 */
export function mediaImage(
  m: MediaRef | undefined,
  ctx: RenderContext,
  imgClass = 'block-media',
): VNode | null {
  if (!m) return null;
  if (m.kind && m.kind !== 'image') return null;
  const src = ctx.resolveMedia(m);
  if (!src) {
    // Placeholder non ancora riempito: in anteprima (autore) lo rendiamo visibile
    // tramite l'hook del contesto; nell'export resta invisibile (hook assente).
    return ctx.renderPlaceholder ? ctx.renderPlaceholder(m) : null;
  }
  const img = h('img', { class: imgClass, src, alt: m.alt || '', loading: 'lazy' });
  if (!m.attribution) return img;
  return h('figure', { class: 'block-media-figure' }, [img, creditCaption(m.attribution, blockLabels(ctx))]);
}
