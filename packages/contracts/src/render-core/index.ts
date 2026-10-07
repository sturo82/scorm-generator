/*
 * render-core — Renderer condiviso dei block (anteprima ↔ export SCORM).
 * Entry pubblico del core: tipi VNode, contesto, helper video e dispatch.
 * Importabile sia dal bundle browser (apps/web) sia dall'asset runtime SCORM
 * (via bundle IIFE). Nessuna dipendenza da React, DOM o Node.
 */

export * from './vnode.js';
export * from './video.js';
export * from './registry.js';
export { renderRichText } from './blocks/rich-text.js';
export { renderTimeline } from './blocks/timeline.js';
export { renderImageHotspot } from './blocks/image-hotspot.js';
export { renderAccordionTabs } from './blocks/accordion-tabs.js';
export { renderClickReveal } from './blocks/click-reveal.js';
export { renderCarouselSteps } from './blocks/carousel-steps.js';
export { renderFlashcard } from './blocks/flashcard.js';
export {
  renderDragDropMatch,
  renderSortingCategories,
  renderDragDropOrder,
  renderBranchingScenario,
} from './blocks/dragdrop.js';
export { renderVideoCheckpoint } from './blocks/video-checkpoint.js';
export * from './stateful.js';
export * from './course-structure.js';
