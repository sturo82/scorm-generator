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
- Claim usati:
  - `custom:tenant_id` → **tenant** del prodotto (obbligatorio). **Il valore è lo
    slug della company** (company = tenant). Questo è il claim che i prodotti già
    leggono (K Scorm risolve `custom:tenant_id` di default); NON usare
    `custom:company_id`.
  - `custom:role` → ruolo dell'owner;
  - `sub`, `email` → identità.
- Branding: ogni prodotto registra il proprio **Managed Login branding** (sfondo
  d'ecosistema comune, accento = colore del prodotto). Header/logo/colori seguono
  lo stile d'ecosistema condiviso (vedi §9).

---

## 2. Gate di entitlement (accesso al prodotto)

Al primo ingresso autenticato (e poi con cache), il prodotto verifica che la
company abbia il prodotto attivo.

```
GET {MANAGER_URL}/ecosystem/entitlements?company_id=<company>
Authorization: Bearer <token client_credentials, scope ecosystem/entitlements.read>
→ products[].{product,status,graceUntil}
```
Decisione:
- accesso **consentito** se esiste il contratto di `<PRODUCT_KEY>` con
  `status ∈ {active, grace}`;
- altrimenti **negato** con 403 e messaggio: *"La tua azienda non ha un contratto
  attivo per <Nome prodotto>."*

Requisiti:
- **Cache** breve per company (es. 60s) per non interrogare Manager a ogni call.
- **Modalità soft → hard**: all'avvio dell'integrazione, se Manager non risponde o
  non ha dati per la company, **consenti** e logga un warning. Attiva il blocco
  (hard) solo quando gli entitlement del prodotto sono popolati e stabili.
- Il gate è a livello **company**, quindi vale per tutti gli owner co-proprietari.

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

- Grant **client_credentials** su Cognito; ogni prodotto ha il **proprio**
  app-client M2M con gli scope minimi:
  `ecosystem/entitlements.read`, `ecosystem/wallet.read`, `ecosystem/wallet.write`.
- Token via `POST https://auth.knowkube.com/oauth2/token`
  (`grant_type=client_credentials&scope=...`); cache del token fino a scadenza.
- Credenziali del client M2M nei secret del prodotto (es. Secrets Manager), MAI
  nel codice/repo.

---

## 5. Mappa errori → UX (coerente tra prodotti)

| Situazione | HTTP interno | Messaggio utente |
|---|---|---|
| Token mancante/non valido | 401 | redirect al login SSO |
| `company_id` assente nel token | 403 | "Account non associato a un'azienda" |
| Prodotto non in entitlement | 403 | "La tua azienda non ha un contratto attivo per <Prodotto>" |
| Crediti insufficienti (hold 409) | 402/409 | "Crediti insufficienti per questa operazione" |
| Manager irraggiungibile (gate soft) | — | consenti + log warning (nessun errore utente) |
| Manager irraggiungibile (wallet) | 503 | "Servizio momentaneamente non disponibile, riprova" |

---

## 6. Configurazione richiesta (ogni prodotto)

```
OIDC_ISSUER, OIDC_AUTH_DOMAIN, OIDC_CLIENT_ID, OIDC_TOKEN_USE=id
MANAGER_URL                      # base URL API Manager
MANAGER_M2M_CLIENT_ID / SECRET   # app-client client_credentials (da Secrets)
ENTITLEMENT_ENFORCE=soft|hard    # feature flag del gate
ENTITLEMENT_CACHE_TTL_SEC=60
WALLET_ENABLED=true|false        # abilita hold/capture
```

---

## 7. Checklist onboarding di un nuovo prodotto

1. Registrare un **app-client** nel pool centrale (login utenti, PKCE) + branding
   Managed Login (accento del prodotto).
2. Registrare un **app-client M2M** (client_credentials) con gli scope Manager.
3. Config §6; `OIDC_ISSUER` = pool centrale.
4. Implementare: validazione token → `company_id` come tenant.
5. Implementare **gate entitlement** (soft → hard) con cache.
6. Implementare **hold/capture/release** su ogni feature a consumo, con
   `reference` idempotente.
7. Mappare gli **errori** come §5.
8. Verifiche: SSO reale tra prodotti della stessa company; accesso negato se
   prodotto non in contratto; hold insufficiente; capture parziale; retry
   idempotente.

---

## 8. Cosa NON deve fare un prodotto
- Non creare login proprietario per gli owner.
- Non mantenere un proprio saldo crediti o decidere entitlement.
- Non fidarsi di `company_id`/tenant forniti dal client (solo dal token).
- Non eseguire feature a pagamento senza hold confermato.
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
accanto/sotto il logo e footer **"Knowkube · ecosistema"**, indipendenti dal
white-label del tenant.

Accessibilità (vincolo d'ecosistema): tutta la UI deve essere **WCAG 2.1 AA** —
contrasto testo ≥ 4.5:1 (≥ 3:1 per large/elementi UI), focus visibile, skip-link
al contenuto, landmark corretti, `aria-label` sui controlli icona. I token di
tema vanno scelti/derivati per **contrasto reale**, non per soglia di luminanza.
