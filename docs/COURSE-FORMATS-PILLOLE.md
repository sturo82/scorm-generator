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

### Scelto: Amazon Nova Reel (AWS Bedrock) — Livello 2

Modello video nativo di Bedrock, coerente con lo stack esistente (stesse
credenziali AWS, stesso pattern asincrono + output su S3, metering come
`BEDROCK_IMAGE`/`BEDROCK_LLM`).

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
