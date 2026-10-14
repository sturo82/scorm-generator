'use client';

import * as React from 'react';
import type { Block } from '@scorm/contracts';
import { INTERACTIONS_CSS } from '@scorm/contracts';
import {
  renderBlock as coreRenderBlock,
  isHandledByCore,
  imagePlaceholderSlot,
  type RenderContext,
} from '@scorm/contracts/render-core';
import { VNodeView } from '@/components/courses/render/vnode-to-react';

/**
 * Renderer React dei Block per l'anteprima nell'editor. Delega al renderer
 * CONDIVISO (@scorm/contracts/render-core): la stessa logica che produce il
 * pacchetto SCORM, proiettata in React dall'adapter VNodeView. Così ciò che si
 * vede in anteprima è esattamente ciò che verrà esportato (nessuna divergenza).
 *
 * In anteprima lo `storageKey` è già risolto dall'API in URL firmato, quindi
 * resolveMedia lo restituisce tale e quale (nell'export sarebbe ../media/...).
 */
const CORE_CTX: RenderContext = {
  resolveMedia: (m) => m.storageKey ?? null,
  // Anteprima (autore): rende VISIBILI i placeholder immagine generati ma non
  // ancora riempiti, con la descrizione suggerita. Nell'export SCORM questo hook
  // NON è fornito, quindi i placeholder restano invisibili (pacchetto pulito).
  renderPlaceholder: (m) => imagePlaceholderSlot(m),
};

export function BlockRenderer({ block }: { block: Block }) {
  // Scope del brand + micro-interazioni condivise (stesse dell'anteprima/corso):
  // senza queste i block interattivi (hotspot, drag&drop, sorting, scenario)
  // sarebbero privi di stile e dei token --ix-* nell'editor. data-motion abilita
  // i token in INTERACTIONS_CSS.
  return (
    <div className="brand-scope rounded-lg border bg-background p-4" data-motion="sober">
      <style dangerouslySetInnerHTML={{ __html: INTERACTIONS_CSS }} />
      <style dangerouslySetInnerHTML={{ __html: IMAGE_PLACEHOLDER_CSS }} />
      {renderByType(block)}
    </div>
  );
}

/**
 * Stile dello slot "immagine da inserire" (placeholder non riempito), mostrato
 * SOLO in anteprima. Usa i token del brand (via .brand-scope) così resta WCAG AA
 * sulla superficie del corso: riquadro tratteggiato, descrizione suggerita e
 * indicazione su dove inserirla. Non compare nel pacchetto SCORM esportato.
 */
const IMAGE_PLACEHOLDER_CSS = `
.block-media-placeholder {
  margin: 0.75rem 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.9rem 1rem;
  border: 1.5px dashed color-mix(in srgb, var(--brand-primary, #4f46e5) 45%, transparent);
  border-radius: 0.75rem;
  background: color-mix(in srgb, var(--brand-primary, #4f46e5) 5%, var(--brand-surface, #fff));
  color: var(--brand-on-surface, #1a2130);
}
.block-media-ph-head { display: flex; align-items: center; gap: 0.5rem; }
.block-media-ph-ico { font-size: 1.1rem; line-height: 1; }
.block-media-ph-badge {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  background: var(--brand-primary, #4f46e5);
  color: var(--brand-on-primary, #fff);
}
.block-media-ph-prompt {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.45;
  font-style: italic;
}
.block-media-ph-alt { margin: 0; font-size: 0.8rem; opacity: 0.85; }
.block-media-ph-hint { margin: 0; font-size: 0.76rem; opacity: 0.7; }
`;

function renderByType(block: Block): React.ReactElement {
  const type = block.type as string;
  const payload = block.payload as Record<string, unknown>;
  if (isHandledByCore(type)) {
    return <VNodeView node={coreRenderBlock({ type, payload }, CORE_CTX)} />;
  }
  return <p className="text-sm text-muted-foreground">[tipo non supportato: {type}]</p>;
}
