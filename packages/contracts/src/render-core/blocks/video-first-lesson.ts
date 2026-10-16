/*
 * render-core/blocks/video-first-lesson.ts — Layout di LEZIONE video-first a
 * DUE COLONNE (approccio a livello di pagina/lezione): a sinistra il video a
 * tutta altezza, a destra una BARRA VERTICALE A TAB che aggrega:
 *   - Trascrizione (karaoke): cue cliccabili con evidenziazione sincronizzata;
 *   - Contenuto: il testo del concetto (block rich_text) + le sezioni del video;
 *   - una tab per OGNI interazione del concetto (flashcard, accordion, timeline,
 *     dragdrop, click_reveal, scenario, sorting, hotspot, carousel…).
 *
 * È costruito con le stesse primitive VNode del resto del core, quindi funziona
 * identico in anteprima (React) ed export SCORM (DOM): un'unica implementazione.
 * Il tutto è avvolto nel behavior 'video-karaoke', che gli adapter interpretano
 * come: switch delle tab (data-tab-btn/data-tab-panel) + seek/karaoke sul
 * <video data-video-el> tramite le righe .transcript-cue (data-seek). Essendo
 * root-scoped, non collide con eventuali altri gruppi di tab nella pagina.
 */

import type { MediaRef } from '../../primitives.js';
import { h, hHtml, withBehavior, blockLabels, type VNode, type VChild, type RenderContext } from '../vnode.js';
import { videoEmbedUrl, fmtTime, sortCues, type TranscriptCueLike } from '../video.js';
import { renderBlock, type BlockLike } from '../registry.js';

interface RichLike {
  html?: string;
}
interface VideoSection {
  id: string;
  title: string;
  content?: RichLike;
}

/** Tipi di block considerati "interazioni/attività" (una tab ciascuno). */
const INTERACTION_TYPES = new Set<string>([
  'flashcard',
  'accordion_tabs',
  'timeline',
  'dragdrop_match',
  'dragdrop_order',
  'click_reveal',
  'branching_scenario',
  'sorting_categories',
  'image_hotspot',
  'carousel_steps',
]);

/** Etichetta breve per la tab di un'interazione, dalla lingua del corso. */
function interactionTabLabel(count: number, index: number, L: ReturnType<typeof blockLabels>): string {
  // Una sola attività: "Attività". Più attività: "Attività 1", "Attività 2", …
  return count === 1 ? L.tabActivities : `${L.tabActivities} ${index + 1}`;
}

/**
 * Costruisce il VNode della lezione video-first a due colonne.
 * `blocks` sono i block della lezione (incluso UN video_checkpoint). Se non c'è
 * un video_checkpoint, ricade su un rendering lineare dei block (nessun layout
 * speciale), così la funzione è sempre sicura da chiamare.
 */
export function renderVideoFirstLesson(blocks: BlockLike[], ctx: RenderContext): VNode {
  const L = blockLabels(ctx);
  const videoBlock = blocks.find((b) => b.type === 'video_checkpoint');

  // Nessun video: fallback a rendering lineare (robustezza, non dovrebbe capitare).
  if (!videoBlock) {
    return h('div', { class: 'lesson-videofirst' }, blocks.map((b) => renderBlock(b, ctx)));
  }

  const payload = videoBlock.payload || {};
  const vid = (payload.video as MediaRef) || ({} as MediaRef);
  const transcript = sortCues((payload.transcript as TranscriptCueLike[]) || []);
  const transcriptStatus = (payload.transcriptStatus as string) || 'none';
  const sections = (payload.sections as VideoSection[]) || [];

  const src = ctx.resolveMedia(vid);
  const embed = videoEmbedUrl(vid);
  const alt = vid.alt || '';
  const hasVideo = !!src || !!embed;

  // --- Colonna video (sinistra) ---
  const videoInner: VChild[] = [];
  if (embed) {
    videoInner.push(
      h('div', { class: 'video-frame' }, [
        h('iframe', {
          src: embed,
          title: alt || L.videoAlt,
          allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
          allowfullscreen: 'allowfullscreen',
          frameborder: '0',
        }),
      ]),
    );
  } else if (src) {
    videoInner.push(
      h('div', { class: 'video-frame' }, [
        h('video', {
          controls: 'controls',
          preload: 'metadata',
          playsinline: 'playsinline',
          src,
          'data-video-el': '',
        }),
      ]),
    );
  } else {
    videoInner.push(
      h('div', { class: 'video-placeholder', role: 'img', 'aria-label': alt || L.videoAlt }, [
        '▶ ' + (alt || L.videoComing),
      ]),
    );
  }
  if (alt && hasVideo) videoInner.push(h('p', { class: 'video-alt' }, [alt]));
  const videoCol = h('div', { class: 'video-col' }, videoInner);

  // --- Barra tab verticale (destra) ---
  // Raccoglie le tab in ordine: Contenuto (rich_text + sezioni) → Attività
  // (una per interazione) → Trascrizione (karaoke).
  const tabs: Array<{ id: string; label: string }> = [];
  const panels: VChild[] = [];

  // 1) Contenuto: tutti i block rich_text della lezione + le sezioni del video.
  const richBlocks = blocks.filter((b) => b.type === 'rich_text');
  if (richBlocks.length > 0 || sections.length > 0) {
    const contentChildren: VChild[] = [];
    richBlocks.forEach((b) => contentChildren.push(renderBlock(b, ctx)));
    sections.forEach((s) => {
      if (s.title) contentChildren.push(h('h4', { class: 'vf-section-title' }, [s.title]));
      contentChildren.push(hHtml('div', { class: 'vf-section-body' }, s.content?.html || ''));
    });
    tabs.push({ id: 'vf-content', label: L.tabContent });
    panels.push(
      h('div', { class: 'video-panel-body', 'data-tab-panel': 'vf-content' }, contentChildren),
    );
  }

  // 2) Attività: una tab per ogni block di interazione.
  const interactionBlocks = blocks.filter((b) => INTERACTION_TYPES.has(b.type));
  interactionBlocks.forEach((b, i) => {
    const tabId = `vf-act-${b.id ?? i}`;
    tabs.push({ id: tabId, label: interactionTabLabel(interactionBlocks.length, i, L) });
    panels.push(
      h('div', { class: 'video-panel-body', 'data-tab-panel': tabId }, [renderBlock(b, ctx)]),
    );
  });

  // 3) Trascrizione (karaoke): presente se ci sono cue o è in elaborazione.
  const hasTranscript = transcript.length > 0 || transcriptStatus === 'processing';
  if (hasTranscript) {
    tabs.push({ id: 'vf-transcript', label: L.transcript });
    panels.push(transcriptPanel(transcript, transcriptStatus, L));
  }

  // Nessuna tab (lezione video senza contenuti a lato): mostra solo il video.
  if (tabs.length === 0) {
    const only = h('div', { class: 'block video' }, [videoCol]);
    return withBehavior(only, { kind: 'video-karaoke' });
  }

  // Prima tab attiva: marca aria-selected/is-active sui bottoni e togli hidden
  // dal pannello corrispondente.
  const activeId = tabs[0]!.id;
  const tablist = h(
    'div',
    { class: 'video-tabs vf-tabs-vertical', role: 'tablist' },
    tabs.map((t) =>
      h(
        'button',
        {
          class: 'video-tab' + (t.id === activeId ? ' is-active' : ''),
          type: 'button',
          role: 'tab',
          'aria-selected': t.id === activeId ? 'true' : 'false',
          'data-tab-btn': t.id,
        },
        [t.label],
      ),
    ),
  );
  // Applica hidden ai pannelli non attivi.
  const panelsWithHidden = panels.map((p) => {
    if (p && typeof p === 'object' && 'attrs' in p) {
      const node = p as VNode;
      const id = node.attrs?.['data-tab-panel'];
      if (id !== undefined && id !== activeId) {
        node.attrs = { ...(node.attrs || {}), hidden: 'hidden' };
      }
    }
    return p;
  });

  const panel = h('aside', { class: 'video-panel vf-panel' }, [tablist, ...panelsWithHidden]);

  const container = h('div', { class: 'block video video-withpanel lesson-videofirst-vnext' }, [
    videoCol,
    panel,
  ]);
  return withBehavior(container, { kind: 'video-karaoke' });
}

/** Pannello della trascrizione: righe cliccabili (seek) con tempo e testo. */
function transcriptPanel(
  transcript: TranscriptCueLike[],
  status: string,
  labels: ReturnType<typeof blockLabels>,
): VNode {
  let inner: VChild[];
  if (status === 'processing') {
    inner = [h('p', { class: 'video-transcript-empty' }, [labels.transcriptProcessing])];
  } else if (transcript.length > 0) {
    const rows: VChild[] = transcript.map((cue, i) => {
      const cells: VChild[] = [h('span', { class: 'cue-time' }, [fmtTime(cue.start)])];
      if (cue.speaker) cells.push(h('span', { class: 'cue-speaker' }, [cue.speaker + ': ']));
      cells.push(cue.text);
      return h(
        'button',
        { class: 'transcript-cue', type: 'button', 'data-cue': String(i), 'data-seek': String(cue.start) },
        cells,
      );
    });
    inner = [h('ol', { class: 'video-transcript' }, rows)];
  } else {
    inner = [h('p', { class: 'video-transcript-empty' }, [labels.transcriptNone])];
  }
  // Niente `hidden` qui: la visibilità iniziale è gestita uniformemente dal
  // chiamante (panelsWithHidden), che nasconde tutti i pannelli tranne il primo.
  return h('div', { class: 'video-panel-body', 'data-tab-panel': 'vf-transcript' }, inner);
}
