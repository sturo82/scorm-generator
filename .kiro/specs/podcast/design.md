# Design — Podcast (serie di puntate audio)

## Panoramica
Un contenuto autonomo, sul modello della libreria video: entità proprie per
azienda, pagina propria, lavori in background con ripresa. Quattro blocchi:

1. **Dati e contratti**: serie, puntate, voci clonate e consensi (Prisma + zod).
2. **Generazione**: piano → copioni a due voci → audio (testo e voce a crediti).
3. **Voci**: porta `VoiceCloneProvider` con adattatore Polly (Francoforte).
4. **Pubblicazione**: area pubblica servita da CloudFront su un sottodominio, feed RSS generato alla pubblicazione.

```
Web (/podcasts)
   │ serie · fonti · piano · copioni · voci · pubblica
   ▼
PodcastsController (@Roles EDITOR)
   ├─ PodcastsService          CRUD, stato, preventivo
   ├─ PodcastGenerationService piano → copioni → audio (lavoro in background, ripresa)
   ├─ PodcastVoicesService     catalogo, clonazione, consenso, eliminazione
   └─ PodcastPublishService    copia MP3/cover nell'area pubblica, genera feed.xml
         │
         ├─ SpeechProvider (Polly, regione voce)      sintesi per battuta
         ├─ VoiceCloneProvider (Polly eu-central-1)   createVoice / getVoice / deleteVoice
         ├─ RetrievalService + RSS (esistenti)        fonti
         ├─ BillingService (esistente)                reserve / settle / release
         └─ ObjectStorage                             privato (lavoro) e pubblico (feed)
```

## Decisioni di design

### Contenuto autonomo, non formato di lezione
Una serie non ha moduli, quiz né avanzamento. Aggiungere `podcast` a `LessonFormat`
richiederebbe di toccare contratti, piano del corso, prezzi a pacchetti, player e
anteprima, e non darebbe un feed. Si segue invece la libreria video: tabelle
proprie, `tenantId`, protezione a livello di riga, pagina e voce di menu.

### Un lavoro proprio, non l'autopilot
`GenerationJob` ha `courseId` opzionale, ma `GenJobPayload` e l'autopilot sono
legati al corso. Si segue il modello dei copioni video: stato e lease sulla riga
della puntata, battito ogni 60 s, ripresa all'avvio per le puntate con lease
scaduto. Una puntata è l'unità di ripresa: ogni passo scrive su storage e sul DB
prima di passare al successivo.

### Voce: porta separata dalla sintesi
Oggi `SpeechProvider` sintetizza soltanto. La creazione delle voci ha un ciclo di
vita diverso (asincrono, con stato, consenso, eliminazione), quindi si aggiunge
una porta `VoiceCloneProvider` accanto a `SpeechProvider`:

```ts
interface VoiceCloneProvider {
  readonly id: string; // 'polly' | 'heygen' | 'mock'
  languages(): string[];                       // lingue clonabili
  createVoice(input: {
    name: string; language: string; clientToken: string;
    recordings: Array<{ bytes: Uint8Array; format: 'wav' | 'mp3' | 'flac' | 'ogg_vorbis' }>;
    termsAccepted: true;
  }): Promise<{ voiceId: string; status: 'pending' | 'active' | 'failed' }>;
  getVoice(voiceId: string): Promise<{ status: 'pending' | 'active' | 'failed'; reason?: string }>;
  deleteVoice(voiceId: string): Promise<void>;
}
```

Adattatore Polly (verificato sulla [documentazione AWS](https://docs.aws.amazon.com/polly/latest/APIReference/API_CreateVoice.html)):
- `CreateVoice` con `LanguageCode`, `Name` (lettere, cifre, `-` e `_`, massimo 64), `TermsAccepted: true`, `ClientToken` (idempotenza) e le registrazioni; risponde subito con la voce in stato *pending*.
- Poi `GetVoice` ogni 30 secondi circa finché è attiva; la creazione richiede in genere 5-10 minuti, quindi è un passo di preparazione e non parte di una richiesta dell'utente. Prima di renderla disponibile Polly verifica che somigli al parlante (controllo di qualità, non di consenso).
- Quando è attiva, il suo **`Voice.Id`** (assegnato da Polly, diverso dal nome) si usa come `VoiceId` in `SynthesizeSpeech`.
- Lingue: it-IT, en-US, fr-FR, de-DE, es-US, pt-BR, hi-IN. La voce parla la lingua con cui è stata creata.
- Solo motore **generativo**. Appartiene all'account e alla regione in cui nasce.
- Per correggere la pronuncia di nomi e sigle i tag SSML `<phoneme>` funzionano con le voci clonate in inglese, francese, italiano, tedesco e spagnolo. Lo stesso testo può uscire leggermente diverso a ogni richiesta: per questo l'ascolto di revisione prima di pubblicare è parte del flusso.
- Permessi: chi crea o elimina voci (`polly:CreateVoice`, `polly:DeleteVoice`) è meglio che sia un ruolo separato da quello che sintetizza. Il permesso `SynthesizeSpeech` con risorsa `*`, che oggi abbiamo, copre anche tutte le voci clonate dell'account.
- Esiste un limite al numero di voci per account e regione (`custom-voice-max-count`).
- Accesso su approvazione dell'account AWS: finché non c'è, l'adattatore risponde "non abilitato" e l'interfaccia nasconde la clonazione (requisito 6.10).

**SDK:** `@aws-sdk/client-polly` è fermo alla 3.600.0, che non ha i comandi per le voci personalizzate. Va aggiornato in `packages/adapters`, controllando che la sintesi esistente non cambi comportamento.

**Regione:** la sintesi e il metering Polly di oggi usano `media.region` (`MEDIA_REGION`), che è anche la regione di Bedrock per le immagini. Non si tocca. Si introduce `SPEECH_REGION` (per il podcast: `eu-central-1`), con un secondo client Polly. Le voci del catalogo e quelle clonate si sintetizzano in quella regione, perché una voce clonata funziona solo dove è stata creata. Il motore generativo è disponibile a Francoforte ([elenco regioni](https://docs.aws.amazon.com/polly/latest/dg/generative-voices.html)), non a Irlanda. Verificato sull'account con `describe-voices`: a Francoforte le voci generative italiane sono **Bianca, Beatrice** (donne) e **Lorenzo** (uomo); a Irlanda nessuna. Bastano per due conduttori senza clonare.

**Registrazioni:** nella richiesta si possono inviare i byte (massimo 5 MB per registrazione prima del base64) oppure un oggetto S3 nella regione dell'endpoint. Il bucket degli asset non è a Francoforte: si inviano i byte. Un minuto a 24 kHz mono 16 bit pesa circa 2,9 MB, quindi le registrazioni si dividono in **prese di al massimo 60 secondi**. La conversione (decodifica, mono, 24 kHz, 16 bit, divisione) si fa **nel browser** con le API audio, come già si fa nel browser per i fotogrammi dei video. Il server controlla durata (10 s-15 min per presa, 15 min in totale), formato e peso, senza ricodificare.

**Alternativa:** HeyGen offre la clonazione istantanea con una registrazione di circa un minuto e la sintesi con quella voce, ma restituisce WAV a 44,1 kHz, non accetta il tag `<break>` per le voci istantanee e non si può riaddestrare. L'adattatore HeyGen è fuori dalla prima versione; la porta lo rende possibile dopo.

### Il motore generativo non fornisce i tempi delle parole
Per le voci generative Polly non restituisce i *speech marks* ([documentazione](https://docs.aws.amazon.com/polly/latest/dg/generative-voices.html)). Il codice attuale li ricava dalla voce neurale della stessa persona, ma una voce clonata non ha una gemella neurale. Quindi:
- si sintetizza **una battuta per volta** e la durata reale di ciascun file si misura con `mp3DurationMs`;
- i tempi **per battuta** sono esatti e bastano per evidenziare la battuta corrente;
- il dettaglio parola per parola, se servirà, si ottiene con Amazon Transcribe sul file finale (fase successiva).

### Audio: una battuta per chiamata, poi unione
Ogni battuta (al massimo circa 1500 caratteri, sotto il limite di Polly di circa 3000) è una chiamata con la voce del suo conduttore. I file MP3 si concatenano, con una breve pausa tra le battute.
- La pausa è un breve file MP3 di silenzio con gli stessi parametri della voce (24 kHz mono, predefiniti del motore generativo), inserito tra le battute. In alternativa il tag `<break>` in SSML, ma Polly dichiara che per il motore generativo sono supportati solo alcuni tag: da verificare con una prova prima di sceglierlo.
- La concatenazione di MP3 con gli stessi parametri è già usata per i voiceover lunghi. Resta da provare con due voci diverse.
- Il livello sonoro dei due conduttori può differire: se in prova è udibile, si aggiunge un passo di normalizzazione (da valutare se `ffmpeg` è disponibile nell'immagine dell'API). È una decisione aperta.

## Modello dati (Prisma)

```prisma
enum PodcastFeedVisibility { PUBLIC PRIVATE }
enum PodcastEpisodeState   { DRAFT PLANNED WRITING SCRIPT_READY VOICING READY FAILED }
enum PodcastVoiceStatus    { CREATING READY FAILED DELETED }

model Podcast {
  id, tenantId (Tenant, cascade), title, description, language,
  category, author, contactEmail, explicit Boolean,
  coverKey String?, hosts Json,            // [{ key:'A'|'B', name, voice:{ kind:'catalog'|'clone', id } }]
  brief Json, knowledgeDocIds Json, feedSources Json,
  visibility PodcastFeedVisibility @default(PRIVATE),
  publicId String @unique,                 // casuale, nell'indirizzo pubblico
  feedToken String?,                       // solo se PRIVATE: segreto, rigenerabile
  createdAt, updatedAt, @@index([tenantId])
}

model PodcastEpisode {
  id, podcastId (cascade), tenantId, position Int, title, summary,
  targetMinutes Int, sources Json,         // documenti e articoli usati
  script Json,                             // { turns: [{ host:'A'|'B', text }] }
  state PodcastEpisodeState, error String?, leaseUntil DateTime?,
  audioKey String?, audioStale Boolean @default(false),
  durationSec Int?, sizeBytes Int?, turnTimings Json?,   // [{ i, startMs, endMs }]
  guid String @unique,                     // identificativo stabile nel feed
  publishedAt DateTime?, publicAudioKey String?,
  createdAt, updatedAt, @@index([podcastId, position])
}

model PodcastVoice {
  id, tenantId, name, language, provider String,   // 'polly'
  providerVoiceId String?, region String,
  status PodcastVoiceStatus, failureReason String?,
  createdBy String, createdAt, deletedAt DateTime?
}

model PodcastVoiceConsent {            // sullo schema di AvatarConsentRecord
  id, voiceId (PodcastVoice), tenantId,
  speakerName String, attestedBy String, attestedAt DateTime,
  statementVersion String,             // versione del testo accettato
  termsAccepted Boolean
}
```
Una migrazione con la protezione a livello di riga su tutte le tabelle, come
`0015_video_asset`. Il testo del consenso accettato resta in `statementVersion`
con il testo versionato nel codice.

**Contratti** (`packages/contracts/src/podcast.ts`): schemi zod di brief, piano, copione (battute con `host` e `text`), voce, consenso e vista del feed, più `podcastWordBudget(minutes)` sul ritmo di parlato (circa 150 parole al minuto, da tarare sulle puntate generate, come `wordsPerSec` dei video).

## Generazione

### Fonti
- **Brief:** tema, pubblico, obiettivi, tono.
- **Documenti:** `RetrievalService.retrieve({ documentIds })` e `fitContext`, come per i corsi.
- **Feed RSS:** l'utente sceglie gli articoli dal feed dell'azienda (il modulo RSS esistente li legge e ne estrae il testo); titolo e indirizzo restano in `sources` della puntata. Il testo degli articoli entra nel contesto come i passaggi dei documenti.

### Passi (una riserva di crediti per passo)
1. **Piano:** una chiamata strutturata restituisce titoli, sintesi e taglio delle puntate. Voce a crediti: `text_light`.
2. **Copione:** una chiamata per puntata, in ordine, con i riassunti delle puntate precedenti per la continuità. Schema: `{ turns: [{ host, text }] }`. Lunghezza tarata con `podcastWordBudget`; se fuori tolleranza si chiede una riscrittura (come `writeVideoScript`). Controllo deterministico alla fine: battute non vuote, host validi, nessun elenco o simbolo, lunghezza massima per battuta. Voce a crediti: `text_standard`.
3. **Audio:** una battuta per volta, poi unione, durata, tempi per battuta, salvataggio. Voce a crediti: `audio_narration` a 1000 caratteri.

### Crediti
- Si riusano le voci di listino già esistenti, quindi non servono nuovi prezzi da Manager.
- Il listino di riserva dà circa 70 crediti per una puntata da 10 minuti (36 per il copione, 36 per l'audio, circa 9000 caratteri). Il prezzo vero viene da Manager: va solo indicato nel preventivo.
- Con le voci generative, il listino interno dei consumi (`PricingRate`) ha oggi solo la riga delle voci neurali (`polly-neural`): serve una riga `polly-generative` per `CHARACTERS` nella regione di Francoforte.
- Preventivo prima di ogni passo; `reserve` prima, `settle` con le unità reali, `release` sul resto. La clonazione della voce non costa crediti. Il costo AWS in valuta non è mai mostrato al cliente.
- I costi non si attribuiscono a un corso (`courseId` assente), come per i video della libreria.

## Pubblicazione e feed

### Area pubblica
Il bucket degli asset è privato e blocca l'accesso pubblico, e resta così. Si aggiunge una **distribuzione CloudFront dedicata** sul sottodominio per i podcast, con origine il bucket: CloudFront lo legge tramite OAC e una policy del bucket concede la lettura solo a un prefisso, per esempio `public-podcasts/`. Gli utenti raggiungono quei file solo attraverso la distribuzione.
- Certificato ACM (in `us-east-1`, come quello del sito) e record DNS `podcast.knowkube.com` nella zona esistente (`dns.tf`).
- I file audio e le copertine stanno in `public-podcasts/<publicId>/<guid>.mp3`: nomi non indovinabili, indirizzi che non scadono, richieste parziali (Range) gestite da CloudFront e S3.
- Il feed è un file statico `public-podcasts/<publicId>/feed.xml` (pubblico) oppure `.../<feedToken>/feed.xml` (privato).
- Permessi IAM per l'API: scrittura e cancellazione solo su quel prefisso.

### Perché un feed statico
Il feed cambia solo quando si pubblica, ritira o modifica una puntata. Scriverlo in S3 a ogni cambio evita un server in mezzo, regge qualsiasi numero di richieste di Spotify e Apple e non dipende dallo stato dell'API. Dopo la scrittura si invalida il percorso in CloudFront; con un tempo di cache breve (minuti) gli aggiornamenti arrivano alle piattaforme, che comunque leggono il feed con i loro tempi.

### Pubblica e ritira
- **Pubblica:** copia l'MP3 (e la copertina) dal prefisso privato a quello pubblico, imposta `publishedAt` e `publicAudioKey`, rigenera il feed. `guid` non cambia mai.
- **Ritira:** toglie la puntata dal feed e cancella il file pubblico.
- **Rigenerazione dell'audio di una puntata già pubblicata:** l'MP3 pubblico si sostituisce solo con una nuova pubblicazione esplicita; il `guid` resta lo stesso.
- **Serie privata o eliminata:** si cancellano i file pubblici e si rigenera il feed vuoto o lo si toglie.

### Contenuto del feed
RSS 2.0 con lo spazio dei nomi `itunes`: titolo, descrizione, lingua, autore, proprietario con email, categoria, `explicit`, copertina; per ogni puntata `title`, `description`, `pubDate`, `guid` (non è un indirizzo web, `isPermaLink="false"`), `enclosure` con indirizzo, dimensione in byte e tipo `audio/mpeg`, `itunes:duration`. Si valida prima di scriverlo (campi obbligatori, copertina quadrata di almeno 1400 px, durate e dimensioni coerenti).

Questi requisiti derivano dalle regole generali degli elenchi di podcast; vanno **controllati sulle pagine ufficiali di Apple e Spotify al momento dell'implementazione**, perché possono cambiare.

### Feed pubblico e privato
- **Pubblico:** `…/<publicId>/feed.xml`, adatto a Spotify e Apple.
- **Privato:** `…/<publicId>/<feedToken>/feed.xml`, per le piattaforme custom. Il token è lungo e casuale; rigenerarlo sposta i file nel nuovo percorso e invalida il vecchio.
- Un file audio pubblico è comunque raggiungibile da chi ne conosce l'indirizzo: la privacy del feed privato dipende dalla segretezza del token. Va scritto chiaramente nell'interfaccia.

## API (`/podcasts`, ruolo EDITOR per le scritture)
- `GET/POST /podcasts`, `GET/PUT/DELETE /podcasts/:id`
- `POST /podcasts/:id/plan` (preventivo + avvio), `PUT /podcasts/:id/episodes` (ordine e modifiche)
- `POST /podcasts/:id/episodes/:eid/script`, `PUT .../script` (modifica), `POST .../audio`
- `GET /podcasts/:id/estimate`
- `POST /podcasts/:id/episodes/:eid/publish`, `DELETE .../publish`
- `POST /podcasts/:id/feed/rotate-token`, `PUT /podcasts/:id/feed` (visibilità)
- `GET /podcast-voices` (catalogo e clonate), `POST /podcast-voices/clone`, `GET /podcast-voices/:id`, `DELETE /podcast-voices/:id`, `GET /podcast-voices/:id/preview`
- `GET /podcasts/:id/episodes/:eid/audio` (URL firmato), `.../transcript?format=txt|srt|vtt`

## Interfaccia web
- Voce di menu **Podcast** (`/podcasts`); elenco delle serie con stato e prossima azione.
- **Creazione guidata:** tema e fonti (brief, documenti, articoli RSS), lingua, numero e durata delle puntate, conduttori e voci con anteprima, preventivo, conferma.
- **Pagina della serie:** puntate con stato e avanzamento, editor del copione a battute, lettore con battuta evidenziata, pubblica/ritira.
- **Feed:** indirizzo da copiare, scelta pubblico/privato, rigenerazione del token, istruzioni per Spotify e Apple Podcasts.
- **Voci:** elenco delle voci clonate, creazione guidata (consenso → caricamento dei file → conversione nel browser → invio → attesa dello stato), eliminazione.
- Dati dell'interfaccia: nuovo `podcasts-types.ts`, funzioni nel client HTTP e nel client di prova, hook di lettura e scrittura.

## Sicurezza e privacy
- Voci come dati biometrici: consenso per ogni voce, prova conservata, eliminazione presso il fornitore, audit di creazione, uso ed eliminazione.
- Le registrazioni passano dal server solo per l'invio e non si conservano (requisito 11.1); il fornitore dichiara di non conservarne copia dopo la creazione ([documentazione](https://docs.aws.amazon.com/polly/latest/dg/custom-voices.html)).
- Il consenso è dichiarato dall'utente: il sistema non può verificarlo. Questo limite va scritto nel testo che l'utente accetta.
- Isolamento per azienda; indirizzi pubblici non indovinabili; nessuna credenziale al browser.
- Se AWS ritira l'abilitazione alla clonazione, le voci esistenti smettono di funzionare: il sistema deve gestire l'errore con un messaggio chiaro.

## Rischi e punti da provare
| Punto | Rischio | Come si risolve |
|---|---|---|
| Accesso alla clonazione | L'account AWS potrebbe non essere approvato | Richiesta all'account team AWS prima di iniziare la parte voci; fino ad allora si lavora con le voci del catalogo |
| Concatenazione di MP3 di voci diverse | Salti o rumori alle giunzioni | Prova con due voci e silenzio inserito; piano B: ricodifica con `ffmpeg` |
| Livello sonoro dei due conduttori | Una voce più forte dell'altra | Ascolto in prova; normalizzazione se serve |
| Deriva della voce nel tempo | Aggiornamenti del modello cambiano la voce in una lunga serie ([nota AWS](https://docs.aws.amazon.com/polly/latest/dg/custom-voices.html)) | Avviso nell'interfaccia; possibilità di rigenerare una puntata |
| Voce generativa e tagli di parola | Il modello può troncare una parola o dire altro | Ascolto di revisione prima di pubblicare; stato bozza finché non approvata |
| Requisiti di Spotify e Apple | Cambiano nel tempo | Controllo sulle pagine ufficiali all'implementazione; validazione del feed |
| Numero di voci per account | **10 voci clonate per account e regione** all'inizio ([annuncio AWS](https://aws.amazon.com/blogs/machine-learning/amazon-polly-launches-voice-cloning-a-unique-voice-for-your-brand/)); il limite è dell'intero account, quindi **condiviso da tutte le aziende** dell'applicazione | Contatore di voci usate; tetto per azienda; errore chiaro; richiesta di aumento ad AWS Support prima del lancio |
| Frequenza delle chiamate | `CreateVoice` e `DeleteVoice` condividono 1 richiesta al secondo | Coda per creazioni ed eliminazioni; ritentativi con attesa |
| Ripetizione dopo un timeout | Un `CreateVoice` andato in timeout può aver creato la voce; il ritentativo automatico ne crea una seconda | `ClientToken` stabile per voce e nome univoco (azienda + identificativo); prima di ritentare si cerca il nome con `DescribeVoices` (le voci clonate hanno `Origin=customer`) |
| SDK Polly vecchio | Mancano i comandi delle voci | Aggiornare `@aws-sdk/client-polly` con prova della sintesi esistente |
| Prezzi voce generativa | Manca la riga nel listino interno | Aggiungerla in una migrazione dei prezzi |

## Decisioni aperte
1. ~~Dominio~~ **Deciso:** `podcast.knowkube.com`, nella zona `knowkube.com` già presente nell'account (Route53), con certificato ACM in `us-east-1` e distribuzione CloudFront dedicata. Resta stabile al passaggio da `architect` a `coach`.
2. **Normalizzazione dell'audio:** serve `ffmpeg` nell'immagine dell'API?
3. **Chi richiede** l'accesso alla clonazione a AWS (titolare dell'account) e quando.
4. **Lingue:** solo le lingue clonabili per le voci clonate; per le voci del catalogo, le lingue effettivamente disponibili in regione vanno verificate.
5. **Ritmo di parlato** per `podcastWordBudget`: tarare con le prime puntate.

## Revisione: serie come contenitore

- La creazione di una serie produce solo il contenitore (titolo, cover, descrizione, voci, linea editoriale). Nessun piano e nessun costo.
- Le puntate si aggiungono una alla volta con `POST /podcasts/:id/episodes`, ciascuna con fonti proprie (documenti, articoli, note) unite a quelle di default della serie.
- `POST /podcasts/:id/ideas` propone idee di puntata (text_light) senza creare nulla.
- Non esiste una "ultima puntata": la serie cresce senza limite fisso (max 200). Solo la prima puntata presenta la serie. Il contesto usa le ultime 6 puntate.
- Migrazione 0055: note, knowledgeDocIds, articles su PodcastEpisode.
