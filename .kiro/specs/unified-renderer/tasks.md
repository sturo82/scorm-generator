# Tasks — Renderer unificato (anteprima ↔ export SCORM)

Convenzioni:
- Build/test SEMPRE in container Docker `node:20.11.0-bookworm` (Node non è sull'host).
- Dopo ogni fase: build completa + suite test verdi (requisito 7.2/7.3/9.1).
- Non toccare `INTERACTIONS_CSS`/`PLAYER_CSS`: i renderer del core devono produrre le stesse classi (requisito 2.3).

---

## Fase 0 — Impalcatura e scioglimento del rischio bundling

- [ ] 1. Creare il core VNode in `@scorm/contracts`
  - `packages/contracts/src/render-core/vnode.ts`: tipi `VNode`, `VChild`, `Behavior`, `RenderContext`; helper `h()`, `hHtml()`.
  - `packages/contracts/src/render-core/video.ts`: `videoEmbedUrl(video)`, `fmtTime(s)`, ordinamento cue (una sola implementazione).
  - `packages/contracts/src/render-core/registry.ts`: `renderBlock(block, ctx): VNode` con dispatch per tipo + segnaposto per tipo ignoto (requisito 1.4).
  - `packages/contracts/src/render-core/index.ts` + entry export dedicato nel package.json di contracts.
  - _Requisiti: 1.1, 1.2, 1.3, 1.5, 3.5, 4.4_

- [ ] 2. Migrare il tipo pilota `rich_text` nel core
  - `render-core/blocks/rich-text.ts`: `renderRichText(payload, ctx): VNode` (usa `hHtml` per il contenuto fidato + lista media via `ctx.resolveMedia`).
  - Test unit del core: snapshot del VNode (tag/classi/attributi) coerente con le classi di `INTERACTIONS_CSS`.
  - _Requisiti: 1.1, 2.3, 3.1, 3.4, 7.1_

- [ ] 3. Adapter DOM + bundle IIFE (RISCHIO PRINCIPALE — sciogliere qui)
  - `packages/scorm/src/runtime/dom/vnode-to-dom.ts`: `mount(vnode): HTMLElement` (attrs/html/children + interpretazione `behavior`).
  - Step di build in `@scorm/scorm` che bundla core + adapter DOM in un asset IIFE `render-core.js` esposto come `window.RenderCore` (valutare esbuild o tsc+wrapper).
  - Includere `render-core.js` tra gli asset runtime del pacchetto (RUNTIME_ASSET_FILES) e nel `<script>` di `page-template.ts`.
  - `renderers.js`: far delegare SOLO `rich_text` a `window.RenderCore` + `mount` (gli altri tipi restano sull'implementazione attuale finché non migrati).
  - Verifica: pacchetto generato carica e renderizza `rich_text` dal core.
  - _Requisiti: 1.5, 6.1, 6.3, 9.3_

- [ ] 4. Adapter React
  - `apps/web/src/components/courses/render/vnode-to-react.tsx`: `VNodeView({ node, ctx })` (VNode → React, interpretazione `behavior` con hook).
  - `block-renderer.tsx`: far renderizzare `rich_text` tramite il core + `VNodeView` (gli altri tipi restano com'erano).
  - Verifica parità: stesso payload → stesso markup/classi in DOM e React.
  - _Requisiti: 1.5, 8.2, 8.3, 8.4_

- [ ] 5. Checkpoint Fase 0
  - Build completa (tutti i package + typecheck web) + 220 test verdi in container.
  - Confermare che il bundling IIFE è sostenibile; se no, rivedere la decisione prima di proseguire.
  - _Requisiti: 7.2, 7.3, 9.1_

---

## Fase 1 — Block statici

- [ ] 6. Migrare `timeline` e `image_hotspot`
  - Core: `blocks/timeline.ts`, `blocks/image-hotspot.ts` (behavior `hotspot`).
  - Rimuovere le implementazioni duplicate da `renderers.js` e `block-renderer.tsx`.
  - Test core + interazione hotspot (DOM e React).
  - _Requisiti: 2.1, 2.2, 2.4, 3.1_

- [ ] 7. Migrare `accordion_tabs` e `click_reveal`
  - Core: behavior `toggle` (accordion) e `tabs` (variant=tabs); `click_reveal` con `toggle`.
  - Adapter: implementare toggle/tabs una volta per backend.
  - Test apertura/chiusura + aria-expanded/aria-selected (DOM e React).
  - _Requisiti: 2.1, 2.2, 2.4_

- [ ] 8. Migrare `carousel_steps` e `flashcard`
  - Core: `carousel` (count) e `flashcard` (toggle flip, entrambe le facce nel markup).
  - Rimuovere duplicati; test flip (aria-pressed) e navigazione carousel.
  - _Requisiti: 2.1, 2.2, 2.3, 2.4_

- [ ] 9. Checkpoint Fase 1
  - Build + test verdi in container; nessuna regressione visiva (classi invariate).
  - _Requisiti: 7.2, 7.3_

---

## Fase 2 — Block complessi, valutabili e video-first

- [ ] 10. Migrare `dragdrop_match` e `sorting_categories`
  - Core: behavior `dnd-assign` (mode match/sort), con fallback click-to-assign.
  - Preservare la logica di valutazione coerente con lo scoring (requisito 2.5).
  - Test drag&drop + fallback click (DOM e React).
  - _Requisiti: 2.1, 2.2, 2.5_

- [ ] 11. Migrare `dragdrop_order` e `branching_scenario`
  - Core: behavior `dnd-order` e `scenario` (startNodeId, scelte, nodi).
  - Rimuovere duplicati; test riordino e navigazione scenario (DOM e React).
  - _Requisiti: 2.1, 2.2_

- [ ] 12. Migrare `video_checkpoint` (karaoke + tab + media)
  - Core: `blocks/video-checkpoint.ts` con pannello a tab (behavior `tabs`) e behavior `video-karaoke`; media via `ctx.resolveMedia`; embed via `videoEmbedUrl` condiviso.
  - Stati `transcriptStatus` (processing/failed/none) resi dal core; azioni editoriali (editor manuale, re-upload) restano SOPRA nel componente React.
  - Test karaoke (simulazione `timeupdate` in jsdom) + click-to-seek (DOM e React).
  - _Requisiti: 4.1, 4.2, 4.3, 4.4, 3.1, 3.5, 8.2_

- [ ] 13. Checkpoint Fase 2 + editing invariato
  - Verificare in anteprima che upload/sostituzione video, editor trascrizione, matita e stato restino funzionanti (requisito 8.1/8.5).
  - Build + test verdi in container.
  - _Requisiti: 7.2, 7.3, 8.1, 8.5_

---

## Fase 3 — Struttura del corso (indice, overview, concetti)

- [ ] 14. Unificare il raggruppamento a concetti
  - Sostituire la copia inline `groupConcepts` in `player.js` con `groupBlocksIntoConcepts` condiviso (bundlato nell'asset runtime).
  - Test: stessa segmentazione a concetti usata da anteprima ed export.
  - _Requisiti: 5.1_

- [ ] 15. Unificare il modello di step e indice/menu di navigazione
  - Fonte di verità condivisa per la sequenza step (course_overview → module_overview → lezioni → assessment).
  - Proiezione: sidebar React (anteprima) e `buildCourseIndex` DOM (export) consumano lo stesso modello → elimina l'asimmetria "menu a sx presente da un lato".
  - _Requisiti: 5.2, 5.3_

- [ ] 16. Unificare le pagine di panoramica corso/modulo
  - Contenuto coerente nei due contesti (hero, obiettivi, elenco lezioni, conteggi).
  - _Requisiti: 5.4_

- [ ] 17. Checkpoint Fase 3
  - Build + test verdi; verifica che menu, overview e concetti combacino tra anteprima ed export reale.
  - _Requisiti: 5.3, 5.5, 7.2, 7.3_

---

## Fase 4 — Rete di sicurezza e pulizia

- [ ] 18. Test di parità di copertura
  - Test che itera i 12 tipi e asserisce che sia l'adapter DOM sia quello React montino il VNode (fallisce se un tipo è gestito da un solo lato).
  - _Requisiti: 7.1, 7.4_

- [ ] 19. Rimozione del codice morto e verifica export
  - Eliminare le ultime implementazioni duplicate residue in `renderers.js` e `block-renderer.tsx`.
  - Generare un pacchetto SCORM da un corso reale e verificarne struttura/offline/import (manifest, asset, course.js) senza regressioni.
  - _Requisiti: 6.1, 6.2, 6.3, 6.4_

- [ ] 20. Verifica finale end-to-end
  - Confronto anteprima ↔ export su un corso video-first reale: menu, trascrizione karaoke, tab, interazioni identiche.
  - Build completa + intera suite test verdi in container; pulizia artefatti temporanei.
  - _Requisiti: 2.2, 4.2, 5.3, 7.2, 7.3_
