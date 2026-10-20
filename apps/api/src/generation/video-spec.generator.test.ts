import type { GenerateInput, LLMProvider, LLMResult } from '@scorm/domain';
import { generateVideoSpec } from './video-spec.generator.js';

const USAGE = { inputTokens: 100, outputTokens: 200 };

function validSpecJson(): string {
  return JSON.stringify({
    version: 1,
    canvas: { width: 1920, height: 1080, fps: 30 },
    theme: { palette: ['#0ea5e9', '#111827'], bg: '#f8fafc', fontFamily: 'Inter' },
    voiceover: { text: 'La blockchain è un registro condiviso e sicuro', lang: 'it' },
    scenes: [
      {
        id: 's1',
        durationHint: 'auto',
        layers: [
          { id: 'cap', component: 'Caption', enter: { at: 'sceneStart' }, exit: { at: 'sceneEnd' } },
          { id: 'title', component: 'TextReveal', props: { text: 'Blockchain', variant: 'title' }, enter: { at: { word: 0 } } },
        ],
      },
    ],
  });
}

/** LLM fake che restituisce, in ordine, le risposte fornite. */
function fakeLlm(responses: string[]): { llm: LLMProvider; calls: GenerateInput[] } {
  const calls: GenerateInput[] = [];
  let i = 0;
  const llm: LLMProvider = {
    id: 'fake',
    async generate(input: GenerateInput): Promise<LLMResult> {
      calls.push(input);
      const text = responses[Math.min(i, responses.length - 1)]!;
      i++;
      return { text, usage: USAGE, model: 'fake-model' };
    },
  };
  return { llm, calls };
}

describe('generateVideoSpec', () => {
  it('ritorna lo spec al primo tentativo se valido', async () => {
    const { llm, calls } = fakeLlm([validSpecJson()]);
    const r = await generateVideoSpec(llm, { scenePrompt: 'Spiega la blockchain', language: 'it' });
    expect(r.spec.scenes).toHaveLength(1);
    expect(r.spec.voiceover.lang).toBe('it');
    expect(calls).toHaveLength(1); // nessun retry
    expect(r.usage.inputTokens).toBe(100);
  });

  it('estrae il JSON anche se avvolto in testo/markdown', async () => {
    const wrapped = 'Ecco il video:\n```json\n' + validSpecJson() + '\n```\nSpero vada bene.';
    const { llm } = fakeLlm([wrapped]);
    const r = await generateVideoSpec(llm, { scenePrompt: 'x', language: 'it' });
    expect(r.spec.version).toBe(1);
  });

  it('fa self-repair: primo output invalido, secondo valido', async () => {
    const invalid = JSON.stringify({ version: 1, scenes: [] }); // manca canvas/theme/voiceover, scene vuote
    const { llm, calls } = fakeLlm([invalid, validSpecJson()]);
    const r = await generateVideoSpec(llm, { scenePrompt: 'x', language: 'it' });
    expect(r.spec.scenes).toHaveLength(1);
    expect(calls).toHaveLength(2); // retry avvenuto
    // Il secondo prompt contiene l'output errato + il motivo.
    const repairMsgs = calls[1]!.messages.map((m) => m.content).join('\n');
    expect(repairMsgs).toContain('NON è valido');
    // Token sommati dei due tentativi.
    expect(r.usage.inputTokens).toBe(200);
  });

  it('lancia un errore chiaro se fallisce anche la riparazione', async () => {
    const invalid = JSON.stringify({ nope: true });
    const { llm } = fakeLlm([invalid, invalid]);
    await expect(generateVideoSpec(llm, { scenePrompt: 'x', language: 'it' })).rejects.toThrow(
      /VideoSpec non valido dopo riparazione/,
    );
  });

  it('rifiuta un component fuori whitelist (via validazione)', async () => {
    const bad = JSON.parse(validSpecJson());
    bad.scenes[0].layers[1].component = 'EvilComp';
    const { llm } = fakeLlm([JSON.stringify(bad), JSON.stringify(bad)]);
    await expect(generateVideoSpec(llm, { scenePrompt: 'x', language: 'it' })).rejects.toThrow();
  });

  it('collassa a UNA scena se l\'LLM ne produce più (sync con voiceover unico)', async () => {
    const multi = JSON.parse(validSpecJson());
    multi.scenes = [
      { id: 's1', durationHint: 'auto', illustration: { prompt: 'a girl studying', kenBurns: 'in' }, layers: [{ id: 't1', component: 'LowerThird', props: { text: 'Uno' }, enter: { at: { word: 0 } } }] },
      { id: 's2', durationHint: 'auto', illustration: { prompt: 'a boy running', kenBurns: 'out' }, layers: [{ id: 'c', component: 'Caption', enter: { at: 'sceneStart' } }, { id: 't2', component: 'LowerThird', props: { text: 'Due' }, enter: { at: { word: 3 } } }] },
    ];
    const { llm } = fakeLlm([JSON.stringify(multi)]);
    const r = await generateVideoSpec(llm, { scenePrompt: 'x', language: 'it' });
    expect(r.spec.scenes).toHaveLength(1);
    // Tiene la prima illustrazione e unisce i layer, escludendo la Caption (iniettata dal renderer).
    expect(r.spec.scenes[0]!.illustration?.prompt).toBe('a girl studying');
    expect(r.spec.scenes[0]!.layers.map((l) => l.component)).toEqual(['LowerThird', 'LowerThird']);
    expect(r.spec.scenes[0]!.durationHint).toBe('auto');
  });
});
