/*
 * render-core/blocks/flashcard.ts — Block `flashcard`: carte con flip 3D a due
 * facce (fronte/retro). Entrambe le facce sono nel markup; il flip è pilotato
 * da aria-pressed sul bottone (CSS transform-style: preserve-3d). behavior
 * 'toggle' (self-flip tramite [data-toggle-self]).
 */

import { h, hHtml, withBehavior, blockLabels, type VNode, type VChild, type RenderContext } from '../vnode.js';

interface RichLike {
  html?: string;
}
interface CardItem {
  id?: string;
  front?: RichLike;
  back?: RichLike;
}

function face(side: 'front' | 'back', label: string, content?: RichLike): VNode {
  return h('div', { class: 'flashcard-face is-' + side }, [
    h('span', { class: 'flashcard-face-label' }, [label]),
    hHtml('div', { class: 'block-rich' }, content?.html || ''),
  ]);
}

export function renderFlashcard(payload: Record<string, unknown>, ctx: RenderContext): VNode {
  const cards = (payload.cards as CardItem[]) || [];
  const L = blockLabels(ctx);
  const btns: VChild[] = cards.map((card) => {
    const inner = h('div', { class: 'flashcard-inner' }, [
      face('front', L.flashcardFront, card.front),
      face('back', L.flashcardBack, card.back),
    ]);
    return h(
      'button',
      { class: 'flashcard', type: 'button', 'aria-pressed': 'false', 'aria-label': L.flashcardFlip, 'data-toggle-self': '' },
      [inner],
    );
  });
  return withBehavior(h('div', { class: 'block flashcards' }, btns), { kind: 'toggle' });
}
