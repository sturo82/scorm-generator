/*
 * render-core/blocks/media.ts — Helper condiviso per il rendering delle
 * immagini dei block. Risolve il MediaRef nell'URL (anteprima o export) e, se
 * l'immagine proviene da una libreria stock (campo `attribution`), avvolge
 * l'<img> in una <figure> con un <figcaption> che accredita autore e fonte.
 * L'attribuzione è obbligatoria per le licenze royalty-free (es. Unsplash) e
 * deve comparire sia in anteprima sia nel pacchetto SCORM esportato.
 */

import type { MediaRef, MediaAttribution } from '../../primitives.js';
import { h, type VNode, type VChild, type RenderContext } from '../vnode.js';

/** Etichetta leggibile del provider (es. 'unsplash' → 'Unsplash'). */
function providerLabel(provider: string): string {
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

/** Costruisce il credito (figcaption) a partire dall'attribuzione. */
function creditCaption(attr: MediaAttribution): VNode {
  const parts: VChild[] = ['Foto di '];
  parts.push(
    attr.authorUrl
      ? h('a', { href: attr.authorUrl, target: '_blank', rel: 'noopener noreferrer' }, [attr.authorName])
      : attr.authorName,
  );
  parts.push(' su ');
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
  if (!src) return null;
  const img = h('img', { class: imgClass, src, alt: m.alt || '', loading: 'lazy' });
  if (!m.attribution) return img;
  return h('figure', { class: 'block-media-figure' }, [img, creditCaption(m.attribution)]);
}
