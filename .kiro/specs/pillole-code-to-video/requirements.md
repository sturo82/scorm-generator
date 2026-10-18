# Requisiti — Cartoon pillole via Code-to-Video (Remotion)

## Introduzione

Le pillole (formato libro-game: `branching_scenario` con `pillole: true`) prevedono
un mini-video "cartoon" per scena. L'implementazione attuale genera i video con
modelli neurali su Bedrock (Luma Ray 2), che costano **~$1.50/s a 720p** (~$52 per
una pillola da 7 scene): proibitivo per l'uso standard del prodotto. Luma è stato
**disattivato in produzione** (`PROVIDER_CARTOON_VIDEO=none`).

Questa feature introduce un motore **code-to-video deterministico**: l'LLM produce
una sceneggiatura strutturata (`VideoSpec`), il TTS (Amazon Polly) genera il
voiceover con timestamp a livello di parola, e un motore di animazione
**Remotion/React/SVG** compone scene vettoriali sincronizzate con la voce,
renderizzandole in MP4 via Chromium headless + FFmpeg. Il costo per pillola scende
da decine di dollari a **pochi centesimi** (solo TTS + CPU di rendering), con
qualità vettoriale nitida e controllo al pixel e al millisecondo.

### Principio architetturale vincolante
Il sistema cartoon esistente consuma **byte MP4 + durata** tramite il port
`TextToVideoProvider` (`packages/domain/src/ports/text-to-video-provider.ts`) e li
persiste in `MediaService.applyCartoonResult`. Il motore code-to-video DEVE essere
una **nuova implementazione dello stesso port** (`PROVIDER_CARTOON_VIDEO=remotion`),
senza modifiche a player, schema della scena, gate video→scelte, metering o
persistenza. I provider neurali (luma/nova) restano selezionabili come opzione
premium.

### Ambito (questa spec)
- Nuovo provider cartoon "remotion" (code-to-video) dietro il port esistente.
- Schema `VideoSpec` (Zod) con timing logico ancorato alle parole del voiceover.
- Estensione del provider Polly per restituire gli speech marks a livello di parola.
- Prompt LLM che produce un `VideoSpec` valido componendo una libreria chiusa di
  componenti.
- Libreria Remotion: registry + componenti base + layer di animazione.
- Rendering headless in MP4 e consegna dei byte al flusso esistente.
- Metering del nuovo costo (TTS + minuti di rendering).

### Fuori ambito (non in questa spec)
- Voci premium di terze parti (es. ElevenLabs): upgrade futuro, Polly è sufficiente.
- Provider neurali (Luma/Runway/Sora) come premium: restano com'è, non toccati qui.
- Editor visuale del `VideoSpec` da parte dell'autore (si parte da generazione LLM).
- Personaggi/avatar complessi animati: la libreria iniziale è di template semplici.

### Glossario
- **VideoSpec**: JSON strutturato che descrive canvas, tema, voiceover e scene con
  layer animati. Generato dall'LLM, validato con Zod, consumato da Remotion.
- **WordMark**: timestamp di una parola del voiceover `{ word, startMs, endMs }`,
  ottenuto dagli speech marks di Polly.
- **Ancora (Anchor)**: riferimento temporale logico di un evento: `{ word: N }`,
  `"sceneStart"` o `"sceneEnd"`. Convertito in frame dal renderer usando i WordMark.
- **Registry**: whitelist dei componenti Remotion che l'LLM può comporre. L'LLM
  NON genera codice: sceglie e parametrizza componenti esistenti.
- **Code-to-video**: pipeline che produce video da codice/dati deterministici,
  contrapposta ai modelli video neurali (raster, costosi, non deterministici).

---

## Requisiti

### Requisito 1 — Provider cartoon "remotion" dietro il port esistente
**User story:** Come sistema, voglio un provider code-to-video che implementi
`TextToVideoProvider`, così da generare i cartoon senza toccare il resto del flusso.

#### Criteri di accettazione
1. THE sistema SHALL fornire un provider `remotion` selezionabile via
   `PROVIDER_CARTOON_VIDEO=remotion`, accanto a `luma | nova | mock | none`.
2. THE provider SHALL implementare l'interfaccia `TextToVideoProvider`
   (`startJob` / `fetchJob`) esistente.
3. WHEN il job è completato THEN `fetchJob` SHALL ritornare
   `{ status: 'completed', bytes, contentType: 'video/mp4', durationSec }`,
   compatibile con `MediaService.applyCartoonResult`.
4. THE provider SHALL NOT richiedere modifiche a player, schema `branching_scenario`,
   gate video→scelte, salvataggio dello storageKey o persistenza della scena.
5. WHERE `startJob` o il rendering falliscono THEN il provider SHALL ritornare uno
   stato `failed` con un motivo leggibile, gestito dal polling esistente.

### Requisito 2 — Schema VideoSpec con timing ancorato alle parole
**User story:** Come generatore, voglio uno schema che descriva le scene senza
indicare secondi/frame espliciti, così che il sync con la voce sia esatto.

#### Criteri di accettazione
1. THE sistema SHALL definire `VideoSpec` come schema **Zod** in
   `packages/contracts`, con `canvas` (width/height/fps), `theme`, `voiceover`
   (text/lang/voiceId opzionale) e `scenes[]`.
2. THE scena SHALL contenere `layers[]`, ciascuno con `component` (dal registry),
   `props`, `enter` e `exit` opzionale.
3. THE ancoraggio temporale (`enter.at`, `exit.at`) SHALL accettare
   `{ word: N }`, `"sceneStart"` o `"sceneEnd"`.
4. THE durata della scena SHALL poter essere `"auto"` (derivata dal segmento di
   voiceover coperto) oppure un valore esplicito in ms.
5. IF un `VideoSpec` non è valido secondo lo schema THEN il sistema SHALL
   rifiutarlo (o ripararlo) PRIMA del rendering, mai renderizzarlo alla cieca.
6. THE `component` di ogni layer SHALL essere accettato SOLO se presente nel
   registry (whitelist); valori sconosciuti SHALL essere rifiutati.

### Requisito 3 — Voiceover con timestamp a livello di parola (Polly)
**User story:** Come motore di animazione, voglio i tempi precisi di ogni parola,
così da sincronizzare testi e grafica con la voce.

#### Criteri di accettazione
1. THE provider di sintesi vocale SHALL poter restituire, oltre all'MP3, gli
   **speech marks a livello di parola** (`OutputFormat=json`,
   `SpeechMarkTypes=['word']`) come `WordMark[]`.
2. THE estensione SHALL essere **additiva**: la sintesi MP3 esistente
   (`SpeechProvider`) SHALL continuare a funzionare invariata.
3. WHEN la lingua non ha una voce mappata THEN il provider SHALL usare la voce di
   default esistente, come già avviene per la narrazione.
4. THE consumo Polly di questa sintesi SHALL essere misurato dal metering come già
   avviene per la narrazione.

### Requisito 4 — Generazione del VideoSpec via LLM
**User story:** Come autore, voglio che dal prompt/storyboard della scena venga
prodotto automaticamente un VideoSpec coerente e valido.

#### Criteri di accettazione
1. THE sistema SHALL fornire un prompt (`videoSpecPrompt`) che, dato il
   `placeholderPrompt`/`alt` della scena e la lingua, produce un `VideoSpec`.
2. THE prompt SHALL vincolare l'LLM a usare SOLO i `component` del registry e a
   restituire JSON conforme allo schema.
3. THE testo del voiceover SHALL essere nella lingua del corso.
4. IF l'output LLM non è un VideoSpec valido THEN il sistema SHALL tentare una
   riparazione/retry e, se persiste, marcare la scena `failed` con motivo chiaro.

### Requisito 5 — Libreria di componenti Remotion (vettoriale)
**User story:** Come prodotto, voglio template vettoriali riutilizzabili in stile
explainer 2D, così da avere risultati nitidi e coerenti.

#### Criteri di accettazione
1. THE sistema SHALL fornire un `registry` che mappa nomi di componente a
   componenti React/Remotion.
2. THE libreria iniziale SHALL includere almeno: `TextReveal`, `Caption`
   (sottotitolo karaoke sincronizzato), `BulletList`, un diagramma concettuale
   (es. `ChainDiagram`) e `IconStat`.
3. THE componenti SHALL animarsi tramite interpolazioni/spring (tweening), NON
   fotogramma per fotogramma, e usare grafica vettoriale (SVG/DOM) con colori
   piatti del `theme`.
4. THE componente `Caption` SHALL evidenziare la parola corrente usando i WordMark.
5. THE layer di animazione SHALL applicare entrate/uscite generiche (fade/slide/pop)
   secondo `enter`/`exit`.

### Requisito 6 — Rendering headless in MP4
**User story:** Come sistema, voglio compilare VideoSpec + audio + componenti in un
MP4, così da consegnarlo al flusso cartoon esistente.

#### Criteri di accettazione
1. THE provider SHALL fare il bundle della composizione Remotion e renderizzarla con
   `@remotion/renderer` (codec h264) producendo un MP4.
2. THE durata del video SHALL coincidere con la durata del voiceover (coerenza
   audio↔video), e `durationSec` SHALL essere derivata dai frame/fps reali.
3. THE rendering SHALL avvenire in modo da NON bloccare il thread principale
   dell'API (worker/processo/ coda), coerente con il polling background esistente.
4. WHERE l'ambiente di rendering non ha le dipendenze Chromium THEN il deploy SHALL
   fornirle (immagine) o delegare a un runner dedicato; la scelta infra è
   documentata nel design.
5. THE file temporanei di rendering SHALL essere ripuliti dopo la consegna dei byte.

### Requisito 7 — Configurazione, metering e costi
**User story:** Come operatore, voglio costi tracciati e configurazione chiara, così
da tenere la spesa sotto controllo.

#### Criteri di accettazione
1. THE configurazione SHALL esporre il provider `remotion` e i suoi parametri
   (risoluzione, fps, voce TTS di default) via env, con default sicuri.
2. THE metering SHALL registrare il costo reale della pipeline (TTS Polly + tempo di
   rendering) al posto del listino $/s dei modelli neurali.
3. THE quota mensile per tenant esistente (`CARTOON_VIDEO_MONTHLY_QUOTA`) SHALL
   restare applicabile anche al provider remotion.
4. WHERE serve un confronto THEN la documentazione SHALL riportare i costi
   code-to-video vs neurali.

### Requisito 8 — Compatibilità, test e non-regressione
**User story:** Come team, voglio che la feature non rompa nulla e sia verificabile.

#### Criteri di accettazione
1. THE gate SHALL restare verde: build + tutti i test + lint.
2. THE schema `VideoSpec` e la conversione ancora→frame SHALL avere test unitari.
3. THE provider mock esistente SHALL continuare a funzionare in dev
   (`PROVIDER_CARTOON_VIDEO=mock`).
4. WHEN `PROVIDER_CARTOON_VIDEO=none` THEN il comportamento SHALL restare quello
   attuale (bottone pellicola → "provider non configurato").
