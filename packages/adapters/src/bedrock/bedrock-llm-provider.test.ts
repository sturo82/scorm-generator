import { describe, it, expect, vi } from 'vitest';
import { BedrockLLMProvider, normalizeToolSchema } from './bedrock-llm-provider.js';
import { outlineJsonSchema, blockJsonSchema } from '@scorm/contracts';
import { ProviderUnavailableError } from '@scorm/domain';

/**
 * Verifica la logica dell'adapter (mappatura messaggi, tool-use strutturato,
 * usage, gestione errori) iniettando un client fittizio al posto di quello AWS.
 * Non effettua chiamate reali a Bedrock.
 */
function withFakeClient(provider: BedrockLLMProvider, send: () => unknown): void {
  // Sostituisce il client interno (accesso privato controllato nel test).
  (provider as unknown as { client: { send: unknown } }).client = { send: vi.fn(send) };
}

describe('BedrockLLMProvider', () => {
  const provider = new BedrockLLMProvider({ modelId: 'test-model', region: 'us-east-1' });

  it('restituisce il testo e l usage per una generazione libera', async () => {
    withFakeClient(provider, async () => ({
      output: { message: { content: [{ text: 'risposta' }] } },
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 5 },
    }));
    const res = await provider.generate({ messages: [{ role: 'user', content: 'ciao' }] });
    expect(res.text).toBe('risposta');
    expect(res.model).toBe('test-model');
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(res.finishReason).toBe('end_turn');
  });

  it('estrae l input del tool come JSON per la generazione strutturata', async () => {
    const structured = { title: 'Corso', modules: [] };
    withFakeClient(provider, async () => ({
      output: {
        message: {
          content: [{ toolUse: { name: 'emit_structured_output', input: structured } }],
        },
      },
      stopReason: 'tool_use',
      usage: { inputTokens: 20, outputTokens: 30 },
    }));
    const res = await provider.generate({
      messages: [{ role: 'user', content: 'genera' }],
      schema: { type: 'object' },
    });
    expect(JSON.parse(res.text)).toEqual(structured);
  });

  it('traduce gli errori del provider in ProviderUnavailableError', async () => {
    withFakeClient(provider, () => {
      throw new Error('network down');
    });
    await expect(
      provider.generate({ messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it('ha id "bedrock"', () => {
    expect(provider.id).toBe('bedrock');
  });
});

describe('normalizeToolSchema', () => {
  it('risolve un $ref top-level in uno schema object inline (requisito Bedrock)', () => {
    const schema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      $ref: '#/definitions/Root',
      definitions: {
        Root: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
          additionalProperties: false,
        },
      },
    };
    const out = normalizeToolSchema(schema);
    expect(out.type).toBe('object');
    expect(out).not.toHaveProperty('$ref');
    expect(out).not.toHaveProperty('definitions');
    expect(out).not.toHaveProperty('$schema');
    expect(out.properties).toEqual({ name: { type: 'string' } });
    expect(out.required).toEqual(['name']);
  });

  it('inlina ricorsivamente i $ref annidati verso definitions', () => {
    const schema = {
      $ref: '#/definitions/Course',
      definitions: {
        Course: {
          type: 'object',
          properties: {
            modules: { type: 'array', items: { $ref: '#/definitions/Module' } },
          },
          required: ['modules'],
        },
        Module: {
          type: 'object',
          properties: { title: { type: 'string' } },
          required: ['title'],
        },
      },
    };
    const out = normalizeToolSchema(schema) as any;
    expect(out.type).toBe('object');
    const items = out.properties.modules.items;
    expect(items).not.toHaveProperty('$ref');
    expect(items.type).toBe('object');
    expect(items.properties.title).toEqual({ type: 'string' });
  });

  it('supporta la sezione $defs oltre a definitions', () => {
    const schema = {
      $ref: '#/$defs/Root',
      $defs: { Root: { type: 'object', properties: { x: { type: 'number' } } } },
    };
    const out = normalizeToolSchema(schema);
    expect(out.type).toBe('object');
    expect(out).not.toHaveProperty('$defs');
    expect(out.properties).toEqual({ x: { type: 'number' } });
  });

  it('lascia invariato uno schema object già inline', () => {
    const schema = { type: 'object', properties: { a: { type: 'boolean' } }, required: ['a'] };
    const out = normalizeToolSchema(schema);
    expect(out).toEqual(schema);
  });

  it('risolve $ref verso definitions annidate in sottoschemi (schema wrapper array)', () => {
    // Caso reale: wrapArraySchema(blockJsonSchema, "blocks") produce un wrapper
    // le cui `definitions` sono annidate dentro l'item, non al top-level.
    const itemSchema = {
      $ref: '#/definitions/Block',
      definitions: {
        Block: {
          type: 'object',
          properties: { kind: { type: 'string' } },
          required: ['kind'],
        },
      },
    };
    const wrapper = {
      type: 'object',
      properties: { blocks: { type: 'array', items: itemSchema } },
      required: ['blocks'],
      additionalProperties: false,
    };
    const out = normalizeToolSchema(wrapper) as any;
    expect(out.type).toBe('object');
    const items = out.properties.blocks.items;
    expect(items).not.toHaveProperty('$ref');
    expect(items.type).toBe('object');
    expect(items.properties.kind).toEqual({ type: 'string' });
    expect(JSON.stringify(out)).not.toContain('$ref');
    expect(JSON.stringify(out)).not.toContain('definitions');
  });

  it('risolve JSON Pointer profondi dentro una definizione (#/definitions/X/anyOf/0/...)', () => {
    const schema = {
      $ref: '#/definitions/Root',
      definitions: {
        Root: {
          type: 'object',
          properties: {
            // Riferimento profondo che punta DENTRO un'altra definizione.
            idRef: { $ref: '#/definitions/Entity/properties/id' },
          },
        },
        Entity: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    };
    const out = normalizeToolSchema(schema) as any;
    expect(out.properties.idRef).toEqual({ type: 'string', format: 'uuid' });
    expect(JSON.stringify(out)).not.toContain('$ref');
  });

  it('normalizza lo schema reale Block (union anyOf con $ref profondi) a wrapper array', () => {
    // Riproduce wrapArraySchema(blockJsonSchema, "blocks") usato dalla pipeline.
    const wrapper = {
      type: 'object',
      properties: { blocks: { type: 'array', items: blockJsonSchema } },
      required: ['blocks'],
      additionalProperties: false,
    };
    const out = normalizeToolSchema(wrapper) as any;
    expect(out.type).toBe('object');
    expect(out.properties.blocks.type).toBe('array');
    // Nessun riferimento né sezione di definizioni deve sopravvivere.
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain('$ref');
    expect(serialized).not.toContain('definitions');
  });

  it('normalizza lo schema reale CourseOutline a type:object senza $ref', () => {
    // È lo schema che faceva fallire Bedrock prima del fix.
    expect(outlineJsonSchema).toHaveProperty('$ref');
    const out = normalizeToolSchema(outlineJsonSchema as Record<string, unknown>);
    expect(out.type).toBe('object');
    expect(out).not.toHaveProperty('$ref');
    expect(out).not.toHaveProperty('definitions');
    expect(out.properties).toHaveProperty('modules');
    // Nessun $ref deve sopravvivere nell'intero schema serializzato.
    expect(JSON.stringify(out)).not.toContain('$ref');
  });
});
