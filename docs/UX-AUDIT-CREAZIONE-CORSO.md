# Audit UX: creazione e avanzamento del corso

Data: 26 novembre 2026. Metodo: lettura del codice e prova dell'interfaccia in modalità demo (dati finti) sul corso "Sicurezza sul lavoro", schermate Corsi, Brief, Contenuti, Media, Anteprima. La procedura guidata "Nuovo corso" è analizzata dal codice, non provata a schermo. Non ho provato l'interfaccia con l'API reale né con corsi in generazione.

## Parere in breve

Il prodotto è potente ma si presenta come uno strumento per chi lo ha costruito. L'utente deve conoscere il modello interno (brief, fonti, struttura, contenuti, media, formati, stati editoriali, preventivo) per ottenere un corso. Per venderlo servono due cose: un percorso principale con una sola decisione per schermata, e una pagina del corso che dica in ogni momento "dove sono, cosa sta succedendo, qual è la prossima azione".

Il criterio che propongo: **chi crea un corso deve poter arrivare a un corso pubblicabile prendendo al massimo 3 decisioni** (cosa insegnare, a chi e con quale esperienza, quanto spendere). Tutto il resto è un'impostazione avanzata, nascosta fino a quando serve.

## Problemi trovati, in ordine di impatto

### 1. Due procedure guidate una dentro l'altra, con numerazioni incoerenti
- La pagina del corso ha 6 passi (Brief, Fonti, Struttura, Contenuti, Media, Anteprima), ma i titoli delle sezioni sono numerati 1, 2, 3, 4, 5: "3. Contenuti delle lezioni" è il passo 4 nella barra, "5. Anteprima & Export" è il passo 6.
- Dentro "Brief" c'è una seconda procedura a 3 passi (Informazioni, Obiettivi, Test e brand).
- Prima ancora, "Nuovo corso" ha 4 passi (Sorgente, Dettagli, Formato, Crea), che raccolgono quasi le stesse informazioni del Brief (titolo, pubblico, lingua, tono, taglio, test).
- Risultato: l'utente compila due volte titolo, pubblico, lingua e test, e non capisce quale versione vale.

### 2. Il corso appena creato non dice che cosa sta succedendo
- Dopo "Crea e genera" il server produce tutto da solo, ma la pagina del corso presenta ancora i 6 passi come se fosse l'utente a doverli fare. Il passo "Contenuti" invita a premere "Genera tutti i contenuti (0)", pulsante disattivato.
- Il testo del box dice "Puoi generarli una lezione alla volta", un'opzione da esperti che compete con l'azione principale.
- Non esiste una vista unica "il tuo corso è al 40%: stiamo scrivendo le lezioni, poi arrivano test, immagini e video".

### 3. Troppe azioni di stato editoriale
- "Approva" (per modulo), "Approva tutto", banner "2 test da generare / 2 pronti" con "Genera 2 pronti" (l'etichetta non si capisce), sezione "Test del corso" che ripete lo stesso banner e "Genera un test" con due pulsanti.
- Il concetto "bozza → approvato" ha senso per i team con revisione, ma oggi è su ogni schermata anche per chi lavora da solo.
- Il banner dei test e la sezione dei test mostrano la stessa informazione due volte.

### 4. Gli esiti dei formati non sono prevedibili
- Parzialmente risolto nel commit 06fb36c: ora il formato dichiara cosa produce, quanto dura e se i video arrivano dopo. Resta da fare lo stesso nella pagina del corso (stato dei video in preparazione per lezione).
- "Aggiungi video-lezione da slide" sta nella barra della tab Contenuti, accanto a "Genera tutti i contenuti": sembra un modo di generare i contenuti, mentre aggiunge un'altra lezione con un flusso proprio (PDF, copioni, avatar, montaggio).

### 5. Il passo Media è un cassetto di cose non collegate
- Copertina, brand, docente. Il sottotitolo dice "immagini e narrazione si generano nello step Contenuti", quindi il passo si chiama Media ma contiene i media meno importanti.
- Il "Brand" è mostrato come scelta tra due schede (Acme, Globex) senza anteprima dell'effetto.
- "Docente" con "Salva docente" è un modulo con un pulsante di salvataggio separato dal resto: l'utente non sa se il dato è già salvato.

### 6. Il passo finale mescola cose di natura diversa
- Esporta SCORM, "Condivisione catalogo integrazioni" (gergo interno), "Costi & prezzo del corso (consumo AI e margine, opzionale)" e il lettore di anteprima.
- "Costi & prezzo (consumo AI e margine)" è un'informazione per chi vende, non per chi crea: non deve stare sulla strada di chi esporta.
- Nell'anteprima, il selettore Slide / Scorrimento / Ibrido viene coperto dal pulsante flottante "Chiedi al corso".

### 7. Linguaggio interno
Brief, Fonti, "pronti", "Approva", "Catalogo integrazioni", "Pillola", "Video-first" (rinominato), "knowledge", "consumo AI e margine": termini che non dicono nulla a chi compra un corso. I testi andrebbero riscritti per il risultato ("Scrivi le lezioni", "Aggiungi un test finale"), non per la tecnica.

### 8. Cose che funzionano e vanno conservate
- Il preventivo in crediti prima di generare, con blocco se i crediti non bastano.
- La generazione completa lato server: l'utente può chiudere la pagina.
- Il lettore di anteprima fedele al pacchetto SCORM.
- Le cartelle e la ricerca nell'elenco corsi.

## Proposta

### Fase A: un solo flusso di creazione (da fare per primo)
Sostituire "Nuovo corso" a 4 passi + Brief a 3 passi con **tre schermate**:
1. **Da dove parti?** Argomento, documenti o slide/video con avatar (come oggi, con una riga che dice cosa ottieni).
2. **Che esperienza vuoi?** Titolo, pubblico, lingua e il formato dichiarato con il suo risultato (già fatto), più "quanto lungo" (poche lezioni / corso completo). Anteprima e lezioni proposte sono modificabili qui, dopo aver premuto "Continua".
3. **Conferma e costo.** Riepilogo "cosa riceverai", test, extra facoltativi, preventivo, un solo pulsante.

Il brief completo (obiettivi, tono, livello, brand) diventa una sezione "Impostazioni del corso" nella pagina del corso, con valori già compilati dalla creazione. Niente seconda procedura.

### Fase B: la pagina del corso diventa un cruscotto
- In cima: stato in una frase ("Stiamo scrivendo le lezioni: 3 su 8") e un'unica azione principale.
- Sotto, tre schede invece di sei passi: **Contenuti** (moduli e lezioni, formato, rigenera, test), **Aspetto** (copertina, brand, docente, in un unico modulo con un solo "Salva"), **Pubblica** (anteprima, esporta SCORM; catalogo e prezzo in "Opzioni avanzate").
- Stato "Approva" nascosto finché il tenant non attiva la revisione editoriale.
- Un solo punto per i test (il banner si elimina).
- "Aggiungi video-lezione da slide" si sposta in "Aggiungi lezione" con le altre origini (vuota, da slide, da video).
- Lo stato dei video in preparazione compare per lezione ("clip 2 di 5 in lavorazione").

### Fase C: linguaggio e rifinitura
- Rivedere ogni etichetta secondo la tabella dei termini sopra.
- Spostare il pulsante "Chiedi al corso" fuori dall'area del lettore.
- Un test con 3-5 utenti reali sul flusso completo prima di vendere.

## Stima e rischi
- Fase A: circa 2 giorni; rischio medio, perché tocca la creazione e gli endpoint che oggi ricevono il brief.
- Fase B: circa 3 giorni; rischio medio sulla gestione degli stati e sulla persistenza dei dati dell'aspetto.
- Fase C: circa 1 giorno.
- Non si cambia nulla nel motore di generazione né nei pacchetti SCORM.

## Cosa serve decidere
1. Va bene eliminare il Brief come procedura e farne una sezione di impostazioni?
2. L'approvazione editoriale resta, ma attivabile per azienda: va bene?
3. I prezzi e i margini restano solo per gli amministratori della piattaforma?
