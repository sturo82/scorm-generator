# Requisiti — Podcast (serie di puntate audio)

## Introduzione
K Scorm genera corsi e video-lezioni. Questa feature aggiunge un nuovo tipo di
contenuto, il **podcast**: una **serie** di **puntate audio** su un tema, scritte
dall'AI a partire da un brief, da documenti della knowledge o da feed RSS, e
raccontate da **due conduttori** in dialogo. Le voci possono essere voci del
catalogo oppure la **voce clonata** di una persona che ha dato il consenso. Ogni
serie ha un **feed RSS** come quello delle piattaforme di hosting: si incolla in
Spotify, Apple Podcasts o in una piattaforma custom.

Il podcast è un contenuto **autonomo**, non un formato di lezione dentro un corso
(decisione presa): non ha moduli, quiz né avanzamento condizionato. Il
precedente architetturale è la libreria video.

### Decisioni già prese
- Contenuto autonomo, con pagina propria nel menu.
- Dialogo a due voci fin dalla prima versione.
- Clonazione della voce con **Amazon Polly** (prima scelta). Il fornitore sta
  dietro un'interfaccia, così HeyGen resta un'alternativa. Lingopal è escluso:
  clona la voce solo dentro il doppiaggio e non offre la sintesi con una voce
  clonata.
- Voci clonate create in **Francoforte** (`eu-central-1`).
- Feed RSS e audio pubblicati su un **sottodominio dedicato**, `podcast.knowkube.com`, che non dipende dal nome del prodotto: l'indirizzo di un feed è la sua identità presso Spotify e Apple e non deve cambiare con il passaggio da `architect` a `coach`.
- Fonti: brief, documenti di knowledge e feed RSS.

### Fuori ambito (non in questa spec)
- Statistiche di ascolto.
- Pagina pubblica della serie e lettore incorporabile (fase successiva).
- Blocco audio dentro i corsi SCORM (fase successiva).
- Monetizzazione, pubblicità, abbonamenti a pagamento degli ascoltatori.
- Registrazione di puntate con persone reali: tutto l'audio è sintetico.
- Lingue diverse da quelle supportate dalla clonazione (vedi requisito 6).

### Glossario
- **Serie / Podcast**: raccolta di puntate su un tema, con titolo, lingua e conduttori.
- **Puntata**: un episodio audio con copione, MP3 e metadati.
- **Conduttore**: personaggio che parla; ha un nome e una voce.
- **Battuta**: un turno di parola di un conduttore nel copione.
- **Voce clonata**: voce creata dalle registrazioni di una persona consenziente.
- **Feed**: documento RSS 2.0 della serie.
- **Pubblicare**: rendere una puntata ascoltabile all'indirizzo pubblico e inserirla nel feed.

---
## Requisiti

### Requisito 1 — Serie e puntate
**User story:** Come editor, voglio creare una serie di puntate su un tema, per
averle tutte in un posto e pubblicarle insieme.

#### Criteri di accettazione
1. THE sistema SHALL consentire di creare, modificare ed eliminare una serie con titolo, descrizione, lingua, categoria, autore e copertina.
2. THE sistema SHALL consentire di creare, riordinare, modificare ed eliminare le puntate di una serie.
3. THE sistema SHALL isolare serie e puntate per azienda (tenant), con la stessa protezione a livello di riga delle altre tabelle.
4. THE sistema SHALL consentire la creazione e la modifica agli utenti con ruolo EDITOR o superiore, e la sola lettura al VIEWER.
5. WHEN una serie viene eliminata THEN il sistema SHALL eliminare puntate, file audio e feed collegati, e SHALL toglierli dall'indirizzo pubblico.

### Requisito 2 — Fonti
**User story:** Come editor, voglio che le puntate partano da un brief, da miei documenti o da feed RSS.

#### Criteri di accettazione
1. THE sistema SHALL accettare come fonte un brief (tema, pubblico, obiettivi, tono), documenti di knowledge già pronti, feed RSS dell'azienda, o una combinazione.
2. WHEN sono indicati documenti o feed THEN il sistema SHALL recuperare i passaggi pertinenti con la stessa ricerca usata per i corsi e SHALL basare piano e copioni su di essi.
3. THE copioni SHALL attenersi alle fonti: SHALL NOT aggiungere fatti, numeri o nomi che non vi compaiono.
4. WHERE una fonte è un feed RSS THE sistema SHALL usare gli articoli selezionati dall'utente e SHALL conservare titolo e indirizzo di ogni articolo come fonte della puntata.
5. THE puntata SHALL elencare le fonti usate.

### Requisito 3 — Piano della serie
**User story:** Come editor, voglio rivedere l'elenco delle puntate prima che il sistema scriva i copioni.

#### Criteri di accettazione
1. WHEN l'utente indica tema, numero di puntate e durata per puntata THEN il sistema SHALL proporre titolo, sintesi e taglio di ogni puntata.
2. THE utente SHALL poter modificare, aggiungere, togliere e riordinare le puntate proposte prima di procedere.
3. THE sistema SHALL mostrare il preventivo in crediti prima di scrivere i copioni (requisito 10).
4. THE numero di puntate e la durata di ciascuna SHALL rispettare limiti configurabili.

### Requisito 4 — Copione a due conduttori
**User story:** Come editor, voglio un dialogo naturale tra due conduttori che posso correggere.

#### Criteri di accettazione
1. THE sistema SHALL generare per ogni puntata un copione come sequenza di battute, ognuna attribuita a un conduttore.
2. THE lunghezza del copione SHALL essere tarata sulla durata scelta, con un ritmo di parlato misurabile e un intervallo di tolleranza.
3. THE sistema SHALL consentire di modificare, aggiungere, togliere e riattribuire le battute.
4. WHEN il copione viene modificato dopo la generazione audio THEN il sistema SHALL segnare l'audio come non aggiornato.
5. THE copione SHALL essere scritto per l'ascolto: frasi parlabili, senza elenchi, simboli o riferimenti a elementi visivi.
6. THE sistema SHALL continuare le puntate di una serie con coerenza (senza ripetere le presentazioni e senza ridire i contenuti delle puntate precedenti).

### Requisito 5 — Conduttori e voci
**User story:** Come editor, voglio scegliere chi parla in ogni serie.

#### Criteri di accettazione
1. THE sistema SHALL consentire di definire due conduttori per serie, ciascuno con nome e voce.
2. THE sistema SHALL offrire come voci un catalogo di voci del fornitore adatte alla lingua della serie, e le voci clonate dell'azienda.
3. THE sistema SHALL consentire di ascoltare un'anteprima di una voce prima di sceglierla.
4. WHEN la lingua della serie non ha voci sufficienti THEN il sistema SHALL spiegarlo prima di procedere.

### Requisito 6 — Clonazione della voce
**User story:** Come utente, voglio creare la mia voce (o quella di un collega consenziente) per i miei podcast.

#### Criteri di accettazione
1. THE sistema SHALL consentire di creare una voce clonata da una o più registrazioni di una sola persona, caricate come file audio (WAV, MP3, FLAC o Ogg Vorbis).
2. THE sistema SHALL verificare, prima dell'invio, durata e formato delle registrazioni rispetto ai requisiti del fornitore, e SHALL consigliare una registrazione pulita di 2-10 minuti.
3. THE sistema SHALL NOT richiedere la registrazione dal browser come unica via, perché i registratori nel browser alterano la voce; WHERE è offerta, SHALL disattivare eliminazione di eco e rumore e SHALL avvisare che la qualità può essere inferiore.
4. BEFORE la creazione il sistema SHALL richiedere la conferma esplicita del consenso della persona la cui voce viene clonata, e SHALL conservare la prova del consenso (chi, quando, per quale voce, testo accettato).
5. THE conferma SHALL includere l'accettazione dei termini del fornitore, che il sistema SHALL trasmettere nella richiesta.
6. THE sistema SHALL consentire di eliminare una voce clonata in qualsiasi momento, SHALL cancellarla anche presso il fornitore e SHALL impedirne l'uso nelle nuove generazioni.
7. WHEN un conduttore usa una voce eliminata THEN il sistema SHALL chiedere di sceglierne un'altra prima di generare l'audio.
8. THE voci clonate SHALL essere visibili e utilizzabili solo dall'azienda che le ha create.
9. THE sistema SHALL mostrare lo stato della voce (in creazione, pronta, fallita) con il motivo in caso di errore.
10. THE clonazione SHALL essere offerta solo per le lingue supportate dal fornitore e solo se l'account è abilitato; altrimenti l'opzione SHALL NOT comparire, o SHALL essere spiegata.

### Requisito 7 — Audio
**User story:** Come editor, voglio ascoltare la puntata come verrà pubblicata.

#### Criteri di accettazione
1. THE sistema SHALL sintetizzare ogni battuta con la voce del suo conduttore e SHALL unire le battute in un solo file MP3, con una breve pausa tra una battuta e l'altra.
2. THE sistema SHALL misurare la durata reale del file e SHALL registrare durata e dimensione.
3. THE sistema SHALL registrare l'inizio e la fine di ogni battuta, per mostrare il trascritto sincronizzato.
4. WHERE il fornitore non fornisce i tempi delle parole THE sistema SHALL accontentarsi dei tempi per battuta.
5. THE sistema SHALL consentire di rigenerare l'audio di una sola puntata, e SHALL addebitare solo quella.
6. THE livello sonoro dei due conduttori SHALL essere confrontabile; IF la differenza supera una soglia THEN il sistema SHALL segnalarlo.
7. IF la sintesi di una battuta fallisce THEN il sistema SHALL ritentare e, se persiste, SHALL indicare quale battuta ha causato l'errore, senza perdere il lavoro già fatto.

### Requisito 8 — Pubblicazione e feed RSS
**User story:** Come editor, voglio un indirizzo RSS da incollare nelle piattaforme di ascolto, come con i servizi di hosting di podcast.

#### Criteri di accettazione
1. THE sistema SHALL generare per ogni serie un feed RSS 2.0 con i dati richiesti dagli elenchi di podcast: titolo, descrizione, lingua, autore, email di contatto, categoria, indicazione di contenuto esplicito, copertina quadrata di almeno 1400 px; e per ogni puntata titolo, descrizione, data di pubblicazione, identificativo stabile, durata e file audio con dimensione e tipo.
2. THE feed SHALL contenere solo le puntate pubblicate.
3. WHEN una puntata viene pubblicata, ritirata o modificata THEN il feed SHALL aggiornarsi entro un tempo breve e documentato.
4. THE sistema SHALL consentire di scegliere per ogni serie un feed **pubblico** (richiesto da Spotify e Apple Podcasts) o **privato** (indirizzo con un codice segreto, adatto alle piattaforme custom).
5. WHERE il feed è privato THE codice SHALL essere lungo e non indovinabile e SHALL poter essere rigenerato, invalidando il vecchio indirizzo.
6. THE file audio SHALL essere serviti da indirizzi stabili che non scadono, con supporto alle richieste parziali (Range), sul sottodominio dedicato ai podcast.
7. THE sistema SHALL mostrare l'indirizzo del feed con un pulsante per copiarlo e le indicazioni per aggiungerlo a Spotify, Apple Podcasts e altre piattaforme.
8. THE identificativo di ogni puntata nel feed SHALL restare invariato anche se il file viene rigenerato, così gli ascoltatori non vedono duplicati.
9. THE sistema SHALL validare il feed prima di renderlo disponibile e SHALL segnalare i dati mancanti che le piattaforme richiedono.
10. WHEN una serie viene messa in privato o eliminata THEN i file pubblici SHALL essere rimossi o resi inaccessibili.

### Requisito 9 — Ascolto in app e download
**User story:** Come utente, voglio ascoltare e scaricare le puntate nell'applicazione.

#### Criteri di accettazione
1. THE pagina della serie SHALL mostrare un lettore audio con trascritto sincronizzato per battuta.
2. THE utente SHALL poter scaricare l'MP3 e il trascritto (testo, SRT o VTT) di ogni puntata.
3. THE accesso in app SHALL usare link firmati a scadenza; solo il feed usa gli indirizzi pubblici stabili.

### Requisito 10 — Crediti e consumi
**User story:** Come responsabile, voglio conoscere il costo prima e pagare solo ciò che viene prodotto.

#### Criteri di accettazione
1. THE sistema SHALL mostrare il preventivo in crediti del piano, dei copioni e dell'audio, prima di ogni passo a pagamento.
2. THE sistema SHALL riservare i crediti prima di partire e SHALL addebitare solo il lavoro riuscito, rilasciando il resto, come per le altre generazioni.
3. WHEN il saldo non basta THEN il sistema SHALL rifiutare l'avvio con un messaggio chiaro, senza lavoro parziale.
4. THE sistema SHALL registrare i consumi dei fornitori (testo, voce) per audit, con il prezzo del listino vigente.
5. THE creazione di una voce clonata SHALL NOT costare crediti presso il fornitore; SHALL essere addebitata solo la sintesi.
6. THE cliente SHALL vedere solo i crediti, mai i costi in valuta dei fornitori.

### Requisito 11 — Sicurezza, privacy e conformità
**User story:** Come responsabile della sicurezza, voglio che le voci siano trattate come dati biometrici.

#### Criteri di accettazione
1. THE voci clonate SHALL essere create nella regione di Francoforte (`eu-central-1`); le registrazioni SHALL NOT essere conservate dal sistema oltre il tempo necessario alla creazione, a meno che l'utente lo scelga.
2. THE sistema SHALL consentire la clonazione solo a chi ha un ruolo adeguato e SHALL registrare nell'audit creazione, uso ed eliminazione delle voci.
3. THE sistema SHALL NOT consentire la clonazione della voce di una persona senza il suo consenso dichiarato, e SHALL fornire il modo di ritirarlo (eliminazione della voce).
4. THE feed e le pagine pubbliche SHALL indicare che l'audio è generato con voci sintetiche, dove la piattaforma lo consente.
5. THE accesso ai dati di una serie SHALL rispettare l'isolamento per azienda; gli indirizzi pubblici dei file SHALL contenere identificativi non indovinabili.
6. THE sistema SHALL NOT esporre al browser le credenziali del fornitore di voci.

### Requisito 12 — Lavori lunghi e affidabilità
**User story:** Come utente, voglio che una serie lunga arrivi in fondo anche se il server si riavvia.

#### Criteri di accettazione
1. THE piano, i copioni e l'audio SHALL girare come lavori in background, con avanzamento visibile per puntata.
2. IF il processo si interrompe THEN il lavoro SHALL riprendere dall'ultimo passo completato, senza rifare né riaddebitare quanto già fatto.
3. THE utente SHALL poter annullare un lavoro in corso, e SHALL essere addebitato solo il lavoro completato.
4. THE errori SHALL essere mostrati in italiano, con il passo che ha fallito e cosa fare.
