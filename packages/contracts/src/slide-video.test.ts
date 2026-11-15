import { SlideVideoSpec, activeCueAt, computeSlideTimeline, globalCues } from './slide-video.js';

describe('computeSlideTimeline', () => {
  it('concatena le slide in sequenza senza buchi', () => {
    const t = computeSlideTimeline([{ durationSec: 2 }, { durationSec: 3 }], 30);
    expect(t.entries[0]).toMatchObject({ startFrame: 0, durationFrames: 60, startSec: 0, endSec: 2 });
    expect(t.entries[1]).toMatchObject({ startFrame: 60, durationFrames: 90, startSec: 2, endSec: 5 });
    expect(t.totalFrames).toBe(150);
    expect(t.totalSec).toBe(5);
  });

  it('non accumula deriva di arrotondamento su molte slide', () => {
    // 29 slide da 17.37s: arrotondare ogni durata singola farebbe derivare il
    // totale; arrotondando i cumulativi resta entro 1 frame dalla somma reale.
    const slides = Array.from({ length: 29 }, () => ({ durationSec: 17.37 }));
    const fps = 30;
    const t = computeSlideTimeline(slides, fps);
    const exact = 29 * 17.37 * fps;
    expect(Math.abs(t.totalFrames - exact)).toBeLessThanOrEqual(1);
    // Contiguità: ogni slide inizia dove finisce la precedente.
    for (let i = 1; i < t.entries.length; i++) {
      expect(t.entries[i]!.startFrame).toBe(t.entries[i - 1]!.startFrame + t.entries[i - 1]!.durationFrames);
    }
  });

  it('garantisce almeno 1 frame anche per durate minuscole', () => {
    const t = computeSlideTimeline([{ durationSec: 0.001 }, { durationSec: 1 }], 30);
    expect(t.entries[0]!.durationFrames).toBeGreaterThanOrEqual(1);
    expect(t.entries[1]!.startFrame).toBe(t.entries[0]!.durationFrames);
  });
});

describe('globalCues', () => {
  const slides = [
    { durationSec: 4, cues: [{ start: 0, end: 2, text: 'Uno' }, { start: 2, end: 4, text: 'Due' }], narration: undefined },
    { durationSec: 3, cues: [{ start: 0.5, end: 2.5, text: 'Tre' }], narration: undefined },
  ];

  it('somma l\'offset di inizio della slide', () => {
    const t = computeSlideTimeline(slides, 30);
    const cues = globalCues(slides, t);
    expect(cues.map((c) => [c.text, c.start, c.end, c.slideIndex])).toEqual([
      ['Uno', 0, 2, 0],
      ['Due', 2, 4, 0],
      ['Tre', 4.5, 6.5, 1],
    ]);
  });

  it('taglia le cue alla finestra della propria slide', () => {
    const s = [{ durationSec: 2, cues: [{ start: 1, end: 9, text: 'Troppo lunga' }], narration: undefined }, { durationSec: 2, cues: [], narration: undefined }];
    const t = computeSlideTimeline(s, 30);
    const [c] = globalCues(s, t);
    expect(c!.end).toBe(2); // non invade la slide 2
  });

  it('ripiega sulla narrazione come unica cue se la clip non ha sottotitoli', () => {
    const s = [{ durationSec: 5, cues: [], narration: '  Testo narrato.  ' }];
    const t = computeSlideTimeline(s, 30);
    expect(globalCues(s, t)).toEqual([{ id: 'cue-0', start: 0, end: 5, text: 'Testo narrato.', slideIndex: 0 }]);
  });

  it('ignora cue vuote e slide senza testo', () => {
    const s = [{ durationSec: 2, cues: [{ start: 0, end: 1, text: '   ' }], narration: undefined }];
    const t = computeSlideTimeline(s, 30);
    expect(globalCues(s, t)).toEqual([]);
  });
});

describe('activeCueAt', () => {
  const cues = [
    { id: 'a', start: 0, end: 2, text: 'A', slideIndex: 0 },
    { id: 'b', start: 3, end: 5, text: 'B', slideIndex: 0 },
  ];
  it('trova la cue attiva e null nei vuoti', () => {
    expect(activeCueAt(cues, 1)?.id).toBe('a');
    expect(activeCueAt(cues, 2.5)).toBeNull();
    expect(activeCueAt(cues, 3)?.id).toBe('b');
    expect(activeCueAt(cues, 5)).toBeNull();
  });
});

describe('SlideVideoSpec', () => {
  it('applica i default (split, 1920x1080@30) e valida le slide', () => {
    const spec = SlideVideoSpec.parse({
      slides: [{ id: 's1', imageUrl: 'https://x/1.png', clipUrl: 'https://x/1.mp4', durationSec: 12.5 }],
    });
    expect(spec.layout).toBe('split');
    expect(spec.canvas).toEqual({ width: 1920, height: 1080, fps: 30 });
    expect(spec.slides[0]!.cues).toEqual([]);
  });

  it('rifiuta uno spec senza slide o con durata non positiva', () => {
    expect(SlideVideoSpec.safeParse({ slides: [] }).success).toBe(false);
    expect(
      SlideVideoSpec.safeParse({ slides: [{ id: 's', imageUrl: 'u', clipUrl: 'c', durationSec: 0 }] }).success,
    ).toBe(false);
  });
});
