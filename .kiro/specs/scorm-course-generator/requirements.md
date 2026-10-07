# Requisiti — SCORM Course Generator

## Introduzione

SCORM Course Generator è una webapp SaaS multi-tenant che consente a organizzazioni (con piani Premium ed Enterprise) di generare corsi e-learning completi a partire da un brief iniziale, con l'ausilio di modelli AI di frontiera (via Amazon Bedrock, dietro un'astrazione provider-agnostica). Ogni corso è composto da più lezioni interattive e test (intermedi e finali, sia classici che interattivi), può essere arricchito con una knowledge base esistente (globale a livello di tenant e specifica per corso), viene brandizzato secondo uno dei brand definiti dall'organizzazione, ed è esportabile come pacchetto SCORM importabile su diversi LMS. Il flusso prevede sempre una fase di revisione umana (human-in-the-loop) prima dell'export.

### Obiettivi di prodotto
- Ridurre drasticamente il tempo di produzione di corsi e-learning professionali.
- Garantire output di qualità enterprise, brandizzato e conforme agli standard SCORM.
- Evitare vendor lock-in sull'AI mantenendo i provider dietro interfacce astratte.
- Mantenere il controllo editoriale umano su ogni contenuto generato.

### Glossario
- **Tenant / Organizzazione**: cliente del SaaS; contiene utenti, brand, knowledge globale, corsi.
- **Brief**: input strutturato che definisce obiettivi, pubblico, durata, tono e vincoli del corso.
- **Knowledge Base (KB)**: insieme di documenti caricati usati come contesto RAG. Globale (tenant) o per-corso.
- **Brand**: set di asset e regole visive/verbali (logo, colori, font, tono) applicato a un corso.
- **Interazione**: componente didattico interattivo (es. flashcard, drag&drop, hotspot).
- **SCORM package**: archivio `.zip` conforme (SCORM 2004 4th Edition primario, SCORM 1.2 opzionale).

---

## Requisiti

### Requisito 1 — Autenticazione e multi-tenancy
**User story:** Come amministratore di organizzazione, voglio che la mia organizzazione sia isolata con i propri utenti, dati e piano, così da operare in sicurezza separato dagli altri tenant.

#### Criteri di accettazione
1. WHEN un utente si registra o viene invitato THEN il sistema SHALL associarlo a un unico tenant con un ruolo (Owner, Admin, Editor, Viewer).
2. THE sistema SHALL isolare tutti i dati (corsi, knowledge, brand, pacchetti) per tenant, impedendo l'accesso cross-tenant.
3. WHEN un utente autenticato esegue una richiesta THEN il sistema SHALL autorizzare l'operazione in base al ruolo e al tenant.
4. THE sistema SHALL supportare piani Premium ed Enterprise con limiti e funzionalità differenziati (quote, feature flag).
5. WHERE un piano impone un limite (es. numero corsi, dimensione knowledge, numero brand) THE sistema SHALL applicare il limite e comunicare chiaramente il superamento.
6. WHILE un utente non è autenticato THE sistema SHALL negare l'accesso a tutte le risorse protette.

### Requisito 2 — Definizione del brief
**User story:** Come editor, voglio definire un brief iniziale strutturato, così che l'AI generi un corso allineato ai miei obiettivi e vincoli.

#### Criteri di accettazione
1. WHEN un editor crea un corso THEN il sistema SHALL raccogliere un brief con: titolo, obiettivi di apprendimento, pubblico target, livello, durata stimata, lingua, tono di voce, numero/approfondimento lezioni desiderato, tipi di test richiesti e vincoli.
2. THE sistema SHALL validare i campi obbligatori del brief prima di avviare la generazione.
3. WHERE l'utente fornisce un brief parziale THE sistema SHALL proporre valori di default sensati e segnalare i campi mancanti.
4. THE sistema SHALL permettere di salvare un brief come bozza e riprenderlo in seguito.
5. WHERE il tenant ha definito brand THE sistema SHALL permettere di associare uno o più brand al corso già in fase di brief.

### Requisito 3 — Gestione della Knowledge Base e RAG
**User story:** Come editor, voglio caricare la mia knowledge esistente (generale e specifica del corso), così che l'AI generi contenuti accurati e contestualizzati.

#### Criteri di accettazione
1. WHEN un utente carica un documento THEN il sistema SHALL accettare formati comuni (PDF, DOCX, PPTX, XLSX, TXT, Markdown, HTML, CSV) ed estrarne il testo.
2. WHERE un formato non è supportato THE sistema SHALL rifiutare il file con un messaggio chiaro.
3. THE sistema SHALL distinguere knowledge **globale** (riusabile da tutti i corsi del tenant) e knowledge **per-corso**.
4. WHEN un documento viene caricato THEN il sistema SHALL effettuare chunking, generare embeddings e indicizzarli in un vector store associato al tenant.
5. WHEN l'AI genera contenuti THEN il sistema SHALL recuperare i chunk rilevanti (globale + per-corso) e usarli come contesto (RAG).
6. THE sistema SHALL tracciare la provenienza (documento, sezione) dei contenuti recuperati per supportare la citazione delle fonti.
7. WHEN un documento viene eliminato THEN il sistema SHALL rimuovere i relativi embeddings dall'indice.
8. THE astrazione di embeddings e vector store SHALL essere provider-agnostica (default Bedrock + vector store configurabile).

### Requisito 4 — Generazione del corso con AI
**User story:** Come editor, voglio che l'AI generi la struttura e i contenuti del corso dal brief e dalla knowledge, così da partire da una bozza completa invece che dal foglio bianco.

#### Criteri di accettazione
1. WHEN un editor avvia la generazione THEN il sistema SHALL produrre prima un **outline** del corso (moduli → lezioni → obiettivi → tipi di test) per revisione.
2. WHEN l'outline è approvato THEN il sistema SHALL generare il contenuto di ciascuna lezione (testo didattico, elementi interattivi, media placeholder) e i test associati.
3. THE sistema SHALL generare i contenuti nella lingua e nel tono di voce indicati nel brief/brand.
4. THE generazione SHALL essere eseguita in modo asincrono con stato osservabile (in coda, in corso, completata, errore).
5. WHERE la generazione di un elemento fallisce THE sistema SHALL permettere il retry del singolo elemento senza rigenerare l'intero corso.
6. THE sistema SHALL usare l'astrazione provider AI, consentendo di selezionare modello/provider senza modifiche al dominio.
7. THE sistema SHALL registrare per ogni generazione il modello usato, i prompt, i parametri e un identificativo per audit/costi.
8. WHERE la knowledge è disponibile THE contenuto generato SHALL essere ancorato ai documenti recuperati e citarne le fonti quando pertinente.

### Requisito 5 — Catalogo di lezioni e interazioni
**User story:** Come editor, voglio che le lezioni usino diversi tipi di interazione, così da avere corsi coinvolgenti e non solo testo.

#### Criteri di accettazione
1. THE sistema SHALL fornire un catalogo di tipi di interazione includendo almeno: testo/rich-content, immagine con hotspot, accordion/tabs, flashcard, timeline, drag-and-drop (abbinamento e ordinamento), click-to-reveal, scenario a ramificazione (branching), video con punti di controllo, carosello/step-by-step.
2. WHEN l'AI genera una lezione THEN il sistema SHALL scegliere tipi di interazione coerenti con l'obiettivo didattico e i vincoli del brief.
3. THE ogni tipo di interazione SHALL avere uno schema dati tipizzato e validabile.
4. THE ogni tipo di interazione SHALL avere un renderer runtime incluso nel pacchetto SCORM, funzionante offline nell'LMS.
5. THE interazioni SHALL essere accessibili (navigazione da tastiera, ARIA, contrasto conforme).

### Requisito 6 — Test e valutazioni
**User story:** Come editor, voglio test intermedi e finali, classici e interattivi, così da misurare l'apprendimento e tracciare i risultati nell'LMS.

#### Criteri di accettazione
1. THE sistema SHALL supportare domande classiche: scelta singola, scelta multipla, vero/falso, risposta aperta breve, abbinamento, riordino, compilazione (fill-in-the-blank).
2. THE sistema SHALL supportare valutazioni interattive basate sui tipi di interazione (es. drag-and-drop valutato, hotspot valutato, scenario con scoring).
3. THE sistema SHALL permettere test **intermedi** (per modulo/lezione) e un test **finale** di corso.
4. WHERE configurato THE sistema SHALL applicare punteggio, soglia di superamento (mastery score), tentativi massimi, randomizzazione domande/risposte e feedback.
5. WHEN l'utente completa un test nell'LMS THEN il runtime SCORM SHALL riportare punteggio, stato di superamento e completamento tramite la Run-Time API.
6. THE sistema SHALL permettere all'editor di modificare domande, risposte corrette, punteggi e feedback prima dell'export.

### Requisito 7 — Branding
**User story:** Come amministratore, voglio definire più brand e generare lo stesso corso per brand diversi, così da riusare i contenuti mantenendo l'identità visiva di ciascun marchio.

#### Criteri di accettazione
1. THE sistema SHALL permettere a un tenant di definire N brand, ciascuno con: nome, logo/i, palette colori (primari, secondari, stati), tipografia (famiglie e scale), favicon, e opzionalmente tono di voce e disclaimer legali.
2. WHEN un corso viene generato o esportato con un brand THEN il sistema SHALL applicare gli asset e le regole del brand a tutte le pagine e interazioni.
3. THE sistema SHALL permettere di esportare lo **stesso corso** con brand diversi, producendo pacchetti SCORM distinti coerenti con ciascun brand.
4. WHERE un brand definisce un tono di voce THE generazione AI SHALL rispettare quel tono.
5. THE applicazione del brand SHALL avvenire tramite temi/token (es. CSS custom properties) senza duplicare la logica dei contenuti.
6. WHERE un asset di brand è mancante o non valido THE sistema SHALL usare un fallback e segnalarlo.

### Requisito 8 — Revisione umana (human-in-the-loop)
**User story:** Come editor, voglio rivedere e modificare ogni contenuto generato prima dell'export, così da garantire qualità e correttezza.

#### Criteri di accettazione
1. THE sistema SHALL fornire un editor per rivedere e modificare outline, lezioni, interazioni e test generati.
2. THE sistema SHALL tracciare lo stato editoriale di ogni elemento (bozza, in revisione, approvato).
3. WHERE un elemento non è approvato THE sistema SHALL avvisare prima di consentire l'export (con possibilità di forzare).
4. THE sistema SHALL permettere la rigenerazione mirata (es. "rigenera questa lezione" / "riscrivi in tono più formale") preservando il resto.
5. THE sistema SHALL mantenere una cronologia delle versioni dei contenuti con possibilità di confronto e ripristino.
6. WHERE più utenti collaborano THE sistema SHALL evitare sovrascritture silenziose (lock o merge/avviso di conflitto).

### Requisito 9 — Export SCORM e compatibilità LMS
**User story:** Come editor, voglio esportare il corso come pacchetto SCORM, così da importarlo su diversi LMS.

#### Criteri di accettazione
1. THE sistema SHALL esportare pacchetti conformi a **SCORM 2004 4th Edition** (target primario) e, opzionalmente, **SCORM 1.2**.
2. WHEN si esporta THEN il sistema SHALL generare un `imsmanifest.xml` valido con organizzazione, risorse, dipendenze e (per 2004) regole di sequencing e navigation.
3. THE pacchetto SHALL includere una runtime che comunica con l'LMS tramite la SCORM Run-Time API (find API handle, Initialize, Get/SetValue, Commit, Terminate) e gestisce completion, success status, score e bookmarking/suspend data.
4. THE pacchetto SHALL essere un singolo `.zip` auto-contenuto, funzionante offline nell'LMS (nessuna dipendenza da rete esterna a runtime).
5. WHEN l'export viene richiesto THEN il sistema SHALL validare la conformità del manifest e segnalare eventuali errori prima di produrre il pacchetto.
6. THE export SHALL essere compatibile con i principali LMS enterprise (es. Moodle, Cornerstone, SuccessFactors, Docebo), evitando dipendenze non supportate.
7. THE sistema SHALL rendere disponibili i pacchetti generati per il download e conservarli con versionamento per tenant/corso/brand.
8. WHERE sono richiesti test intermedi e finali THE sequencing SHALL rispettare prerequisiti e condizioni di completamento definiti.

### Requisito 10 — Astrazione dei provider e portabilità
**User story:** Come responsabile tecnico, voglio che i provider AI/embeddings/vector-store siano dietro interfacce astratte, così da evitare vendor lock-in e poter aggiungere provider futuri.

#### Criteri di accettazione
1. THE dominio applicativo SHALL dipendere da interfacce astratte per: generazione testo (LLM), embeddings, vector store, storage dei file e coda dei job.
2. THE sistema SHALL fornire un'implementazione di default basata su Amazon Bedrock per LLM ed embeddings.
3. WHEN si aggiunge un nuovo provider THEN SHALL essere sufficiente implementare l'interfaccia e registrarlo via configurazione, senza modificare la logica di dominio.
4. THE configurazione del provider SHALL essere definibile per ambiente e, dove sensato, per tenant.
5. THE sistema SHALL isolare le credenziali dei provider e non esporle lato client.

### Requisito 11 — Osservabilità, costi e audit
**User story:** Come amministratore, voglio tracciare utilizzo, costi e azioni, così da governare consumi e conformità.

#### Criteri di accettazione
1. THE sistema SHALL registrare le operazioni di generazione (modello, token/costo stimato, durata, esito) per tenant.
2. THE sistema SHALL fornire log strutturati e tracciabilità delle richieste (correlation id).
3. THE sistema SHALL mantenere un audit delle azioni rilevanti (creazione/modifica/esportazione/eliminazione) con utente, timestamp e tenant.
4. WHERE un piano prevede quote THE sistema SHALL esporre il consumo corrente rispetto ai limiti.

### Requisito 12 — Sicurezza e privacy dei dati
**User story:** Come responsabile sicurezza, voglio che i dati e i documenti caricati siano protetti, così da rispettare i requisiti enterprise.

#### Criteri di accettazione
1. THE sistema SHALL cifrare i dati a riposo (storage, database, indice) e in transito (TLS).
2. THE sistema SHALL validare e sanificare tutti gli input, inclusi i file caricati (tipo, dimensione, contenuto malevolo).
3. THE contenuto HTML generato per il pacchetto SCORM SHALL essere sanificato per prevenire XSS all'interno dell'LMS.
4. THE accesso ai file sorgente e ai pacchetti SHALL avvenire tramite URL firmati a scadenza, non pubblici.
5. WHERE richiesto dal piano Enterprise THE sistema SHALL supportare la cancellazione dei dati su richiesta (data deletion) e la separazione logica rigorosa per tenant.
