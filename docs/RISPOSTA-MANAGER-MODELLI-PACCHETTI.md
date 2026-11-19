# K Scorm → Manager: modello A o B per i pacchetti

Dati di produzione (14/10 → 19/11/2026): 112 lezioni generate, 11 test, 15 strutture, e i log
degli ultimi 60 giorni. Prezzi fornitore: Claude Sonnet 4.6 EU $3,30/M token in ingresso e
$16,50/M in uscita, immagine $0,04 + traduzione del prompt $0,0059 = $0,0459.

## In breve

**Raccomandiamo il modello A** (prezzo fisso esatto) con i limiti stretti sotto. È l'unico che
rispetta i vostri primi tre obiettivi: linearità, comprensibilità e nessuna perdita di margine.
Sul quarto (caso migliore non troppo alto) lo avvicina: il margine sul costo tipico scende da
circa 5,9× a circa 4×.

Sotto circa 4× non si scende con un prezzo fisso. Il motivo è il secondo tentativo: oltre il 10%
delle lezioni ne ha bisogno, quindi il caso peggiore contiene sempre due chiamate piene. Il modello B
toglie questo problema, ma rende l'importo variabile e ha bisogno di una cosa che oggi non esiste:
una capture espressa in costo USD, convertita da voi.

## Correzione sui dati

- **Immagini.** Le 4,5 immagini per lezione sono la media su tutti i formati. Per formato, prima del
  tetto:

  | Formato | Media | Mediana | p90 | Max |
  |---|---|---|---|---|
  | standard | 10,6 | 11 | 13 | 15 |
  | pillola | 0,9 | 1 | 1 | 1 |
  | pillola interattiva | 0 | 0 | 0 | 0 |
  | video-first | 0,1 | 0 | 0 | 2 |

  Con il tetto attuale una lezione standard usa quasi sempre esattamente il massimo.
- **Tentativi.** Su 112 lezioni, 13 sono fallite al primo tentativo (11,6%). Il motivo è sempre
  "il modello non ha prodotto block validi". Di queste, 9 sono riuscite al secondo tentativo,
  3 al terzo e 1 non è riuscita. Con 2 tentativi, circa il 3,6% delle lezioni fallisce e va rilanciata.
  Le troncature per limite di token in uscita sono state 3 nel periodo, una delle quali su un test.
- **Misura attuale incompleta.** Oggi registriamo il consumo solo del tentativo riuscito. I tentativi
  falliti si pagano ad AWS ma non risultano nei nostri costi. Il costo tipico che abbiamo misurato
  è quindi sottostimato di circa il 5-10% sulla parte testo. Lo correggiamo in ogni caso.

## Distribuzione dei token per chiamata (riuscita)

| Voce | In p50 | In p90 | In p99 | In max | Out p50 | Out p90 | Out p99 | Out max |
|---|---|---|---|---|---|---|---|---|
| Lezione (tutti i formati, n=112) | 10.564 | 11.014 | 11.210 | 11.298 | 5.334 | 9.113 | 10.506 | 12.292 |
| Pillola (n=5) | 10.538 | | | 10.538 | 2.317 | 2.525 | | 2.629 |
| Pillola interattiva (n=4) | 10.374 | | | 10.374 | 3.928 | 4.042 | | 4.051 |
| Test (n=11) | 5.802 | 6.260 | 6.292 | 6.295 | 6.287 | 7.428 | 7.761 | 7.798 |
| Struttura (n=15) | 3.744 | 4.610 | 5.074 | 5.144 | 4.095 | 4.977 | 5.195 | 5.225 |

Le lezioni standard e video-first non si separano bene nei dati: quasi tutte sono state generate a
lotti, che registrano i consumi per lotto e non per lezione. Le uscite più lunghe (p90 e oltre) sono
lezioni standard. Dalla dimensione dei contenuti salvati, una video-first è circa il 60% di una standard.

**Limite di uscita a 12.000.** Avrebbe troncato 1 lezione su 112, quella da 12.292 token. Una lezione
troncata fallisce: non si addebita, ma va rilanciata. Con il tetto di immagini le uscite si accorciano
di qualche centinaio di token. Per la lezione standard proponiamo 13.000, per avere margine sul
massimo osservato senza togliere contenuto.

## Modello A: limiti proposti e tabella aggiornata

| Pacchetto | Tentativi | Ingresso max | Uscita max | Immagini | Caso peggiore | **Prezzo ×2** |
|---|---|---|---|---|---|---|
| `course_structure` | 2 | 8.000 | 7.000 | – | $0,284 | **$0,57** |
| `lesson_standard` (4 immagini) | 2 | 16.000 | 13.000 | 4 | $0,718 | **$1,44** |
| `lesson_standard` (6 immagini) | 2 | 16.000 | 13.000 | 6 | $0,810 | **$1,62** |
| `lesson_pillola` | 2 | 16.000 | 6.000 | 2 | $0,395 | **$0,79** |
| `lesson_pillola_interattiva` | 2 | 16.000 | 8.000 | 2 | $0,461 | **$0,92** |
| `lesson_video_first` | 2 | 16.000 | 10.000 | 1 | $0,482 | **$0,96** |
| `course_test` | 2 | 9.000 | 10.000 | – | $0,389 | **$0,78** |

- Con i vostri numeri (16.000 in, 12.000 out, 4 immagini) la lezione standard viene $1,37, come
  avete calcolato voi.
- **Immagini incluse.** 4 abbassa il prezzo. 6 è quello che usiamo oggi ed è più vicino allo standard
  premium che ci è richiesto. La decisione è commerciale: per noi vanno bene entrambi i valori.
- **Costo tipico** di una lezione standard con 4 immagini: circa $0,33. Il margine sul tipico è
  quindi circa 4,4×, e il minimo garantito resta 2×.
- **Ingresso di 16.000.** È circa 1,4 volte il massimo osservato. Lo rendiamo un limite vero: se il
  prompt lo supera, il codice riduce il contesto della knowledge prima della chiamata.

**Pacchetti per lunghezza** (breve, standard, lunga): sconsigliati per ora. I formati fanno già da
fasce: pillola 6.000, video-first 10.000, standard 13.000. Una terza scelta aumenta le decisioni
dell'utente e il rischio di troncare. Il vantaggio sarebbe solo sul margine del caso migliore.

## Modello B: affidabilità della misura

- **Token.** Bedrock restituisce per ogni chiamata i token in ingresso e in uscita, che sono gli
  stessi che fattura. La misura è esatta.
- **Prezzo.** Usiamo il listino AWS EU. Lo scarto con la fattura viene solo da variazioni di listino,
  che aggiorniamo noi.
- **Cosa va aggiunto per misurare tutto:**
  - i tentativi falliti, che oggi non registriamo (circa il 5-10% del testo, vedi sopra);
  - la traduzione del prompt di ogni immagine, che già registriamo;
  - gli embeddings della ricerca nella knowledge, meno di $0,0001 per lezione, che si possono ignorare.
- **Immagini.** Il costo è fisso per immagine riuscita. Non abbiamo verificato se Stability addebita
  le immagini bloccate dal filtro dei contenuti; per sicurezza le conteremmo come pagate.
- **Scarto atteso dalla fattura del fornitore** dopo queste correzioni: sotto l'1%.
- **Registro per hold.** Sì, è fattibile: per ogni hold salviamo costo misurato in USD, importo
  catturato e numero di tentativi. Abbiamo già il registro dei consumi per chiamata e quello degli
  addebiti per corso; basta collegarli all'hold.
- **Conversione.** Il limite vero di B è chi converte i dollari in crediti. Per regola concordata K
  Scorm non converte USD in crediti. Servirebbe quindi una capture espressa in costo
  (`cost_usd`), su cui voi applicate ×2 e il cambio.

## Esperienza utente

| | Modello A | Modello B |
|---|---|---|
| Preventivo | "1.440 crediti", con le voci | "Fino a 1.440 crediti (di solito circa 650)" |
| Fine lavoro | "Addebitati 1.440 crediti" | "Addebitati 612 crediti su un massimo di 1.440" |
| Movimenti | Importi uguali per lo stesso pacchetto | Importi diversi per ogni lezione |
| Domande al supporto | Rare, e sul prezzo ("perché costa così") | Più frequenti: "perché 612 e ieri 540", "perché l'hold era 1.440" |

Con B l'utente pianifica sul massimo e vede un importo diverso ogni volta. Senza il "di solito
circa" il massimo spaventa, ma il "di solito" è una stima che può risultare sbagliata. Lo scarto tra
due lezioni simili è del ±40%, quindi non pochi utenti lo noteranno.

## Casi limite

| Caso | Modello A | Modello B |
|---|---|---|
| Lotto che fallisce a metà | Si addebitano i pezzi finiti; i pezzi non fatti si rilasciano | Si addebita il costo misurato dei pezzi finiti ×2 (tentativi falliti compresi); il resto si rilascia |
| Pezzo singolo fallito | Rilascio totale; il costo lo assorbiamo noi | Uguale: rilascio totale, costo assorbito da noi |
| Annullamento durante il lavoro | Oggi non esiste un "annulla" delle generazioni. Se lo aggiungiamo: pezzi finiti addebitati, quello in corso e i successivi rilasciati | Uguale, sul costo misurato |
| Rigenerazione di una lezione già pagata | Nuovo pacchetto a prezzo pieno, mostrato prima di confermare | Nuovo addebito sul costo reale |
| Riserva oltre la durata prevista | Vedi tempi sotto | Uguale |

**Tempi massimi realistici:**

| Lavoro | Durata massima |
|---|---|
| Struttura | 3 minuti |
| Lezione | 5 minuti (testo e immagini, 2 tentativi) |
| Test | 3 minuti |
| Lotto "tutto il corso" (20 lezioni + 11 test, 3 in parallelo) | circa 30 minuti |

Chiediamo **60 minuti di scadenza per gli hold dei pacchetti**. Oggi un hold di testo scade dopo
30 minuti, che per un lotto lungo sono pochi.

## Lavoro lato K Scorm

- **Modello A: circa 1 giorno.**
  - Pacchetti, preventivo, tetti e addebito per pezzo sono già in produzione e aspettano solo i
    vostri prezzi.
  - Restano da fare: limiti di uscita per formato, limite vero di ingresso, misura dei tentativi
    falliti per il nostro controllo del margine, e il valore definitivo delle immagini incluse.
- **Modello B: circa 3-4 giorni,** più il lavoro da parte vostra.
  - Misura completa per hold, compresi i tentativi falliti.
  - Capture sul costo.
  - Registro per hold.
  - Interfaccia "fino a / addebitato" nei preventivi, nei movimenti e nel riepilogo del corso.
  - Riconciliazione periodica.

## Cosa chiediamo a Manager

**Modello A:**
1. Prezzi delle 6 feature fisse, dalla tabella sopra con la scelta di 4 o 6 immagini.
2. Scadenza di 60 minuti per gli hold dei pacchetti.
3. Conferma che più hold sulla stessa feature con `reference` diversi (`…:lesson_standard:1`, `:2`, …)
   vanno bene. Usiamo un hold per pezzo per addebitare solo i pezzi riusciti.
4. Valutare `text_light` a 12 crediti (vedi la richiesta precedente).

**Modello B, in aggiunta:**
1. Capture con `cost_usd`: voi applicate ×2 e il cambio, la capture è limitata all'hold e restituite i
   crediti catturati.
2. Hold di una feature fissa con importo maggiore del prezzo di listino, perché qui il listino è il tetto.
3. Metadati per riga di movimento (costo misurato, tentativi), visibili in `GET /wallet/transactions`.
4. Il riferimento del cambio usato e quando lo aggiornate.

Nel frattempo restiamo sul listino attuale per operazione, come indicato.
