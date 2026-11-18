# Richiesta di integrazione wallet crediti: K Scorm – Manager

**Oggetto:** specifiche e conferme per l'addebito in crediti delle generazioni di corsi e video in K Scorm
**Prodotto richiedente:** K Scorm (`kscorm`)
**Destinatario:** team Manager (wallet, billing, control plane d'ecosistema)

---

## 1. Premessa

K Scorm genera corsi e video: copioni, clip con avatar, montaggio video, quiz e immagini. Si intende far pagare queste generazioni tramite il wallet a crediti gestito da Manager, con il seguente flusso:

1. prima di generare, K Scorm mostra al cliente il costo stimato in crediti;
2. se il cliente accetta, K Scorm **prenota** i crediti (`hold`);
3. a fine elaborazione K Scorm **addebita il consumo reale** (`capture`);
4. in caso di errore o annullamento K Scorm **libera** la riserva (`release`).

Manager resta l'unica fonte di verità per saldo, movimenti, ricariche (Stripe incluso) e listino. K Scorm non gestisce pagamenti né ricariche.

K Scorm ha già implementato il client del wallet secondo la specifica `MANAGER-ECOSYSTEM-SPEC.md` (§5): `hold`, `capture`, `release`, idempotenza tramite `reference`, autenticazione M2M con scope `ecosystem/wallet.read` e `ecosystem/wallet.write`.

## 2. Come K Scorm calcolerà i crediti

K Scorm misura già il costo reale di ogni operazione in dollari. L'importo in crediti sarà:

> crediti = costo misurato (USD) × (1 + margine) × crediti per dollaro

Il tasso «crediti per dollaro» (e per euro) è un dato di Manager. È quindi richiesta la sua comunicazione formale (punto 3.1).

## 3. Richieste

Si chiede a Manager di fornire risposta scritta a ciascuno dei punti seguenti.

### 3.1 Tasso di conversione (bloccante)
- Quanti crediti corrispondono a 1 USD e a 1 EUR?
- Il tasso è unico per tutte le aziende e i prodotti, o varia per contratto o per feature?
- Il margine sul costo è applicato da K Scorm o già incluso nel listino di Manager?
- Il tasso è leggibile da un endpoint (es. `GET /ecosystem/wallet/rates`), così che una variazione non richieda un nuovo rilascio di K Scorm? In caso contrario, come verremo avvisati di una modifica?

### 3.2 Voci a consumo (`feature`) e importi
K Scorm propone queste voci:

| `feature` | Descrizione |
|---|---|
| `video_avatar` | clip con avatar |
| `video_render` | montaggio del video |
| `text_generation` | copioni, riepiloghi, quiz, corsi |
| `image_generation` | immagini e copertine |

- Le voci proposte sono accettate, o esiste già un elenco di Manager da adottare?
- `amount` è un intero positivo in crediti? Con quale regola di arrotondamento (proposta: per eccesso sulla prenotazione, al valore reale sull'addebito)?
- Esiste un importo minimo per un `hold`?

### 3.3 Durata e rinnovo della riserva (bloccante)
Una generazione di clip con avatar può durare da 30 a 60 minuti.
- Dopo quanto tempo un `hold` non catturato scade e viene liberato automaticamente?
- È possibile impostare una scadenza più lunga alla creazione, oppure **prolungare** un `hold` esistente (es. `POST /ecosystem/wallet/holds/{holdId}/extend`)?

### 3.4 Consumo reale diverso dalla stima (bloccante)
- Se il consumo reale supera l'importo riservato, la `capture` viene rifiutata, accettata fino al saldo disponibile, oppure va aperto un `hold` integrativo?
- È possibile effettuare **più `capture` parziali** sullo stesso `hold` (utile per lavori a fasi), o è ammessa una sola `capture` finale?
- Se un'operazione si interrompe dopo aver già generato parte dei contenuti (parte del costo già sostenuta verso i fornitori), è possibile fare una `capture` parziale sul consumato e un `release` del resto?

### 3.5 Lettura del saldo
- Si conferma che `GET /ecosystem/wallet?company_id=…` restituisce `balance`, `available` e `currency`?
- Il saldo deve essere mostrato solo in crediti, o anche con il controvalore in euro? In tal caso con quale tasso?

### 3.6 Errori
- Si conferma il formato `409 { "error": "insufficient_credits", "available": N }` per il saldo insufficiente?
- Elencare gli altri errori che K Scorm deve gestire (azienda senza wallet, wallet sospeso, contratto scaduto) con codice HTTP e struttura del messaggio.

### 3.7 Ricarica (link, senza gestione pagamenti in K Scorm)
- Indicare l'URL della pagina di ricarica di Manager e le modalità di accesso con SSO da K Scorm.
- La pagina accetta un parametro di ritorno (`return_url`) per riportare l'utente in K Scorm dopo il pagamento?
- Chi può ricaricare (solo l'owner dell'azienda o ogni utente)? K Scorm nasconderà il pulsante di conseguenza.

### 3.8 Attivazione per azienda e ambiente di prova
- Il wallet si attiva **per singola azienda**? Si richiede di poterlo abilitare a un cliente alla volta, lasciando le altre senza addebito. Dove si imposta e come lo legge K Scorm (es. `walletEnabled` per company)?
- Si richiede la messa a disposizione di **un'azienda di prova** con wallet attivo e saldo di test, per verificare i cicli `hold → capture` e `hold → release`.
- Esiste un ambiente di staging di Manager?

### 3.9 Estratto conto
- I movimenti riportano `product`, `feature` e `reference`. È possibile includere una descrizione leggibile (es. «Video: <titolo>») visibile al cliente nell'estratto conto? Con quale campo?

## 4. Attività di K Scorm dopo la risposta

1. Lettura di saldo e tasso di conversione.
2. Attivazione dell'addebito per singola azienda.
3. Stima in crediti mostrata prima di ogni generazione a pagamento, con conferma esplicita.
4. `hold` all'avvio, `capture` del consumo reale a fine lavoro, `release` in caso di errore o annullamento.
5. Messaggio «Crediti insufficienti» con pulsante **Ricarica** verso la pagina di Manager.
6. Saldo in crediti visibile nell'intestazione dell'applicazione.

## 5. Priorità

I punti **3.1, 3.3 e 3.4** sono bloccanti: senza le risposte non è possibile avviare lo sviluppo. I restanti punti possono essere chiariti in parallelo.

Si ringrazia per la collaborazione. Si resta a disposizione per un confronto tecnico.
