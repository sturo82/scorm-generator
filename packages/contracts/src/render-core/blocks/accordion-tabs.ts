/*
 * render-core/blocks/accordion-tabs.ts — Block `accordion_tabs`. Due varianti:
 *  - 'accordion' (default): intestazioni cliccabili che aprono/chiudono il corpo
 *    (behavior 'toggle', apertura multipla). Markup canonico SCORM.
 *  - 'tabs': barra di tab con un pannello attivo per volta (behavior 'tabs').
 */

import { h, hHtml, withBehavior, type VNode, type VChild } from '../vnode.js';

interface RichLike {
  html?: string;
}
interface Panel {
  id: string;
  title: string;
  content?: RichLike;
}

export function renderAccordionTabs(payload: Record<string, unknown>): VNode {
  const variant = (payload.variant as string) || 'accordion';
  const panels = (payload.panels as Panel[]) || [];

  if (variant === 'tabs') {
    const initial = panels[0]?.id ?? '';
    const tabButtons: VChild[] = panels.map((pan) =>
      h(
        'button',
        {
          class: 'video-tab',
          type: 'button',
          role: 'tab',
          'aria-selected': pan.id === initial ? 'true' : 'false',
          'data-tab-btn': pan.id,
        },
        [pan.title],
      ),
    );
    const tablist = h('div', { class: 'tabs-list', role: 'tablist' }, tabButtons);
    const panelNodes: VChild[] = panels.map((pan) =>
      hHtml(
        'div',
        {
          class: 'tabs-panel',
          role: 'tabpanel',
          'data-tab-panel': pan.id,
          hidden: pan.id === initial ? undefined : 'hidden',
        },
        pan.content?.html || '',
      ),
    );
    return withBehavior(h('div', { class: 'block tabs' }, [tablist, ...panelNodes]), {
      kind: 'tabs',
      initialTabId: initial,
    });
  }

  // Variante accordion: coppie intestazione (trigger) + corpo (body nascosto).
  const children: VChild[] = [];
  panels.forEach((pan, i) => {
    children.push(
      h(
        'button',
        { class: 'accordion-head', 'aria-expanded': 'false', id: 'acc-' + i, 'data-toggle-trigger': '' },
        [pan.title],
      ),
    );
    children.push(
      hHtml(
        'div',
        {
          class: 'accordion-body',
          role: 'region',
          'aria-labelledby': 'acc-' + i,
          hidden: 'hidden',
          'data-toggle-body': '',
        },
        pan.content?.html || '',
      ),
    );
  });
  return withBehavior(h('div', { class: 'block accordion', role: 'tablist' }, children), { kind: 'toggle' });
}
