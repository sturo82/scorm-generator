# Tasks — Podcast (serie di puntate audio)

Convenzioni: build, lint e test con il controllo completo (container Docker) dopo
ogni fase. Il ruolo si controlla sempre sul server. Nessun segreto nel repo. Ogni
passo a pagamento ha preventivo, riserva e addebito del solo lavoro riuscito.

---
## Fase 0 — Prerequisiti (non sono codice)
- [ ] 0.1 Richiedere ad AWS l'abilitazione alla **clonazione vocale di Polly** per l'account (account team o modulo "apply for access" indicato nella pagina di annuncio AWS). A cura del titolare dell'account. Verifica: nel pannello laterale della console Polly, **a Francoforte**, compare la voce **Voice cloning**. Finché non c'è, si procede con le voci del catalogo (Bianca, Beatrice, Lorenzo).
- [ ] 0.1b Chiedere ad AWS Support, insieme all'abilitazione, un **aumento del limite** di voci clonate (10 per account e regione all'inizio, condivise da tutte le aziende).
  - _Requisiti: 6.10_
- [x] 0.2 Sottodominio scelto: **`podcast.knowkube.com`** (zona `knowkube.com` già in Route53). Il certificato si crea con Terraform.
  - _Requisiti: 8.6_
- [x] 0.3 Letti (podcasters.apple.com): copertina quadrata 1400-3000 px JPEG/PNG, categorie con maiuscole esatte, RFC 2822, HEAD e byte-range, GUID fisso, nomi file ASCII, enclosure unico per puntata. Leggere i requisiti correnti di **Apple Podcasts e Spotify** per il feed (campi obbligatori, copertina, durata) e aggiornare la validazione.
  - _Requisiti: 8.1, 8.9_

## Fase A — Infrastruttura e configurazione
- [ ] 1. Regione e client Polly per le voci
  - `SPEECH_REGION` (default: `MEDIA_REGION`; per il podcast `eu-central-1`) in `configuration.ts`, `variables.tf` e `apprunner.tf`. Un secondo client Polly per la sintesi del podcast; `MEDIA_REGION` resta com'è.
  - _Requisiti: 11.1_
- [ ] 2. Permessi IAM (`iam.tf`)
  - `polly:CreateVoice`, `polly:GetVoice`, `polly:DeleteVoice` (e `polly:ListVoices` se serve) oltre a `SynthesizeSpeech`.
  - Scrittura e cancellazione sul solo prefisso `public-podcasts/` del bucket degli asset.
  - _Requisiti: 6.1, 8.6_
- [ ] 3. Area pubblica (`podcasts.tf`)
  - Distribuzione CloudFront con OAC sul prefisso `public-podcasts/`, certificato, record DNS del sottodominio, risposte con tipo e intestazioni di cache corretti e supporto alle richieste parziali.
  - Il bucket resta privato, con il blocco di accesso pubblico attivo: la distribuzione legge il solo prefisso `public-podcasts/` con una policy del bucket dedicata all'OAC.
  - _Requisiti: 8.6, 8.10_
- [ ] 4. Prezzi interni: riga `polly-generative` (`CHARACTERS`) per la regione di Francoforte in una migrazione dei prezzi.
  - _Requisiti: 10.4_
- [ ] 5. Aggiornare `@aws-sdk/client-polly` e verificare che la sintesi esistente non cambi.
  - _Requisiti: 6.1_
- [ ] 6. Checkpoint A: `terraform fmt` e `terraform validate` verdi, build e test verdi.

## Fase B — Dati e contratti
- [ ] 7. `packages/contracts/src/podcast.ts`
  - Schemi zod di serie, puntata, brief, piano, copione a battute, voce, consenso e vista del feed; `podcastWordBudget`, `podcastScriptFit`; esportare da `index.ts` e ricompilare i contratti.
  - _Requisiti: 1, 3, 4_
- [ ] 8. Migrazione Prisma: `Podcast`, `PodcastEpisode`, `PodcastVoice`, `PodcastVoiceConsent`, tipi enumerati, indici e protezione a livello di riga.
  - _Requisiti: 1.3, 6.8, 11.5_
- [ ] 9. Registrare i nuovi consumi nel metering (`source` per piano, copione, audio) e nell'elenco dei costi.
  - _Requisiti: 10.4_
- [ ] 10. Checkpoint B: migrazione applicata su un database pulito, contratti compilati, test verdi.

## Fase C — Voci e clonazione
- [ ] 11. Porta `VoiceCloneProvider` in `@scorm/domain` e adattatore **mock** per sviluppo e test.
  - _Requisiti: 6_
- [ ] 12. Adattatore **Polly** (`createVoice`, `getVoice`, `deleteVoice`) con `ClientToken` per l'idempotenza, errori mappati (non abilitato, limite di voci raggiunto, registrazione non valida).
  - _Requisiti: 6.1, 6.5, 6.9, 6.10_
- [ ] 13. `PodcastVoicesService` e API
  - Elenco (catalogo + clonate), creazione con consenso, controllo di formato e durata, stato con interrogazione periodica, anteprima, eliminazione presso il fornitore, audit.
  - Le registrazioni non si conservano oltre l'invio.
  - _Requisiti: 5, 6, 11.1, 11.2, 11.3_
- [ ] 14. Catalogo delle voci per lingua (voci generative disponibili nella regione) con anteprima.
  - _Requisiti: 5.2, 5.3, 5.4_
- [ ] 15. Checkpoint C: voce mock creata, usata, eliminata; voce reale su Polly appena l'accesso è abilitato.

## Fase D — Generazione
- [ ] 16. Fonti: recupero da documenti (come per i corsi) e da articoli RSS scelti, con fonti salvate per puntata.
  - _Requisiti: 2_
- [ ] 17. Piano della serie: prompt, schema, controllo, modifica prima di procedere, preventivo.
  - _Requisiti: 3, 10.1_
- [ ] 18. Copione a due conduttori: prompt, schema a battute, taratura sulla durata con riscrittura, controllo deterministico, modifica manuale, segnalazione "audio non aggiornato".
  - _Requisiti: 4_
- [ ] 19. Audio: una battuta per volta, ritentativi, pausa tra le battute, unione, durata reale, tempi per battuta, salvataggio privato.
  - Prova della giunzione con due voci diverse e della normalizzazione del livello (decisione aperta 2).
  - _Requisiti: 7_
- [ ] 20. Lavoro in background con battito e ripresa all'avvio, avanzamento per puntata, annullamento, addebito del solo lavoro completato.
  - _Requisiti: 10.2, 12_
- [ ] 21. Trascritto in testo, SRT e VTT dai tempi per battuta.
  - _Requisiti: 9.2_
- [ ] 22. Checkpoint D: una serie di prova con due voci del catalogo, dal brief all'MP3, con crediti riservati e addebitati correttamente; prova con documenti e con un feed RSS.

## Fase E — Pubblicazione e feed
- [ ] 23. Generatore del feed RSS 2.0 con `itunes:*`, scappamento dei caratteri, validazione.
  - _Requisiti: 8.1, 8.9_
- [ ] 24. Pubblica e ritira: copia nell'area pubblica, `guid` stabile, rigenerazione del feed, invalidazione in CloudFront.
  - _Requisiti: 8.2, 8.3, 8.8_
- [ ] 25. Feed pubblico o privato, token rigenerabile, rimozione dei file con il cambio di visibilità e l'eliminazione della serie.
  - _Requisiti: 8.4, 8.5, 8.10, 1.5_
- [ ] 26. Prova del feed con un validatore di podcast e, se possibile, con un'app di ascolto reale; controllo delle richieste parziali.
  - _Requisiti: 8.1, 8.6_

## Fase F — Interfaccia web
- [ ] 27. Tipi, client HTTP, client di prova e hook per serie, puntate, voci e feed.
- [ ] 28. Voce **Podcast** nel menu e pagina dell'elenco.
  - _Requisiti: 1_
- [ ] 29. Creazione guidata: fonti, lingua, numero e durata, conduttori e voci con anteprima, preventivo.
  - _Requisiti: 2, 3, 5, 10_
- [ ] 30. Pagina della serie: puntate con avanzamento, editor dei copioni, lettore con battuta evidenziata, download.
  - _Requisiti: 4.3, 7, 9_
- [ ] 31. Voci: creazione guidata con consenso, conversione nel browser (mono, 24 kHz, 16 bit, prese fino a 60 s), stato, eliminazione.
  - _Requisiti: 6_
- [ ] 32. Feed: indirizzo da copiare, pubblico o privato, rigenerazione del token, istruzioni per le piattaforme, avvisi sui dati mancanti.
  - _Requisiti: 8.4, 8.7, 8.9_
- [ ] 33. Checkpoint F: percorso completo in un browser con un utente EDITOR e uno VIEWER.

## Fase G — Rifinitura e chiusura
- [ ] 34. Audit di creazione, uso ed eliminazione delle voci, e di pubblicazione e ritiro delle puntate.
  - _Requisiti: 11.2_
- [ ] 35. Messaggi d'errore in italiano per ogni passo e per i limiti del fornitore.
  - _Requisiti: 12.4_
- [ ] 36. Documentazione operativa in `docs/` (dominio, abilitazione Polly, regione, come testare un feed).
- [ ] 37. Checkpoint finale: build, lint, test, deploy; prova con una serie reale.

---
### Fasi successive (non in questa spec)
- Pagina pubblica della serie e lettore incorporabile.
- Trascritto parola per parola con Amazon Transcribe.
- Blocco audio nei corsi SCORM.
- Adattatore HeyGen per le voci clonate.
- Statistiche di ascolto.
