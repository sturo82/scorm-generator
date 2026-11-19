# K Scorm → Manager: listino a pacchetti per il preventivo del corso

## Cosa chiediamo

Vorremmo mostrare al cliente il **prezzo esatto di un corso prima che spenda qualsiasi credito**.
Per farlo chiediamo di aggiungere al listino di K Scorm alcune voci **a prezzo fisso** (pacchetti).
Ogni pacchetto corrisponde a un pezzo di corso finito, non a una singola chiamata AI.

- Il cliente vede un preventivo fatto di soli prezzi fissi, per esempio "8 lezioni + 5 test + struttura".
  L'addebito è esattamente quello. **Il cliente non paga mai più del preventivo.**
- Ogni pacchetto è prezzato sul **caso peggiore** del nostro costo fornitori, ×2.
  Il caso peggiore non è una media: si calcola dai limiti rigidi del codice.
  Così anche il caso più sfortunato resta con margine 2×.

Le voci si dichiarano come oggi nel self-register (campo `features`). Sono tutte a tariffa fissa
(nessuna `units`). Finché non le prezzate, K Scorm continua a usare il listino attuale per
operazione. Il passaggio quindi non rompe nulla.

## Pacchetti

| Feature | Cosa contiene | Quando si addebita |
|---|---|---|
| `course_structure` | Struttura del corso (moduli, lezioni, obiettivi) | A ogni generazione della struttura |
| `lesson_standard` | Lezione completa: testo, interazioni, fino a **6 immagini** | A ogni generazione della lezione |
| `lesson_pillola` | Micro-lezione: testo, verifica, fino a **2 immagini** | Come sopra |
| `lesson_pillola_interattiva` | Lezione a scenari (libro-game), fino a **2 immagini** | Come sopra |
| `lesson_video_first` | Lezione attorno a un video caricato dall'autore, fino a **1 immagine** | Come sopra |
| `course_test` | Un test (intermedio di modulo o finale) con domande e feedback | A ogni generazione del test |

Restano voci attuali, con il loro prezzo:
- `text_light`: anteprima e bozze brevi.
- `image_generation`: copertina, copertine di modulo, rigenerazione di una singola immagine.
- `audio_narration`, `video_avatar_*`, `video_render`, `video_cartoon`, `avatar_creation_*`: componenti
  aggiuntive che il cliente sceglie dopo. Le loro quantità sono note e mostrate prima di spendere:
  i caratteri della narrazione, il minuto massimo del video avatar, i minuti stimati del video da slide.

Una lezione rigenerata si addebita di nuovo con il suo pacchetto.
Le immagini generate insieme alla lezione sono incluse nel pacchetto e non si addebitano a parte.

## Limiti rigidi che garantiamo nel codice

| Voce | Limite |
|---|---|
| Testo lezione | max 16.000 token in uscita per chiamata, **max 2 tentativi** |
| Test | max 16.000 token in uscita per chiamata, **max 2 tentativi** |
| Struttura | max 8.000 token in uscita per chiamata, max 2 esecuzioni |
| Immagini per lezione | standard 6, pillola 2, pillola interattiva 2, video-first 1 (tagliate nel codice, non solo chieste nel prompt) |
| Contesto della knowledge | max 5 estratti da 1.200 caratteri |
| Numero di lezioni | quello del preventivo: la struttura non ne aggiunge |
| Numero di moduli (e quindi di test intermedi) | max 1 ogni 2 lezioni, arrotondato per eccesso |

L'ingresso di ogni chiamata è limitato dalla struttura del prompt. Il massimo osservato in
produzione è 11.298 token per una lezione, 6.295 per un test e 5.144 per la struttura.
Nel calcolo usiamo circa il doppio: 24.000, 16.000 e 12.000. Aggiungiamo anche limiti di
lunghezza ai campi del brief, così l'ingresso resta limitato anche con testi inseriti dal cliente.

## Calcolo del caso peggiore

Prezzi dei fornitori misurati in produzione:
- Claude Sonnet 4.6 EU: $3,30 per milione di token in ingresso, $16,50 per milione in uscita.
- Immagine Stability Core: $0,04.
- Traduzione del prompt di un'immagine: max 300 token in ingresso e 300 in uscita, cioè $0,0059.
  Totale per immagine: **$0,0459**.

| Pacchetto | Calcolo | Caso peggiore | **Prezzo ×2 (USD)** |
|---|---|---|---|
| `course_structure` | 2 × (12.000 in + 8.000 out) | $0,3432 | **$0,69** |
| `lesson_standard` | 2 × (24.000 in + 16.000 out) + 6 immagini | $0,9618 | **$1,92** |
| `lesson_pillola` | 2 × (24.000 in + 16.000 out) + 2 immagini | $0,7782 | **$1,56** |
| `lesson_pillola_interattiva` | come pillola | $0,7782 | **$1,56** |
| `lesson_video_first` | 2 × (24.000 in + 16.000 out) + 1 immagine | $0,7323 | **$1,46** |
| `course_test` | 2 × (16.000 in + 16.000 out) | $0,6336 | **$1,27** |

Dettaglio di un tentativo di lezione: 24.000 × $3,30/M + 16.000 × $16,50/M = $0,0792 + $0,264 = $0,3432.

I crediti li calcolate voi con il vostro cambio USD→EUR (1 EUR = 100 crediti).
A titolo indicativo, con 1 USD ≈ 0,92 EUR: struttura circa 63, lezione standard circa 177,
pillola circa 143, video-first circa 135, test circa 117.

## Esempio per il cliente

Corso di 8 lezioni standard, 4 moduli, test intermedi e finale, copertina:

| Voce | USD (×2) |
|---|---|
| Struttura | $0,69 |
| 8 lezioni standard | $15,39 |
| 5 test (4 intermedi + 1 finale) | $6,34 |
| Copertina (`image_generation`) | $0,09 |
| **Totale** | **$22,50**, circa 2.070 crediti |

Per trasparenza: il costo tipico reale di questo corso è circa $4,75. Il margine effettivo medio
quindi è circa 4,7×, mentre quello minimo garantito, nel caso peggiore, è 2×.

## Una nota su `text_light`

Con la stessa regola, il caso peggiore dell'anteprima (12.000 token in ingresso e 1.200 in uscita)
è $0,0594, che ×2 fa $0,12. Oggi `text_light` vale 6 crediti, circa $0,065: copre la media ma non il
caso peggiore. Valutate se portarlo a 12 crediti.

## Cosa vi chiediamo, in breve

1. Aggiungere le 6 feature a prezzo fisso al listino di K Scorm, con i prezzi della tabella
   o con i vostri arrotondamenti, purché non più bassi.
2. Confermare che una feature non ancora prezzata resta fuori dal `featureCatalog` del kit:
   è il segnale che usiamo per restare sul listino attuale.
3. Valutare `text_light` a 12 crediti.
