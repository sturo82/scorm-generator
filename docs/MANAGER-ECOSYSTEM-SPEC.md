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
2. **Contratti/entitlement**: quali prodotti ha attivi una company.
3. **Wallet** (portafoglio virtuale a crediti) per company: saldo + movimenti,
   usato dai prodotti per acquistare feature interne a consumo.
4. **Provisioning**: creazione degli owner nel pool Cognito centrale.

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
  createdAt

Contract (entitlement per prodotto, 1 per (company, product))
  companyId     FK
  product       kscorm | klive | kdataroom | ondemand
  status        active | grace | expired | cancelled
  plan          (opzionale: nome piano)
  startAt
  endAt         (null = a tempo indeterminato)
  graceUntil    (null se non in grace)
  UNIQUE(companyId, product)

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
    { "product": "ondemand", "status": "active", "graceUntil": null },
    { "product": "kscorm",   "status": "active", "graceUntil": null }
  ]
}
```
Semantica per i prodotti: accesso consentito se esiste un contratto del prodotto
con `status ∈ {active, grace}`. Altrimenti negato.

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

---

## 9. Cosa resta ai prodotti (NON Manager)

- Gate entitlement al login (chiamata §4) con cache breve e **modalità soft**
  iniziale (consenti se Manager non risponde) → poi hard.
- Hold/capture/release attorno alle feature a pagamento (§5–§6).
- Metering tecnico locale finché non si consolida in Manager.
