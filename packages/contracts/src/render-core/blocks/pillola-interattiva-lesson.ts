/*
 * render-core/blocks/pillola-interattiva-lesson.ts — Layout di LEZIONE "pillola
 * interattiva" (libro-game): la lezione è un unico percorso a scene con scelte
 * che, per vie diverse, portano alla risoluzione o meno di una situazione. È
 * costruita attorno al block `branching_scenario` (modalità pillole): un player
 * a tutto riquadro con il mini-video della scena e le scelte in overlay.
 *
 * Il contenitore monta il branching_scenario a piena larghezza; gli eventuali
 * altri block (introduzione/testo) vengono resi sopra, in forma compatta. Se non
 * c'è uno scenario, ripiega sul rendering lineare dei block (robustezza).
 *
 * Costruito con le primitive VNode del core → identico in anteprima (React) ed
 * export SCORM (DOM). Un'unica implementazione, due adapter.
 */

import { h, type VNode, type VChild, type RenderContext } from '../vnode.js';
import { renderBlock, type BlockLike } from '../registry.js';

/**
 * Costruisce il VNode della lezione pillola interattiva: lo scenario (libro-game)
 * a tutto riquadro, preceduto dagli eventuali block non-scenario (es. un breve
 * testo introduttivo). `blocks` sono i block della lezione, nell'ordine.
 */
export function renderPillolaInterattivaLesson(blocks: BlockLike[], ctx: RenderContext): VNode {
  const scenario = blocks.find((b) => b.type === 'branching_scenario');
  const intro = blocks.filter((b) => b !== scenario);

  const children: VChild[] = [];
  // Block introduttivi (opzionali): testo/immagini prima del libro-game.
  for (const b of intro) {
    children.push(h('div', { class: 'pillola-interattiva-intro' }, [renderBlock(b, ctx)]));
  }
  if (scenario) {
    children.push(h('div', { class: 'pillola-interattiva-stage' }, [renderBlock(scenario, ctx)]));
  }
  return h('div', { class: 'lesson-pillola-interattiva' }, children);
}
