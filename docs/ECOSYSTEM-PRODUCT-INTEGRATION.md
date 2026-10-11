# Knowkube — Guida d'integrazione prodotto (contratto d'ecosistema)

> Guida **condivisa** che OGNI piattaforma Knowkube (presente e futura: K Scorm,
> K Live, K Dataroom, OnDemand, …) deve seguire per integrarsi nell'ecosistema.
> È il "contratto" lato prodotto; la controparte (fonte di verità) è **Manager**,
> specificato in `docs/MANAGER-ECOSYSTEM-SPEC.md`. Modello generale in
> `docs/ECOSYSTEM-ADMIN-SSO.md`.
>
> Terminologia: `<PRODUCT_KEY>` = chiave canonica del prodotto
> (`kscorm`|`klive`|`kdataroom`|`ondemand`). `company` = tenant del prodotto.

---

## 0. Principi (non negoziabili)

1. **Identità centralizzata.** L'autenticazione dei clienti (owner) avviene SOLO
   sul pool Cognito d'ecosistema via dominio `auth.knowkube.com`. Nessun prodotto
   crea un proprio sistema di login per gli owner.
2. **Manager è l'unica fonte di verità** per entitlement e wallet. Il prodotto
   **legge/riserva/addebita**, non decide né tiene saldi/contratti propri.
3. **company = tenant.** Il prodotto isola i dati per `company_id` ricavato dal
   token. Mai fidarsi di un tenant passato dal client.
4. **Fail-safe & reversibile.** Ogni integrazione nuova parte in **modalità soft**
   (non blocca) e diventa **hard** solo quando la dipendenza è affidabile.
5. **Zero segreti statici.** Le chiamate verso Manager usano OAuth2
   client-credentials (token a scadenza), non API key hardcoded.

---

## 1. Autenticazione utente (OIDC)

Config per prodotto (variabili pubbliche lato web + validazione lato API):
```
OIDC_ISSUER      = https://cognito-idp.<region>.amazonaws.com/<poolId>   # unico ecosistema
OIDC_AUTH_DOMAIN = auth.knowkube.com                                     # login brandizzata
OIDC_CLIENT_ID   = <app-client del prodotto>                             # 1 per prodotto
OIDC_TOKEN_USE   = id                                                    # vedi nota
```
Regole:
- Il **web** usa Authorization Code + PKCE verso `auth.knowkube.com` con il
  **proprio** app-client; il Bearer verso l'API è l'**ID token** (contiene i
  claim applicativi `custom:tenant_id`/`custom:role`; l'access token di Cognito
  non li porta).
- L'**API** valida firma (JWKS), `iss`, audience (`aud`/`client_id`), scadenza e
  `token_use`.
- OIDC si configura **una volta sola nella vita**: pool unico, un solo client web
  per prodotto, `auth.knowkube.com`. Aggiungere prodotti/installazioni NON tocca
  OIDC. Il "quale prodotto/cliente è attivo" NON vive nel token: lo decide
  Manager (§2).
- Claim usati:
  - `custom:tenant_id` → **tenant** del prodotto (obbligatorio). **Il valore è lo
    slug della company** (company = tenant). Questo è il claim che i prodotti già
    leggono (K Scorm risolve `custom:tenant_id` di default); NON usare
    `custom:company_id`.
  - `custom:eco_role` → **eco-role** dell'owner (vocabolario d'ecosistema
    `OWNER|ADMIN|MEMBER|VIEWER`); il prodotto lo **mappa** sul proprio ruolo
    interno (vedi §2bis). Fallback a `custom:role` finché Manager non emette il
    nuovo claim.
  - `sub`, `email` → identità (usati anche dal JIT provisioning, §2).
- Branding: ogni prodotto registra il proprio **Managed Login branding** (sfondo
  d'ecosistema comune, accento = colore del prodotto). Header/logo/colori seguono
  lo stile d'ecosistema condiviso (vedi §9).

---

## 1bis. Self-register (l'installazione si annuncia a Manager)

Ogni prodotto/whitelabel è un'installazione (per OnDemand: infra propria per
cliente/region). All'avvio **si annuncia** a Manager. È un **contratto HTTP**,
implementabile in qualsiasi stack (Node `fetch`, Django `httpx`, …): NON è una
libreria condivisa, sono poche righe locali al prodotto.

```
POST {MANAGER_URL}/installations/self      Authorization: Bearer <M2M>
body {
  product:        "<PRODUCT_KEY>",
  installationId: "<univoco>",      # mono-prodotto: = PRODUCT_KEY; whitelabel: es. "ondemand-acme-eu"
  region:         "<aws-region>",
  domains:        ["<dominio servito>"],
  ecoRoleMap:     { OWNER:"...", ADMIN:"...", MEMBER:"...", VIEWER:"..." }   # opzionale (solo display su Manager)
}
→ 200 { installationId, status:"available", enforce, walletEnabled }
```
Regole:
- **Idempotente** (upsert su `installationId`) → chiamalo a ogni avvio/deploy.
- **Non bloccante**: se Manager non risponde, il prodotto parte comunque e
  ritenta; ciò che conta davvero per l'accesso è il gate al login (§2).
- Manager registra l'installazione come **disponibile ma DISATTIVA**:
  l'attivazione per-company è una scelta separata su Manager.

---

## 2. Gate di entitlement (accesso al prodotto) + JIT provisioning

A ogni ingresso autenticato (con cache), il prodotto verifica che la company
abbia il prodotto/installazione **attivo**, poi — se è il primo accesso — crea
l'utente al volo (JIT).

```
GET {MANAGER_URL}/entitlements?company_id=<company>
Authorization: Bearer <token client_credentials, scope ecosystem/entitlements.read>
→ products[].{product,installationId,available,status,graceUntil}
```
Decisione (gate):
- accesso **consentito** se esiste il contratto di `<PRODUCT_KEY>` (e, per prodotti
  multi-installazione, del proprio `installationId`) con `status ∈ {active, grace}`;
- altrimenti **negato** con 403: *"La tua azienda non ha un contratto attivo per
  <Nome prodotto>."*

**JIT provisioning** (dopo il gate, mai prima):
- se l'utente (`email`/`sub` + tenant) **non esiste** nel prodotto, crealo al volo
  dai claim del token, con ruolo interno = mapping di `custom:eco_role` (§2bis);
- così l'owner entra **senza essere pre-creato** nel prodotto;
- vincolo: il JIT avviene SOLO se il gate ha detto "attivo" → nessun utente creato
  per company non abilitate.

Requisiti:
- **Cache** breve per company (es. 60s).
- **Modalità soft → hard**: in soft (o errore infra) **consenti** + log warning;
  passa a **hard** solo quando gli entitlement sono popolati e stabili.
- Il gate è a livello **company**: vale per tutti gli owner co-proprietari.

---

## 2bis. Mapping eco-role → ruolo interno

Il token porta `custom:eco_role` ∈ `{OWNER, ADMIN, MEMBER, VIEWER}`. Il prodotto
tiene una tabella **in casa propria** e la applica (nel JIT e, se vuole, a ogni
accesso):

```
# esempio K Scorm
OWNER → OWNER   ADMIN → ADMIN   MEMBER → EDITOR   VIEWER → VIEWER
```
- Il mapping lo **esegue sempre il prodotto** (disaccoppiamento). Manager non
  conosce i ruoli interni.
- Default sicuro se il claim manca o è sconosciuto: **VIEWER** (minimo privilegio).
- Il prodotto può promuovere/declassare internamente oltre il default (autz fine):
  non risale a Manager.
- `ecoRoleMap` nel self-register (§1bis) è **opzionale e solo per display** su
  Manager; non è la verità operativa.

---

## 3. Wallet — feature a consumo (hold → capture/release)

Per ogni feature a pagamento interno, usare il pattern a **riserva**. Mai
eseguire l'operazione a pagamento senza un hold confermato.

```
# 1) PRIMA di eseguire: riserva
POST {MANAGER_URL}/ecosystem/wallet/holds        scope ecosystem/wallet.write
body { company_id, product:<PRODUCT_KEY>, feature, amount, reference }
  → 201 {holdId,...} | 409 insufficient_credits | 200 (idempotente)

# 2) a fine operazione riuscita: addebita il consumo reale (<= amount)
POST {MANAGER_URL}/ecosystem/wallet/holds/{holdId}/capture   body { amount }

# 3) se l'operazione fallisce/annulla:
POST {MANAGER_URL}/ecosystem/wallet/holds/{holdId}/release
```
Regole d'oro:
- **`reference` = id univoco e stabile dell'operazione** nel prodotto (es.
  `kscorm:job:<jobId>:video:<blockId>`). È la **idempotency key**: retry sicuri,
  niente doppi addebiti.
- **Hold prima, azione dopo.** Se `409 insufficient_credits` → non eseguire,
  mostrare *"Crediti insufficienti"*.
- **Capture del consumo reale** (può essere < hold: la differenza si libera).
- **Release sempre** su errore/annullamento (o lascia scadere l'hold: Manager fa
  auto-release, ma il prodotto deve comunque tentare il release esplicito).
- Il prodotto **non** mostra né calcola il saldo come verità: per visualizzarlo
  usa `GET /ecosystem/wallet` (sola lettura).

### Metering tecnico
Il prodotto può mantenere un metering tecnico locale (log dei consumi) per
diagnostica. La **conversione consumo→crediti** (listino) vive in **Manager**:
il prodotto invia `feature` + `amount` in crediti secondo il listino condiviso.
Evoluzione prevista: il metering sarà consolidato in Manager (riferito al
prodotto), quindi tenere `product/feature/reference` sempre valorizzati.

---

## 4. Autenticazione service-to-service verso Manager

- Le credenziali M2M (client_id/secret per prodotto) le **emette Manager** dalla
  console `/ecosystem/` (control plane): il prodotto NON crea client sul pool, li
  **riceve** e li mette nei propri secret.
- Grant **client_credentials** su Cognito; ogni prodotto ha il **proprio**
  app-client M2M con gli scope minimi:
  `ecosystem/entitlements.read`, `ecosystem/wallet.read`, `ecosystem/wallet.write`.
- Token via `POST https://auth.knowkube.com/oauth2/token`
  (`grant_type=client_credentials&scope=...`); cache del token fino a scadenza.
- Endpoint API Manager: base `https://manager.knowkube.com/api/ecosystem/`
  (`/entitlements`, `/wallet`, `/wallet/holds`, …).
- Credenziali del client M2M nei secret del prodotto (es. Secrets Manager), MAI
  nel codice/repo.

> **M2M vs client web OIDC — regola di gestione (non confondere i due).**
> - **Client M2M** (service-to-service, `client_credentials`): di Manager,
>   **rotabili liberamente** dal control plane. Nessun impatto sul login utente.
> - **Client web OIDC** (login utenti, Auth Code + PKCE): **del prodotto**, NON
>   creato da Manager. Il prodotto valida l'ID token su `aud` = client ID, e tale
>   audience è cablata nell'infra del prodotto. Quindi il **client ID web non si
>   cambia al volo**: un cambio tocca sia il build del web
>   (`NEXT_PUBLIC_OIDC_CLIENT_ID`) sia l'audience dell'API (`OIDC_AUDIENCE`) e
>   richiede un redeploy coordinato. Manager, se serve, interviene **sul client
>   web esistente del prodotto**, non ne crea uno nuovo. (K Scorm: `scorm-web` =
>   `48i3t9p2g5vqdkajssi7bv92r8`.)

> Pool d'ecosistema (uguale per tutti; si usa l'**ID**, non il nome): POOL ID
> `eu-west-1_jvwWWna9i`, issuer
> `https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_jvwWWna9i`, login
> `https://auth.knowkube.com`. Resource server identifier = `ecosystem`.

---

## 5. Mappa errori → UX (coerente tra prodotti)

| Situazione | HTTP interno | Messaggio utente |
|---|---|---|
| Token mancante/non valido | 401 | redirect al login SSO |
| `company_id` assente nel token | 403 | "Account non associato a un'azienda" |
| Prodotto/installazione non attivo | 403 | "La tua azienda non ha un contratto attivo per <Prodotto>" |
| Utente al primo accesso (JIT) | — | crea l'utente dai claim e prosegui (nessun errore) |
| Crediti insufficienti (hold 409) | 402/409 | "Crediti insufficienti per questa operazione" |
| Manager irraggiungibile (gate soft) | — | consenti + log warning (nessun errore utente) |
| Manager irraggiungibile (wallet) | 503 | "Servizio momentaneamente non disponibile, riprova" |

---

## 6. Configurazione richiesta (ogni prodotto)

Config **comune a tutte le installazioni** (uguale, si copia):
```
OIDC_ISSUER, OIDC_AUTH_DOMAIN, OIDC_TOKEN_USE=id   # pool unico d'ecosistema
MANAGER_URL                      # base URL API Manager
ECOSYSTEM_TOKEN_URL              # https://auth.knowkube.com/oauth2/token
ECOSYSTEM_SCOPES                 # entitlements.read wallet.read wallet.write
```
Config **per installazione** (cambia; NON vive in Terraform condiviso, viene dal
provisioning parametrico dell'installazione):
```
PRODUCT_KEY                      # kscorm | ondemand | ...
INSTALLATION_ID                  # univoco (mono-prodotto: = PRODUCT_KEY)
OIDC_CLIENT_ID                   # client web del prodotto (una volta sola)
MANAGER_M2M_CLIENT_ID / SECRET   # client_credentials del prodotto (da Secrets)
ENTITLEMENT_ENFORCE=off|soft|hard
ENTITLEMENT_CACHE_TTL_SEC=60
WALLET_ENABLED=true|false
```
> Nota: `ENTITLEMENT_ENFORCE`/`WALLET_ENABLED` possono essere **default** letti
> anche dalla risposta del self-register (§1bis), così lo stato d'attivazione lo
> comanda Manager a runtime senza redeploy. Le env restano come fallback.

---

## 7. Checklist onboarding di un nuovo prodotto/installazione

1. (Prodotto nuovo) Riusare il **client web OIDC** del prodotto nel pool centrale
   (login utenti, PKCE) + branding Managed Login (accento del prodotto). OIDC si
   configura **una volta sola**; una nuova installazione NON crea client nuovi.
2. Ricevere da Manager un **client M2M** (client_credentials) con gli scope.
3. Config §6 (comune + per-installazione); `OIDC_ISSUER` = pool centrale.
4. Implementare il **self-register** (§1bis), idempotente e non bloccante.
5. Implementare: validazione token → `company_id` come tenant.
6. Implementare **gate entitlement** (soft → hard) con cache **+ JIT provisioning**
   dopo il gate, con **mapping eco-role** (§2bis).
7. Implementare **hold/capture/release** su ogni feature a consumo, con
   `reference` idempotente.
8. Mappare gli **errori** come §5.
9. (Installazione nuova) Provisionare l'infra in modo **parametrico**
   (`installationId/product/region`), senza toccare le installazioni esistenti.
10. Verifiche: self-register idempotente; SSO silenzioso tra prodotti della stessa
    company; JIT al primo accesso; accesso negato se non attivo; hold
    insufficiente; capture parziale; retry idempotente.

---

## 8. Cosa NON deve fare un prodotto
- Non creare login proprietario per gli owner; non riconfigurare OIDC per prodotto
  o installazione (si fa una volta sola).
- Non mantenere un proprio saldo crediti o decidere entitlement/attivazione.
- Non decidere da sé i ruoli d'ecosistema: usa `custom:eco_role` e lo **mappa**.
- Non creare l'utente **prima** del gate entitlement (JIT solo dopo il "sì").
- Non fidarsi di `company_id`/tenant/ruolo forniti dal client (solo dal token).
- Non eseguire feature a pagamento senza hold confermato.
- Non mettere lo stato d'attivazione o l'identità dell'installazione **in
  Terraform** da editare a mano: viene dal provisioning parametrico + Manager.
- Non hardcodare segreti o URL di Manager senza config.

---

## 9. Stile condiviso — header, logo, colori (riferimento K Scorm)

Lo **stile** è comune a tutto l'ecosistema; cambia solo l'**accento** = colore
del prodotto (verde per K Scorm, azzurro per K Manager, ecc.).

Header (anonimo e loggato):
- Barra **sticky**, altezza **63px**, full-width, padding orizzontale **32px**.
- Fondo **scuro semi-trasparente + blur** (sempre scuro, anche in tema light, così
  il logo bianco è leggibile): `background hsl(160 24% 7% / .82)`,
  `backdrop-filter: saturate(140%) blur(10px)`, bordo inferiore
  `1px solid hsl(0 0% 100% / .08)`, testo chiaro.
- **Logo**: wordmark bianco del prodotto, alto **30px**, a **32px** dal bordo
  sinistro.
- **CTA** ("Entra/Accedi"): compatto, altezza **~30px**, con icona, a 32px dal
  bordo destro; `background = colore accento del prodotto`, testo con contrasto
  **WCAG AA ≥ 4.5:1**.

Blocco utente (header loggato, a destra): toggle tema + "pillola" con nome
utente, nome company e avatar iniziali (`background = accento`,
`color = foreground del primario`), più bottone **logout** (icona, `aria-label`).
Testi del blocco in colori **chiari fissi** (il fondo header è sempre scuro).

Identità d'ecosistema **sempre visibile**: tagline persistente **"by Knowkube"**
accanto/sotto il logo e footer **"Knowkube"**, indipendenti dal white-label del
tenant.

Accessibilità (vincolo d'ecosistema): tutta la UI deve essere **WCAG 2.1 AA** —
contrasto testo ≥ 4.5:1 (≥ 3:1 per large/elementi UI), focus visibile, skip-link
al contenuto, landmark corretti, `aria-label` sui controlli icona. I token di
tema vanno scelti/derivati per **contrasto reale**, non per soglia di luminanza.
