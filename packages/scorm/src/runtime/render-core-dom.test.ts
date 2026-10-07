import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { runtimeAssetPath } from './index.js';

/**
 * Verifica che il bundle IIFE del renderer condiviso (render-core.js, generato
 * da esbuild) esponga window.RenderCore in un ambiente browser (jsdom) e che
 * renderers.js deleghi correttamente i tipi migrati (rich_text) al core,
 * producendo gli stessi nodi DOM/classi di prima.
 */
function loadWithCore(): JSDOM {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    runScripts: 'outside-only',
  });
  const win = dom.window as unknown as Record<string, unknown> & { eval: (s: string) => void };
  for (const file of ['render-core.js', 'scorm-api.js', 'scoring.js', 'renderers.js']) {
    win.eval(readFileSync(runtimeAssetPath(file as never), 'utf8'));
  }
  return dom;
}

describe('render-core.js (bundle IIFE) nel runtime SCORM', () => {
  let dom: JSDOM;
  beforeEach(() => {
    dom = loadWithCore();
  });

  it('espone window.RenderCore con le API attese', () => {
    const w = dom.window as unknown as { RenderCore?: Record<string, unknown> };
    expect(w.RenderCore).toBeTruthy();
    expect(typeof w.RenderCore!.renderBlock).toBe('function');
    expect(typeof w.RenderCore!.isHandledByCore).toBe('function');
    expect(typeof w.RenderCore!.renderBlockDom).toBe('function');
  });

  it('rich_text è gestito dal core e renderizzato via Renderers.renderBlock', () => {
    const w = dom.window as unknown as {
      RenderCore: { isHandledByCore: (t: string) => boolean };
      Renderers: { renderBlock: (b: unknown) => HTMLElement };
    };
    expect(w.RenderCore.isHandledByCore('rich_text')).toBe(true);
    const node = w.Renderers.renderBlock({
      type: 'rich_text',
      payload: {
        content: { format: 'html', html: '<p>Benvenuti</p>' },
        media: [{ kind: 'image', storageKey: '../media/asset-1.png', alt: 'Logo', source: 'upload' }],
      },
    });
    expect(node.className).toBe('block');
    const rich = node.querySelector('.block-rich');
    expect(rich).toBeTruthy();
    expect(rich!.innerHTML).toContain('<p>Benvenuti</p>');
    const img = node.querySelector('img.block-media') as HTMLImageElement | null;
    expect(img).toBeTruthy();
    expect(img!.getAttribute('src')).toBe('../media/asset-1.png');
    expect(img!.getAttribute('alt')).toBe('Logo');
  });

  it('un tipo NON ancora migrato ricade sul renderer legacy (nessuna rottura)', () => {
    const w = dom.window as unknown as {
      Renderers: { renderBlock: (b: unknown) => HTMLElement };
    };
    const node = w.Renderers.renderBlock({
      type: 'branching_scenario',
      payload: { startNodeId: 'n1', nodes: [{ id: 'n1', content: { format: 'html', html: 'Start' }, choices: [] }] },
    });
    expect(node.className).toContain('scenario');
  });

  it('behavior flashcard: il click gira la carta (aria-pressed)', () => {
    const w = dom.window as unknown as { Renderers: { renderBlock: (b: unknown) => HTMLElement } };
    const node = w.Renderers.renderBlock({
      type: 'flashcard',
      payload: { cards: [{ id: 'c1', front: { format: 'html', html: 'A' }, back: { format: 'html', html: 'B' } }] },
    });
    const btn = node.querySelector('button.flashcard') as HTMLButtonElement;
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    btn.click();
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    btn.click();
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('behavior accordion: il click apre/chiude il corpo (aria-expanded + hidden)', () => {
    const w = dom.window as unknown as { Renderers: { renderBlock: (b: unknown) => HTMLElement } };
    const node = w.Renderers.renderBlock({
      type: 'accordion_tabs',
      payload: { panels: [{ id: 'p1', title: 'Uno', content: { format: 'html', html: '<p>corpo</p>' } }] },
    });
    const head = node.querySelector('.accordion-head') as HTMLButtonElement;
    const body = node.querySelector('.accordion-body') as HTMLElement;
    expect(body.hasAttribute('hidden')).toBe(true);
    head.click();
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(body.hasAttribute('hidden')).toBe(false);
  });

  it('behavior carousel: next mostra lo slide successivo e aggiorna lo stato', () => {
    const w = dom.window as unknown as { Renderers: { renderBlock: (b: unknown) => HTMLElement } };
    const node = w.Renderers.renderBlock({
      type: 'carousel_steps',
      payload: { steps: [{ title: 'S1' }, { title: 'S2' }] },
    });
    const slides = node.querySelectorAll('[data-carousel-slide]');
    const status = node.querySelector('[data-carousel-status]') as HTMLElement;
    const next = node.querySelector('[data-carousel-next]') as HTMLButtonElement;
    expect(slides[0]!.hasAttribute('hidden')).toBe(false);
    expect(slides[1]!.hasAttribute('hidden')).toBe(true);
    expect(status.textContent).toBe('Passo 1 di 2');
    next.click();
    expect(slides[1]!.hasAttribute('hidden')).toBe(false);
    expect(status.textContent).toBe('Passo 2 di 2');
  });

  it('behavior hotspot: il click sul punto mostra il box info con il contenuto', () => {
    const w = dom.window as unknown as { Renderers: { renderBlock: (b: unknown) => HTMLElement } };
    const node = w.Renderers.renderBlock({
      type: 'image_hotspot',
      payload: {
        image: { kind: 'image', storageKey: '../media/a.png', alt: '', source: 'upload' },
        hotspots: [{ id: 'h1', x: 0.5, y: 0.5, label: 'Punto 1', content: { format: 'html', html: '<p>dettaglio</p>' } }],
      },
    });
    const dot = node.querySelector('[data-hotspot-dot]') as HTMLButtonElement;
    const info = node.querySelector('[data-hotspot-info]') as HTMLElement;
    expect(info.hasAttribute('hidden')).toBe(true);
    dot.click();
    expect(dot.getAttribute('aria-pressed')).toBe('true');
    expect(info.hasAttribute('hidden')).toBe(false);
    expect(info.innerHTML).toContain('dettaglio');
  });

  it('behavior stateful (sorting): click su chip poi su bucket piazza l’elemento', () => {
    const w = dom.window as unknown as { Renderers: { renderBlock: (b: unknown) => HTMLElement } };
    const node = w.Renderers.renderBlock({
      type: 'sorting_categories',
      payload: {
        items: [{ id: 'i1', label: 'Mela', categoryId: 'c1' }],
        categories: [{ id: 'c1', label: 'Frutta' }],
      },
    });
    const host = node.querySelector('[data-stateful]') as HTMLElement;
    const chip = host.querySelector('[data-ev="pick"]') as HTMLButtonElement;
    chip.click(); // pick i1
    const bucket = host.querySelector('[data-dnd-bucket="c1"]') as HTMLElement;
    bucket.click(); // place in c1
    // Dopo il piazzamento (tutti piazzati) compare il feedback.
    expect(host.querySelector('.assessment-feedback')).toBeTruthy();
    expect(host.textContent).toContain('Tutto corretto');
  });

  it('behavior stateful (scenario): scegliere una choice naviga al nodo successivo', () => {
    const w = dom.window as unknown as { Renderers: { renderBlock: (b: unknown) => HTMLElement } };
    const node = w.Renderers.renderBlock({
      type: 'branching_scenario',
      payload: {
        startNodeId: 'n1',
        nodes: [
          { id: 'n1', content: { format: 'html', html: '<p>Domanda</p>' }, choices: [{ id: 'c1', label: 'Vai', nextNodeId: 'n2' }] },
          { id: 'n2', content: { format: 'html', html: '<p>Arrivato</p>' }, choices: [] },
        ],
      },
    });
    const host = node.querySelector('[data-stateful]') as HTMLElement;
    expect(host.textContent).toContain('Domanda');
    (host.querySelector('[data-ev="choose"]') as HTMLButtonElement).click();
    expect(host.textContent).toContain('Arrivato');
    expect(host.textContent).toContain('Fine scenario');
  });

  it('parità DOM: ogni tipo di block è montato dal core (nessun fallback "unknown")', () => {
    const w = dom.window as unknown as {
      Renderers: { renderBlock: (b: unknown) => HTMLElement };
      RenderCore: { isHandledByCore: (t: string) => boolean };
    };
    const payloads: Record<string, Record<string, unknown>> = {
      rich_text: { content: { format: 'html', html: '<p>x</p>' }, media: [] },
      image_hotspot: { image: { kind: 'image', storageKey: 'i.png', source: 'upload' }, hotspots: [{ id: 'h', x: 0.1, y: 0.1, label: 'L', content: { html: '' } }] },
      accordion_tabs: { panels: [{ id: 'p', title: 'T', content: { html: '' } }] },
      flashcard: { cards: [{ id: 'c', front: { html: 'A' }, back: { html: 'B' } }] },
      timeline: { events: [{ id: 'e', date: '2020', title: 'T', content: { html: '' } }] },
      dragdrop_match: { pairs: [{ id: 'l', left: 'A', right: 'B' }] },
      dragdrop_order: { items: [{ id: 'i', label: 'A' }] },
      click_reveal: { items: [{ id: 'r', trigger: 'T', content: { html: '' } }] },
      branching_scenario: { startNodeId: 'n', nodes: [{ id: 'n', content: { html: 'Q' }, choices: [] }] },
      video_checkpoint: { video: { kind: 'video', storageKey: 'v.mp4', source: 'upload' }, transcript: [], sections: [] },
      carousel_steps: { steps: [{ id: 's', title: 'S', content: { html: '' } }] },
      sorting_categories: { items: [{ id: 'i', label: 'A', categoryId: 'c' }], categories: [{ id: 'c', label: 'C' }] },
    };
    for (const type of Object.keys(payloads)) {
      expect(w.RenderCore.isHandledByCore(type)).toBe(true);
      const node = w.Renderers.renderBlock({ type, payload: payloads[type] });
      expect(node).toBeTruthy();
      expect(node.className).not.toContain('unknown');
    }
  });

  it('behavior video-karaoke: click su una cue imposta currentTime (seek)', () => {
    const w = dom.window as unknown as { Renderers: { renderBlock: (b: unknown) => HTMLElement } };
    const node = w.Renderers.renderBlock({
      type: 'video_checkpoint',
      payload: {
        video: { kind: 'video', storageKey: '../media/v.mp4', source: 'upload', alt: '' },
        transcript: [
          { id: 'c0', start: 0, end: 2, text: 'Zero' },
          { id: 'c1', start: 5, end: 7, text: 'Cinque' },
        ],
        transcriptStatus: 'ready',
        sections: [],
      },
    });
    const video = node.querySelector('[data-video-el]') as HTMLVideoElement;
    const cues = node.querySelectorAll('.transcript-cue');
    expect(cues.length).toBe(2);
    (cues[1] as HTMLButtonElement).click();
    expect(video.currentTime).toBe(5);
  });
});
