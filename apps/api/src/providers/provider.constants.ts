/** Token NestJS per il container DI del dominio e le porte risolte da esso. */
export const DOMAIN_CONTAINER = 'DOMAIN_CONTAINER';
export const OBJECT_STORAGE = 'OBJECT_STORAGE';
export const VECTOR_STORE = 'VECTOR_STORE';
export const EMBEDDINGS_PROVIDER = 'EMBEDDINGS_PROVIDER';
export const LLM_PROVIDER = 'LLM_PROVIDER';
export const IMAGE_PROVIDER = 'IMAGE_PROVIDER';
export const SPEECH_PROVIDER = 'SPEECH_PROVIDER';
export const TRANSCRIPTION_PROVIDER = 'TRANSCRIPTION_PROVIDER';
export const JOB_QUEUE = 'JOB_QUEUE';
export const DOCUMENT_EXTRACTORS = 'DOCUMENT_EXTRACTORS';
/** Client Amazon Cognito per la gestione utenti admin (null se non configurato). */
export const COGNITO_CLIENT = 'COGNITO_CLIENT';
/** Provider immagini stock (Pexels/Unsplash); null se non configurato. */
export const STOCK_IMAGE_PROVIDER = 'STOCK_IMAGE_PROVIDER';
/** Provider di generazione video avatar (HeyGen); null se non configurato. */
export const VIDEO_GEN_PROVIDER = 'VIDEO_GEN_PROVIDER';
/** Provider text-to-video per i cartoon delle scene pillole (Nova Reel); null se non configurato. */
export const CARTOON_VIDEO_PROVIDER = 'CARTOON_VIDEO_PROVIDER';
/** Provider di recupero feed RSS/Atom (per creare corsi dalle notizie). */
export const FEED_PROVIDER = 'FEED_PROVIDER';
