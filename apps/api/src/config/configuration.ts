/**
 * Configurazione dell'applicazione, caricata da variabili d'ambiente.
 * I segreti dei provider restano server-side (Requisito 10.5 / 12).
 */
export interface AppConfig {
  port: number;
  databaseUrl: string;
  /** Provider attivi, selezionabili per ambiente (Requisito 10.4). */
  providers: {
    llm: 'bedrock' | 'mock';
    embeddings: 'bedrock' | 'mock';
    vectorStore: 'pgvector' | 'in-memory';
    objectStorage: 's3' | 'local';
    jobQueue: 'sqs' | 'in-memory';
    /** Generazione immagini (Stability su Bedrock) e audio (Polly). */
    image: 'bedrock' | 'mock';
    speech: 'polly' | 'mock';
    /** Trascrizione automatica video (Amazon Transcribe). */
    transcription: 'transcribe' | 'mock';
  };
  auth: {
    /** Provider di autenticazione (Requisito 1 / 10). */
    provider: 'jwt' | 'oidc' | 'dev';
    jwtSecret: string;
    jwtIssuer: string;
    jwtAudience: string;
    /** OIDC: issuer e audience dell'IdP (quando provider = 'oidc'). */
    oidcIssuer?: string;
    oidcAudience?: string;
    oidcJwksUri?: string;
    /** OIDC: claim del tenant (CSV, provati in ordine). Default per Cognito. */
    oidcTenantClaim?: string;
    /** OIDC: impone token_use ("access" | "id"), utile con Cognito. */
    oidcTokenUse?: 'access' | 'id';
  };
  /** Origini CORS consentite (CSV). */
  corsOrigins: string[];
  /** Object storage S3/MinIO. */
  s3: {
    bucket: string;
    region: string;
    endpoint?: string;
    /** Endpoint pubblico per gli URL firmati (browser), se diverso da endpoint. */
    publicEndpoint?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  };
  /** Embeddings: dimensione dei vettori (determina lo schema pgvector). */
  embeddings: {
    dimensions: number;
  };
  /** Amazon Bedrock (LLM + embeddings) quando selezionato come provider. */
  bedrock: {
    region: string;
    llmModelId: string;
    embeddingsModelId: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    sessionToken?: string;
  };
  /** Generazione media: immagini (Stability su Bedrock) e audio (Polly). */
  media: {
    region: string;
    imageModelId: string;
    /** Formato immagine di output: png|jpeg|webp (jpeg più leggero per SCORM). */
    imageFormat: 'png' | 'jpeg' | 'webp';
    /** Larghezza/altezza richieste; mappate all'aspect ratio supportato. */
    imageWidth: number;
    imageHeight: number;
    /** Engine Polly e voce di default (override per lingua nell'adapter). */
    speechEngine: 'neural' | 'standard';
    speechDefaultVoice: string;
  };
  /** Amazon Transcribe (ASR) per la trascrizione dei video caricati. */
  transcribe: {
    region: string;
    /** Lingua di default (es. "it-IT"); se assente, auto-detect. */
    defaultLanguage?: string;
  };
  /**
   * Amazon Cognito per la gestione utenti admin (inviti). Se userPoolId è
   * assente (dev/test), la funzione inviti è disabilitata.
   */
  cognito: {
    userPoolId?: string;
    region: string;
  };
  /** Limiti di upload della knowledge base. */
  upload: {
    maxFileBytes: number;
  };
  /** Coda SQS quando selezionata come job queue. */
  sqs: {
    queueUrl: string;
    region: string;
    endpoint?: string;
  };
}

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Variabile d'ambiente mancante: ${name}`);
  }
  return value;
}

export function loadConfiguration(): AppConfig {
  return {
    port: Number(env('PORT', '3000')),
    databaseUrl: env('DATABASE_URL', 'postgresql://scorm:scorm_dev_password@db:5432/scorm'),
    providers: {
      llm: env('PROVIDER_LLM', 'mock') as AppConfig['providers']['llm'],
      embeddings: env('PROVIDER_EMBEDDINGS', 'mock') as AppConfig['providers']['embeddings'],
      vectorStore: env('PROVIDER_VECTOR_STORE', 'in-memory') as AppConfig['providers']['vectorStore'],
      objectStorage: env('PROVIDER_OBJECT_STORAGE', 'local') as AppConfig['providers']['objectStorage'],
      jobQueue: env('PROVIDER_JOB_QUEUE', 'in-memory') as AppConfig['providers']['jobQueue'],
      image: env('PROVIDER_IMAGE', 'mock') as AppConfig['providers']['image'],
      speech: env('PROVIDER_SPEECH', 'mock') as AppConfig['providers']['speech'],
      transcription: env('PROVIDER_TRANSCRIPTION', 'mock') as AppConfig['providers']['transcription'],
    },
    auth: {
      provider: env('AUTH_PROVIDER', 'jwt') as AppConfig['auth']['provider'],
      jwtSecret: env('AUTH_JWT_SECRET', 'dev-insecure-secret-change-me'),
      jwtIssuer: env('AUTH_JWT_ISSUER', 'scorm-generator'),
      jwtAudience: env('AUTH_JWT_AUDIENCE', 'scorm-api'),
      oidcIssuer: process.env['OIDC_ISSUER'],
      oidcAudience: process.env['OIDC_AUDIENCE'],
      oidcJwksUri: process.env['OIDC_JWKS_URI'],
      oidcTenantClaim: process.env['OIDC_TENANT_CLAIM'],
      oidcTokenUse: process.env['OIDC_TOKEN_USE'] as AppConfig['auth']['oidcTokenUse'],
    },
    corsOrigins: env('CORS_ORIGINS', 'http://localhost:3100')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    s3: {
      bucket: env('S3_BUCKET', 'scorm-dev'),
      region: env('S3_REGION', 'us-east-1'),
      endpoint: process.env['S3_ENDPOINT'],
      publicEndpoint: process.env['S3_PUBLIC_ENDPOINT'],
      accessKeyId: process.env['S3_ACCESS_KEY'],
      secretAccessKey: process.env['S3_SECRET_KEY'],
    },
    embeddings: {
      dimensions: Number(env('EMBEDDINGS_DIMENSIONS', '64')),
    },
    bedrock: {
      region: env('BEDROCK_REGION', env('AWS_REGION', 'us-east-1')),
      llmModelId: env('BEDROCK_LLM_MODEL_ID', 'anthropic.claude-3-5-sonnet-20240620-v1:0'),
      embeddingsModelId: env('BEDROCK_EMBEDDINGS_MODEL_ID', 'amazon.titan-embed-text-v2:0'),
      accessKeyId: process.env['AWS_ACCESS_KEY_ID'],
      secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY'],
      sessionToken: process.env['AWS_SESSION_TOKEN'],
    },
    media: {
      region: env('MEDIA_REGION', env('BEDROCK_REGION', env('AWS_REGION', 'us-west-2'))),
      imageModelId: env('IMAGE_MODEL_ID', 'stability.stable-image-core-v1:1'),
      imageFormat: env('IMAGE_FORMAT', 'jpeg') as AppConfig['media']['imageFormat'],
      imageWidth: Number(env('IMAGE_WIDTH', '1024')),
      imageHeight: Number(env('IMAGE_HEIGHT', '768')),
      speechEngine: env('SPEECH_ENGINE', 'neural') as AppConfig['media']['speechEngine'],
      speechDefaultVoice: env('SPEECH_DEFAULT_VOICE', 'Bianca'),
    },
    transcribe: {
      region: env('TRANSCRIBE_REGION', env('AWS_REGION', 'us-east-1')),
      defaultLanguage: process.env['TRANSCRIBE_LANGUAGE'],
    },
    cognito: {
      userPoolId: process.env['COGNITO_USER_POOL_ID'],
      region: env('COGNITO_REGION', env('AWS_REGION', 'eu-west-1')),
    },
    upload: {
      maxFileBytes: Number(env('UPLOAD_MAX_FILE_BYTES', String(50 * 1024 * 1024))),
    },
    sqs: {
      queueUrl: env('SQS_QUEUE_URL', ''),
      region: env('SQS_REGION', env('AWS_REGION', 'us-east-1')),
      endpoint: process.env['SQS_ENDPOINT'],
    },
  };
}
