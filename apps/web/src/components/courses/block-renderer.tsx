'use client';

import * as React from 'react';
import type { Block } from '@scorm/contracts';
import { INTERACTIONS_CSS } from '@scorm/contracts';
import {
  renderBlock as coreRenderBlock,
  isHandledByCore,
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
};

export function BlockRenderer({ block }: { block: Block }) {
  // Scope del brand + micro-interazioni condivise (stesse dell'anteprima/corso):
  // senza queste i block interattivi (hotspot, drag&drop, sorting, scenario)
  // sarebbero privi di stile e dei token --ix-* nell'editor. data-motion abilita
  // i token in INTERACTIONS_CSS.
  return (
    <div className="brand-scope rounded-lg border bg-background p-4" data-motion="sober">
      <style dangerouslySetInnerHTML={{ __html: INTERACTIONS_CSS }} />
      {renderByType(block)}
    </div>
  );
}

function renderByType(block: Block): React.ReactElement {
  const type = block.type as string;
  const payload = block.payload as Record<string, unknown>;
  if (isHandledByCore(type)) {
    return <VNodeView node={coreRenderBlock({ type, payload }, CORE_CTX)} />;
  }
  return <p className="text-sm text-muted-foreground">[tipo non supportato: {type}]</p>;
}
