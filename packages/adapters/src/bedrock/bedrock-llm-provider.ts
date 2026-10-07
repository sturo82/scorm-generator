import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type Message,
  type Tool,
} from '@aws-sdk/client-bedrock-runtime';
import {
  type GenerateInput,
  type LLMProvider,
  type LLMResult,
  ProviderUnavailableError,
} from '@scorm/domain';

export interface BedrockLLMProviderOptions {
  /** ID del modello Bedrock (es. anthropic.claude-3-5-sonnet-20240620-v1:0). */
  modelId: string;
  region?: string;
  /** Credenziali esplicite; se assenti, usa la default credential chain AWS. */
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
}

const STRUCTURED_TOOL_NAME = 'emit_structured_output';

/**
 * Adapter LLMProvider su Amazon Bedrock, basato sulla Converse API
 * (indipendente dal modello). La generazione strutturata (Requisito 4.1 / 4.2)
 * è ottenuta forzando l'uso di un tool il cui input schema è il JSON Schema
 * richiesto: il modello restituisce direttamente l'oggetto conforme.
 *
 * Le credenziali restano server-side (Requisito 10.5): sono lette dalle opzioni
 * o dalla default credential chain di AWS, mai dal client.
 */
export class BedrockLLMProvider implements LLMProvider {
  readonly id = 'bedrock';
  private readonly client: BedrockRuntimeClient;
  private readonly modelId: string;

  constructor(opts: BedrockLLMProviderOptions) {
    this.modelId = opts.modelId;
    this.client = new BedrockRuntimeClient({
      region: opts.region ?? 'us-east-1',
      credentials:
        opts.accessKeyId && opts.secretAccessKey
          ? {
              accessKeyId: opts.accessKeyId,
              secretAccessKey: opts.secretAccessKey,
              sessionToken: opts.sessionToken,
            }
          : undefined,
    });
  }

  async generate(input: GenerateInput): Promise<LLMResult> {
    const messages = this.toConverseMessages(input);
    const system = input.system ? [{ text: input.system }] : undefined;

    const inferenceConfig = {
      temperature: input.temperature,
      maxTokens: input.maxTokens,
    };

    const toolConfig = input.schema
      ? {
          tools: [this.schemaTool(input.schema)] satisfies Tool[],
          toolChoice: { tool: { name: STRUCTURED_TOOL_NAME } },
        }
      : undefined;

    let response;
    try {
      response = await this.client.send(
        new ConverseCommand({
          modelId: this.modelId,
          messages,
          system,
          inferenceConfig,
          toolConfig,
        }),
      );
    } catch (err) {
      throw new ProviderUnavailableError('bedrock', err);
    }

    const text = input.schema
      ? this.extractToolInput(response.output?.message?.content)
      : this.extractText(response.output?.message?.content);

    return {
      text,
      model: this.modelId,
      finishReason: response.stopReason,
      usage: {
        inputTokens: response.usage?.inputTokens ?? 0,
        outputTokens: response.usage?.outputTokens ?? 0,
      },
    };
  }

  private toConverseMessages(input: GenerateInput): Message[] {
    // La Converse API gestisce system separatamente; qui mappiamo user/assistant.
    return input.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: [{ text: m.content }],
      }));
  }

  private schemaTool(schema: Record<string, unknown>): Tool {
    return {
      toolSpec: {
        name: STRUCTURED_TOOL_NAME,
        description: 'Restituisce l\'output strutturato conforme allo schema richiesto.',
        // Il JSON Schema è passato come documento di input del tool. Il tipo
        // "DocumentType" dell'SDK è strutturalmente un valore JSON arbitrario,
        // quindi si usa un cast controllato.
        inputSchema: { json: normalizeToolSchema(schema) as unknown as never },
      },
    };
  }

  private extractText(content: ContentBlock[] | undefined): string {
    if (!content) return '';
    return content
      .map((c) => ('text' in c && c.text ? c.text : ''))
      .join('')
      .trim();
  }

  /** Estrae l'input del tool strutturato come JSON serializzato. */
  private extractToolInput(content: ContentBlock[] | undefined): string {
    if (!content) throw new ProviderUnavailableError('bedrock');
    for (const block of content) {
      if ('toolUse' in block && block.toolUse?.input !== undefined) {
        return JSON.stringify(block.toolUse.input);
      }
    }
    // Fallback: il modello potrebbe aver risposto in testo nonostante toolChoice.
    const text = this.extractText(content);
    if (text) return text;
    throw new ProviderUnavailableError('bedrock');
  }
}

/**
 * Normalizza un JSON Schema per l'inputSchema di un tool Bedrock. Gli schema
 * generati da zod-to-json-schema hanno un `$ref` top-level verso una sezione
 * `definitions`/`$defs`, ma la Converse API richiede che `inputSchema.json` sia
 * uno schema con `type: "object"` inline. Questa funzione risolve il `$ref`
 * radice e inlina ricorsivamente ogni riferimento interno, restituendo uno
 * schema autocontenuto. È puramente strutturale: non altera i vincoli.
 */
export function normalizeToolSchema(schema: Record<string, unknown>): Record<string, unknown> {
  // Decodifica un segmento di JSON Pointer (RFC 6901: ~1 -> "/", ~0 -> "~").
  const decodeSegment = (seg: string): string => seg.replace(/~1/g, '/').replace(/~0/g, '~');

  // Risolve un $ref come JSON Pointer completo rispetto a un documento radice.
  // zod-to-json-schema produce sia riferimenti a una definizione
  // (#/definitions/Block) sia pointer profondi dentro una definizione
  // (#/definitions/Block/anyOf/0/properties/id). Navigare l'intero path copre
  // entrambi i casi, inclusi array (indici numerici).
  const resolvePointer = (ref: string, root: unknown): unknown => {
    if (!ref.startsWith('#/')) {
      throw new Error(`Riferimento JSON Schema non supportato: ${ref}`);
    }
    const segments = ref.slice(2).split('/').map(decodeSegment);
    let current: unknown = root;
    for (const seg of segments) {
      if (Array.isArray(current)) {
        current = current[Number(seg)];
      } else if (current && typeof current === 'object') {
        current = (current as Record<string, unknown>)[seg];
      } else {
        current = undefined;
      }
      if (current === undefined) {
        throw new Error(`Riferimento JSON Schema non risolvibile: ${ref}`);
      }
    }
    return current;
  };

  // `root` è il documento rispetto al quale risolvere i $ref. Quando un nodo
  // porta con sé le proprie `definitions`/`$defs` (schema annidato, es. l'item
  // di wrapArraySchema), quel nodo diventa la nuova radice per i $ref che
  // contiene — così si risolvono anche i wrapper con definizioni locali.
  const inline = (node: unknown, root: unknown, seen: Set<string>): unknown => {
    if (Array.isArray(node)) return node.map((n) => inline(n, root, seen));
    if (node === null || typeof node !== 'object') return node;

    const obj = node as Record<string, unknown>;
    const localRoot = obj['definitions'] || obj['$defs'] ? obj : root;

    if (typeof obj['$ref'] === 'string') {
      const ref = obj['$ref'];
      if (seen.has(ref)) {
        // Riferimento ricorsivo: evitiamo loop infiniti lasciando un oggetto
        // generico (caso non presente negli schema attuali).
        return { type: 'object' };
      }
      const target = resolvePointer(ref, localRoot);
      const resolved = inline(target, localRoot, new Set(seen).add(ref));
      // Eventuali fratelli di $ref (rari) vengono fusi sopra la definizione.
      const { $ref: _ignored, ...rest } = obj;
      return typeof resolved === 'object' && resolved !== null && !Array.isArray(resolved)
        ? { ...(resolved as Record<string, unknown>), ...(inline(rest, localRoot, seen) as object) }
        : resolved;
    }

    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'definitions' || key === '$defs' || key === '$schema') continue;
      out[key] = inline(value, localRoot, seen);
    }
    return out;
  };

  const normalized = inline(schema, schema, new Set<string>()) as Record<string, unknown>;
  // Rimuove eventuali chiavi di wrapping rimaste al top-level.
  delete normalized['definitions'];
  delete normalized['$defs'];
  delete normalized['$schema'];
  return normalized;
}
