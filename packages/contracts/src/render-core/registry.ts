/*
 * render-core/registry.ts — Dispatch del rendering per tipo di block. Mappa
 * block.type → funzione pura che costruisce il VNode. In Fase 0 è migrato solo
 * `rich_text` (pilota); gli altri tipi verranno aggiunti nelle fasi successive.
 * Un tipo non ancora migrato o sconosciuto produce un segnaposto esplicito,
 * coerente tra i due backend (requisito 1.4).
 */

import { h, type VNode, type RenderContext } from './vnode.js';
import { renderRichText } from './blocks/rich-text.js';
import { renderTimeline } from './blocks/timeline.js';
import { renderImageHotspot } from './blocks/image-hotspot.js';
import { renderAccordionTabs } from './blocks/accordion-tabs.js';
import { renderClickReveal } from './blocks/click-reveal.js';
import { renderCarouselSteps } from './blocks/carousel-steps.js';
import { renderFlashcard } from './blocks/flashcard.js';
import {
  renderDragDropMatch,
  renderSortingCategories,
  renderDragDropOrder,
  renderBranchingScenario,
} from './blocks/dragdrop.js';
import { renderVideoCheckpoint } from './blocks/video-checkpoint.js';

/** Block minimale: ciò che serve al core (type + payload). */
export interface BlockLike {
  id?: string;
  type: string;
  payload?: Record<string, unknown>;
}

/** Firma di un renderer di block. */
export type BlockRenderer = (payload: Record<string, unknown>, ctx: RenderContext) => VNode;

/** Registro dei renderer migrati nel core. */
export const registry: Record<string, BlockRenderer> = {
  rich_text: renderRichText,
  timeline: renderTimeline,
  image_hotspot: renderImageHotspot,
  accordion_tabs: (payload) => renderAccordionTabs(payload),
  click_reveal: (payload) => renderClickReveal(payload),
  carousel_steps: renderCarouselSteps,
  flashcard: (payload) => renderFlashcard(payload),
  dragdrop_match: renderDragDropMatch,
  sorting_categories: renderSortingCategories,
  dragdrop_order: renderDragDropOrder,
  branching_scenario: renderBranchingScenario,
  video_checkpoint: renderVideoCheckpoint,
};

/** True se il tipo è gestito dal core condiviso (altrimenti usare il legacy). */
export function isHandledByCore(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(registry, type);
}

/**
 * Costruisce il VNode per un block. Se il tipo non è gestito dal core produce
 * un segnaposto esplicito (lo stesso in anteprima ed export).
 */
export function renderBlock(block: BlockLike, ctx: RenderContext): VNode {
  const fn = registry[block.type];
  if (!fn) {
    return h('div', { class: 'block unknown' }, ['[tipo non supportato: ' + block.type + ']']);
  }
  return fn(block.payload || {}, ctx);
}
