/*
 * render-core/vnode.ts — Modello di nodo virtuale (VNode) condiviso tra il
 * renderer dell'anteprima (React) e quello dell'export SCORM (DOM vanilla).
 *
 * Il core costruisce un albero DICHIARATIVO e neutro: non conosce né React né
 * il DOM del browser dell'LMS. Due adapter sottili (uno per backend) proiettano
 * il VNode in elementi React o in nodi DOM reali, interpretando i `behavior`
 * dichiarativi (interazioni) con la tecnica nativa del loro ambiente.
 *
 * Questo elimina la duplicazione della logica di rendering (prima scritta due
 * volte) e garantisce che anteprima ed export non possano divergere.
 */

import type { MediaRef } from '../primitives.js';

/** Valore ammesso per un attributo di un VNode. */
export type VAttrValue = string | number | boolean | undefined;

/** Figlio di un VNode: un altro nodo, testo, o niente. */
export type VChild = VNode | string | number | null | undefined;

/**
 * Nodo virtuale. `html` e `children` sono mutuamente esclusivi: `html` serve
 * SOLO per il contenuto rich-text già sanificato lato server (fidato).
 */
export interface VNode {
  tag: string;
  attrs?: Record<string, VAttrValue>;
  /** HTML fidato (rich-text sanificato). Mutuamente esclusivo con `children`. */
  html?: string;
  children?: VChild[];
  /** Interazione dichiarativa, interpretata dagli adapter. */
  behavior?: Behavior;
}

/**
 * Comportamento interattivo dichiarativo. Il core marca il sottoalbero; ogni
 * adapter lo implementa UNA volta con la tecnica del suo backend (addEventListener
 * per il DOM, useState/handler per React). Il markup contiene già tutti gli
 * stati (es. flashcard con entrambe le facce): il behavior pilota solo quale
 * pattern di interattività attivare.
 */
export type Behavior =
  | { kind: 'toggle'; group?: string; initial?: boolean }
  | { kind: 'tabs'; initialTabId: string }
  | { kind: 'carousel'; count: number }
  | { kind: 'hotspot' }
  | { kind: 'video-karaoke' }
  // Behavior "stateful": il contenuto interattivo è ri-renderizzato dal core a
  // ogni cambio di stato. L'adapter tiene lo stato in un contenitore marcato
  // [data-stateful] e, a ogni interazione, chiama renderStateful(spec, state)
  // per ottenere il nuovo VNode interno, poi lo rimonta (DOM) o ri-renderizza
  // (React). Markup/classi/scoring restano nel core → parità garantita.
  | { kind: 'stateful'; spec: StatefulSpec };

/**
 * Specifica di un block interattivo con stato. `type` seleziona il renderer di
 * stato nel core; `payload` sono i dati del block; `initial` è lo stato iniziale.
 */
export interface StatefulSpec {
  type: 'dnd-match' | 'dnd-sort' | 'dnd-order' | 'scenario';
  payload: Record<string, unknown>;
}

/**
 * Contesto di rendering iniettato dal chiamante. Astrae ciò che è specifico del
 * contesto d'uso (anteprima vs export), così il core resta neutro.
 */
export interface RenderContext {
  /**
   * Risolve un MediaRef nell'URL utilizzabile come src:
   * - anteprima: URL firmato fornito dall'API;
   * - export: path relativo riscritto dal builder (es. "../media/asset-1.png").
   * Ritorna null se il media non è materializzato (placeholder).
   */
  resolveMedia: (ref: MediaRef) => string | null;
}

/** Costruttore di un VNode con figli. */
export function h(tag: string, attrs?: VNode['attrs'], children?: VChild[]): VNode {
  return { tag, attrs, children };
}

/** Costruttore di un VNode con contenuto HTML fidato (rich-text sanificato). */
export function hHtml(tag: string, attrs: VNode['attrs'], html: string): VNode {
  return { tag, attrs, html };
}

/** Associa un behavior interattivo a un VNode (ritorna lo stesso nodo). */
export function withBehavior(node: VNode, behavior: Behavior): VNode {
  node.behavior = behavior;
  return node;
}

/** True se il valore è un VNode (utile agli adapter nel ciclo sui figli). */
export function isVNode(x: unknown): x is VNode {
  return typeof x === 'object' && x !== null && typeof (x as VNode).tag === 'string';
}
