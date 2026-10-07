// @scorm/scorm — generazione manifest e packaging dei pacchetti SCORM
// (SCORM 2004 4th Edition primario, SCORM 1.2 opzionale).
// Manifest builder, package builder e Run-Time API wrapper: task 8-9.

export const SCORM_PACKAGE_VERSION = '0.1.0' as const;

export * from './theme/index.js';
export * from './sanitize/index.js';
export * from './runtime/index.js';
export * from './package/index.js';
