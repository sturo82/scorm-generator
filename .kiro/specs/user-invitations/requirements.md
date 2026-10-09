# Requisiti — Inviti utente da pannello admin (Cognito)

## Introduzione

In produzione l'autenticazione è OIDC su Amazon Cognito. Oggi un utente che
esiste in Cognito **non può accedere** finché non esiste anche un record `User`
nel database applicativo (l'`AuthGuard` lo risolve per `tenantId_externalId` e,
fuori dalla modalità `dev`, non lo auto-provisiona). Non esiste alcun endpoint
né UI per creare/invitare utenti: oggi nascono solo via `provisionDevUser`
(solo `AUTH_PROVIDER=dev`).

Questa feature introduce un **pannello admin nella UI** per invitare utenti. Un
amministratore inserisce email, nome e ruolo; il sistema crea l'utente in
**Cognito** (che invia l'email di invito con password temporanea) e il record
`User` corrispondente nel **DB applicativo**, nello stesso tenant dell'admin.

### Ambito (Fase 1 — "Scenario X: tenant singolo")
- Esiste **un tenant** (la tua organizzazione), creato come seed al deploy con
  un utente OWNER iniziale.
- L'admin invita utenti **dentro il proprio tenant**. Nessuna creazione di nuovi
  tenant da UI (rimandata alla Fase 2: self-signup + abbonamento).
- Login: **solo email/password** (nessun login sociale).
- **Self-signup disabilitato** su Cognito: solo gli admin creano utenti.

### Fuori ambito (Fase 2, non in questa spec)
- Registrazione aperta al pubblico e creazione automatica del tenant.
- Billing/abbonamenti.
- Lambda trigger (pre-token-generation / post-confirmation).
- Reset password self-service oltre al flusso standard di Cognito.

### Glossario
- **Tenant**: organizzazione cliente; isola corsi/brand/knowledge/utenti.
- **externalId**: il claim `sub` dell'IdP (in Cognito, lo UUID dell'utente nello
  User Pool). È la chiave con cui l'`AuthGuard` collega il token al record `User`.
- **custom:tenant_id**: attributo Cognito che porta il tenant nel token.
- **Ruoli**: OWNER ⊇ ADMIN ⊇ EDITOR ⊇ VIEWER (gerarchia già esistente).

---

## Requisiti

### Requisito 1 — Infrastruttura di identità (Cognito)
**User story:** Come operatore, voglio un User Pool Cognito configurato per
email/password e inviti admin, così da avere un IdP conforme in UE.

#### Criteri di accettazione
1. THE sistema SHALL fornire un Cognito User Pool in regione UE (`eu-west-1`) con
   sign-in via **email** e policy password robusta.
2. THE User Pool SHALL avere la **self-registration disabilitata**
   (`AdminCreateUser` only).
3. THE User Pool SHALL definire un custom attribute **`tenant_id`** (stringa,
   mutabile) incluso nei token.
4. THE sistema SHALL fornire un **App Client pubblico** (senza secret) con
   Authorization Code + **PKCE**, scope `openid email profile`, callback URL del
   dominio frontend.
5. THE sistema SHALL esporre, come output dell'infrastruttura, `issuer`,
   `clientId`, `userPoolId` e il dominio hosted UI, da iniettare nelle config di
   API e Web.
6. WHERE un amministratore crea un utente THEN Cognito SHALL inviare un'email di
   invito con password temporanea.

### Requisito 2 — Endpoint di creazione utente (backend)
**User story:** Come amministratore, voglio un endpoint protetto che crei un
utente sia in Cognito sia nel DB, così che l'invitato possa accedere davvero.

#### Criteri di accettazione
1. THE sistema SHALL esporre `POST /admin/users` riservato ai ruoli **ADMIN e
   superiori** (`@Roles('ADMIN')`), con input validato: `email`, `displayName`
   (opzionale), `role`.
2. WHEN l'endpoint è invocato THEN il sistema SHALL creare l'utente in Cognito
   via `AdminCreateUser`, impostando gli attributi `email`, `email_verified=true`
   e `custom:tenant_id` = tenant dell'admin chiamante.
3. WHEN Cognito ha creato l'utente THEN il sistema SHALL leggere il `sub`
   generato e creare il record `User` nel DB con `tenantId` dell'admin,
   `externalId = sub`, `email`, `displayName`, `role`.
4. THE ruolo assegnabile SHALL NOT superare il ruolo del chiamante (un ADMIN non
   può creare un OWNER); un tentativo SHALL essere rifiutato (403).
5. WHERE l'email esiste già nel tenant (vincolo `@@unique([tenantId, email])`)
   THE sistema SHALL rispondere con un errore chiaro (409) senza creare duplicati.
6. IF la creazione del record DB fallisce DOPO la creazione in Cognito THEN il
   sistema SHALL compensare eliminando l'utente Cognito (`AdminDeleteUser`), per
   non lasciare stati incoerenti.
7. THE operazione SHALL essere registrata nell'audit (`user.invited`) con email
   e ruolo (senza segreti).
8. THE scrittura del record `User` SHALL avvenire nel contesto del tenant
   corrente (coerente con l'isolamento multi-tenant/RLS esistente).

### Requisito 3 — Elenco utenti (backend)
**User story:** Come amministratore, voglio vedere gli utenti del mio tenant,
così da gestirli.

#### Criteri di accettazione
1. THE sistema SHALL esporre `GET /admin/users` (`@Roles('ADMIN')`) che ritorna
   gli utenti del **solo tenant del chiamante** (id, email, displayName, role,
   createdAt).
2. THE risposta SHALL NOT includere dati sensibili (nessun token, nessuna
   password).

### Requisito 4 — Pannello admin (frontend)
**User story:** Come amministratore, voglio un pannello nelle impostazioni per
invitare utenti e vederli, senza usare la console AWS.

#### Criteri di accettazione
1. THE frontend SHALL fornire una pagina `settings/users` con l'elenco utenti e
   un form "Invita utente" (email, displayName, select ruolo).
2. WHEN l'admin invia il form THEN la UI SHALL chiamare `POST /admin/users`,
   mostrare conferma/errore (toast) e aggiornare l'elenco.
3. THE voce di navigazione "Utenti" SHALL essere mostrata **solo** agli utenti
   con ruolo ADMIN o OWNER (gating cosmetico; l'enforcement resta server-side).
4. THE select del ruolo SHALL offrire solo ruoli ≤ quello dell'utente corrente.
5. WHERE l'API risponde con errore (403/409/500) THE UI SHALL mostrare un
   messaggio comprensibile e NON lasciare il form in stato ambiguo.

### Requisito 5 — Seed del tenant e del primo OWNER
**User story:** Come operatore, al primo deploy voglio creare il tenant iniziale
e il primo utente OWNER, così da poter poi invitare gli altri dall'UI.

#### Criteri di accettazione
1. THE sistema SHALL fornire una procedura ripetibile (script o comando) per
   creare: un Plan, il Tenant iniziale, e un utente OWNER collegato al `sub`
   Cognito dell'operatore.
2. THE procedura SHALL essere idempotente o chiaramente one-shot documentata.
3. THE documentazione di deploy SHALL spiegare come ottenere il `sub` Cognito
   del primo OWNER e lanciare il seed.

### Requisito 6 — Sicurezza e configurazione
**User story:** Come team, voglio che l'integrazione Cognito sia sicura e
configurata senza segreti nel codice.

#### Criteri di accettazione
1. THE backend SHALL ricevere `COGNITO_USER_POOL_ID` e la regione via
   configurazione; le credenziali AWS SHALL provenire dal **task role IAM** (o
   default credential chain), mai da variabili statiche nel repo.
2. THE task role IAM SHALL concedere i **permessi minimi** Cognito
   (`AdminCreateUser`, `AdminDeleteUser`, `ListUsers`) sul solo User Pool.
3. THE `AdminCreateUser`/elenco SHALL agire **solo** sul tenant del chiamante;
   non SHALL essere possibile creare/elencare utenti di altri tenant.
4. THE enforcement del ruolo SHALL essere server-side (`@Roles`), indipendente
   dal gating cosmetico della UI.

### Requisito 7 — Verifica e non-regressione
#### Criteri di accettazione
1. THE build (tsc di tutti i package + typecheck web) e la suite di test
   esistente SHALL restare verdi; SHALL essere aggiunti test per la logica del
   nuovo servizio (gerarchia ruoli, compensazione, filtro tenant) con il client
   Cognito mockato.
2. THE verifica SHALL girare in container Docker (coerente col flusso del repo).
3. THE lavoro SHALL procedere a fasi lasciando il sistema compilabile dopo
   ciascuna.
