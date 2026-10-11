# Manager — Spec servizi d'ecosistema (entitlement + wallet)

> Documento **da sviluppare in Manager** (back-office Knowkube). Autosufficiente:
> contiene modello dati, API, autenticazione e definition of done. I prodotti
> (K Scorm, K Live, K Dataroom, OnDemand) sono **consumatori**: non decidono mai
> entitlement né saldo, li leggono/richiedono a Manager.
>
> Contesto completo nel design: `docs/ECOSYSTEM-ADMIN-SSO.md`.

---

## 0. Ruolo di Manager (fonte di verità)

Manager è l'unico punto dove si decidono:
1. **Company** (aziende cliente) e i loro **owner** (clienti co-proprietari).
2. **Contratti/entitlement**: quali prodotti/installazioni ha attivi una company.
3. **Wallet** (portafoglio virtuale a crediti) per company: saldo + movimenti,
   usato dai prodotti per acquistare feature interne a consumo.
4. **Provisioning**: creazione degli owner nel pool Cognito centrale.
5. **Registro delle installazioni**: ogni prodotto/whitelabel si **annuncia** a
   Manager (self-register) e Manager tiene l'elenco di cosa esiste, dove e per
   quale company è *disponibile* o *attivo* (vedi §0ter e §4bis).
6. **Hub / pagina di snodo**: dopo il login l'owner sceglie da Manager in quale
   prodotto/installazione entrare; l'ingresso è SSO silenzioso (vedi §7bis).

I prodotti chiamano Manager via **OAuth2 client-credentials** (M2M). Nessun
prodotto tiene un proprio saldo o decide l'entitlement.

Chiavi-prodotto canoniche: `kscorm`, `klive`, `kdataroom`, `ondemand`
(`kmanager` NON è un prodotto-cliente).

---

## 0bis. Decisioni di implementazione (Q&A dal team Manager)

Queste scelte sono **vincolanti** per allineare Manager e i prodotti.

1. **Identificatore Company = slug esterno + id numerico interno.** `Company.slug`
   (univoco, **immutabile**, `[a-z0-9-]`, derivato dal nome ALLA creazione e poi
   congelato: il rename del `name` non lo cambia) è l'identificatore usato nelle
   API d'ecosistema (`company_id = <slug>`) e scritto in `custom:tenant_id` nel
   token Cognito. L'`id` numerico resta PK interna; le API risolvono slug→id.
   Vincolo: lo slug nel claim e lo slug in Manager devono coincidere esattamente.

2. **Prodotti = enum curato**, `kscorm|klive|kdataroom|ondemand`, con
   `UNIQUE(company, product)`. `kmanager` escluso (back-office). L'enum è
   **estendibile** centralmente (nuovi prodotti aggiunti senza rotture).

3. **App dedicata `ecosystem/`** (isolata: modelli + API M2M + Cognito), NON dentro
   `customers`. È un bounded context d'ecosistema (futura base dello stack
   identità); può referenziare `customers` per company/contratti.

4. **Auth M2M Fase 1 = stub `M2MClient` a DB**, accettato come **adapter
   sostituibile** verso Cognito, a queste condizioni (per non toccare le view al
   passaggio futuro):
   - la validazione vive in un'**astrazione** (es. permission DRF
     `RequireScope("ecosystem/wallet.write")`), non nelle view;
   - stessa **forma HTTP** del finale: `Authorization: Bearer <token>`, scope
     identici (`ecosystem/entitlements.read`, `wallet.read`, `wallet.write`),
     stessi codici 401/403 → i prodotti non cambieranno nulla;
   - secret **hashati** a DB (no plaintext), confronto a tempo costante;
   - sostituibile con validazione JWT Cognito dietro la stessa permission.

5. **Ownership delle risorse Cognito (Opzione 1 — confermata).** Il pool è
   **condiviso** ma le risorse d'ecosistema le **crea e possiede Manager** dalla
   console `/ecosystem/` (via API AWS, con pieni permessi):
   - **resource server** (identifier **`ecosystem`**, scope `entitlements.read`,
     `wallet.read`, `wallet.write`);
   - **client M2M** per prodotto (client_credentials);
   - **provisioning owner** (`admin-create-user` con `custom:tenant_id` = slug
     company).
   Lo stack Terraform di K Scorm **NON** gestisce queste risorse (per evitare
   conflitti): tocca solo ciò che era già suo (pool, custom domain, Managed Login
   branding, client `scorm-web`, template email). **Regola:** nessuno dei due
   ricrea il pool; Manager aggiunge solo risorse-figlie.

   **Eccezione importante — client web OIDC (login owner).** Questo client NON
   è una risorsa che Manager crea per il prodotto: Manager **riusa il client web
   già esistente del prodotto** (per K Scorm: `scorm-web` =
   `48i3t9p2g5vqdkajssi7bv92r8`). Motivo: il prodotto valida l'ID token su
   `aud` = client ID, e quell'audience è **cablata nell'infrastruttura del
   prodotto** (per K Scorm `OIDC_AUDIENCE` in App Runner, da Terraform). Perciò:
   - **Client M2M (service-to-service):** di Manager, **rotabili liberamente**
     dal control plane (es. `71nb14…`). Nessun impatto sul login utente.
   - **Client web OIDC (login utenti):** del prodotto. **Mai cambiare il client
     ID al volo.** È legato a due punti nel prodotto — build del web
     (`NEXT_PUBLIC_OIDC_CLIENT_ID`) e audience dell'API in infra
     (`OIDC_AUDIENCE`); un cambio richiede un change coordinato con redeploy di
     web **e** API. Manager, se serve, agisce **sul client esistente**
     (callback/branding), non ne crea uno nuovo.

6. **Parametri di aggancio al pool (uguali per tutte le app; si usa l'ID, NON il
   nome `scorm-users`):**
   ```
   POOL ID = eu-west-1_jvwWWna9i
   ISSUER  = https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_jvwWWna9i
   JWKS    = <issuer>/.well-known/jwks.json
   LOGIN   = https://auth.knowkube.com   (dominio owner, uguale per tutti)
   REGION  = eu-west-1
   ```
   Resource server identifier atteso = **`ecosystem`** → scope completi
   `ecosystem/entitlements.read`, `ecosystem/wallet.read`, `ecosystem/wallet.write`.

---

## 0ter. Modello d'attivazione (prodotti e installazioni) — principi

Decisioni di impianto frozen in questa sezione. Obiettivo: **infra stabile**;
aggiungere/togliere prodotti o installazioni = **operazione-dati su Manager**,
senza `terraform apply` sulle installazioni esistenti e senza riconfigurare OIDC.

1. **Prodotto vs installazione.**
   - *Prodotto* = un software (codebase): `kscorm`, `ondemand`, `klive`, …
   - *Installazione* = un deployment con **infra propria** (Lambda/DB/region
     dedicati) di quel software. Un prodotto "mono" (es. K Scorm) ha **una**
     installazione; OnDemand ne ha **N** (una o più whitelabel per cliente,
     anche in region diverse). Codebase condivisa, infra isolata per
     installazione.

2. **OIDC si configura UNA VOLTA SOLA.** Pool unico d'ecosistema, un unico
   dominio di login (`auth.knowkube.com`). Aggiungere prodotti/installazioni
   **non** tocca OIDC: il login usa sempre lo stesso pool. Il discriminante
   "quale prodotto, quale cliente, è attivo?" **non** vive nel token né
   nell'infra: lo decide Manager (fonte di verità) ed è chiesto a runtime.

3. **Self-register (l'installazione si annuncia).** All'avvio ogni installazione
   chiama Manager (`POST /ecosystem/installations/self`, §4bis) dichiarando
   `product`, `installationId`, `region`, `domains`. Manager fa **upsert** e la
   registra come **disponibile, di default DISATTIVATA**. È un **contratto HTTP**,
   non una libreria: ogni prodotto lo implementa nel proprio stack (Node, Django,
   …) con poche righe. Idempotente e **non bloccante** (se Manager non risponde,
   l'installazione parte comunque e ritenta).

4. **Disponibile ≠ attivo.** Manager, per ogni **company**, flagga quali
   prodotti/installazioni sono *disponibili* e quali *attivi* (default: non
   attivo). L'owner può entrare **solo** nei prodotti/installazioni **attivi** per
   la sua company.

5. **JIT provisioning (nessun utente da creare prima).** Al primo ingresso valido
   e **dopo** il gate di entitlement, il prodotto crea l'utente al volo dai claim
   del token (`email`, `custom:tenant_id`, ruolo). L'owner entra senza essere
   stato pre-creato nel prodotto. Il JIT avviene SOLO se il gate dice "attivo",
   così non si creano utenti per company non abilitate.

6. **Ruoli: vocabolario d'ecosistema astratto + mapping nel prodotto.** Manager
   NON assegna ruoli interni del prodotto. Assegna un **eco-role** da un
   vocabolario piccolo e stabile; ogni prodotto lo **mappa** sul proprio ruolo
   interno (vedi §1ter). Così prodotti con ruoli diversi non si accoppiano e un
   prodotto può cambiare i propri ruoli senza impattare Manager né gli altri.

**Il solo vincolo che resta** (scenario infra-per-installazione): creare una
nuova installazione richiede comunque di **provisionare la sua infra** (è
inevitabile). L'obiettivo raggiunto è: (a) zero modifiche alle installazioni
esistenti; (b) provisioning **parametrico/automatizzabile** (modulo + pipeline su
`installationId/product/region`), non editing a mano di Terraform condiviso;
(c) attivazione/disattivazione e stato = **solo Manager**, zero infra.

---

## 1. Modello dati (Manager)

```
Company
  id            numerico, PK interna
  slug          "juve"  — identificatore ESTERNO, univoco, immutabile [a-z0-9-]
  name          "Juventus FC"  (rinominabile; NON cambia lo slug)
  status        active | suspended
  createdAt

Owner  (cliente co-proprietario; 1..N per company, stesso livello)
  id
  companyId     FK → Company
  cognitoSub    sub dell'utente nel pool centrale
  email
  ecoRole       OWNER | ADMIN | MEMBER | VIEWER   (vedi §1ter)
  createdAt

Installation (deployment di un prodotto; registrato via self-register §4bis)
  id            PK interna
  installationId  stringa univoca, es. "kscorm" o "ondemand-acme-eu"
  product       kscorm | klive | kdataroom | ondemand
  region        es. "eu-west-1"
  domains       lista domini serviti (per branding/UX dell'hub)
  ecoRoleMap    JSON opzionale (eco-role → ruolo interno), SOLO per display §1ter
  firstSeenAt   primo self-register
  lastSeenAt    ultimo self-register (heartbeat all'avvio)
  UNIQUE(installationId)

Contract (entitlement; 1 per (company, product[, installation]))
  companyId     FK
  product       kscorm | klive | kdataroom | ondemand
  installationId  (opzionale) specifica l'installazione, per prodotti multi-
                installazione (OnDemand); null = prodotto mono (es. kscorm)
  available     bool  — Manager l'ha reso disponibile per la company
  status        active | grace | expired | cancelled   (attivo ⟺ active|grace)
  plan          (opzionale: nome piano)
  startAt
  endAt         (null = a tempo indeterminato)
  graceUntil    (null se non in grace)
  UNIQUE(companyId, product, installationId)

Wallet (uno per company)
  companyId     FK (PK)
  balance       crediti disponibili (interi; vedi §3 unità)
  currency      "CREDITS"
  updatedAt

WalletTxn (movimenti del wallet — append-only, audit)
  id
  companyId     FK
  type          topup | hold | capture | release | adjust | refund
  amount        >0 accredito, <0 addebito (vedi §3)
  product       prodotto che origina il movimento (es. kscorm)
  feature       feature consumata (es. "video_generation","transcription")
  holdId        correlazione hold→capture/release (null per topup/adjust)
  reference     id esterno dell'operazione nel prodotto (idempotency)
  balanceAfter  saldo risultante (per audit)
  createdAt
```

Note:
- **company = tenant** nei prodotti (confermato).
- `Contract.status = grace` finché `now < graceUntil`: in grace l'entitlement è
  ancora **attivo** per i prodotti (accesso consentito), ma segnalato.

---

## 1ter. Vocabolario eco-role (ruoli d'ecosistema) + mapping

Vocabolario **unico, stabile, versionato**. È l'unico "ruolo" che Manager
assegna e che viaggia nell'ecosistema (claim `custom:eco_role`). Quattro livelli,
a livello **company/cliente**:

```
OWNER   co-proprietario azienda: gestisce tutto, invita owner, titolare contratto
ADMIN   gestisce operatività e utenti, NON la titolarità del contratto
MEMBER  utente operativo
VIEWER  sola lettura
```

Regole:
- **Manager assegna solo l'eco-role.** NON conosce né assegna i ruoli interni dei
  prodotti.
- **Ogni prodotto mappa in casa propria** eco-role → ruolo interno. Esempi:
  ```
  K Scorm:   OWNER→OWNER      ADMIN→ADMIN   MEMBER→EDITOR   VIEWER→VIEWER
  OnDemand:  OWNER→SUPERADMIN ADMIN→ADMIN   MEMBER→EDITOR   VIEWER→VIEWER
  K Live:    OWNER→HOST_ADMIN ADMIN→HOST    MEMBER→SPEAKER  VIEWER→ATTENDEE
  ```
- **Chi ESEGUE il mapping = sempre il prodotto** (non negoziabile: tiene tutto
  disaccoppiato). **Chi CONOSCE il mapping = il prodotto per forza; Manager solo
  se vuole mostrarlo in UI** (via `Installation.ecoRoleMap`, puramente
  informativo, NON la verità operativa).
- Un prodotto può promuovere/declassare internamente un utente oltre il default
  d'ecosistema (autorizzazione fine, interna): **non** risale a Manager.
- Non esiste un "superadmin" nel vocabolario clienti. Un eventuale
  amministratore di piattaforma trasversale a tutti i clienti è **staff interno
  Knowkube**, modellato separatamente (mai assegnabile a un owner cliente).

Il vocabolario è un **contratto condiviso versionato**: cambiarlo impatta tutti i
prodotti, quindi va trattato come breaking change d'ecosistema.

---

## 2. Autenticazione service-to-service (OAuth2 client-credentials)

Enterprise, nativa Cognito, nessuna chiave statica.

Setup (nel pool centrale `eu-west-1_jvwWWna9i` o in un resource server dedicato):
- **Resource server** Manager con scope:
  - `ecosystem/entitlements.read`
  - `ecosystem/wallet.read`
  - `ecosystem/wallet.write`
- Un **app-client M2M** per prodotto (grant `client_credentials`), con gli scope
  minimi necessari (es. K Scorm: entitlements.read + wallet.read + wallet.write).

Flusso: il prodotto ottiene un access token
(`POST /oauth2/token` su `auth.knowkube.com`, grant client_credentials) e lo usa
come `Authorization: Bearer` verso le API Manager. Manager valida issuer/scope.

---

## 3. Unità crediti e regole saldo

- `balance` e `amount` in **crediti interi** (nessun float). La conversione
  "consumo tecnico → crediti" vive in Manager (listino per feature/prodotto), così
  i prezzi si cambiano in un solo posto. (In K Scorm resta solo il metering
  tecnico; vedi §6.)
- Il **saldo disponibile** = `balance − somma hold aperti`. Un hold riserva
  crediti senza ancora sottrarli definitivamente.
- Regola: non si può aprire un hold se `disponibile < importo` (salvo politica di
  sconfino configurabile per company, default **no**).

---

## 4. API — Entitlement

### GET /ecosystem/entitlements
Query: `company_id`.
Scope: `ecosystem/entitlements.read`.
```
GET /ecosystem/entitlements?company_id=juve
→ 200 {
  "company_id": "juve",
  "products": [
    { "product": "ondemand", "installationId": "ondemand-juve-eu",
      "available": true, "status": "active", "graceUntil": null },
    { "product": "kscorm",   "installationId": null,
      "available": true, "status": "active", "graceUntil": null }
  ]
}
```
Semantica per i prodotti: accesso consentito se esiste un contratto del prodotto
(ed eventuale `installationId`) con `status ∈ {active, grace}`. Altrimenti negato.
Un prodotto multi-installazione (OnDemand) filtra anche per il proprio
`installationId`; un prodotto mono (kscorm) ignora il campo.

---

## 4bis. API — Installazioni (self-register + hub)

Contratto HTTP implementabile in **qualsiasi stack** (Node/Django/…). È un
contratto, non una libreria.

### POST /ecosystem/installations/self   (self-register, all'avvio)
L'installazione si annuncia. **Idempotente** (upsert su `installationId`),
**non bloccante** lato prodotto. Autenticata col client M2M del prodotto.
```
scope ecosystem/entitlements.read (o uno scope dedicato installations.write)
body {
  "product": "ondemand",
  "installationId": "ondemand-acme-eu",
  "region": "eu-west-1",
  "domains": ["acme.ondemand.knowkube.com"],
  "ecoRoleMap": { "OWNER":"SUPERADMIN","ADMIN":"ADMIN",
                  "MEMBER":"EDITOR","VIEWER":"VIEWER" }   // opzionale (display)
}
→ 200 {
  "installationId": "ondemand-acme-eu",
  "status": "available",          // registrata; attivazione per-company separata
  "enforce": "hard",              // modalità gate suggerita (opzionale)
  "walletEnabled": true           // opzionale
}
```
Note:
- Default **disponibile, non attivo** per nessuna company finché Manager non
  flagga l'attivazione.
- Il prodotto chiama questo endpoint a ogni avvio/deploy; serve da heartbeat
  (`lastSeenAt`). Un fallimento NON deve impedire al prodotto di partire.

### GET /ecosystem/hub?company_id=<slug>   (tessere per l'owner)
Usato dall'hub di Manager per mostrare all'owner i prodotti/installazioni
**attivi** per la sua company (vedi §7bis).
```
scope ecosystem/entitlements.read
→ 200 { "company_id":"acme", "tiles":[
    { "product":"kscorm","installationId":null,
      "loginUrl":"https://architect.knowkube.com/login","label":"K Scorm" },
    { "product":"ondemand","installationId":"ondemand-acme-eu",
      "loginUrl":"https://acme.ondemand.knowkube.com/login","label":"OnDemand" }
] }
```

---

## 5. API — Wallet (hold/capture)

Pattern a **riserva** (hold → capture | release), idempotente.

### GET /ecosystem/wallet
```
GET /ecosystem/wallet?company_id=juve        scope wallet.read
→ 200 { "company_id":"juve","balance":1200,"available":1150,"currency":"CREDITS" }
```

### POST /ecosystem/wallet/holds   (riserva crediti PRIMA dell'operazione)
```
scope wallet.write
body {
  "company_id":"juve",
  "product":"kscorm",
  "feature":"video_generation",
  "amount": 50,
  "reference":"kscorm:job:cmv2d...:video:blk12"   // idempotency key
}
→ 201 { "holdId":"h_abc", "amount":50, "available":1100, "expiresAt":"..." }
→ 409 { "error":"insufficient_credits","available":30 }       // saldo < amount
→ 200 (idempotente: stesso reference già visto → ritorna lo stesso hold)
```
- Un hold **scade** se non catturato entro N minuti (release automatico) → evita
  crediti bloccati da operazioni morte.

### POST /ecosystem/wallet/holds/{holdId}/capture  (conferma addebito a fine op.)
```
scope wallet.write
body { "amount": 48 }        // <= amount dell'hold (consumo reale può essere minore)
→ 200 { "captured":48, "released":2, "balance":1152 }
```

### POST /ecosystem/wallet/holds/{holdId}/release  (annulla la riserva)
```
scope wallet.write
→ 200 { "released":50, "balance":1200 }
```

### POST /ecosystem/wallet/topup   (ricarica — operata da Manager/billing)
```
scope wallet.write (o solo back-office)
body { "company_id":"juve","amount":1000,"reference":"invoice:..." }
→ 200 { "balance":2200 }
```

Requisiti trasversali:
- **Idempotency** su `reference` per holds e topup (retry sicuri).
- **Append-only** `WalletTxn` per audit; `balanceAfter` su ogni movimento.
- Concorrenza: operazioni sul wallet **atomiche** (transazione DB / lock per
  company) per evitare race tra hold concorrenti.

---

## 6. Integrazione lato prodotto (K Scorm) — come consumerà

Flusso di una feature a pagamento (es. generazione video):
1. K Scorm stima il costo (metering tecnico locale) → chiede un **hold** al wallet
   (`reference` = id operazione, idempotente).
2. Se `insufficient_credits` → blocca con messaggio ("Crediti insufficienti").
3. Esegue l'operazione; a fine → **capture** con il consumo reale (≤ hold).
4. Se fallisce → **release**.

Nota evolutiva (concordata): oggi K Scorm tiene il **metering tecnico** locale
(`UsageRecord`, pricing). In prospettiva **anche il metering confluirà in Manager**
(riferito a kscorm): Manager diventa il registro unico di consumi + saldo, e
K Scorm invierà gli eventi di consumo. Questa spec è compatibile: capture già
porta `product/feature/reference`, sufficienti a ricostruire il metering in
Manager quando si farà il consolidamento.

---

## 7. Provisioning owner (Manager → Cognito)

Quando Manager attiva un cliente:
- crea l'**owner** nel pool centrale (`admin-create-user`) con `custom:tenant_id`
  = id della company (+ `custom:role=OWNER`);
- per co-proprietari aggiuntivi: ulteriori utenti con lo **stesso** `company_id`.
- alla disdetta: Manager imposta `Contract.status` → `expired/cancelled`
  (eventuale `graceUntil`); l'owner mantiene il login ma i prodotti negano
  l'accesso al termine del grace.
- `custom:eco_role` = eco-role dell'owner (default `OWNER` per il co-proprietario,
  vedi §1ter). È l'unico "ruolo" nel token; i prodotti lo mappano in casa.

---

## 7bis. Hub + SSO silenzioso + JIT (ingresso owner, scenario B)

Obiettivo (nelle parole del prodotto): *Pippo, owner di Acme, fa login una volta,
clicca "K Scorm" nell'hub ed entra come `pippo@email.com` **senza** essere stato
pre-creato su K Scorm.*

Flusso:
1. Pippo fa login su Manager via OIDC (pool d'ecosistema) → si crea la **sessione
   di pool** su `auth.knowkube.com`.
2. **Hub di Manager** (`GET /ecosystem/hub`, §4bis): mostra le tessere dei
   prodotti/installazioni **attivi** per Acme.
3. Pippo clicca una tessera → Manager lo manda al login OIDC di quel
   prodotto/installazione (stesso pool). Grazie alla sessione di pool esistente,
   Cognito **non ridomanda le credenziali**: redirect di ritorno automatico
   (**SSO silenzioso**, comportamento nativo del pool — nessun handoff custom).
4. Il prodotto riceve l'ID token (claim `email`, `custom:tenant_id=acme`,
   `custom:eco_role`), e nel suo auth-guard:
   - valida il token (firma/iss/aud/scadenza);
   - **gate entitlement**: chiede a Manager "Acme ha questo prodotto/installazione
     attivo?" (§4) → se no, 403;
   - **JIT provisioning**: se l'utente non esiste, lo crea dai claim con il ruolo
     interno ottenuto mappando `custom:eco_role` (§1ter). SOLO dopo il gate.
   - Pippo è dentro, senza pre-creazione. ✅

Punti fermi: SSO silenzioso = gratis col pool unico; "senza creare l'utente" =
JIT, **lato prodotto**; nessuno di questi passi tocca OIDC o l'infra.

---

## 8. Definition of Done (prima parte Manager)

1. Modello dati §1 (Company, Owner, Contract, Wallet, WalletTxn).
2. Resource server + scope Cognito e app-client M2M per i prodotti (§2).
3. API entitlement §4 (con stati active/grace).
4. API wallet §5 (hold/capture/release/topup) **idempotenti e atomiche**.
5. Provisioning owner §7 (crea utente Cognito con `company_id`).
6. Backfill dei contratti OnDemand esistenti nel nuovo modello; aggiunta prodotto
   `kscorm` per la company di test (`juve`/`knowkube`).
7. Test: entitlement attivo/grace/scaduto; hold con saldo sufficiente/insufficiente;
   capture parziale; release; idempotency su reference ripetuto; concorrenza.
8. Registro **Installation** + endpoint `self-register` idempotente (§4bis);
   flag *disponibile/attivo* per (company, prodotto/installazione).
9. **Hub** (`GET /ecosystem/hub`) con le tessere dei prodotti attivi e `loginUrl`
   per l'ingresso SSO (§7bis).
10. `custom:eco_role` emesso nel token owner secondo il vocabolario §1ter.

---

## 9. Cosa resta ai prodotti (NON Manager)

- **Self-register** all'avvio (§4bis), idempotente e non bloccante, nel proprio
  stack.
- Gate entitlement al login (chiamata §4) con cache breve e **modalità soft**
  iniziale (consenti se Manager non risponde) → poi hard.
- **JIT provisioning** dell'utente dai claim, dopo il gate; **mapping eco-role →
  ruolo interno** (§1ter) in casa del prodotto.
- Hold/capture/release attorno alle feature a pagamento (§5–§6).
- Metering tecnico locale finché non si consolida in Manager.
