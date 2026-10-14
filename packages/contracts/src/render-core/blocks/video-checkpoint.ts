/*
 * render-core/blocks/video-checkpoint.ts — Block `video_checkpoint` (video-first
 * stile Brain Bites): colonna video (file caricato o embed esterno) + pannello a
 * tab con Trascrizione karaoke (evidenziazione sincronizzata + click-to-seek) e
 * Sezioni. Markup canonico del runtime SCORM. Interazione: behavior
 * 'video-karaoke' (tab + highlight su timeupdate + seek), implementato una volta
 * per backend. Media risolto via ctx; embed esterni via videoEmbedUrl condiviso.
 *
 * Le azioni editoriali (editor manuale trascrizione, re-upload) NON vivono qui:
 * restano responsabilità dell'anteprima, sopra il renderer.
 */

import type { MediaRef } from '../../primitives.js';
import type { CourseLabels } from '../../course-labels.js';
import { h, hHtml, withBehavior, blockLabels, type VNode, type VChild, type RenderContext } from '../vnode.js';
import { videoEmbedUrl, fmtTime, type TranscriptCueLike } from '../video.js';

interface RichLike {
  html?: string;
}
interface VideoSection {
  id: string;
  title: string;
  content?: RichLike;
}

export function renderVideoCheckpoint(payload: Record<string, unknown>, ctx: RenderContext): VNode {
  const vid = (payload.video as MediaRef) || ({} as MediaRef);
  const transcript = (payload.transcript as TranscriptCueLike[]) || [];
  const transcriptStatus = (payload.transcriptStatus as string) || 'none';
  const sections = (payload.sections as VideoSection[]) || [];
  const src = ctx.resolveMedia(vid);
  const embed = videoEmbedUrl(vid);
  const alt = vid.alt || '';
  const hasVideo = !!src || !!embed;
  const L = blockLabels(ctx);

  // Tab: Trascrizione (se presente o in elaborazione) + una per sezione.
  const tabs: Array<{ id: string; label: string }> = [];
  if (transcript.length > 0 || transcriptStatus === 'processing') tabs.push({ id: 'transcript', label: L.transcript });
  sections.forEach((s) => tabs.push({ id: s.id, label: s.title }));
  const showPanel = tabs.length > 0;

  const container = h('div', { class: 'block video' + (showPanel ? ' video-withpanel' : '') }, []);
  const children: VChild[] = [];

  // --- Colonna video ---
  const videoCol: VChild[] = [];
  if (embed) {
    videoCol.push(
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
    videoCol.push(
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
    videoCol.push(
      h('div', { class: 'video-placeholder', role: 'img', 'aria-label': alt || L.videoAlt }, [
        '▶ ' + (alt || L.videoComing),
      ]),
    );
  }
  if (alt && hasVideo) videoCol.push(h('p', { class: 'video-alt' }, [alt]));
  children.push(h('div', { class: 'video-col' }, videoCol));

  // --- Pannello a tab ---
  if (showPanel) {
    const activeTab = tabs[0]!.id;
    const tablist = h(
      'div',
      { class: 'video-tabs', role: 'tablist' },
      tabs.map((t) =>
        h(
          'button',
          {
            class: 'video-tab' + (t.id === activeTab ? ' is-active' : ''),
            type: 'button',
            role: 'tab',
            'aria-selected': t.id === activeTab ? 'true' : 'false',
            'data-tab-btn': t.id,
          },
          [t.label],
        ),
      ),
    );

    // Corpo: un pannello per tab (trascrizione + sezioni), uno attivo.
    const panels: VChild[] = [];
    if (transcript.length > 0 || transcriptStatus === 'processing') {
      panels.push(transcriptPanel(transcript, transcriptStatus, 'transcript' === activeTab, L));
    }
    sections.forEach((s) => {
      panels.push(
        hHtml(
          'div',
          { class: 'video-panel-body', 'data-tab-panel': s.id, hidden: s.id === activeTab ? undefined : 'hidden' },
          s.content?.html || '',
        ),
      );
    });

    const panel = h('aside', { class: 'video-panel' }, [tablist, ...panels]);
    children.push(panel);
  }

  container.children = children;
  return withBehavior(container, { kind: 'video-karaoke' });
}

/** Pannello della trascrizione: righe cliccabili (seek) con tempo e testo. */
function transcriptPanel(transcript: TranscriptCueLike[], status: string, active: boolean, labels: CourseLabels): VNode {
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
  return h(
    'div',
    { class: 'video-panel-body', 'data-tab-panel': 'transcript', hidden: active ? undefined : 'hidden' },
    inner,
  );
}
