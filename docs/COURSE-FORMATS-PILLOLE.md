# Formati del corso e "Pillole" (libro-game)

Il corso può essere generato in tre **formati** (campo `Brief.format`):

- `completo` — formato classico: testo, immagini, interazioni, quiz (default).
- `video_first` — ogni lezione è incentrata su un video (segnaposto o avatar
  HeyGen). Equivale allo storico flag `videoFirst` (mantenuto per compatibilità).
- `pillole` — mini-video interattivi in stile **libro-game**: scene brevi
  (cartoon), l'utente fa una scelta, ogni scelta ha una conseguenza
  (positiva/negativa) con punteggio e instrada alla scena successiva.

## Modello dati delle "pillole"

Una pillola è **autocontenuta** = una lezione con un block `branching_scenario`:

- `nodes` = le scene (ognuna con un media video per scena + testo breve);
- `choices` = i bivi (ogni scelta: `label`, `nextNodeId`, `score`, `feedback`);
- `startNodeId` = scena iniziale; nodi senza scelte = esiti terminali.

Questo riusa lo schema `branching_scenario` e il motore a stati
(`reduceScenario`/`renderScenario`) già esistenti, e si incastra nel player
lineare senza un nuovo motore di navigazione di corso (la navigazione tra scene
vive DENTRO il block). I cartoon di ogni scena sono **segnaposto con storyboard**:
la generazione produce, per ogni scena, una descrizione di cosa deve mostrare il
cartoon; l'autore carica il video (finché il Livello 2 non è attivo).

## Generazione cartoon — provider video

### In uso: Luma Ray 2 (AWS Bedrock, us-west-2) — Livello 2

NOTA: Amazon Nova Reel NON è disponibile/abilitato sul nostro account AWS in
nessuna region (verificato via `bedrock list-foundation-models`). L'unico
modello video su Bedrock disponibile è **Luma Ray 2** (`luma.ray-v2:0`) in
**us-west-2** — la stessa region della generazione immagini. L'integrazione usa
quindi Luma Ray 2; l'adapter Nova Reel resta nel codice per un'eventuale futura
disponibilità. Luma genera clip di 5s o 9s (540p/720p), prezzo ~$0.09/s
(~$0.45 per clip da 5s a 720p).

Modello video Bedrock, coerente con lo stack esistente (stesse credenziali AWS,
pattern asincrono StartAsyncInvoke/GetAsyncInvoke + output su S3, metering
`BEDROCK_VIDEO`). L'output va in un bucket dedicato in us-west-2
(`scorm-video-gen-<account>`, prefix `luma-output`); l'adapter lo scarica e il
servizio lo salva nel bucket assets dell'app.

- Costo: ~$0.08 / secondo di video generato (~$0.48 per una scena da 6s).
- Capacità: text-to-video e **image-to-video** (720p, 24fps), clip in
  incrementi di 6s fino a 2 min, con camera motion e reference image.
- Asincrono: ~90s per un clip da 6s; output scritto su un bucket S3 del nostro
  account.
- Approccio consigliato per coerenza di stile: generare prima un frame cartoon
  (Nova Canvas / generatore immagini esistente) e poi animarlo con Nova Reel
  (image-to-video), così lo stile resta uniforme tra le scene.
- Ordine di grandezza: una pillola di ~6 scene da 6s (~36s) ≈ ~$2.9, da
  ribaltare sul cliente via quote/markup esistente.

Fonti (rielaborate per conformità licenze): documentazione AWS Nova Reel
(video-generation, video-gen-access) e pagina pricing Amazon Nova.

### Da integrare in futuro: fal.ai (opzione alternativa)

Aggregatore che espone molti modelli video (Veo, Kling, Seedance, Wan,
PixVerse) dietro un'unica API pay-per-second, con image-to-video. Da valutare
SE in futuro servono stili/qualità che Nova Reel non copre. Richiede un provider
esterno nuovo (account, API key, billing separato), quindi NON introdotto ora.

## Roadmap di implementazione

- **Livello 1 (in corso):** campo `format` nel brief; generazione "pillole"
  (scene/scelte/conseguenze/storyboard); rendering video-per-scena nello
  scenario (prima il video, poi le scelte); selettore formato nel wizard. I
  cartoon sono segnaposto caricati dall'autore.
- **Livello 2 (successivo):** integrazione Amazon Nova Reel per generare i
  cartoon dagli storyboard (job asincrono + metering + quota, come HeyGen).
- **Futuro / eventuale:** fal.ai come provider alternativo.

## Attivazione di Nova Reel in produzione (Livello 2)

Il codice e l'infrastruttura (Terraform) sono pronti, ma la feature è **spenta
di default** (`cartoon_video_provider = "none"`), così il deploy non genera
costi finché non la si attiva consapevolmente. Per accenderla:

1. **Verifica la region**: conferma su quale region il tuo account AWS ha Nova
   Reel abilitato (spesso `us-east-1`). Imposta `nova_reel_region` di conseguenza.
   Nova Reel NON è disponibile in tutte le region (come Stability per le immagini).
2. **Prefix S3 di output**: imposta `nova_reel_output_s3_uri` a un prefix nel
   bucket assets, es. `s3://<bucket-assets>/nova-reel`. Deve stare nello stesso
   bucket dell'app, così il servizio legge l'output con `getObject` e lo copia
   nella key canonica dei media. La policy IAM (`BedrockNovaReelAsync` + `S3Assets`)
   copre già lettura/scrittura e le azioni async.
3. **Attiva il provider**: `cartoon_video_provider = "nova"`.
4. `terraform apply` (infra/). È un'azione ad alto impatto: va eseguita
   manualmente da chi gestisce l'infra, verificando il piano.

Finché il provider resta `none`, il formato "pillole" funziona con i cartoon
caricati a mano dall'autore (gli storyboard sono comunque generati). Con `nova`
attivo, il bottone "Genera cartoon" produce i mini-video via Nova Reel
(~$0.08/s, quota mensile per tenant via `nova_reel_monthly_quota`).

---

## Livello 2b — Cartoon "code-to-video" (Remotion) — CONSIGLIATO

I modelli video neurali (Luma Ray 2 su Bedrock) costano troppo per l'uso
standard: ~$0.09–1.5/s, cioè decine di dollari a pillola. Per questo è stato
costruito un motore **code-to-video deterministico** che genera i mini-cartoon
per programma, con costo di **pochi centesimi a scena** e qualità vettoriale
nitida.

### Come funziona
Pipeline (provider `remotion`, `TextToVideoProvider`):
1. **LLM → VideoSpec**: dallo storyboard della scena, un prompt produce un JSON
   `VideoSpec` (schema Zod in `@scorm/contracts`) validato, con self-repair.
   L'LLM compone SOLO componenti di una whitelist (nessun codice arbitrario).
2. **TTS → voce + word-timings**: Amazon Polly sintetizza il voiceover e
   restituisce gli speech marks a livello di parola (`synthesizeWithMarks`).
3. **Remotion → MP4**: la composizione `PillolaVideo` (`@scorm/video`) disegna
   scene SVG animate, sincronizzate con la voce ancorando gli eventi alle
   PAROLE del voiceover; `@remotion/renderer` produce l'MP4 (h264).
4. I byte dell'MP4 rientrano nel flusso esistente (`applyCartoonResult`) →
   `storageKey` della scena. Player, gate video→scelte e metering invariati.

### Componenti disponibili (whitelist)
`TextReveal`, `Caption` (sottotitolo karaoke sincronizzato), `BulletList`,
`ChainDiagram`, `IconStat`, `ArrowFlow`. Si estende aggiungendo un componente a
`@scorm/video` e il relativo nome all'enum `ComponentName` dei contratti.

### Costi
| Voce | Code-to-video (remotion) | Luma Bedrock 720p |
|------|--------------------------|-------------------|
| Per secondo | ~$0.01 (TTS + CPU) | $0.09–1.50 |
| Pillola ~35s (7 scene) | ~$0.35 | ~$3–52 |

Listino metering: `remotion-code-to-video` a $0.01/s (migrazione
`0040_remotion_pricing`). Quota mensile per tenant invariata
(`CARTOON_VIDEO_MONTHLY_QUOTA`).

### Attivazione e infrastruttura di rendering
Remotion rende via **Chromium headless** + FFmpeg. Per tenere l'immagine API
leggera, `@scorm/video` è importato DINAMICAMENTE solo quando il provider è
`remotion`, e il download di Chromium è disattivato nell'immagine di default
(`REMOTION_SKIP_CHROMIUM_DOWNLOAD=true`). Due strade per attivarlo:

- **MVP in-process**: fornire Chromium nell'immagine API (aggiungere il pacchetto
  headless-shell di Remotion / dipendenze di sistema) e impostare
  `PROVIDER_CARTOON_VIDEO=remotion`. Il render gira nel processo API: semplice,
  ma i render (secondi-minuti) competono con l'API per CPU — adatto a volumi bassi.
- **Runner dedicato (consigliato in prod)**: eseguire il rendering in un worker
  separato o su `@remotion/lambda`. Isola la CPU, scala indipendentemente e non
  rallenta l'API. Il port `TextToVideoProvider` non cambia: cambia solo
  l'implementazione di `RenderFn` iniettata nel wiring.

Config: `CARTOON_VIDEO_WIDTH` / `_HEIGHT` / `_FPS` (default 1920×1080@30).
Finché `PROVIDER_CARTOON_VIDEO=none` (default prod), nulla di tutto questo è
attivo e non ci sono costi.
