import { describe, it, expect } from 'vitest';
import { collectCartoonScenes, findCartoonScene, isPlaceholderVideo } from './cartoon-scenes.js';

/** Costruisce un block branching_scenario con N node video. */
function scenarioBlock(id: string, nodes: Array<Record<string, unknown>>) {
  return { id, type: 'branching_scenario', payload: { nodes } };
}

/** Costruisce un block video_checkpoint con la media video indicata. */
function videoBlock(id: string, video: Record<string, unknown>) {
  return { id, type: 'video_checkpoint', payload: { video, checkpoints: [] } };
}

describe('collectCartoonScenes', () => {
  it('estrae una scena per node video di un branching_scenario', () => {
    const blocks = [
      scenarioBlock('sc1', [
        { id: 'n1', media: { kind: 'video', placeholderPrompt: 'storyboard 1' } },
        { id: 'n2', media: { kind: 'video', alt: 'alt 2' } },
        { id: 'n3', media: { kind: 'image' } }, // non-video: ignorato
      ]),
    ];
    const scenes = collectCartoonScenes(blocks);
    expect(scenes).toHaveLength(2);
    expect(scenes[0]).toMatchObject({ blockId: 'sc1', sceneId: 'n1', prompt: 'storyboard 1' });
    // alt è il fallback dello storyboard quando manca placeholderPrompt.
    expect(scenes[1]).toMatchObject({ blockId: 'sc1', sceneId: 'n2', prompt: 'alt 2' });
  });

  it('estrae una scena singola da un video_checkpoint (sceneId = blockId)', () => {
    const blocks = [videoBlock('vc1', { kind: 'video', placeholderPrompt: 'hook storyboard' })];
    const scenes = collectCartoonScenes(blocks);
    expect(scenes).toHaveLength(1);
    expect(scenes[0]).toMatchObject({ blockId: 'vc1', sceneId: 'vc1', prompt: 'hook storyboard' });
  });

  it('raccoglie scene da block MISTI in una lezione (pillola a blocchi piatti)', () => {
    const blocks = [
      videoBlock('hook', { kind: 'video', placeholderPrompt: 'hook' }),
      { id: 'core', type: 'rich_text', payload: { content: { html: '<p>…</p>' } } },
      { id: 'check', type: 'flashcard', payload: { cards: [] } },
    ];
    const scenes = collectCartoonScenes(blocks);
    expect(scenes.map((s) => s.sceneId)).toEqual(['hook']);
  });

  it('ritorna un riferimento VIVO alla media (mutare la scena muta il block)', () => {
    const blocks = [videoBlock('vc1', { kind: 'video', placeholderPrompt: 'x' })];
    const scene = collectCartoonScenes(blocks)[0]!;
    scene.media.storageKey = 'media/key.mp4';
    scene.media.videoGenStatus = 'ready';
    const payload = (blocks[0] as { payload: { video: Record<string, unknown> } }).payload;
    expect(payload.video.storageKey).toBe('media/key.mp4');
    expect(payload.video.videoGenStatus).toBe('ready');
  });

  it('limita per blockId e per sceneId', () => {
    const blocks = [
      scenarioBlock('sc1', [{ id: 'n1', media: { kind: 'video' } }, { id: 'n2', media: { kind: 'video' } }]),
      videoBlock('vc1', { kind: 'video' }),
    ];
    expect(collectCartoonScenes(blocks, 'sc1').map((s) => s.sceneId)).toEqual(['n1', 'n2']);
    expect(collectCartoonScenes(blocks, 'sc1', 'n2').map((s) => s.sceneId)).toEqual(['n2']);
    expect(collectCartoonScenes(blocks, 'vc1', 'vc1').map((s) => s.blockId)).toEqual(['vc1']);
  });

  it('tollera blocks non-array o block senza id', () => {
    expect(collectCartoonScenes(null as unknown as unknown[])).toEqual([]);
    expect(collectCartoonScenes([{ type: 'video_checkpoint', payload: { video: { kind: 'video' } } }])).toEqual([]);
  });
});

describe('findCartoonScene', () => {
  it('localizza una scena di scenario per block+scene', () => {
    const blocks = [scenarioBlock('sc1', [{ id: 'n1', media: { kind: 'video', placeholderPrompt: 'p' } }])];
    const scene = findCartoonScene(blocks, 'sc1', 'n1');
    expect(scene?.prompt).toBe('p');
  });

  it('localizza la scena di un video_checkpoint (sceneId = blockId)', () => {
    const blocks = [videoBlock('vc1', { kind: 'video' })];
    expect(findCartoonScene(blocks, 'vc1', 'vc1')?.blockId).toBe('vc1');
  });

  it('ritorna null se la scena non esiste', () => {
    const blocks = [videoBlock('vc1', { kind: 'video' })];
    expect(findCartoonScene(blocks, 'vc1', 'altro')).toBeNull();
  });
});

describe('isPlaceholderVideo', () => {
  it('true solo per video senza storageKey', () => {
    expect(isPlaceholderVideo({ kind: 'video' })).toBe(true);
    expect(isPlaceholderVideo({ kind: 'video', storageKey: 'k' })).toBe(false);
    expect(isPlaceholderVideo({ kind: 'image' })).toBe(false);
  });
});
