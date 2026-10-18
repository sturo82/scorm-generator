// @scorm/video — libreria di componenti e composition Remotion per i cartoon
// "code-to-video" delle pillole. Il rendering effettivo (Chromium) avviene nel
// provider (Fase E), che fa il bundle di questo package.
export * from './types.js';
export { REGISTRY } from './registry.js';
export { AnimatedLayer } from './AnimatedLayer.js';
export { PillolaVideo } from './PillolaVideo.js';
export { RemotionRoot, COMPOSITION_ID } from './Root.js';
export { renderPillola, type RenderPillolaInput, type RenderPillolaResult } from './render.js';
