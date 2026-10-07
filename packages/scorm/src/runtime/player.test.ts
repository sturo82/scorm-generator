import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { runtimeAssetPath } from './index.js';

/** Carica gli asset del runtime dentro una finestra jsdom (come nel browser). */
function loadRuntime(): JSDOM {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    runScripts: 'outside-only',
  });
  const win = dom.window as unknown as Record<string, unknown> & { eval: (s: string) => void };
  for (const file of ['render-core.js', 'scorm-api.js', 'scoring.js', 'renderers.js', 'player.js']) {
    win.eval(readFileSync(runtimeAssetPath(file as never), 'utf8'));
  }
  return dom;
}

const course = {
  id: 'c1',
  title: 'Corso di prova',
  modules: [
    {
      id: 'm1',
      title: 'Modulo 1',
      lessons: [
        {
          id: 'l1',
          title: 'Lezione 1',
          blocks: [
            { id: 'b1', type: 'rich_text', payload: { content: { format: 'html', html: '<p>Benvenuti</p>' }, media: [] } },
            {
              id: 'b2',
              type: 'flashcard',
              payload: { cards: [{ id: 'cc', front: { format: 'html', html: '<p>Q</p>' }, back: { format: 'html', html: '<p>A</p>' } }] },
            },
          ],
        },
        { id: 'l2', title: 'Lezione 2', blocks: [] },
      ],
    },
  ],
};

describe('Player (jsdom)', () => {
  let dom: JSDOM;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let win: any;

  beforeEach(() => {
    dom = loadRuntime();
    win = dom.window;
  });

  it('renderizza la prima lezione con i suoi block', () => {
    const root = win.document.getElementById('root');
    const player = new win.Player(course, { scorm: null, root });
    // Step 0 = panoramica corso, 1 = panoramica modulo, 2 = prima lezione.
    // Le panoramiche si auto-completano alla visualizzazione; qui le marchiamo
    // per poter navigare direttamente alla lezione (il gating lo richiede).
    player.completed['overview:course'] = true;
    player.completed['overview:mod:m1'] = true;
    player.go(2);
    // Il titolo del corso è nell'header sempre visibile (topbar).
    expect(root.querySelector('.topbar-title')?.textContent).toBe('Corso di prova');
    expect(root.textContent).toContain('Benvenuti');
    expect(root.querySelector('.flashcard')).toBeTruthy();
  });

  it('mostra l’header del corso sempre visibile (titolo + docente)', () => {
    const root = win.document.getElementById('root');
    const withInstructor = { ...course, instructor: { name: 'Mario Rossi', role: 'Formatore' } };
    new win.Player(withInstructor, { scorm: null, root }).render();
    const topbar = root.querySelector('.course-topbar');
    expect(topbar).toBeTruthy();
    expect(topbar.querySelector('.topbar-title')?.textContent).toBe('Corso di prova');
    expect(topbar.querySelector('.topbar-instructor')?.textContent).toContain('Mario Rossi');
    expect(topbar.querySelector('.topbar-instructor')?.textContent).toContain('Formatore');
  });

  it('applica data-motion sul root in base a interactionStyle del corso', () => {
    const root = win.document.getElementById('root');
    // Default: 'sober' quando il campo manca.
    new win.Player(course, { scorm: null, root }).render();
    expect(root.getAttribute('data-motion')).toBe('sober');
    // 'lively' quando richiesto.
    new win.Player({ ...course, interactionStyle: 'lively' }, { scorm: null, root }).render();
    expect(root.getAttribute('data-motion')).toBe('lively');
  });

  it('raggruppa i blocchi in concetti e naviga tra loro (slide, default)', () => {
    const multi = {
      ...course,
      modules: [
        {
          id: 'm1',
          title: 'Modulo 1',
          lessons: [
            {
              id: 'lx',
              title: 'Lezione X',
              blocks: [
                { id: 'c1', type: 'rich_text', payload: { content: { format: 'html', html: '<h2>Concetto A</h2>' } } },
                { id: 'c1b', type: 'flashcard', payload: { cards: [{ id: 'z', front: { format: 'html', html: 'f' }, back: { format: 'html', html: 'b' } }] } },
                { id: 'c2', type: 'rich_text', payload: { content: { format: 'html', html: '<h2>Concetto B</h2>' } } },
              ],
            },
          ],
        },
      ],
    };
    const root = win.document.getElementById('root');
    const player = new win.Player(multi, { scorm: null, root });
    // Vai alla lezione (step 2), saltando le panoramiche corso/modulo.
    player.completed['overview:course'] = true;
    player.completed['overview:mod:m1'] = true;
    player.go(2);
    // Stepper con 2 concetti e nav intra-lezione presenti.
    expect(root.querySelectorAll('.concept-dot').length).toBe(2);
    // In slide mode si vede un solo concetto per volta: il primo (Concetto A).
    expect(root.textContent).toContain('Concetto A');
    expect(root.textContent).not.toContain('Concetto B');
    // Avanza al concetto successivo.
    const next = root.querySelector('.concept-next');
    expect(next).toBeTruthy();
    next.dispatchEvent(new win.Event('click'));
    expect(root.textContent).toContain('Concetto B');
  });

  it('offre il selettore delle 3 modalità di visualizzazione', () => {
    const root = win.document.getElementById('root');
    const player = new win.Player(course, { scorm: null, root });
    player.completed['overview:course'] = true;
    player.completed['overview:mod:m1'] = true;
    player.go(2); // il selettore modalità appare sulle lezioni, non sulle panoramiche
    expect(root.querySelectorAll('.view-toggle-btn').length).toBe(3);
  });

  it('la flashcard ha due facce (flip 3D) e il click alterna aria-pressed', () => {
    const root = win.document.getElementById('root');
    const player = new win.Player(course, { scorm: null, root });
    player.completed['overview:course'] = true;
    player.completed['overview:mod:m1'] = true;
    player.go(2); // la flashcard è nella prima lezione (step 2)
    const card = root.querySelector('.flashcard');
    expect(card).toBeTruthy();
    // Entrambe le facce presenti nel DOM (requisito del flip CSS a due facce).
    expect(root.querySelector('.flashcard-face.is-front')).toBeTruthy();
    expect(root.querySelector('.flashcard-face.is-back')).toBeTruthy();
    expect(card.getAttribute('aria-pressed')).toBe('false');
    card.dispatchEvent(new win.Event('click'));
    expect(card.getAttribute('aria-pressed')).toBe('true');
  });

  it('il gating blocca l’avanzamento su uno step non completo (assessment)', () => {
    // Si usa un assessment come step di gate: a differenza di una lezione (che in
    // jsdom risulta "scrollata" perché il layout ha dimensioni 0), un test non si
    // auto-completa, quindi è adatto a verificare il blocco dell'avanzamento.
    const withTest = {
      ...course,
      assessments: [
        { id: 'a1', scope: 'intermediate', moduleId: 'm1', title: 'Test', masteryScore: 0.5, questions: [{ id: 'q1', type: 'true_false', answer: true, points: 1 }] },
      ],
    };
    const root = win.document.getElementById('root');
    const player = new win.Player(withTest, { scorm: null, root });
    // Step: 0 panoramica corso, 1 panoramica modulo, 2-3 lezioni, 4 assessment.
    player.completed['overview:course'] = true;
    player.completed['overview:mod:m1'] = true;
    player.completed['lesson:l1'] = true;
    player.completed['lesson:l2'] = true;
    player.go(4); // all'assessment (step di gate, non completo)
    expect(player.index).toBe(4);
    // Lo step assessment non è completo: non si può avanzare oltre (è l'ultimo,
    // ma il pulsante "Completa corso" resta disabilitato).
    expect(player.isStepComplete(4)).toBe(false);
  });

  it('inserisce gli assessment intermedi come step dopo il modulo (gate)', () => {
    const withTest = {
      ...course,
      assessments: [
        { id: 'a1', scope: 'intermediate', moduleId: 'm1', title: 'Test modulo 1', masteryScore: 0.5, questions: [{ id: 'q1', type: 'true_false', answer: true, points: 1 }] },
      ],
    };
    const player = new win.Player(withTest, { scorm: null, root: win.document.getElementById('root') });
    // 1 panoramica corso + 1 panoramica modulo + 2 lezioni + 1 assessment = 5 step;
    // l'ultimo è l'assessment con gate.
    expect(player.steps.length).toBe(5);
    expect(player.steps[4].kind).toBe('assessment');
    expect(player.steps[4].gate).toBe(true);
  });

  it('un assessment è completo solo se superato (gating sul test)', () => {
    const store: Record<string, string> = {};
    const scorm = {
      setScore: (scaled: number, raw: number) => { store.scaled = String(scaled); store.raw = String(raw); },
      setOutcome: (c: boolean, p: boolean) => { store.completed = String(c); store.passed = String(p); },
      commit: () => true,
    };
    const withTest = {
      ...course,
      assessments: [
        { id: 'a1', scope: 'intermediate', moduleId: 'm1', title: 'Test', masteryScore: 0.5, questions: [{ id: 'q1', type: 'true_false', answer: true, points: 1 }] },
      ],
    };
    const root = win.document.getElementById('root');
    const player = new win.Player(withTest, { scorm, root });
    player.completed['overview:course'] = true;
    player.completed['overview:mod:m1'] = true;
    player.completed['lesson:l1'] = true;
    player.completed['lesson:l2'] = true;
    player.go(4); // vai all'assessment (index 4)
    expect(root.querySelector('.assessment')).toBeTruthy();
    // Risposta sbagliata: non completa, non supera il gate.
    const falseRadio = Array.from(root.querySelectorAll('input[type=radio]')).find((r: any) => r.value === 'false') as any;
    falseRadio.checked = true;
    falseRadio.dispatchEvent(new win.Event('change'));
    (root.querySelector('.assessment-submit') as any).dispatchEvent(new win.Event('click'));
    expect(player.completed['assess:a1']).toBeFalsy();
    // Risposta giusta: supera, completa il gate e riporta allo SCORM.
    const trueRadio = Array.from(root.querySelectorAll('input[type=radio]')).find((r: any) => r.value === 'true') as any;
    trueRadio.checked = true;
    trueRadio.dispatchEvent(new win.Event('change'));
    (root.querySelector('.assessment-submit') as any).dispatchEvent(new win.Event('click'));
    expect(player.completed['assess:a1']).toBe(true);
    expect(store.passed).toBe('true');
  });
});

describe('Renderers (jsdom)', () => {
  it('renderizza un accordion accessibile con aria-expanded', () => {
    const dom = loadRuntime();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = dom.window as any;
    const node = win.Renderers.renderBlock({
      type: 'accordion_tabs',
      payload: { variant: 'accordion', panels: [{ id: 'p1', title: 'Sezione', content: { format: 'html', html: '<p>x</p>' } }] },
    });
    const btn = node.querySelector('.accordion-head');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    btn.dispatchEvent(new win.Event('click'));
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });
});
