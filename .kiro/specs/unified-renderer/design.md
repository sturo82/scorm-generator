# Design — Renderer unificato (anteprima ↔ export SCORM)

## Panoramica

Introduciamo **un core di rendering condiviso** che descrive, per ogni tipo di block, un albero di UI in forma **dichiarativa e neutra** (VNode). Due adapter sottili trasformano il VNode nel backend concreto:

- **Adapter DOM** (per l'export SCORM): VNode → nodi DOM reali (`document.createElement`), mantenendo il comportamento vanilla attuale.
- **Adapter React** (per l'anteprima editor): VNode → `React.createElement`, dentro i componenti dell'editor.

Il core non conosce né `window.SCORM` né React né Node. Riceve dall'esterno tutto ciò che è specifico del contesto (risoluzione media, eventuale handler di interazione), rispettando i requisiti 1.2/1.3/3.1.

```
                 ┌─────────────────────────────────────────┐
                 │   @scorm/contracts  (o nuovo pacchetto)   │
                 │   render-core/                            │
                 │   ├─ vnode.ts        (tipi VNode, h())    │
                 │   ├─ blocks/*.ts     (12 renderer puri)   │
                 │   ├─ video.ts        (embed, fmtTime)     │
                 │   └─ index.ts        (renderBlock(vnode)) │
                 └───────────────┬───────────────┬───────────┘
                                 │               │
              ┌──────────────────▼──┐        ┌───▼─────────────────────┐
              │ adapter DOM (vanilla)│        │ adapter React            │
              │ packages/scorm       │        │ apps/web                 │
              │ renderers.js (slim)  │        │ block-renderer.tsx (slim)│
              └──────────────────────┘        └──────────────────────────┘
                       │                                   │
                 export SCORM                        anteprima editor
```

### Scelta dell'approccio di astrazione

Valutati due approcci (vedi domanda posta in chat):

| | VNode dichiarativo (SCELTO) | Factory `el()` iniettata |
|---|---|---|
| Testabilità core | Alta: il VNode è un oggetto serializzabile, verificabile senza DOM né React | Media: serve un fake di `el` |
| Vicinanza al codice attuale | Media: `renderers.js` usa già `el()`, va adattato | Alta |
| Gestione interazioni | Esplicita e neutra (vedi sotto) | Delicata (closure sul backend) |
| Rischio divergenza futura | Basso (un solo albero, due proiezioni meccaniche) | Medio |
| Parità verificabile con test | Sì (snapshot del VNode per tipo) | Più difficile |

**Scelto: VNode dichiarativo.** È più testabile e rende la parità verificabile con snapshot, soddisfacendo i requisiti 7.1/7.4. Il costo è modellare le interazioni in modo neutro, affrontato sotto.

## Modello VNode

```ts
// render-core/vnode.ts
export type VChild = VNode | string | null | undefined;
export interface VNode {
  tag: string;                         // 'div', 'button', 'video', ...
  attrs?: Record<string, string | number | boolean | undefined>;
  // Classi come stringa (compatibili con INTERACTIONS_CSS/PLAYER_CSS invariati).
  // Contenuto HTML fidato (rich_text già sanificato lato server):
  html?: string;                       // mutuamente esclusivo con children
  children?: VChild[];
  // Comportamento interattivo neutro, interpretato dagli adapter (vedi sotto):
  behavior?: Behavior;
}
export function h(tag: string, attrs?: VNode['attrs'], children?: VChild[]): VNode;
export function hHtml(tag: string, attrs: VNode['attrs'], html: string): VNode; // rich text
```

### Interazioni: modello dichiarativo "Behavior"

Le interazioni (flip, accordion, reveal, carousel, hotspot, drag&drop, scenario, karaoke) non sono scritte come event listener nel core. Il core marca i nodi con un `behavior` dichiarativo; ogni adapter lo implementa una volta sola con la tecnica nativa del suo backend.

```ts
export type Behavior =
  | { kind: 'toggle'; group?: string; initial?: boolean }      // flashcard flip, accordion, reveal
  | { kind: 'tabs'; initialTabId: string }                     // accordion variant=tabs, video panel
  | { kind: 'carousel'; count: number }                        // carousel_steps
  | { kind: 'hotspot' }                                        // image_hotspot
  | { kind: 'dnd-assign'; mode: 'match' | 'sort' }             // dragdrop_match, sorting_categories
  | { kind: 'dnd-order' }                                      // dragdrop_order
  | { kind: 'scenario'; startNodeId: string }                 // branching_scenario
  | { kind: 'video-karaoke' };                                 // video_checkpoint
```

Il core produce il markup completo (tutti gli stati nel DOM, come fa già `renderers.js`: es. flashcard con entrambe le facce). Il `behavior` dice all'adapter *quale pattern di interattività* attivare su quel sottoalbero. Così:
- l'**adapter DOM** aggancia `addEventListener` + `setAttribute(aria-*)` (identico a oggi);
- l'**adapter React** usa `useState`/handler sul medesimo markup.

Questo mantiene markup e classi **identici** (requisito 2.3) e concentra la logica di interazione in due punti (uno per backend) invece che in 24 (12 tipi × 2).

> Nota: lo stato interattivo è effimero (UI), non persiste. Gli assessment e lo scoring restano nel runtime SCORM (requisito 2.5 / 6.2) e nei componenti dedicati; il core copre la presentazione dei block di contenuto.

### Risoluzione media iniettata

```ts
export interface RenderContext {
  resolveMedia: (ref: MediaRef) => string | null; // URL firmato (web) | path relativo (export)
  // altre strategie contestuali se necessarie (es. prefix asset)
}
```

Il core riceve `RenderContext`. In anteprima `resolveMedia` ritorna lo `storageKey` già risolto in URL firmato dall'API; nell'export ritorna il path `../media/asset-N.ext` prodotto da `embedMedia` del builder (requisito 3.1–3.4). L'embed esterno (YouTube/Vimeo/Twitch) diventa una sola funzione `videoEmbedUrl` nel core (requisito 3.5), eliminando le regex duplicate.

## Posizionamento del codice

Il core va in un package importabile sia da bundle browser (apps/web) sia da asset runtime SCORM, **senza dipendenze Node** (requisito 1.5). Candidati:

- **`@scorm/contracts`** (preferito): è già la casa del codice condiviso (`INTERACTIONS_CSS`, `groupBlocksIntoConcepts`, `compileTheme`), già importato da entrambi, puro TS senza Node. Aggiungiamo `src/render-core/`.
- Alternativa: nuovo package `@scorm/render-core`. Più pulito concettualmente ma aggiunge overhead di workspace; rimandabile.

**Scelta: `@scorm/contracts/render-core`**, riesportato con un entry dedicato per non appesantire l'import principale.

### Il nodo "asset vanilla non compilato"

Oggi `renderers.js` e `player.js` sono **asset `.js` statici** copiati nel pacchetto, NON moduli TS. Non possono `import` da `@scorm/contracts` a runtime nel browser dell'LMS (sono caricati come `<script>`).

Soluzione: il core TS viene **compilato/bundlato in un asset IIFE** (`render-core.js`) incluso tra gli asset runtime del pacchetto ed esposto come `window.RenderCore`. `renderers.js` diventa un adapter sottile che usa `window.RenderCore` + l'adapter DOM. Il bundling avviene al build di `@scorm/scorm` (step di copy-assets esteso con un bundle, es. esbuild già disponibile o tsc + wrapper IIFE). Dettaglio da validare in fase di task (vedi Rischi).

## Componenti e interfacce

### Core (nuovo)
- `vnode.ts`: tipi `VNode`/`Behavior`/`RenderContext`, helper `h`, `hHtml`.
- `blocks/`: una funzione pura per tipo, `renderRichText(payload, ctx): VNode`, ... `renderVideoCheckpoint(payload, ctx): VNode`.
- `registry.ts`: `renderBlock(block, ctx): VNode` con dispatch per tipo + segnaposto per tipo ignoto (requisito 1.4).
- `video.ts`: `videoEmbedUrl(video)`, `fmtTime(s)`, ordinamento cue.
- `index.ts`: export pubblici del core.

### Adapter DOM (`packages/scorm`)
- `vnode-to-dom.ts` (compilato nel bundle IIFE): `mount(vnode): HTMLElement`, applica `attrs`, `html`, `children`; interpreta `behavior` con listener vanilla.
- `renderers.js` ridotto: `renderBlock(block)` → `RenderCore.renderBlock(block, ctx)` → `mount(...)`. Mantiene `renderAssessment` (scoring) dove sta.

### Adapter React (`apps/web`)
- `vnode-to-react.tsx`: `function VNodeView({ node, ctx })` che mappa VNode → elementi React; interpreta `behavior` con hook React.
- `block-renderer.tsx` ridotto: `BlockRenderer` chiama il core e rende il VNode con `VNodeView`. La logica interattiva duplicata (flip/accordion/dnd/...) viene rimossa in favore dei behavior.
- `block-preview.tsx` resta per i **controlli editoriali** (upload, stato trascrizione, matita, "Sostituisci", "Trascrizione"), ma la **presentazione** del contenuto passa dal renderer condiviso (requisito 8.2/8.4).

### Struttura corso (Fase 2, requisito 5)
- Spostare in condiviso: `buildSteps` logico e il raggruppamento a concetti (già `groupBlocksIntoConcepts`), eliminando la copia `groupConcepts` in player.js.
- Indice/overview: unificare il modello dati dell'indice; i due backend lo proiettano (sidebar React / `buildCourseIndex` DOM). Risolve l'asimmetria "menu a sx presente da un lato".

## Strategia di migrazione (fasi)

Ogni fase lascia build e test verdi (requisito 9.1).

**Fase 0 — Impalcatura**: `render-core/` con `vnode.ts`, `registry.ts` vuoto, i due adapter minimi, un tipo di block pilota (`rich_text`) migrato end-to-end in entrambi i backend. Verifica parità con snapshot VNode.

**Fase 1 — Block statici**: migrare rich_text, timeline, image_hotspot (hotspot behavior), accordion_tabs (toggle/tabs), click_reveal, carousel_steps, flashcard (toggle). Rimuovere le implementazioni duplicate man mano.

**Fase 2 — Block valutabili/complessi**: dragdrop_match, dragdrop_order, sorting_categories (dnd behavior), branching_scenario, video_checkpoint (karaoke behavior + media). Massima attenzione a scoring e karaoke.

**Fase 3 — Struttura corso** (requisito 5): concetti, step, indice, overview condivisi; eliminare `groupConcepts` inline; unificare indice/menu per rimuovere l'asimmetria.

**Fase 4 — Rete di sicurezza**: test di parità (ogni tipo gestito da entrambi gli adapter), pulizia del codice morto, verifica export su struttura reale.

## Testing

- **Unit del core**: per ogni tipo, `renderBlock` produce un VNode con tag/classi/attributi attesi (snapshot). Verifica che le classi combacino con quelle usate da `INTERACTIONS_CSS`/`PLAYER_CSS`.
- **Parità di copertura** (requisito 7.4): un test itera i 12 tipi e asserisce che sia l'adapter DOM sia quello React sappiano montare il VNode (nessun tipo gestito solo da un lato).
- **Adapter DOM**: montaggio in jsdom (già usato dai test del runtime) + interazione (click flip → aria-pressed; click cue → seek).
- **Adapter React**: test di rendering (il testo/markup atteso compare) usando l'infrastruttura di test del web.
- **Regressione**: l'intera suite esistente (220 test) resta verde (requisito 7.2/7.3).
- Tutta la verifica gira in container Docker `node:20.11.0-bookworm` (requisito 9.4).

## Rischi e mitigazioni

1. **Bundling del core in asset IIFE per SCORM** (`window.RenderCore`). Rischio: complessità nel build di `@scorm/scorm`. Mitigazione: validare presto in Fase 0 con un tool già presente (esbuild/tsc + wrapper); se troppo oneroso, fallback a generare l'asset dal core via step di build dedicato. **Questo è il rischio tecnico principale e va sciolto in Fase 0.**
2. **Interazioni complesse (drag&drop, scenario) nel modello behavior.** Rischio: comportamento sottilmente diverso tra i due adapter. Mitigazione: migrarle in Fase 2 con test di interazione dedicati per entrambi i backend.
3. **Karaoke dipende dal `<video>` reale e dall'evento timeupdate.** Mitigazione: il behavior `video-karaoke` incapsula l'aggancio; test in jsdom simulando `timeupdate`.
4. **Parità CSS.** Il markup/classi devono restare compatibili con i CSS esistenti. Mitigazione: non toccare `INTERACTIONS_CSS`/`PLAYER_CSS`; i renderer del core producono le stesse classi di oggi.
5. **Regressione export offline.** Mitigazione: nessun React nel pacchetto; il core è compilato a vanilla; test di struttura pacchetto in Fase 4.
6. **Ambito.** È un refactor ampio. Mitigazione: fasi indipendenti, ognuna verde e mergiabile; la Fase 3 (struttura) può slittare senza bloccare i benefici delle fasi 0–2.

## Decisioni aperte (da confermare in fase di task)
- Pacchetto host del core: `@scorm/contracts/render-core` (preferito) vs nuovo package.
- Tool di bundling dell'asset IIFE per SCORM.
- Se migrare la struttura corso (Fase 3) in questa iterazione o in una successiva.
