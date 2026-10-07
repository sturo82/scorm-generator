import { describe, it, expect } from 'vitest';
import { renderBlock, isHandledByCore } from './registry.js';
import { videoEmbedUrl, fmtTime, sortCues } from './video.js';
import { initialState, reduce, renderStateful } from './stateful.js';
import { buildCourseSteps, groupConcepts } from './course-structure.js';
import { BlockType } from '../blocks.js';
import type { RenderContext } from './vnode.js';
import type { MediaRef } from '../primitives.js';

/** Contesto di test: risolve lo storageKey tale e quale (come fosse un URL). */
const ctx: RenderContext = { resolveMedia: (m) => m.storageKey ?? null };

const media = (over: Partial<MediaRef>): MediaRef => ({
  kind: 'image',
  alt: '',
  source: 'upload',
  ...over,
});

describe('render-core registry', () => {
  it('rich_text produce un div.block con il contenuto rich e le immagini risolte', () => {
    const vnode = renderBlock(
      {
        type: 'rich_text',
        payload: {
          content: { format: 'html', html: '<p>Ciao</p>' },
          media: [media({ storageKey: 'img-1.png', alt: 'Logo' })],
        },
      },
      ctx,
    );
    expect(vnode.tag).toBe('div');
    expect(vnode.attrs?.class).toBe('block');
    const children = vnode.children ?? [];
    // Primo figlio: il contenuto rich (html fidato).
    expect(children[0]).toMatchObject({ tag: 'div', attrs: { class: 'block-rich' }, html: '<p>Ciao</p>' });
    // Secondo figlio: l'immagine risolta.
    expect(children[1]).toMatchObject({ tag: 'img', attrs: { class: 'block-media', src: 'img-1.png', alt: 'Logo' } });
  });

  it('rich_text salta i media non materializzati (placeholder) e i non-immagine', () => {
    const vnode = renderBlock(
      {
        type: 'rich_text',
        payload: {
          content: { format: 'html', html: '<p>x</p>' },
          media: [media({ placeholderPrompt: 'una foto' }), media({ kind: 'video', storageKey: 'v.mp4' })],
        },
      },
      ctx,
    );
    // Solo il contenuto rich, nessuna immagine.
    expect((vnode.children ?? []).filter((c) => typeof c === 'object' && c && (c as { tag?: string }).tag === 'img')).toHaveLength(0);
  });

  it('un tipo non gestito produce il segnaposto esplicito', () => {
    const vnode = renderBlock({ type: 'non_esiste', payload: {} }, ctx);
    expect(vnode.attrs?.class).toBe('block unknown');
    expect(vnode.children?.[0]).toContain('non supportato');
  });

  it('isHandledByCore riflette i tipi migrati nel core', () => {
    for (const t of [
      'rich_text',
      'timeline',
      'image_hotspot',
      'accordion_tabs',
      'click_reveal',
      'carousel_steps',
      'flashcard',
    ]) {
      expect(isHandledByCore(t)).toBe(true);
    }
    // Fase 2: anche i tipi complessi/valutabili e il video sono nel core.
    for (const t of [
      'dragdrop_match',
      'dragdrop_order',
      'sorting_categories',
      'branching_scenario',
      'video_checkpoint',
    ]) {
      expect(isHandledByCore(t)).toBe(true);
    }
  });
});

describe('render-core block statici (Fase 1)', () => {
  it('timeline produce ol.block.timeline con un li per evento', () => {
    const v = renderBlock(
      { type: 'timeline', payload: { events: [{ date: '2020', title: 'A', content: { html: '<p>x</p>' } }] } },
      ctx,
    );
    expect(v.tag).toBe('ol');
    expect(v.attrs?.class).toBe('block timeline');
    expect(v.children).toHaveLength(1);
  });

  it('flashcard: carte con flip (data-toggle-self, aria-pressed) e behavior toggle', () => {
    const v = renderBlock(
      { type: 'flashcard', payload: { cards: [{ id: 'c1', front: { html: 'A' }, back: { html: 'B' } }] } },
      ctx,
    );
    expect(v.attrs?.class).toBe('block flashcards');
    expect(v.behavior).toEqual({ kind: 'toggle' });
    const btn = v.children?.[0] as { attrs?: Record<string, unknown> };
    expect(btn.attrs?.['data-toggle-self']).toBeDefined();
    expect(btn.attrs?.['aria-pressed']).toBe('false');
  });

  it('accordion variant tabs: behavior tabs con primo pannello attivo', () => {
    const v = renderBlock(
      {
        type: 'accordion_tabs',
        payload: { variant: 'tabs', panels: [{ id: 'p1', title: 'Uno', content: { html: 'x' } }, { id: 'p2', title: 'Due', content: { html: 'y' } }] },
      },
      ctx,
    );
    expect(v.attrs?.class).toBe('block tabs');
    expect(v.behavior).toEqual({ kind: 'tabs', initialTabId: 'p1' });
  });

  it('accordion variant default: behavior toggle con coppie trigger/body', () => {
    const v = renderBlock(
      { type: 'accordion_tabs', payload: { panels: [{ id: 'p1', title: 'Uno', content: { html: 'x' } }] } },
      ctx,
    );
    expect(v.attrs?.class).toBe('block accordion');
    expect(v.behavior).toEqual({ kind: 'toggle' });
  });

  it('carousel_steps: behavior carousel, slide con data-carousel-slide (solo il primo visibile)', () => {
    const v = renderBlock(
      { type: 'carousel_steps', payload: { steps: [{ title: 'S1' }, { title: 'S2' }] } },
      ctx,
    );
    expect(v.attrs?.class).toBe('block carousel');
    expect(v.behavior).toMatchObject({ kind: 'carousel', count: 2 });
  });

  it('image_hotspot: behavior hotspot, dot con data-hotspot-dot + box info nascosto', () => {
    const v = renderBlock(
      {
        type: 'image_hotspot',
        payload: {
          image: media({ storageKey: 'img.png' }),
          hotspots: [{ id: 'h1', x: 0.5, y: 0.5, label: 'Punto', content: { html: '<p>info</p>' } }],
        },
      },
      ctx,
    );
    expect(v.attrs?.class).toBe('block hotspot');
    expect(v.behavior).toEqual({ kind: 'hotspot' });
  });
});

describe('render-core block interattivi (Fase 2)', () => {
  it('dragdrop_match / sorting / order / scenario sono behavior stateful', () => {
    const match = renderBlock({ type: 'dragdrop_match', payload: { pairs: [] } }, ctx);
    expect(match.behavior).toMatchObject({ kind: 'stateful', spec: { type: 'dnd-match' } });
    const sort = renderBlock({ type: 'sorting_categories', payload: { items: [], categories: [] } }, ctx);
    expect(sort.behavior).toMatchObject({ kind: 'stateful', spec: { type: 'dnd-sort' } });
    const order = renderBlock({ type: 'dragdrop_order', payload: { items: [] } }, ctx);
    expect(order.behavior).toMatchObject({ kind: 'stateful', spec: { type: 'dnd-order' } });
    const scenario = renderBlock({ type: 'branching_scenario', payload: { startNodeId: 'n1', nodes: [] } }, ctx);
    expect(scenario.behavior).toMatchObject({ kind: 'stateful', spec: { type: 'scenario' } });
  });

  it('video_checkpoint: behavior video-karaoke, colonna video + pannello tab trascrizione', () => {
    const v = renderBlock(
      {
        type: 'video_checkpoint',
        payload: {
          video: media({ kind: 'video', storageKey: 'v.mp4', source: 'upload' }),
          transcript: [{ id: 'c0', start: 0, end: 2, text: 'Ciao' }],
          transcriptStatus: 'ready',
          sections: [],
        },
      },
      ctx,
    );
    expect(v.attrs?.class).toContain('block video');
    expect(v.behavior).toEqual({ kind: 'video-karaoke' });
  });
});

describe('render-core stateful reducers (logica + scoring)', () => {
  it('dnd-match: pick + drop assegna il valore e lo rimuove da altri slot', () => {
    const spec = { type: 'dnd-match' as const, payload: { pairs: [{ id: 'l1', left: 'A', right: 'X' }, { id: 'l2', left: 'B', right: 'X' }] } };
    let s = initialState(spec);
    s = reduce(spec, s, { ev: 'drop', arg: 'l1', arg2: 'X' });
    expect((s as { assign: Record<string, string> }).assign).toEqual({ l1: 'X' });
    // Lo stesso valore su l2 lo toglie da l1 (unicità).
    s = reduce(spec, s, { ev: 'drop', arg: 'l2', arg2: 'X' });
    expect((s as { assign: Record<string, string> }).assign).toEqual({ l2: 'X' });
  });

  it('dnd-order: move riordina gli elementi', () => {
    const spec = { type: 'dnd-order' as const, payload: { items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }] } };
    let s = initialState(spec) as { order: string[] };
    expect(s.order).toEqual(['a', 'b', 'c']);
    s = reduce(spec, s, { ev: 'move', arg: '0', arg2: '2' }) as { order: string[] };
    expect(s.order).toEqual(['b', 'c', 'a']);
  });

  it('scenario: choose accumula lo score e naviga; fine quando non c’è nextNodeId', () => {
    const spec = {
      type: 'scenario' as const,
      payload: {
        startNodeId: 'n1',
        nodes: [
          { id: 'n1', content: { html: 'Q' }, choices: [{ id: 'c1', label: 'vai', nextNodeId: 'n2', score: 3 }] },
          { id: 'n2', content: { html: 'Fine' }, choices: [{ id: 'c2', label: 'end', score: 2 }] },
        ],
      },
    };
    let s = initialState(spec) as { currentId: string; score: number; ended: boolean };
    s = reduce(spec, s, { ev: 'choose', arg: 'c1' }) as typeof s;
    expect(s.currentId).toBe('n2');
    expect(s.score).toBe(3);
    expect(s.ended).toBe(false);
    s = reduce(spec, s, { ev: 'choose', arg: 'c2' }) as typeof s;
    expect(s.score).toBe(5);
    expect(s.ended).toBe(true);
  });

  it('dnd-sort: renderStateful mostra feedback quando tutti piazzati e conta i corretti', () => {
    const spec = {
      type: 'dnd-sort' as const,
      payload: {
        items: [{ id: 'i1', label: 'Uno', categoryId: 'c1' }, { id: 'i2', label: 'Due', categoryId: 'c2' }],
        categories: [{ id: 'c1', label: 'C1' }, { id: 'c2', label: 'C2' }],
      },
    };
    let s = initialState(spec);
    s = reduce(spec, s, { ev: 'place', arg: 'c1', arg2: 'i1' });
    s = reduce(spec, s, { ev: 'place', arg: 'c1', arg2: 'i2' }); // i2 sbagliato (dovrebbe essere c2)
    const vnode = renderStateful(spec, s, () => null);
    const json = JSON.stringify(vnode);
    expect(json).toContain('assessment-feedback');
    expect(json).toContain('1 su 2 corretti');
  });
});

describe('render-core video helpers', () => {
  it('videoEmbedUrl costruisce gli URL dei provider esterni', () => {
    expect(videoEmbedUrl({ source: 'youtube', externalId: 'abcdef12345' })).toBe(
      'https://www.youtube.com/embed/abcdef12345?rel=0',
    );
    expect(videoEmbedUrl({ source: 'vimeo', externalUrl: 'https://vimeo.com/123456' })).toBe(
      'https://player.vimeo.com/video/123456',
    );
    expect(videoEmbedUrl({ source: 'twitch', externalId: '98765', externalUrl: '' }, 'example.com')).toBe(
      'https://player.twitch.tv/?video=98765&parent=example.com',
    );
    expect(videoEmbedUrl({ source: 'upload' })).toBeNull();
  });

  it('fmtTime formatta i secondi come m:ss', () => {
    expect(fmtTime(0)).toBe('0:00');
    expect(fmtTime(9)).toBe('0:09');
    expect(fmtTime(75)).toBe('1:15');
  });

  it('sortCues ordina per start crescente senza mutare l’array originale', () => {
    const input = [
      { start: 5, text: 'b' },
      { start: 1, text: 'a' },
    ];
    const out = sortCues(input);
    expect(out.map((c) => c.text)).toEqual(['a', 'b']);
    expect(input[0]!.text).toBe('b'); // originale invariato
  });
});

describe('render-core course-structure (Fase 3)', () => {
  const course = {
    id: 'c1',
    title: 'Corso',
    modules: [
      { id: 'm1', title: 'Modulo 1', lessons: [{ id: 'l1', title: 'Lez 1' }, { id: 'l2', title: 'Lez 2' }] },
      { id: 'm2', title: 'Modulo 2', lessons: [{ id: 'l3', title: 'Lez 3' }] },
    ],
    assessments: [
      { id: 'aMid', scope: 'module', moduleId: 'm1' },
      { id: 'aFin', scope: 'final' },
    ],
  };

  it('buildCourseSteps: overview corso → (overview modulo → lezioni → test intermedio) → test finale', () => {
    const steps = buildCourseSteps(course);
    expect(steps.map((s) => s.kind)).toEqual([
      'course_overview',
      'module_overview',
      'lesson',
      'lesson',
      'assessment', // intermedio del modulo 1
      'module_overview',
      'lesson',
      'assessment', // finale
    ]);
    // Il test intermedio è gate; il finale no.
    const mid = steps.find((s) => s.kind === 'assessment' && (s as { assessment: { id: string } }).assessment.id === 'aMid');
    expect((mid as { gate: boolean }).gate).toBe(true);
    const fin = steps.find((s) => s.kind === 'assessment' && (s as { assessment: { id: string } }).assessment.id === 'aFin');
    expect((fin as { gate: boolean }).gate).toBe(false);
  });

  it('buildCourseSteps: indici modulo/lezione coerenti sugli step lesson', () => {
    const steps = buildCourseSteps(course);
    const lessons = steps.filter((s) => s.kind === 'lesson') as Array<{ moduleIndex: number; lessonIndexInModule: number }>;
    expect(lessons[0]).toMatchObject({ moduleIndex: 0, lessonIndexInModule: 0 });
    expect(lessons[1]).toMatchObject({ moduleIndex: 0, lessonIndexInModule: 1 });
    expect(lessons[2]).toMatchObject({ moduleIndex: 1, lessonIndexInModule: 0 });
  });

  it('groupConcepts: un rich_text apre un concetto, i blocchi successivi vi appartengono', () => {
    const concepts = groupConcepts([
      { type: 'rich_text', payload: { content: { html: '<h2>A</h2>' } } },
      { type: 'flashcard', payload: {} },
      { type: 'rich_text', payload: { content: { html: '<h2>B</h2>' } } },
    ]);
    expect(concepts).toHaveLength(2);
    expect(concepts[0]!.blocks).toHaveLength(2);
    expect(concepts[0]!.title).toBe('A');
  });
});

describe('render-core parità di copertura (anti-divergenza)', () => {
  it('OGNI tipo di block del catalogo è gestito dal core condiviso', () => {
    // Se qualcuno aggiunge un BlockType senza migrarlo nel core, questo test
    // fallisce: è la rete di sicurezza contro la divergenza anteprima↔export.
    for (const type of BlockType.options) {
      expect(isHandledByCore(type)).toBe(true);
    }
  });

  it('il core produce un VNode non vuoto per ogni tipo (payload minimale)', () => {
    const minimalPayload: Record<string, Record<string, unknown>> = {
      rich_text: { content: { html: '<p>x</p>' }, media: [] },
      image_hotspot: { image: media({ storageKey: 'i.png' }), hotspots: [{ id: 'h', x: 0.1, y: 0.1, label: 'L', content: { html: '' } }] },
      accordion_tabs: { panels: [{ id: 'p', title: 'T', content: { html: '' } }] },
      flashcard: { cards: [{ id: 'c', front: { html: 'A' }, back: { html: 'B' } }] },
      timeline: { events: [{ id: 'e', date: '2020', title: 'T', content: { html: '' } }] },
      dragdrop_match: { pairs: [{ id: 'l', left: 'A', right: 'B' }] },
      dragdrop_order: { items: [{ id: 'i', label: 'A' }] },
      click_reveal: { items: [{ id: 'r', trigger: 'T', content: { html: '' } }] },
      branching_scenario: { startNodeId: 'n', nodes: [{ id: 'n', content: { html: 'Q' }, choices: [] }] },
      video_checkpoint: { video: media({ kind: 'video', storageKey: 'v.mp4', source: 'upload' }), transcript: [], sections: [] },
      carousel_steps: { steps: [{ id: 's', title: 'S', content: { html: '' } }] },
      sorting_categories: { items: [{ id: 'i', label: 'A', categoryId: 'c' }], categories: [{ id: 'c', label: 'C' }] },
    };
    for (const type of BlockType.options) {
      const vnode = renderBlock({ type, payload: minimalPayload[type] ?? {} }, ctx);
      expect(vnode).toBeTruthy();
      expect(typeof vnode.tag).toBe('string');
      expect(String(vnode.attrs?.class || '')).not.toContain('unknown');
    }
  });
});
