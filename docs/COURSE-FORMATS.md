# Formati di corso — guida didattica

Tre formati, distinti per **scopo d'uso** (non solo per durata). La scelta si fa
nel wizard (`Brief.format`): `pillole` | `video_first` | `completo` (Standard).
Questo documento è la fonte di verità per i prompt di generazione
(`apps/api/src/generation/prompts.ts`) e per la resa nel player/anteprima.

Principio trasversale (tutti i formati): **richiamo attivo distribuito**
(spaced retrieval). Oltre alla verifica finale, inserire un micro-richiamo
*durante* il contenuto (una domanda-aggancio prima della risposta, una flashcard
subito dopo una definizione, una riflessione tra due capitoli). Si ricorda molto
meglio con richiami nel mezzo, non solo alla fine. Deve restare leggero: 1
micro-interazione, non un quiz pesante a metà.

---

## 1. Pillola (Micro-Learning / Fast Track)

Formato veloce, sintetico, "sapere fare subito".
- **Scopo**: risolvere un problema specifico o spiegare UN singolo concetto.
- **Durata**: 2-4 minuti.
- **Media principale**: video/animazione breve (code-to-video generato), + widget.
- **Struttura**:
  1. **Hook & Obiettivo** (15-30s): problema immediato o promessa di apprendimento.
  2. **Concetto Core** (1-2 min): spiegazione ultra-sintetica, 1 solo concetto/step.
  3. **Checkpoint** (30-60s): domanda-lampo / verifica leggera (retrieval).
  4. **Takeaway** (15s): il concetto chiave da ricordare.
- **Quando**: ripassi veloci, procedure singole, consigli pratici, just-in-time.
- **Mix di blocchi consigliato** (budget basso): 1 clip video breve per Hook/Core
  (code-to-video), 1 interattivo LEGGERO per il Checkpoint (flashcard o una
  singola scelta), 1 rich_text per il Takeaway. NON generare molte micro-clip:
  il video breve costa poco solo se è UNO.

## 2. Video First (Video-Lezione / Deep Dive)

Lezione visuale strutturata e guidata; scompone concetti complessi.
- **Scopo**: argomenti articolati, teorie, casi studio, dimostrazioni passo-passo.
- **Durata**: 8-15 min (max ~20).
- **Media principale**: UN video portante (screencast/presentazione/dimostrazione),
  con pannello interattivo a lato. NB: il video lungo NON va generato tutto come
  cartoon (costo/tempo): è un segnaposto che l'autore riempie, o un unico video.
- **Struttura**:
  1. **Introduzione & Contestualizzazione** (1 min): dove siamo nel percorso, perché conta.
  2. **Capitoli** (6-10 min): A) teoria/modello mentale; B) dimostrazione/esempio reale;
     C) eccezioni ed errori da evitare.
  3. **Verifiche intermedie** (tra i capitoli, non solo a fine): riflessioni/sondaggi.
  4. **Conclusione & Collegamento** (1 min): sintesi + aggancio alla lezione dopo.
- **Quando**: moduli introduttivi, framework complessi, tutorial dettagliati.

## 3. Standard (Testuale & Interattivo / Self-Paced)

Flessibile, non basato su video; lettura + pratica attiva, studio asincrono.
- **Scopo**: consolidare la memoria a lungo termine, schemi di consultazione,
  studio senza audio/video (accessibilità).
- **Durata**: 3-7 min di lettura + interazioni.
- **Media principale**: testo, grafica (diagrammi/mappe/infografiche), widget.
- **Struttura & componenti**:
  - **Testo guida**: paragrafi brevi, grassetti strategici, box evidenziati
    (Tip / Attenzione / Definizione).
  - **Visual & schemi**: diagrammi di flusso, mappe concettuali, immagini.
  - **Widget interattivi** (vicino al contenuto, non ammassati in fondo):
    flashcard (termini/definizioni), drag&drop (riordino/categorizzazione),
    accordion/tab (contenuti espandibili).
  - **Quiz / test finale**: scelta multipla con feedback immediato e spiegazione.
- **Quando**: normative, definizioni tecniche, checklist, contesti senza audio.

---

## Confronto sintetico

| Caratteristica | Pillola | Video First | Standard |
|---|---|---|---|
| Focus | 1 problema/step | 1 argomento complesso | memorizzazione/consultazione |
| Media principale | video/animazione breve | video/screencast portante | testo, grafica, widget |
| Interattività | 1 verifica rapida | quiz/sondaggi integrati | flashcard, drag&drop, quiz |
| Impegno studente | minimo (2-4 min) | medio (8-15 min) | flessibile/autonomo |
| Costo generazione | basso-medio | medio-alto | basso |

## Note di budget (specifiche del nostro motore)

- Il video "cartoon" è **code-to-video** su Lambda (~$0.12/clip breve): ideale per
  la **Pillola** (clip corte). Evitare video generati lunghi nel Video First.
- Le immagini (Bedrock) costano ~$0.04: usarle liberamente in Standard e nel Core
  delle Pillole al posto di altro video.
- Gli interattivi (flashcard, drag&drop, scenario, quiz) non hanno costo di
  generazione media: usarli per la verifica ovunque abbia senso.
