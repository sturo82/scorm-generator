/*
 * render-core/blocks/pillola-lesson.ts — Layout di LEZIONE "pillola": un
 * CONTENITORE SCORREVOLE coerente dove OGNI blocco è una CARD ben definita, con
 * una distinzione visiva netta tra blocchi di CONTENUTO (testo, slide, immagini,
 * video: "impara") e blocchi di AZIONE/interazione (quiz, flashcard, drag&drop,
 * scenario: "mettiti alla prova"). Ogni card ha un'etichetta di ruolo, così il
 * contenuto specifico e le azioni sono chiaramente distinti.
 *
 * Costruito con le primitive VNode del core → identico in anteprima (React) ed
 * export SCORM (DOM). Un'unica implementazione, due adapter.
 */

import { h, blockLabels, type VNode, type VChild, type RenderContext } from '../vnode.js';
import { renderBlock, type BlockLike } from '../registry.js';

/** Blocchi "azione/interazione": una card con stile ed etichetta dedicati. */
const ACTION_TYPES = new Set<string>([
  'flashcard',
  'dragdrop_match',
  'dragdrop_order',
  'click_reveal',
  'branching_scenario',
  'sorting_categories',
  'image_hotspot',
]);

/** Etichetta di ruolo della card, dalla lingua del corso. */
function cardKind(type: string): 'content' | 'action' {
  return ACTION_TYPES.has(type) ? 'action' : 'content';
}

/**
 * Costruisce il VNode della lezione pillola: contenitore scorrevole con una card
 * per blocco. `blocks` sono i block della lezione, nell'ordine (hook → core →
 * verifica → takeaway). Ogni card porta un'etichetta ("Contenuto"/"Attività").
 */
export function renderPillolaLesson(blocks: BlockLike[], ctx: RenderContext): VNode {
  const L = blockLabels(ctx);
  const children: VChild[] = [];
  blocks.forEach((b, i) => {
    // VIDEO-LEZIONE: se il PRIMO block è un video_checkpoint, è il video che È
    // la lezione → va reso come HERO a piena larghezza (protagonista), non come
    // una card tra le altre. I block successivi (takeaway, verifica) restano card.
    if (i === 0 && b.type === 'video_checkpoint') {
      children.push(h('div', { class: 'pillola-hero', 'data-block-index': '0' }, [renderBlock(b, ctx)]));
      return;
    }
    const kind = cardKind(b.type);
    const label = kind === 'action' ? L.tabActivities : L.tabContent;
    children.push(
      h(
        'section',
        {
          class: `pillola-card pillola-card--${kind}`,
          'data-block-kind': kind,
          'data-block-index': String(i),
        },
        [
          h('div', { class: 'pillola-card-head' }, [
            h('span', { class: 'pillola-card-badge' }, [label]),
          ]),
          h('div', { class: 'pillola-card-body' }, [renderBlock(b, ctx)]),
        ],
      ),
    );
  });
  return h('div', { class: 'lesson-pillola' }, children);
}
