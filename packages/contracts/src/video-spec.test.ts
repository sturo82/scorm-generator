import { VideoSpec } from './video-spec.js';
import {
  computeAllSceneBounds,
  computeSceneBounds,
  msToFrame,
  resolveFrame,
  type SceneBounds,
} from './video-spec-timing.js';
import type { Scene, WordMark } from './video-spec.js';

/** VideoSpec minimo valido, riusato dai test. */
function validSpec(): unknown {
  return {
    version: 1,
    canvas: { width: 1920, height: 1080, fps: 30 },
    theme: { palette: ['#000', '#fff'], bg: '#fff', fontFamily: 'Inter' },
    voiceover: { text: 'Ciao mondo questa è una prova', lang: 'it' },
    scenes: [
      {
        id: 's1',
        durationHint: 'auto',
        layers: [
          {
            id: 'title',
            component: 'TextReveal',
            props: { text: 'Titolo' },
            enter: { at: { word: 0 }, anim: 'fadeUp', ms: 400 },
            exit: { at: 'sceneEnd' },
          },
        ],
      },
    ],
  };
}

describe('VideoSpec schema', () => {
  it('accetta uno spec valido', () => {
    const r = VideoSpec.safeParse(validSpec());
    expect(r.success).toBe(true);
  });

  it('rifiuta un component fuori dalla whitelist', () => {
    const spec = validSpec() as { scenes: Array<{ layers: Array<{ component: string }> }> };
    spec.scenes[0]!.layers[0]!.component = 'HackerComponent';
    const r = VideoSpec.safeParse(spec);
    expect(r.success).toBe(false);
  });

  it('rifiuta un ancoraggio malformato (word negativo)', () => {
    const spec = validSpec() as { scenes: Array<{ layers: Array<{ enter: { at: unknown } }> }> };
    spec.scenes[0]!.layers[0]!.enter.at = { word: -3 };
    const r = VideoSpec.safeParse(spec);
    expect(r.success).toBe(false);
  });

  it('richiede almeno una scena', () => {
    const spec = validSpec() as { scenes: unknown[] };
    spec.scenes = [];
    const r = VideoSpec.safeParse(spec);
    expect(r.success).toBe(false);
  });

  it('applica i default (anim/ms del layer, durationHint)', () => {
    const spec = {
      version: 1,
      canvas: { width: 1920, height: 1080, fps: 30 },
      theme: { palette: ['#000'], bg: '#fff' },
      voiceover: { text: 'x', lang: 'it' },
      scenes: [{ id: 's1', layers: [{ id: 'l', component: 'Caption', enter: { at: 'sceneStart' } }] }],
    };
    const r = VideoSpec.parse(spec);
    expect(r.scenes[0]!.durationHint).toBe('auto');
    expect(r.scenes[0]!.layers[0]!.enter.anim).toBe('fadeUp');
    expect(r.scenes[0]!.layers[0]!.enter.ms).toBe(400);
    expect(r.theme.fontFamily).toBe('Inter');
  });
});

const WORDS: WordMark[] = [
  { word: 'Ciao', startMs: 0, endMs: 500 },
  { word: 'mondo', startMs: 500, endMs: 1000 },
  { word: 'prova', startMs: 1000, endMs: 2000 },
];

describe('video-spec-timing', () => {
  it('msToFrame arrotonda ms→frame al fps dato', () => {
    expect(msToFrame(1000, 30)).toBe(30);
    expect(msToFrame(500, 30)).toBe(15);
    expect(msToFrame(516, 30)).toBe(15); // 15.48 → 15
  });

  it('resolveFrame: sceneStart/sceneEnd ritornano i confini', () => {
    const b: SceneBounds = { startFrame: 10, endFrame: 70, length: 60 };
    expect(resolveFrame('sceneStart', b, WORDS, 30)).toBe(10);
    expect(resolveFrame('sceneEnd', b, WORDS, 30)).toBe(70);
  });

  it('resolveFrame: parola N → frame del suo startMs (clampato nella scena)', () => {
    const b: SceneBounds = { startFrame: 0, endFrame: 90, length: 90 };
    // parola 2 start=1000ms → 30 frame
    expect(resolveFrame({ word: 2 }, b, WORDS, 30)).toBe(30);
  });

  it('resolveFrame: indice di parola fuori range → clamp a inizio scena', () => {
    const b: SceneBounds = { startFrame: 5, endFrame: 50, length: 45 };
    expect(resolveFrame({ word: 99 }, b, WORDS, 30)).toBe(5);
  });

  it('resolveFrame: frame di una parola oltre la fine scena → clamp a endFrame', () => {
    const b: SceneBounds = { startFrame: 0, endFrame: 20, length: 20 };
    // parola 2 → 30 frame, ma la scena finisce a 20 → clamp 20
    expect(resolveFrame({ word: 2 }, b, WORDS, 30)).toBe(20);
  });

  it('computeSceneBounds: durata esplicita in ms', () => {
    const scene = { id: 's', durationHint: 2000, layers: [] } as unknown as Scene;
    const b = computeSceneBounds(scene, WORDS, 0, 30);
    expect(b.length).toBe(60); // 2000ms @30fps
    expect(b.endFrame).toBe(60);
  });

  it('computeSceneBounds: auto copre TUTTO il voiceover (ultima parola) + coda, non la parola ancorata', () => {
    const scene = {
      id: 's',
      durationHint: 'auto',
      // Layer ancorato solo a word 0: la durata NON deve fermarsi lì, ma coprire
      // l'intero voiceover (ultima parola) così l'audio non viene troncato.
      layers: [{ id: 'l', component: 'Caption', props: {}, enter: { at: { word: 0 }, anim: 'none', ms: 1 } }],
    } as unknown as Scene;
    const b = computeSceneBounds(scene, WORDS, 0, 30);
    // ultima parola endMs=2000 + coda 600 = 2600ms @30fps = 78 frame
    expect(b.endFrame).toBe(78);
  });

  it('computeSceneBounds: auto senza word-timings → fallback', () => {
    const scene = {
      id: 's',
      durationHint: 'auto',
      layers: [{ id: 'l', component: 'Caption', props: {}, enter: { at: 'sceneStart', anim: 'none', ms: 1 } }],
    } as unknown as Scene;
    const b = computeSceneBounds(scene, [], 0, 30, 3000);
    expect(b.length).toBe(90); // fallback 3000ms @30fps (nessun word-timing)
  });

  it('computeAllSceneBounds: le scene si susseguono senza buchi', () => {
    const scenes = [
      { id: 'a', durationHint: 1000, layers: [] },
      { id: 'b', durationHint: 2000, layers: [] },
    ] as unknown as Scene[];
    const all = computeAllSceneBounds(scenes, WORDS, 30);
    expect(all[0]!.startFrame).toBe(0);
    expect(all[0]!.endFrame).toBe(30);
    expect(all[1]!.startFrame).toBe(30); // inizia dove finisce la prima
    expect(all[1]!.endFrame).toBe(90);
  });
});
