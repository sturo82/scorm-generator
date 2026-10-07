// @scorm/adapters — implementazioni concrete delle porte di dominio.
// Gli adapter mock/in-memory per sviluppo e test sono sotto ./testing.
// Gli adapter reali (Bedrock, pgvector, S3, SQS) verranno aggiunti qui nel
// task 10.3.

export const ADAPTERS_VERSION = '0.1.0' as const;

export * as testing from './testing/index.js';
