// @scorm/video — libreria di componenti e composition Remotion per i cartoon
// "code-to-video" delle pillole. Il rendering effettivo (Chromium) avviene nel
// provider (Fase E), che fa il bundle di questo package.
export * from './types.js';
export { REGISTRY } from './registry.js';
export { AnimatedLayer } from './AnimatedLayer.js';
export { PillolaVideo } from './PillolaVideo.js';
export { SlideAvatarVideo } from './SlideAvatarVideo.js';
export { RemotionRoot, COMPOSITION_ID, SLIDE_COMPOSITION_ID } from './Root.js';
export {
  renderPillola,
  renderSlideVideo,
  type RenderPillolaInput,
  type RenderPillolaResult,
  type RenderSlideVideoResult,
} from './render.js';
export { renderPillolaOnLambda, renderSlideVideoOnLambda, type LambdaRenderOptions } from './render-lambda.js';
