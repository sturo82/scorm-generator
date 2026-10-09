// @scorm/contracts — tipi di dominio condivisi e JSON Schema.
// Fonte di verità unica: schema Zod da cui derivano i tipi TypeScript e i
// JSON Schema per la generazione strutturata AI.

export const CONTRACTS_VERSION = '0.1.0' as const;

export * from './primitives.js';
export * from './plan.js';
export * from './brand.js';
export * from './brief.js';
export * from './blocks.js';
export * from './assessment.js';
export * from './course.js';
export * from './json-schema.js';
export * from './interactions-css.js';
export * from './theme-compiler.js';
export * from './concepts.js';
export * from './pricing.js';
export * from './folder.js';
export * from './app-branding.js';
export * from './video-asset.js';
export * from './stock-image.js';
