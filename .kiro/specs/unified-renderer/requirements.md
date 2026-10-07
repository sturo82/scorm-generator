# Requisiti — Renderer unificato (anteprima ↔ export SCORM)

## Introduzione

Oggi i contenuti di un corso sono renderizzati da **due implementazioni separate e gemelle**:

- **Anteprima editor** (React/JSX): `apps/web/src/components/courses/block-renderer.tsx` (+ `course-preview.tsx` per lezione/indice/overview).
- **Export SCORM** (DOM vanilla, `window.*`): `packages/scorm/src/runtime/assets/renderers.js` (+ `player.js` per navigazione/indice/overview).

Le due implementazioni coprono gli stessi 12 tipi di block e la stessa struttura di corso (overview corso/modulo, lezioni, concetti, video-first con karaoke e tab), ma sono scritte due volte. L'unico codice condiviso è il CSS (`INTERACTIONS_CSS` in `@scorm/contracts`) e pochi helper di dominio (`groupBlocksIntoConcepts`, `compileTheme`). La duplicazione provoca **divergenze** tra ciò che l'autore vede in anteprima e ciò che viene esportato nel pacchetto SCORM (es. menu di navigazione presente da un lato e non dall'altro, trascrizione mostrata in un renderer ma non nell'altro).

Questo refactor introduce **un unico renderer condiviso** per la logica di rendering dei block (e, in una fase successiva, della struttura del corso), consumato sia dall'anteprima React sia dal runtime SCORM, eliminando la duplicazione alla radice.

### Obiettivi
- Una sola implementazione della logica di rendering per ogni tipo di block.
- Parità garantita tra anteprima e export: ciò che l'autore vede è ciò che viene esportato.
- Nessuna regressione funzionale su export SCORM, assessment, karaoke video-first, interazioni (flip, accordion, drag&drop, hotspot, scenario, timeline, reveal, carousel, sorting).
- Mantenere l'export SCORM **offline e self-contained** (nessuna dipendenza esterna a runtime; nessun React nel pacchetto).
- Mantenere nell'anteprima le funzioni editoriali (upload video, stato trascrizione, selezione modalità) sopra/accanto al renderer condiviso.

### Glossario
- **Renderer di block**: funzione che, dato `type` + `payload` di un block, produce la rappresentazione visiva/interattiva.
- **Backend di rendering**: il "come" si costruisce l'output (DOM vanilla per SCORM; elementi React per l'anteprima).
- **Risoluzione media**: trasformazione di `storageKey` nell'URL utilizzabile (URL firmato in anteprima; path relativo `../media/...` nell'export).
- **Core condiviso**: il modulo neutro che contiene la logica di rendering, indipendente dal backend.

---

## Requisiti

### Requisito 1 — Core di rendering condiviso e DOM-agnostico
**User story:** Come sviluppatore, voglio che la logica di rendering di ogni tipo di block viva in un unico modulo condiviso, così che anteprima ed export non possano più divergere.

#### Criteri di accettazione
1. THE sistema SHALL fornire un modulo di rendering condiviso che definisce, per ciascuno dei 12 tipi di block, come costruire l'output a partire da `type` + `payload`.
2. THE modulo condiviso SHALL essere indipendente dal backend concreto (DOM vanilla o React), tramite un'astrazione di costruzione dell'output (es. factory di elementi / descrizione dichiarativa dell'albero).
3. THE modulo condiviso SHALL NOT dipendere da globali del browser SCORM (`window.SCORM`, `window.Renderers`, `window.Player`) né da API Node (`node:fs`, `JSZip`).
4. WHERE un tipo di block non è riconosciuto THE modulo condiviso SHALL produrre un segnaposto esplicito ("tipo non supportato") coerente nei due backend.
5. THE modulo condiviso SHALL risiedere in un package importabile sia da `apps/web` (bundle browser) sia da `packages/scorm` (asset runtime), senza trascinare dipendenze incompatibili.

### Requisito 2 — Parità funzionale per tutti i tipi di block
**User story:** Come autore, voglio che ogni interazione si comporti identica in anteprima e nell'export, così da fidarmi di ciò che vedo prima di esportare.

#### Criteri di accettazione
1. THE renderer condiviso SHALL supportare tutti i tipi attuali: rich_text, image_hotspot, accordion_tabs, flashcard, timeline, dragdrop_match, dragdrop_order, click_reveal, branching_scenario, video_checkpoint, carousel_steps, sorting_categories.
2. WHEN un block interattivo viene renderizzato THEN il comportamento (flip flashcard, apertura accordion/tab, reveal, carousel, hotspot, drag&drop con fallback click, scenario a scelte, karaoke video) SHALL essere equivalente nei due contesti.
3. THE markup e le classi CSS prodotte SHALL restare compatibili con `INTERACTIONS_CSS` e con il CSS del player, così da preservare l'aspetto attuale.
4. THE accessibilità esistente (ruoli ARIA, `aria-pressed`/`aria-expanded`/`aria-selected`, navigazione da tastiera) SHALL essere preservata o migliorata.
5. WHERE un block è valutabile (es. sorting_categories) THE logica di valutazione SHALL restare coerente con lo scoring del runtime SCORM.

### Requisito 3 — Risoluzione dei media parametrizzata
**User story:** Come sviluppatore, voglio che il renderer condiviso non assuma un formato di URL fisso, così che funzioni sia con gli URL firmati dell'anteprima sia con i path relativi dell'export.

#### Criteri di accettazione
1. THE renderer condiviso SHALL ricevere la risoluzione di `storageKey` → URL come parametro/strategia iniettata, senza codificarla al suo interno.
2. WHEN usato in anteprima THEN la strategia SHALL restituire gli URL firmati forniti dall'API.
3. WHEN usato nell'export THEN la strategia SHALL restituire i path relativi riscritti dal builder (`../media/...`).
4. WHERE un media non è materializzato (solo `placeholderPrompt`) THE renderer SHALL mostrare il segnaposto in entrambi i contesti.
5. THE risoluzione degli embed esterni (YouTube/Vimeo/Twitch) SHALL essere condivisa (una sola implementazione di parsing/embed), eliminando le regex duplicate.

### Requisito 4 — Video-first: trascrizione karaoke e tab condivise
**User story:** Come autore di lezioni video-first, voglio che la trascrizione karaoke e le tab sezioni appaiano identiche in anteprima e nell'export.

#### Criteri di accettazione
1. THE rendering del block video_checkpoint (video + pannello a tab Trascrizione/Sezioni) SHALL provenire dal renderer condiviso.
2. WHEN il video è in riproduzione THEN l'evidenziazione karaoke della cue corrente e il click-to-seek SHALL funzionare in entrambi i contesti.
3. WHERE `transcriptStatus` è 'processing'/'failed'/'none' THE renderer condiviso SHALL mostrare lo stato coerentemente; le azioni editoriali (editor manuale, re-upload) restano responsabilità dell'anteprima e vivono SOPRA il renderer.
4. THE formattazione del tempo (m:ss) e l'ordinamento delle cue SHALL essere condivisi (una sola implementazione).

### Requisito 5 — Struttura del corso unificata (overview, indice, concetti)
**User story:** Come autore, voglio che la struttura di navigazione (panoramica corso/modulo, indice a sinistra, raggruppamento a concetti, modalità slide/scroll/hybrid) sia coerente tra anteprima ed export.

#### Criteri di accettazione
1. THE euristica di raggruppamento a concetti SHALL avere un'unica implementazione condivisa (eliminando la copia inline `groupConcepts` in player.js a favore di `groupBlocksIntoConcepts`).
2. THE costruzione della sequenza di step (course_overview → module_overview → lezioni → assessment) SHALL avere un'unica fonte di verità logica, consumata dai due contesti.
3. WHERE l'anteprima mostra l'indice/menu di navigazione a sinistra THE export SHALL mostrare un indice equivalente (e viceversa), eliminando l'asimmetria attuale.
4. THE pagine di panoramica corso e modulo SHALL essere coerenti nei due contesti per contenuto mostrato (hero, obiettivi, elenco lezioni, conteggi).
5. Questo requisito PUÒ essere realizzato in una fase successiva a quella dei block (vedi design), ma il risultato finale SHALL eliminare la divergenza strutturale.

### Requisito 6 — Nessuna regressione su export SCORM e offline
**User story:** Come utente che importa il pacchetto in un LMS, voglio che l'export resti conforme, offline e funzionante come prima.

#### Criteri di accettazione
1. THE pacchetto SCORM esportato SHALL restare self-contained e offline (nessuna risorsa esterna, nessun React a runtime).
2. THE integrazione con l'API SCORM (initialize/commit/terminate, bookmark, scoring, gating) SHALL restare invariata.
3. WHEN il refactor è completo THEN la struttura del pacchetto (manifest, asset, course.js) SHALL restare valida e importabile sugli LMS target.
4. THE dimensione e il tempo di generazione del pacchetto SHALL restare nello stesso ordine di grandezza attuale (nessuna regressione sostanziale).

### Requisito 7 — Verifica e protezione contro future divergenze
**User story:** Come team, voglio una rete di sicurezza che impedisca ai due output di divergere di nuovo in futuro.

#### Criteri di accettazione
1. THE refactor SHALL essere coperto da test che verificano, per ciascun tipo di block, la coerenza dell'output del core condiviso.
2. THE build completa (tsc di tutti i package + typecheck web) e l'intera suite di test esistente SHALL restare verdi.
3. THE suite esistente di 220 test SHALL continuare a passare senza regressioni; i nuovi test del renderer condiviso SHALL essere aggiunti.
4. WHERE possibile THE sistema SHALL includere un test che fallisce se un tipo di block è gestito da un backend ma non dall'altro (parità di copertura).

### Requisito 8 — L'editing dei contenuti resta facile e invariato
**User story:** Come autore, voglio continuare a modificare i contenuti con la stessa facilità di oggi, così che l'unificazione del renderer non peggiori l'esperienza di editing.

#### Criteri di accettazione
1. THE funzioni di editing attuali SHALL restare disponibili e almeno altrettanto comode: modifica block (dialog editor), upload/sostituzione video, inserimento/correzione manuale della trascrizione, generazione contenuti/immagini/narrazione, riordino, eliminazione lezioni.
2. THE renderer condiviso SHALL essere usato come layer di PRESENTAZIONE; i controlli editoriali (pulsanti, dialog, stato trascrizione, segnaposto cliccabili) restano responsabilità dell'anteprima e vivono SOPRA/ACCANTO al renderer, non dentro il core condiviso.
3. WHEN l'autore modifica un contenuto THEN l'anteprima SHALL riflettere immediatamente la modifica usando il renderer condiviso (nessuna regressione nei tempi di aggiornamento rispetto a oggi).
4. THE componente editoriale (oggi `block-preview.tsx`) SHALL continuare a esistere per i controlli di editing, ma la PRESENTAZIONE del contenuto SHALL passare attraverso il renderer condiviso, eliminando la logica di presentazione duplicata.
5. WHERE un block è selezionato/hover nell'editor THE affordance di modifica (es. icona matita, "Sostituisci", "Trascrizione") SHALL restare presente e funzionante come oggi.

### Requisito 9 — Migrazione incrementale e reversibile
**User story:** Come sviluppatore, voglio migrare un pezzo alla volta mantenendo il sistema sempre funzionante, così da non introdurre un big-bang rischioso.

#### Criteri di accettazione
1. THE migrazione SHALL procedere per fasi, lasciando il sistema compilabile e testabile dopo ogni fase.
2. THE prima fase SHALL riguardare la logica di rendering dei block; la struttura del corso (indice/overview/step) PUÒ seguire in una fase successiva.
3. WHERE un backend non è ancora migrato THE sistema SHALL continuare a usare l'implementazione esistente senza rotture.
4. THE lavoro SHALL essere verificabile in container Docker (Node non è sull'host), coerentemente con il flusso di build/test del repo.
