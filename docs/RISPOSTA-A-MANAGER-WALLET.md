# Risposta a Manager: catalogo completo delle feature a consumo di K Scorm

Grazie per le risposte. Recepiamo il contratto: il prezzo lo decide solo Manager (listino in crediti, 1 EUR = 100 crediti). K Scorm legge `featureCatalog` e `featureUnits` dal kit, mostra il prezzo in crediti prima di generare e invia `hold`, `capture` e `release`. K Scorm non calcola crediti dal costo in dollari.

Questo documento elenca **tutte** le operazioni a pagamento di K Scorm (testi, quiz, immagini, audio, trascrizioni, video e avatar), non solo i video da slide. Per ciascuna indichiamo la feature proposta, l'unità di tariffa e il costo reale tipico per fissare il prezzo.

I costi sono **costi fornitore in USD, senza margine**. Derivano dai **consumi realmente registrati in produzione** (1.746 movimenti dal 14 ottobre al 17 novembre 2026, 17 corsi e i video da slide), con numero di campioni indicato. Dove non ci sono ancora dati lo scriviamo e usiamo il listino del fornitore.

---

## 1. Catalogo delle feature proposte

### 1.1 Testi AI (corsi, lezioni, quiz)

Sono feature **a unità**, con unità «operazione» (`units` = numero di operazioni, intero). Così una generazione di 12 lezioni è un solo hold con `units: 12`. Chiediamo a Manager di dichiararle in `featureUnits`.

| `feature` | Operazioni coperte | Costo reale tipico | Massimo |
|---|---|---|---|
| `text_standard` | outline del corso; contenuto di una lezione; quiz di modulo; quiz finale; copioni delle slide; struttura della knowledge | $0,08-0,16 | $0,27 |
| `text_light` | proposta delle sezioni; riepilogo e punti chiave di una lezione; anteprima e brief del corso da RSS o knowledge; copione di un video singolo | $0,01-0,025 | $0,03 |

Costi **misurati** per operazione (input più output del modello; `n` = operazioni osservate; p90 = 9 operazioni su 10 costano meno):

| Operazione | n | Medio | p90 | Fascia |
|---|---|---|---|---|
| Outline del corso | 14 | $0,080 | $0,098 | `text_standard` |
| Contenuto di una lezione | 104 | $0,120 | $0,181 | `text_standard` |
| Quiz del corso (modulo o finale) | 11 | $0,120 | $0,143 | `text_standard` |
| Quiz da slide | 12 | $0,088 | $0,122 | `text_standard` |
| Copioni delle slide | 6 | $0,155 | $0,267 | `text_standard` |
| Struttura della knowledge | 0 | non misurato (stima $0,12-0,25) | | `text_standard` |
| Brief da RSS o da knowledge | 1 | $0,015 | | `text_light` |
| Anteprima del corso da RSS o knowledge | 18 | $0,024 | $0,029 | `text_light` |
| Riepilogo di una lezione | 10 | $0,021 | $0,023 | `text_light` |
| Proposta delle sezioni | 2 | $0,014 | $0,016 | `text_light` |
| Copione di un video con avatar singolo | 5 | $0,008 | $0,008 | `text_light` |

Dai dati: il tetto reale della fascia `text_standard` è **circa $0,27** (copioni con molto testo), quello di `text_light` **circa $0,03**. Una lezione costa in media $0,12 di testo; un corso medio ne ha circa 9 (104 lezioni su 11 corsi).

Proponiamo due fasce (`standard` e `light`) invece di una feature per operazione, per tenere il listino leggero. Se preferite voci separate per outline, lezione e quiz (estratto conto più leggibile per il cliente), le teniamo distinte con gli stessi prezzi.

### 1.2 Immagini

| `feature` | Unità | Costo reale | Note |
|---|---|---|---|
| `image_generation` | per immagine (`units` = numero di immagini) | $0,042 | Misurato su 289 immagini: Stable Image Core $0,040 più riscrittura del prompt $0,002. Vale per immagini di lezione, copertine di corso e di modulo. Un corso ne usa in media **36** (massimo 72): sono circa $1,50 a corso. |

Le immagini da archivi gratuiti (Pexels, Unsplash) non hanno costo e non vengono addebitate.

### 1.3 Audio

| `feature` | Unità | Costo reale | Note |
|---|---|---|---|
| `audio_narration` | per **1.000 caratteri** di testo narrato (`units` decimali; si arrotonda per eccesso) | $0,016 | Amazon Polly Neural, $16 per milione di caratteri; misurato su 1 narrazione (2.445 caratteri, $0,039). I caratteri sono noti prima della generazione, quindi la prenotazione è esatta. |

### 1.4 Trascrizione

| `feature` | Unità | Costo reale | Note |
|---|---|---|---|
| `video_transcription` | per minuto di video | $0,024 | Amazon Transcribe, da listino: **nessun consumo ancora registrato** in produzione. La durata è nota prima dell'avvio. |

### 1.5 Avatar parlante (clip HeyGen)

Il costo dipende dall'engine e dal tipo di avatar scelti dal cliente, con un rapporto di 12 a 1 tra il più economico e il più caro. Con una sola tariffa si venderebbe in perdita o si farebbe pagare troppo. Proponiamo **una feature per fascia di costo**, tutte **al minuto di parlato**:

| `feature` | Quando | Costo reale al minuto |
|---|---|---|
| `video_avatar_iii_twin` | Avatar III, digital twin | $0,60 |
| `video_avatar_iii` | Avatar III, da foto o catalogo | $0,99 |
| `video_avatar_iv_photo` | Avatar IV, da foto | $2,31 |
| `video_avatar_iv` | Avatar IV, digital twin o catalogo | $4,83 |
| `video_avatar_v` | Avatar V, digital twin | $7,20 |

Usate sia per i **video singoli con avatar** dentro le lezioni, sia per i **video da slide**. Fonte: listino HeyGen self-serve in vigore, confermato dai consumi registrati: digital twin Avatar III $0,60 al minuto (3.496 secondi), avatar da foto Avatar III $0,99 al minuto (417 secondi). Finora **non sono stati usati** Avatar IV e V.

### 1.6 Creazione di un avatar

| `feature` | Unità | Costo reale |
|---|---|---|
| `avatar_creation_photo` | per creazione | $1,32 (misurato, 1 creazione) |
| `avatar_creation_twin` | per creazione | $2,13 |

Importo fisso per operazione.

### 1.7 Montaggio video

| `feature` | Unità | Costo reale | Note |
|---|---|---|---|
| `video_render` | per minuto di video finito | $0,12 | Montaggio slide e avatar (Remotion su Lambda, tariffa interna di $0,002 al secondo), misurato su 21 montaggi per 6.268 secondi. La durata è esatta prima del render. |

### 1.8 Video «cartoon» e pillole animate

| `feature` | Unità | Costo reale | Note |
|---|---|---|---|
| `video_cartoon` | per minuto di video | $0,60 | Animazioni generate da codice (Remotion, voce Polly inclusa), tariffa interna di $0,01 al secondo: misurato su 38 scene per 2.503 secondi. È l'unico motore usato in produzione. |
| `video_cartoon_ai` | per minuto di video | $4,80-5,40 | Modelli generativi (Amazon Nova Reel $0,08 al secondo, Luma Ray 2 $0,09 al secondo). Mai usati in produzione (nessun consumo registrato): li dichiariamo solo per poterli attivare più avanti, senza fretta di prezzarli. |

### 1.9 Incluso, non addebitato

Questi consumi sono troppo piccoli per un prezzo a sé e li assorbiamo noi:
- **Indicizzazione di documenti** nella knowledge (embeddings): circa $0,001 per documento.
- **Ricerca nella knowledge** (embeddings di una domanda): frazioni di centesimo.
- **Export SCORM**, upload di file e immagini da archivi gratuiti: nessun costo fornitore.

Se Manager preferisce addebitare anche l'export, lo indichiamo come feature a importo fisso, ma non lo riteniamo necessario.

### 1.10 Ordini di grandezza osservati

Per aiutare a fissare i prezzi, ecco cosa è costato davvero finora (costo fornitore, senza margine):

| Caso | Costo |
|---|---|
| Corso completo (17 corsi, tutte le fasi) | mediana **$3,71**; 9 corsi su 10 sotto **$14,58**; massimo $17,14 |
| Di cui immagini in un corso medio (36 immagini) | circa $1,50 |
| Di cui testi in un corso medio (9 lezioni, outline, quiz) | circa $1,40 |
| Un minuto di video da slide con avatar digital twin, finito | $0,60 avatar + $0,12 montaggio = **$0,72** (più i testi) |
| Un minuto con avatar da foto o catalogo (Avatar III) | $0,99 + $0,12 = **$1,11** |
| Un'intera esecuzione di clip da slide (26 clip, 11,7 minuti di parlato, con una rigenerazione) | $9,08 |

La rigenerazione di clip pesa: ogni cambio di avatar o di pronuncia ripaga tutte le clip interessate. Per questo ogni rigenerazione avrà un preventivo e un hold propri.

---

## 2. Operazioni dell'utente e feature coinvolte

| Cosa fa l'utente | Feature addebitate |
|---|---|
| Genera la struttura di un corso | `text_standard` ×1 |
| Genera i contenuti delle lezioni (tutte o una) | `text_standard` ×N lezioni |
| Genera i quiz (di modulo o finali) | `text_standard` ×N quiz |
| Genera un corso da RSS o da knowledge | `text_light` ×(anteprima + brief), poi `text_standard` ×(outline + lezioni + quiz) |
| Genera immagini o copertine | `image_generation` ×N |
| Genera la narrazione audio di una lezione | `audio_narration` ×(caratteri / 1.000) |
| Trascrive un video | `video_transcription` ×minuti |
| Crea un video con avatar in una lezione | `text_light` (copione) + `video_avatar_*` ×minuti |
| Crea un video animato (cartoon) | `video_cartoon` ×minuti |
| Crea un avatar da foto o digital twin | `avatar_creation_photo` o `avatar_creation_twin` |
| Crea un video da slide con avatar | `text_standard` (copioni) + `video_avatar_*` ×minuti + `video_render` ×minuti + `text_light` o `text_standard` per riepilogo e quiz, se in un corso |

---

## 3. Modello di hold, capture e release

- **Preventivo prima di accettare.** K Scorm mostra il totale in crediti, calcolato dal `featureCatalog` (fissa: prezzo; a unità: prezzo × unità iniziate). Se il cliente accetta, prenota.
- **Un hold per feature e per generazione**, con `reference` stabile e univoco, per esempio `kscorm:job:<jobId>:text_standard` oppure `kscorm:slide-clips:<importId>:<n>`. I retry non addebitano due volte.
- **Prenotazione:**
  - testi, immagini, audio, trascrizione, montaggio, creazione avatar: le unità sono **esatte** prima di partire, quindi nessun margine;
  - clip avatar e video animati: le unità sono stimate dai copioni, quindi riserviamo **+25%**, perché `capture_exceeds_hold` non ammette sforamenti.
- **Addebito:** alla `capture` inviamo il consumo realmente generato; il resto torna disponibile.
- **Interruzione a metà:** `capture` del già prodotto, il resto torna disponibile. Senza consumo, `release`.
- **Errore o annullamento:** `release`.
- **Rigenerazioni:** una rigenerazione (nuovo avatar, clip rifatte) è una nuova operazione con un nuovo `reference` e un nuovo preventivo.
- **Nessun valore a unità iniziate sul margine:** con tariffa al minuto, 5,3 minuti riservati e addebitati sono 6 minuti. Accettato da noi.

## 4. Scadenza degli hold

| Feature | Durata massima del lavoro | Scadenza richiesta |
|---|---|---|
| `text_standard`, `text_light` | 1-3 minuti per operazione; un corso intero fino a circa 15 minuti | **30 minuti** |
| `image_generation` | secondi per immagine | 15 minuti (default) |
| `audio_narration` | 1-2 minuti | 15 minuti (default) |
| `video_transcription` | pochi minuti | 30 minuti |
| `video_render` | qualche minuto; timeout massimo 30 minuti | **45 minuti** |
| `video_cartoon` | fino a 20 minuti | 45 minuti |
| `video_avatar_*` | vedi sotto | **120 minuti** |
| `avatar_creation_*` | pochi minuti | 15 minuti (default) |

**Avatar.** Limite per esecuzione: 25 minuti di parlato, circa 30-40 slide. Le clip vengono generate 3 alla volta, con tempo massimo di 20 minuti e 3 tentativi ciascuna. Dato misurato: 12 clip per 5,3 minuti di parlato hanno richiesto circa **14 minuti**, dominati dalla coda del fornitore. Per 25 minuti di parlato stimiamo **60-70 minuti** in condizioni normali. Con 90 minuti, i casi con ritentativi potrebbero scadere prima della `capture`: chiediamo **120 minuti**.

---

## 5. Conferme richieste a Manager

1. **Prezzi in crediti** per ciascuna feature del catalogo (§1).
2. **Scadenze** degli hold come da §4.
3. **Nomi delle feature**, in particolare le cinque `video_avatar_*` e le due fasce `text_*`.
4. **Feature a unità con unità «operazione»** (`text_standard`, `text_light`, `image_generation`): è possibile dichiararle in `featureUnits` con `units` intero? Così una generazione di molte lezioni è un solo hold.
5. **`audio_narration` per 1.000 caratteri:** un prezzo intero in crediti per 1.000 caratteri è sufficiente (costo $0,016, quindi circa 2-3 crediti)? In alternativa, preferite una tariffa fissa per narrazione?
6. **Unità iniziate:** conferma che 5,3 minuti diventano 6 minuti sia in hold sia in capture, e che con `units` decimali per `audio_narration` e `video_transcription` vale lo stesso.
7. **Attivazione per azienda:** `walletEnabled` è per installazione; decidiamo noi lato K Scorm quali aziende addebitare, con un nostro flag per azienda.
8. **Azienda di prova `sportwig-dev`:** serve almeno un utente di quell'azienda che acceda a K Scorm tramite SSO (così l'azienda esiste anche da noi) e un saldo di test.
9. **`features` nel self-register:** aggiorniamo l'elenco con i nomi sopra. Finché non sono prezzate, l'hold resta bloccato con `feature_not_priced`, come previsto.

---

# Richieste aggiuntive a Manager: wallet personale e spazio personale

Recepito il contratto del wallet personale (`POST /wallet/personal`, `company_id` "p-…" da usare così
com'è in holds, capture, release e `GET /wallet`, ricarica da K Scorm con `topup-session`). K Scorm
ora lo supporta: ogni utente sceglie se pagare con il wallet dell'azienda o con il personale, e gli
utenti senza company hanno uno **spazio personale** (un tenant individuale creato al primo accesso,
sempre pagato dal wallet personale). Per completare e metterlo in sicurezza ci servono queste risposte.

## 1. Chi può entrare senza company (sicurezza)
Uno spazio personale si apre quando il token non ha `custom:tenant_id`. Oggi non c'è un controllo di
«contratto» come per le company.
- Qualunque utente del pool senza `custom:tenant_id` può avere uno spazio su K Scorm, o serve un segno
  esplicito che l'utente è un account standalone ammesso (es. un claim `custom:account_type=personal`,
  oppure una verifica `GET /entitlements?sub=<sub>`)? Preferiamo un segno esplicito, per non aprire K Scorm
  agli utenti di altri prodotti.
- Il token porta `email_verified`? Il wallet personale è legato a `sub` ed email: cosa succede se l'utente
  cambia email?
- K Scorm mette il suo spazio personale dietro un interruttore (`PERSONAL_SPACE_ENABLED`) finché non
  avete risposto.

## 2. Modalità di prova di Stripe
- Potete aggiungere un campo `livemode` (booleano) alle risposte di `GET /wallet` e di
  `POST /wallet/personal`, e al portale owner? K Scorm avvisa l'utente quando Stripe è in sandbox e oggi
  lo capisce solo dall'indirizzo della sessione di pagamento (`cs_test_…`), cioè dopo il primo click.

## 3. Movimenti e ricevute
- Non c'è un elenco dei movimenti. Servirebbe, almeno per il wallet personale, un endpoint (es.
  `GET /wallet/transactions?company_id=…`) con data, feature, `reference` e importo, per mostrare lo
  storico in app. In alternativa un campo `last_topup_at` per capire quando una ricarica è arrivata.

## 4. Cancellazione dello spazio personale
- Se un utente chiede la cancellazione dei dati, K Scorm cancella lo spazio personale. Cosa fate del
  wallet personale e del saldo residuo (rimborso, chiusura, mantenimento)?

## 5. Regola per azienda
- Una regola «questa azienda non ammette il wallet personale» non esiste. Se serve ai clienti, ve la
  chiediamo come funzione nuova (la imposterebbe Manager e K Scorm la leggerebbe dal kit).
