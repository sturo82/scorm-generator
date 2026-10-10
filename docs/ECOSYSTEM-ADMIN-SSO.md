# Knowkube — SSO d'ecosistema per i clienti (design)

> Stato: **proposta di design** da approvare prima dell'implementazione.
> Decisioni fissate:
> - **A1** — riuso del pool Cognito attuale come pool d'identità centrale.
> - **Modello Cliente-centrico** — l'accesso deriva dalla **company** (azienda
>   cliente), non dal singolo utente.
> - **B2** — l'entitlement (quali prodotti ha la company) è servito da **Manager**
>   (fonte di verità: i contratti), non da un attributo sul singolo utente.
> - **Entitlement provisioning su Manager** — gli acquisti/attivazioni per
>   prodotto si decidono solo in Manager (un cliente può avere alcune piattaforme
>   e non altre). Manager è l'unica fonte di verità.
> - **S2S = OAuth2 client-credentials** su Cognito (resource server + app-client
>   M2M per prodotto).
> Scope: architettura, modello dati, flussi, impatti, rollout. Nessuna
> implementazione in questo documento. **Decisioni §8 chiuse.**

---

## 1. Modello di dominio (congelato)

- **Manager** = back-office di Knowkube (strumento interno dell'operatore). Qui
  l'operatore (es. tu) gestisce **Company** e **Contratti**. I clienti NON sono
  admin di Manager. Oggi Manager ha i contratti **solo per il prodotto OnDemand**;
  gli altri prodotti (Scorm, Live, Dataroom, …) vanno aggiunti.
- **Company** (azienda cliente, es. "juve") = **tenant d'ecosistema**. Ha
  **1..N contratti**, uno per prodotto acquistato.
- **Owner** = cliente proprietario della propria company. Appartiene a **una
  sola** company. Una company ha **1..N owner** (co-proprietari), **tutti dello
  stesso livello** (nessuna gerarchia tra owner).
- **Entitlement** = l'insieme dei prodotti sotto contratto **della company**.
  Vale per **tutti** gli owner di quella company. Fonte di verità: **Manager**.
- **company = tenant** in ogni prodotto (un cliente = un tenant per prodotto).

Chiavi-prodotto canoniche (da congelare ora): `kscorm`, `klive`, `kdataroom`,
`ondemand`, … (`kmanager` NON è un prodotto-cliente: è il back-office).

---

## 2. Perché Cliente-centrico (e non entitlement sull'utente)

Poiché:
- l'accesso dipende da **cosa ha comprato la company**, non dalla singola persona;
- una company ha **più owner** → l'entitlement deve valere per tutti senza doverlo
  replicare su ciascun utente;
- la verità su "chi ha comprato cosa" è già in **Manager** (billing/contratti),

l'entitlement **non** va messo come CSV sull'utente Cognito (sarebbe duplicato e
divergente tra co-owner), ma **risolto dalla company** interrogando Manager (B2).

Sull'utente Cognito resta solo l'appartenenza: `custom:company_id`.

---

## 3. Architettura

```
   OPERATORE (tu)                         CLIENTI (owner)
        │                                      │
        ▼                                      ▼
 ┌───────────────┐                   ┌───────────────────────────────┐
 │   K MANAGER    │  fonte di verità  │  Knowkube Identity (Cognito)  │
 │  back-office   │  Company+Contratti│  pool eu-west-1_jvwWWna9i      │
 │                │                   │  dominio auth.knowkube.com     │
 │  - Company      │                   │  Owner (cliente):              │
 │  - Contratti    │                   │    sub, email                  │
 │    (prod/comp)  │                   │    custom:company_id = juve    │
 │  - API          │◀──────────────────│  App client per prodotto:      │
 │    entitlements │   query al login  │    kscorm-web, klive-web, …    │
 │    della company│                   │   (Managed Login per-brand)    │
 └───────────────┘                   └───────────────┬───────────────┘
         ▲                                            │ OIDC (issuer unico)
         │ GET /entitlements?company=juve             │
         │  → { products: ["kscorm","ondemand"] }     ▼
         │                            ┌───────────────────────────────┐
         └────────────────────────────│  Prodotto (es. K Scorm) API    │
                                      │  1. valida token (issuer/aud)  │
                                      │  2. legge custom:company_id    │
                                      │  3. chiede a Manager gli         │
                                      │     entitlement della company   │
                                      │  4. 'kscorm' ∈ products? → ok   │
                                      │  5. tenant = company_id          │
                                      └───────────────────────────────┘
```

### Elementi
- **Pool d'identità centrale** (A1): l'attuale pool, promosso a identità
  d'ecosistema per i **clienti/owner**. Un **app-client per prodotto** (branding
  Managed Login dedicato + redirect del prodotto). Issuer unico → **SSO reale**:
  l'owner si logga una volta e passa tra i prodotti della sua company.
- **Manager** espone un'**API entitlements**: data una company, ritorna i prodotti
  sotto contratto. È la fonte di verità (ha i contratti). Oggi conosce OnDemand;
  si estende man mano agli altri prodotti.
- **Ogni prodotto** fa il **gate**: `prodotto ∈ entitlements(company)` → accesso.

---

## 4. Modello dati

### Attributi utente (Cognito, pool centrale)
| Attributo            | Esempio             | Note                                             |
|----------------------|---------------------|--------------------------------------------------|
| `sub`                | `92c5b414-…`        | id immutabile owner                              |
| `email`              | `mario@juve.com`    | identità                                         |
| `custom:company_id`  | `juve`              | **appartenenza** alla company (unica, immutabile)|
| `custom:role`        | `OWNER`             | ruolo nel prodotto (owner cliente)               |

> NB: **niente** `custom:platforms` sull'utente. L'entitlement è della company e
> si risolve via Manager (B2). `custom:company_id` sostituisce di fatto l'uso
> attuale di `custom:tenant_id` (company = tenant). In transizione li teniamo
> allineati.

### Entitlement (Manager, fonte di verità)
Concettuale:
```
Company(id, nome)
Contract(company_id, product, stato, scadenza, piano, …)
```
API (contratto d'interfaccia proposto, da realizzare in Manager):
```
GET /ecosystem/entitlements?company_id=juve
Authorization: Bearer <access token client_credentials, scope ecosystem/entitlements.read>
→ 200 { "company_id":"juve", "products":[
         {"product":"ondemand","active":true},
         {"product":"kscorm","active":true,"graceUntil":null}
       ] }
```
Auth: **OAuth2 client-credentials** su Cognito (vedi §8.1). Manager = resource
server con scope `ecosystem/entitlements.read`; ogni prodotto ha un app-client
M2M. Caching lato prodotto: breve (es. 60s) per non interrogare Manager a ogni
richiesta.

---

## 5. Flusso di login (Authorization Code + PKCE)

1. L'owner apre un prodotto (es. `architect.knowkube.com`) e avvia il login SSO
   con l'**app-client del prodotto** → `auth.knowkube.com` (Managed Login con lo
   stile d'ecosistema e l'accento del prodotto).
2. Login una sola volta → sessione del pool. Aprendo un altro prodotto della
   stessa company, l'SSO non richiede di riautenticarsi.
3. Callback: il prodotto riceve i token; dall'ID token legge `custom:company_id`.
4. **Gate di entitlement**: l'API del prodotto chiede a **Manager** gli
   entitlement della company e verifica che il proprio prodotto sia attivo.
   - non attivo/non presente → accesso negato ("La tua azienda non ha un
     contratto attivo per K Scorm");
   - attivo → prosegue; **tenant = company_id**.
5. Co-proprietari: ogni owner della stessa company passa lo stesso gate (perché
   l'entitlement è della company). Nessuna configurazione per-utente.

---

## 6. Impatti per componente

### Manager (back-office) — nuovo lavoro
Spec implementativa dedicata: **`docs/MANAGER-ECOSYSTEM-SPEC.md`**. In sintesi:
- Estendere il modello contratti **oltre OnDemand** (aggiungere i prodotti).
- Esporre l'**API entitlements per company** (OAuth2 client-credentials).
- **Wallet virtuale per company** (saldo a crediti + movimenti) con API
  **hold/capture/release/topup** idempotenti: i prodotti riservano e addebitano
  crediti per le feature a consumo. Manager è l'unica fonte del saldo.
- (Provisioning) Creare gli **owner** nel pool Cognito con `custom:company_id`
  quando si attiva un cliente.

### K Scorm (questo repo) — piccolo
- Issuer già sul pool centrale (A1, nessun cambio).
- App-client già presente (branding verde già fatto).
- API: aggiungere il **gate entitlement** (chiama Manager; `kscorm` attivo per la
  company?), con **modalità soft** iniziale (se Manager non raggiungibile o
  company senza dati → consenti, log warning) poi **hard**.
- Tenant: usare `company_id` come tenant (già compatibile con `tenant_id`).

### Altri prodotti (K Live, K Dataroom, OnDemand)
- App-client nel pool centrale + branding Managed Login + redirect.
- Issuer puntato al pool centrale.
- Stesso gate entitlement verso Manager.

---

## 7. Rollout (step reversibili)

1. **Congelare** chiavi-prodotto e questo design. *(nessun deploy)*
2. **Manager**: definire e implementare l'**API entitlements per company**
   (iniziando dai contratti OnDemand già presenti + aggiungere Scorm). *(lavoro
   su Manager, non su questo repo)*
3. **Pool**: aggiungere `custom:company_id` allo schema (se non basta
   `tenant_id`); mantenere `tenant_id = company_id`. *(additivo)*
4. **K Scorm gate soft**: l'API chiama Manager e verifica l'entitlement, ma in
   assenza di risposta/di dati **consente** (legacy) con log. *(nessun lockout)*
5. **K Scorm gate hard**: obbligatorio quando Manager espone gli entitlement
   Scorm in modo affidabile.
6. **Onboarding secondo prodotto** (es. OnDemand/Live) con lo stesso schema.
7. **(Governance)** estrarre il pool/dominio/client in uno stack
   `knowkube-identity` separato (`terraform state mv`, nessuna ricreazione).

Reversibilità: fino allo step 4 tutto è additivo; il gate è disattivabile.

---

## 8. Decisioni finali (chiuse)

1. **Auth service-to-service K Scorm → Manager** = **OAuth2 client-credentials**
   su Cognito (scelta enterprise). Manager espone l'API entitlements come
   **resource server** con uno scope dedicato (es. `ecosystem/entitlements.read`);
   ogni prodotto ha un **app-client machine-to-machine** (grant client_credentials)
   che ottiene un access token con quello scope e chiama l'API. Nessuna chiave
   statica: credenziali per-prodotto, revocabili e scopate.
2. **Scadenza/disdetta contratto**: l'owner mantiene il login (identità), ma il
   gate nega l'accesso al prodotto con messaggio chiaro ("La tua azienda non ha
   un contratto attivo per K Scorm"). **Grace period: previsto** (durata gestita
   da Manager nei contratti; durante il grace l'entitlement resta `active`).
3. **Un prodotto, un solo tenant per company** (company = tenant). Confermato.
4. **Provisioning e acquisti SU MANAGER (punto di verità unico).** Un cliente può
   avere abbonamenti solo ad alcune piattaforme: l'attivazione/revoca per prodotto
   si decide **esclusivamente in Manager**. Manager:
   - crea gli **owner** nel pool Cognito con `custom:company_id` (admin-create-user);
   - registra/attiva/disdice i **contratti per prodotto** della company;
   - è l'**unica** fonte dell'entitlement esposta via API ai prodotti.
   I prodotti non decidono mai l'entitlement: lo leggono soltanto.

---

## 9. Cosa NON cambia

- Issuer/token attuali di K Scorm (A1 → nessun re-login).
- Branding/header d'ecosistema già implementati.
- Il login degli utenti finali dei prodotti (fuori scope).

---

## 10. Prossimo passo

Il **primo lavoro vero è su Manager** (API entitlements per company + provisioning
owner), perché è la fonte di verità. Su K Scorm, in parallelo e in sicurezza, si
può preparare il **gate soft** (chiamata a Manager dietro feature flag, default
"consenti") senza impatti. Approvare design + §8 prima di partire.
