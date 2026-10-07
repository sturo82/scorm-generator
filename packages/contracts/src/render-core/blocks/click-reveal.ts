/*
 * render-core/blocks/click-reveal.ts — Block `click_reveal`: elenco di trigger
 * cliccabili che svelano un contenuto. behavior 'toggle' (apertura multipla).
 * Markup canonico SCORM: div.block.click-reveal > (button.reveal-trigger +
 * div.reveal-body[hidden])*.
 */

import { h, hHtml, withBehavior, type VNode, type VChild } from '../vnode.js';

interface RichLike {
  html?: string;
}
interface RevealItem {
  id?: string;
  trigger: string;
  content?: RichLike;
}

export function renderClickReveal(payload: Record<string, unknown>): VNode {
  const items = (payload.items as RevealItem[]) || [];
  const children: VChild[] = [];
  items.forEach((item) => {
    children.push(
      h('button', { class: 'reveal-trigger', 'aria-expanded': 'false', 'data-toggle-trigger': '' }, [item.trigger]),
    );
    children.push(
      hHtml('div', { class: 'reveal-body', hidden: 'hidden', 'data-toggle-body': '' }, item.content?.html || ''),
    );
  });
  return withBehavior(h('div', { class: 'block click-reveal' }, children), { kind: 'toggle' });
}
