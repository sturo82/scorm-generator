import type {
  GenerateInput,
  JSONSchema,
  LLMProvider,
  LLMResult,
} from '@scorm/domain';

/**
 * LLMProvider deterministico per sviluppo e test (Requisito 10.1 / 10.3).
 * - Senza schema: restituisce un'eco strutturata e deterministica del prompt.
 * - Con schema: produce un oggetto JSON minimo che soddisfa lo schema, così da
 *   permettere di esercitare la pipeline end-to-end senza credenziali Bedrock.
 *
 * NON è una simulazione fedele del modello: serve a rendere testabile il flusso.
 */
export interface MockLLMOptions {
  /**
   * Override opzionale: data una GenerateInput, restituisce il testo da usare.
   * Se restituisce undefined, si applica il comportamento di default.
   */
  responder?: (input: GenerateInput) => string | undefined;
}

export class MockLLMProvider implements LLMProvider {
  readonly id = 'mock';

  constructor(private readonly options: MockLLMOptions = {}) {}

  async generate(input: GenerateInput): Promise<LLMResult> {
    const override = this.options.responder?.(input);
    const text =
      override ??
      (input.schema ? this.buildFromSchema(input.schema) : this.echo(input));

    return {
      text,
      model: 'mock-model',
      finishReason: 'stop',
      usage: {
        inputTokens: this.estimateTokens(input),
        outputTokens: Math.ceil(text.length / 4),
      },
    };
  }

  private echo(input: GenerateInput): string {
    const last = input.messages.at(-1)?.content ?? '';
    return `MOCK:${last.slice(0, 200)}`;
  }

  private estimateTokens(input: GenerateInput): number {
    const all = (input.system ?? '') + input.messages.map((m) => m.content).join(' ');
    return Math.ceil(all.length / 4);
  }

  /**
   * Genera un valore JSON deterministico che soddisfa lo schema fornito.
   * Supporta il sottoinsieme di JSON Schema prodotto da zod-to-json-schema
   * (object/array/string/number/boolean/enum/const, oneOf/anyOf, $ref locali).
   */
  private buildFromSchema(schema: JSONSchema): string {
    const root = schema as Record<string, unknown>;
    const value = this.sample(root, root, 0);
    return JSON.stringify(value);
  }

  /**
   * Risolve un JSON Pointer locale (es. "#/definitions/Assessment/properties/id")
   * seguendo l'intero path a partire dal documento radice.
   */
  private resolveRef(ref: string, root: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!ref.startsWith('#/')) return undefined;
    const segments = ref
      .slice(2)
      .split('/')
      .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
    let current: unknown = root;
    for (const seg of segments) {
      if (current && typeof current === 'object' && seg in (current as Record<string, unknown>)) {
        current = (current as Record<string, unknown>)[seg];
      } else {
        return undefined;
      }
    }
    return current as Record<string, unknown> | undefined;
  }

  private sample(
    node: Record<string, unknown>,
    root: Record<string, unknown>,
    depth: number,
  ): unknown {
    if (depth > 40) return null; // guardia anti-ricorsione

    // Risoluzione $ref via JSON Pointer completo.
    const ref = node['$ref'];
    if (typeof ref === 'string') {
      const target = this.resolveRef(ref, root);
      return target ? this.sample(target, root, depth + 1) : null;
    }

    if (Array.isArray(node['const'])) return node['const'];
    if ('const' in node) return node['const'];

    const enumVals = node['enum'] as unknown[] | undefined;
    if (enumVals && enumVals.length > 0) return enumVals[0];

    // Union: prende la prima variante.
    for (const key of ['oneOf', 'anyOf', 'allOf'] as const) {
      const variants = node[key] as Record<string, unknown>[] | undefined;
      if (variants && variants.length > 0) {
        if (key === 'allOf') {
          // Merge superficiale delle varianti allOf.
          const merged: Record<string, unknown> = {};
          for (const v of variants) {
            const sampled = this.sample(v, root, depth + 1);
            if (sampled && typeof sampled === 'object') Object.assign(merged, sampled);
          }
          return merged;
        }
        return this.sample(variants[0] as Record<string, unknown>, root, depth + 1);
      }
    }

    const type = this.resolveType(node);
    switch (type) {
      case 'object':
        return this.sampleObject(node, root, depth);
      case 'array':
        return this.sampleArray(node, root, depth);
      case 'string':
        return this.sampleString(node);
      case 'number':
      case 'integer':
        return typeof node['minimum'] === 'number' ? node['minimum'] : 1;
      case 'boolean':
        return false;
      case 'null':
        return null;
      default:
        return null;
    }
  }

  private resolveType(node: Record<string, unknown>): string | undefined {
    const t = node['type'];
    if (typeof t === 'string') return t;
    if (Array.isArray(t) && t.length > 0) return t[0] as string;
    if (node['properties']) return 'object';
    if (node['items']) return 'array';
    return undefined;
  }

  private sampleObject(
    node: Record<string, unknown>,
    root: Record<string, unknown>,
    depth: number,
  ): Record<string, unknown> {
    const props = (node['properties'] as Record<string, unknown>) ?? {};
    const required = (node['required'] as string[]) ?? Object.keys(props);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(props)) {
      // Genera i campi richiesti; per gli altri, solo se semplici (evita rumore).
      if (!required.includes(key)) continue;
      out[key] = this.sample(props[key] as Record<string, unknown>, root, depth + 1);
    }
    return out;
  }

  private sampleArray(
    node: Record<string, unknown>,
    root: Record<string, unknown>,
    depth: number,
  ): unknown[] {
    const items = node['items'] as Record<string, unknown> | undefined;
    const minItems = (node['minItems'] as number | undefined) ?? 1;
    if (!items || minItems <= 0) return [];
    const count = Math.max(1, minItems);
    return Array.from({ length: count }, () => this.sample(items, root, depth + 1));
  }

  private sampleString(node: Record<string, unknown>): string {
    const format = node['format'];
    if (format === 'email') return 'mock@example.com';
    if (format === 'uri' || format === 'url') return 'https://example.com/mock';

    // Se c'è un pattern, prova a produrre un valore che lo soddisfi per i casi
    // noti dei contratti (es. codice lingua BCP-47, colore esadecimale).
    const pattern = node['pattern'];
    if (typeof pattern === 'string') {
      const sample = sampleForPattern(pattern);
      if (sample) return sample;
    }
    return 'mock';
  }
}

/**
 * Restituisce un valore che soddisfa alcuni pattern regex noti usati nei
 * contratti. Non è un generatore generico di stringhe da regex: copre i casi
 * necessari a far passare la validazione nella pipeline mock.
 */
function sampleForPattern(pattern: string): string | undefined {
  const candidates = ['it', 'en', '#000000', 'mock-value'];
  for (const c of candidates) {
    try {
      if (new RegExp(pattern).test(c)) return c;
    } catch {
      // Pattern non compilabile: ignora.
    }
  }
  return undefined;
}
