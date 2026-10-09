/*
 * render-core/blocks/image-hotspot.ts — Block `image_hotspot`: immagine con
 * punti numerati; cliccando un punto compare il relativo contenuto in un box
 * condiviso sotto l'immagine. Markup canonico del runtime SCORM (hotspot-stage,
 * hotspot-dot, hotspot-info). Interazione: behavior 'hotspot'.
 *
 * I contenuti dei punti sono emessi come nodi nascosti [data-hotspot-content="i"]
 * così entrambi gli adapter (DOM/React) possono iniettarli nel box info senza
 * ri-renderizzare.
 */

import type { MediaRef, MediaAttribution } from '../../primitives.js';
import { h, hHtml, withBehavior, type VNode, type VChild, type RenderContext } from '../vnode.js';

interface RichLike {
  html?: string;
}
interface HotspotItem {
  id?: string;
  x: number;
  y: number;
  label: string;
  content?: RichLike;
}

/** Credito stock sotto lo stage (l'immagine è lo sfondo interattivo). */
function creditCaption(attr: MediaAttribution): VNode {
  const label = attr.provider.charAt(0).toUpperCase() + attr.provider.slice(1);
  const parts: VChild[] = ['Foto di '];
  parts.push(
    attr.authorUrl
      ? h('a', { href: attr.authorUrl, target: '_blank', rel: 'noopener noreferrer' }, [attr.authorName])
      : attr.authorName,
  );
  parts.push(' su ');
  parts.push(
    attr.sourceUrl
      ? h('a', { href: attr.sourceUrl, target: '_blank', rel: 'noopener noreferrer' }, [label])
      : label,
  );
  return h('p', { class: 'block-media-credit' }, parts);
}

export function renderImageHotspot(payload: Record<string, unknown>, ctx: RenderContext): VNode {
  const image = payload.image as MediaRef | undefined;
  const hotspots = (payload.hotspots as HotspotItem[]) || [];
  const src = image ? ctx.resolveMedia(image) : null;

  const stageChildren: VChild[] = [
    h('img', { src: src || '', alt: (image && image.alt) || '' }),
  ];
  // Sorgenti nascoste del contenuto di ogni punto (per il box info condiviso).
  const contentSources: VChild[] = [];
  hotspots.forEach((hsp, i) => {
    stageChildren.push(
      h(
        'button',
        {
          class: 'hotspot-dot',
          type: 'button',
          style: 'left:' + hsp.x * 100 + '%;top:' + hsp.y * 100 + '%',
          'aria-label': hsp.label,
          'aria-pressed': 'false',
          'data-hotspot-dot': String(i),
        },
        [String(i + 1)],
      ),
    );
    contentSources.push(
      hHtml(
        'div',
        { 'data-hotspot-content': String(i), hidden: 'hidden' },
        '<p class="hotspot-title">' + escapeText(hsp.label) + '</p>' + (hsp.content?.html || ''),
      ),
    );
  });

  const stage = h('div', { class: 'hotspot-stage' }, stageChildren);
  const info = h('div', { class: 'hotspot-info', role: 'dialog', hidden: 'hidden', 'data-hotspot-info': '' }, []);
  const blockChildren: VChild[] = [stage, info];
  if (image?.attribution) blockChildren.push(creditCaption(image.attribution));
  blockChildren.push(...contentSources);
  return withBehavior(h('div', { class: 'block hotspot' }, blockChildren), {
    kind: 'hotspot',
  });
}

/** Escape minimale per il testo del titolo iniettato nell'HTML del box info. */
function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
