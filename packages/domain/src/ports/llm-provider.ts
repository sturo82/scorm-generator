/**
 * Porta per la generazione di testo (LLM). Astrae il provider concreto
 * (default: Amazon Bedrock) per evitare vendor lock-in (Requisito 10).
 * Supporta la generazione strutturata conforme a JSON Schema per ottenere
 * output direttamente validabili (Requisito 4.1 / 4.2).
 */

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** JSON Schema (serializzabile) usato per vincolare l'output del modello. */
export type JSONSchema = Record<string, unknown>;

export interface GenerateInput {
  system?: string;
  messages: ChatMessage[];
  /** Se presente, il provider deve restituire JSON conforme a questo schema. */
  schema?: JSONSchema;
  temperature?: number;
  maxTokens?: number;
}

/** Consumo token per audit costi (Requisito 4.7 / 11.1). */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LLMResult {
  /** Testo generato, oppure JSON serializzato se è stata usata una schema. */
  text: string;
  usage: TokenUsage;
  /** Identificativo del modello effettivamente usato. */
  model: string;
  /** Motivo di stop riportato dal provider, se disponibile. */
  finishReason?: string;
}

/** Chunk di streaming (opzionale). */
export interface LLMChunk {
  delta: string;
}

export interface LLMProvider {
  /** Identificativo stabile del provider (es. "bedrock"). */
  readonly id: string;
  generate(input: GenerateInput): Promise<LLMResult>;
  stream?(input: GenerateInput): AsyncIterable<LLMChunk>;
}
