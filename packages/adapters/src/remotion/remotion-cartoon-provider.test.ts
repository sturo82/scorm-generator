import { RemotionCartoonProvider, type GenerateSpecFn, type RenderFn } from './remotion-cartoon-provider.js';
import type { SpeechProvider } from '@scorm/domain';
import type { VideoSpec } from '@scorm/contracts';

const SPEC: VideoSpec = {
  version: 1,
  canvas: { width: 1920, height: 1080, fps: 30 },
  theme: { palette: ['#000'], bg: '#fff', fontFamily: 'Inter' },
  voiceover: { text: 'ciao mondo', lang: 'it' },
  scenes: [{ id: 's1', durationHint: 'auto', layers: [] }],
};

function speechWithMarks(): SpeechProvider {
  return {
    id: 'mock',
    async synthesize() {
      return { bytes: new Uint8Array([1, 2]), contentType: 'audio/mpeg', voice: 'mock' };
    },
    async synthesizeWithMarks() {
      return {
        bytes: new Uint8Array([1, 2]),
        contentType: 'audio/mpeg',
        voice: 'mock',
        marks: [
          { word: 'ciao', startMs: 0, endMs: 400 },
          { word: 'mondo', startMs: 400, endMs: 800 },
        ],
      };
    },
  };
}

/** Attende che fetchJob esca da 'processing' (il run è in background). */
async function waitDone(p: RemotionCartoonProvider, jobRef: string) {
  for (let i = 0; i < 50; i++) {
    const r = await p.fetchJob(jobRef);
    if (r.status !== 'processing') return r;
    await new Promise((res) => setTimeout(res, 5));
  }
  throw new Error('timeout');
}

describe('RemotionCartoonProvider', () => {
  it('completa la pipeline e consegna i byte MP4 con durata', async () => {
    const generateSpec: GenerateSpecFn = async () => ({ spec: SPEC });
    const render: RenderFn = async () => ({ bytes: new Uint8Array([9, 9, 9]), durationSec: 5 });
    const p = new RemotionCartoonProvider({ generateSpec, speech: speechWithMarks(), render });

    const { jobRef } = await p.startJob({ prompt: 'spiega x', language: 'it' });
    const r = await waitDone(p, jobRef);
    expect(r.status).toBe('completed');
    if (r.status === 'completed') {
      expect(Array.from(r.bytes)).toEqual([9, 9, 9]);
      expect(r.contentType).toBe('video/mp4');
      expect(r.durationSec).toBe(5);
    }
  });

  it('fallisce con reason se la generazione dello spec lancia', async () => {
    const generateSpec: GenerateSpecFn = async () => {
      throw new Error('LLM giù');
    };
    const render: RenderFn = async () => ({ bytes: new Uint8Array(), durationSec: 1 });
    const p = new RemotionCartoonProvider({ generateSpec, speech: speechWithMarks(), render });

    const { jobRef } = await p.startJob({ prompt: 'x', language: 'it' });
    const r = await waitDone(p, jobRef);
    expect(r.status).toBe('failed');
    if (r.status === 'failed') expect(r.reason).toContain('LLM giù');
  });

  it('fallisce con reason se il render lancia', async () => {
    const generateSpec: GenerateSpecFn = async () => ({ spec: SPEC });
    const render: RenderFn = async () => {
      throw new Error('Chromium assente');
    };
    const p = new RemotionCartoonProvider({ generateSpec, speech: speechWithMarks(), render });

    const { jobRef } = await p.startJob({ prompt: 'x', language: 'it' });
    const r = await waitDone(p, jobRef);
    expect(r.status).toBe('failed');
    if (r.status === 'failed') expect(r.reason).toContain('Chromium');
  });

  it('fetchJob su jobRef sconosciuto → failed', async () => {
    const p = new RemotionCartoonProvider({
      generateSpec: async () => ({ spec: SPEC }),
      speech: speechWithMarks(),
      render: async () => ({ bytes: new Uint8Array(), durationSec: 1 }),
    });
    const r = await p.fetchJob('inesistente');
    expect(r.status).toBe('failed');
  });

  it('stile B: genera l\'illustrazione (ImageProvider) e la passa al render come src', async () => {
    const specWithIllus: VideoSpec = {
      ...SPEC,
      scenes: [
        { id: 's1', durationHint: 'auto', illustration: { prompt: 'un gatto', kenBurns: 'in' }, layers: [] },
      ],
    };
    const images = {
      id: 'mock-img',
      generate: async () => ({ bytes: new Uint8Array([7, 7]), contentType: 'image/png', model: 'mock' }),
    };
    let renderedSpec: VideoSpec | undefined;
    const render: RenderFn = async (args) => {
      renderedSpec = args.spec;
      return { bytes: new Uint8Array([1]), durationSec: 3 };
    };
    const p = new RemotionCartoonProvider({ generateSpec: async () => ({ spec: specWithIllus }), speech: speechWithMarks(), render, images });
    const { jobRef } = await p.startJob({ prompt: 'x', language: 'it' });
    const r = await waitDone(p, jobRef);
    expect(r.status).toBe('completed');
    // L'illustrazione è stata risolta in un data URL e passata al render.
    const src = renderedSpec?.scenes[0]?.illustration?.src ?? '';
    expect(src.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('startJob lancia se lo SpeechProvider non supporta i word-timings', async () => {
    const speechNoMarks: SpeechProvider = {
      id: 'mock',
      async synthesize() {
        return { bytes: new Uint8Array(), contentType: 'audio/mpeg', voice: 'mock' };
      },
    };
    const p = new RemotionCartoonProvider({
      generateSpec: async () => ({ spec: SPEC }),
      speech: speechNoMarks,
      render: async () => ({ bytes: new Uint8Array(), durationSec: 1 }),
    });
    await expect(p.startJob({ prompt: 'x', language: 'it' })).rejects.toThrow();
  });
});
