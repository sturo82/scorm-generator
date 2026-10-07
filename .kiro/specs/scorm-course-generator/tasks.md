# Piano di implementazione — SCORM Course Generator

Il piano è incrementale: ogni task costruisce su quelli precedenti, produce qualcosa di verificabile e termina con test. I provider esterni (Bedrock, vector store, storage) sono dietro astrazioni, quindi lo sviluppo end-to-end è possibile con adapter mock prima di collegare AWS. I riferimenti `_Requisiti_` puntano ai criteri in `requirements.md`.

> Nota: ogni task tocca solo codice; i task di infrastruttura reale (AWS) sono isolati e marcati come opzionali/collegabili in seguito.

---

## 1. Fondamenta del progetto

- [x] 1.1 Inizializzare il monorepo e la toolchain
  - Creare struttura workspace (es. `apps/web`, `apps/api`, `packages/domain`, `packages/scorm`, `packages/contracts`).
  - Configurare TypeScript, linter, formatter, test runner e script di build condivisi.
  - _Requisiti: 10.1_

- [x] 1.2 Definire i tipi di dominio condivisi e gli schema dei contenuti
  - In `packages/contracts`: tipi e JSON Schema versionati per Course, Module, Lesson, Block (per ogni tipo di interazione), Assessment, Question, Brand, Brief.
  - Validatori di schema riutilizzabili da API, generazione ed editor.
  - _Requisiti: 5.3, 6.1, 7.1_

- [x] 1.3 Definire le porte provider-agnostiche
  - Interfacce `LLMProvider`, `EmbeddingsProvider`, `VectorStore`, `ObjectStorage`, `JobQueue`, `DocumentExtractor` in `packages/domain`.
  - Container di dependency injection e registrazione adapter via configurazione.
  - _Requisiti: 10.1, 10.3, 10.4_

- [x] 1.4 Implementare adapter mock/in-memory per lo sviluppo
  - `MockLLMProvider` deterministico (output conforme a schema), `InMemoryVectorStore`, `LocalObjectStorage`, `InMemoryJobQueue`.
  - _Requisiti: 10.1, 10.3_

## 2. Persistenza, multi-tenancy e auth

- [x] 2.1 Schema database e migrazioni
  - Modellare Tenant, User, Plan, Brand, KnowledgeDoc, Course, Module, Lesson, Block, Assessment, Question, CourseBrandBuild, ScormPackage, GenerationJob, ContentVersion (JSONB per i payload ricchi).
  - _Requisiti: 1.1, 1.2, 4.7, 7.1, 8.5, 9.7_

- [x] 2.2 Autenticazione e contesto tenant
  - Integrare auth OIDC/JWT dietro astrazione; middleware che risolve tenant e ruolo da ogni richiesta.
  - _Requisiti: 1.1, 1.3, 1.6_

- [x] 2.3 Autorizzazione per ruolo e isolamento tenant
  - Guardie per ruolo (Owner/Admin/Editor/Viewer); filtro `tenantId` su tutte le query; valutare Row-Level Security.
  - Test: nessun accesso cross-tenant.
  - _Requisiti: 1.2, 1.3, 12.5_

- [x] 2.4 Piani, quote e feature flag
  - Enforcement limiti (corsi, dimensione knowledge, numero brand, export) con messaggi chiari ed esposizione del consumo.
  - _Requisiti: 1.4, 1.5, 11.4_

## 3. Knowledge base e RAG

- [x] 3.1 Upload file e storage sorgente
  - Endpoint upload con validazione tipo/dimensione; salvataggio via `ObjectStorage`; URL firmati per accesso.
  - _Requisiti: 3.1, 3.2, 12.2, 12.4_

- [x] 3.2 Estrazione multi-formato
  - `DocumentExtractor` per PDF, DOCX, PPTX, XLSX, TXT, Markdown, HTML, CSV → testo + sezioni; rifiuto formati non supportati.
  - _Requisiti: 3.1, 3.2_

- [x] 3.3 Chunking, embeddings e indicizzazione
  - Job di ingestion: chunking semantico con overlap → `EmbeddingsProvider` → upsert in `VectorStore` con metadati `{tenantId, scope, courseId?, documentId, section}`.
  - Scope globale e per-corso. Rimozione embeddings su delete documento.
  - _Requisiti: 3.3, 3.4, 3.7, 3.8_

- [x] 3.4 Retrieval con citazioni
  - Query combinata (obiettivo + brief), filtro per tenant, recupero globale + per-corso, re-rank/dedup, tracciamento provenienza per citazioni.
  - _Requisiti: 3.5, 3.6, 1.2_

## 4. Brief e gestione corso

- [x] 4.1 CRUD brief con validazione e bozze
  - Form/endpoint brief (obiettivi, pubblico, livello, durata, lingua, tono, test richiesti, vincoli); default sensati; salvataggio bozza; associazione brand.
  - _Requisiti: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 4.2 CRUD corso e gerarchia contenuti
  - Creazione corso, moduli, lezioni, block, assessment, question come dati tipizzati validati.
  - _Requisiti: 4.2, 5.3, 6.1_

## 5. Branding

- [x] 5.1 CRUD brand e asset
  - Definizione di N brand per tenant (logo, colori, tipografia, voice, legal); upload asset; validazione; fallback per asset mancanti.
  - _Requisiti: 7.1, 7.6_

- [x] 5.2 Compilazione tema brand (token)
  - Generazione `theme.css` da token (CSS custom properties); self-hosting web font; applicazione senza duplicare logica contenuti.
  - _Requisiti: 7.2, 7.5, 7.6_

## 6. Generazione AI

- [x] 6.1 Adapter Bedrock per LLM ed embeddings
  - `BedrockLLMProvider` (generazione strutturata/tool-use conforme a schema, usage) e `BedrockEmbeddingsProvider`; credenziali solo server-side.
  - _Requisiti: 4.6, 10.2, 10.5_

- [x] 6.2 Orchestrazione job di generazione
  - Pipeline asincrona con stati (in coda/in corso/completato/errore), sotto-job per elemento e retry mirato.
  - _Requisiti: 4.4, 4.5_

- [x] 6.3 Generazione outline
  - Dal brief + contesto RAG → outline strutturato (moduli/lezioni/obiettivi/tipi di test) per revisione.
  - _Requisiti: 4.1, 3.5_

- [x] 6.4 Generazione contenuti lezioni e interazioni
  - Per lezione: generazione Block con scelta coerente del tipo di interazione, lingua/tono da brief e voice di brand, media placeholder, citazioni fonti.
  - _Requisiti: 4.2, 4.3, 4.8, 5.2, 7.4_

- [x] 6.5 Generazione test e valutazioni
  - Domande classiche e valutazioni interattive; test intermedi e finali; punteggio, mastery, tentativi, randomizzazione, feedback.
  - _Requisiti: 6.1, 6.2, 6.3, 6.4_

- [x] 6.6 Audit di generazione
  - Registrazione modello, prompt, parametri, usage/costo stimato, correlation id per ogni chiamata.
  - _Requisiti: 4.7, 11.1, 11.2_

## 7. Editor human-in-the-loop

- [x] 7.1 Editor di revisione contenuti
  - UI per rivedere/modificare outline, lezioni, interazioni, test; rich-text con output sanificabile.
  - _Requisiti: 8.1_

- [x] 7.2 Stato editoriale e versioning
  - Stati bozza/in revisione/approvato per elemento; cronologia `ContentVersion` con confronto e ripristino.
  - _Requisiti: 8.2, 8.5_

- [x] 7.3 Rigenerazione mirata
  - Comandi "rigenera lezione"/"riscrivi in tono X" sul singolo elemento, preservando il resto e creando nuova versione.
  - _Requisiti: 8.4_

- [x] 7.4 Protezione da conflitti concorrenti
  - Lock o avviso di conflitto per evitare sovrascritture silenziose.
  - _Requisiti: 8.6_

## 8. Runtime SCORM e renderer interazioni

- [x] 8.1 Wrapper Run-Time API
  - `scorm-api.js`: individuazione handle (`API_1484_11` / `API`), Initialize/Get/SetValue/Commit/Terminate, mapping completion/success/score/suspend/location; degradazione fuori LMS.
  - _Requisiti: 9.3, 6.5_

- [x] 8.2 Player runtime
  - `player.js` che renderizza `course.json` (moduli/lezioni/block/assessment) applicando `theme.css`; navigazione e bookmarking.
  - _Requisiti: 5.4, 7.2, 9.3_

- [x] 8.3 Renderer delle interazioni (catalogo)
  - Renderer per i tipi del catalogo (rich_text, image_hotspot, accordion_tabs, flashcard, timeline, dragdrop_match/order, click_reveal, branching_scenario, video_checkpoint, carousel_steps), accessibili e tematizzati.
  - _Requisiti: 5.1, 5.4, 5.5_

- [x] 8.4 Runtime test e scoring
  - Rendering e valutazione domande classiche e interattive; invio risultati via Run-Time API (score/success/completion).
  - _Requisiti: 6.2, 6.4, 6.5_

## 9. Packaging ed export SCORM

- [x] 9.1 Generatore manifest
  - `imsmanifest.xml` per SCORM 2004 4th (organizzazione, risorse, `imsss` sequencing, `adlnav`) e variante SCORM 1.2.
  - _Requisiti: 9.1, 9.2, 9.8_

- [x] 9.2 Builder del pacchetto
  - Assemblaggio struttura zip (runtime, renderer, content/course.json, assets tema/brand/media, pages), sanificazione HTML, self-contained offline.
  - _Requisiti: 9.3, 9.4, 12.3_

- [x] 9.3 Export per brand (CourseBrandBuild)
  - Materializzazione corso+brand → pacchetto brandizzato; stesso corso con brand diversi → pacchetti distinti; versionamento e download via URL firmato.
  - _Requisiti: 7.3, 9.7, 12.4_

- [x] 9.4 Validazione pre-export e gate di approvazione
  - Validazione manifest/profilo e integrità risorse; blocco con errori chiari; avviso (con forzatura) se elementi non approvati.
  - _Requisiti: 9.5, 8.3_

- [x] 9.5 Golden test e compatibilità LMS
  - Golden test sul `.zip` (struttura + manifest attesi); checklist di compatibilità per i principali LMS enterprise.
  - _Requisiti: 9.1, 9.6_

## 10. Osservabilità, sicurezza e rifiniture

- [x] 10.1 Log strutturati, metriche e audit
  - Correlation id end-to-end; metriche di generazione per tenant; audit delle azioni rilevanti.
  - _Requisiti: 11.1, 11.2, 11.3_

- [x] 10.2 Hardening sicurezza
  - Cifratura a riposo/in transito, validazione/sanitizzazione input e upload, URL firmati, isolamento credenziali provider.
  - _Requisiti: 12.1, 12.2, 12.4, 10.5_

- [x] 10.3 (Opzionale) Adapter AWS reali
  - `PgVectorStore`/`OpenSearchVectorStore`, `S3ObjectStorage`, `SqsJobQueue`; configurazione per ambiente.
  - _Requisiti: 10.2, 10.3, 10.4_

- [x] 10.4 (Enterprise) Data deletion e isolamento rigoroso
  - Cancellazione dati su richiesta e separazione logica rigorosa per tenant.
  - _Requisiti: 12.5_

- [x] 11. Test end-to-end del flusso completo
  - E2E con `MockLLMProvider`: brief → outline → contenuti → revisione → export, verificando pacchetto valido per due brand diversi.
  - _Requisiti: 2.1, 4.1, 4.2, 7.3, 8.1, 9.1_
