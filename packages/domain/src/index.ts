// @scorm/domain — porte provider-agnostiche, container DI e logica di dominio.
// Le implementazioni concrete (adapter) vivono fuori dal dominio e vengono
// iniettate tramite i token (Requisito 10).

export const DOMAIN_VERSION = '0.1.0' as const;

export * from './tenant.js';
export * from './errors.js';
export * from './ports/index.js';
export * from './container.js';
export * from './tokens.js';
