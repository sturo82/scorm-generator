# Knowkube — Runbook di provisioning prodotto (ecosistema)

> Procedura **ripetibile** per portare un prodotto/installazione dentro
> l'ecosistema Knowkube. È il "come nasce" di un prodotto, a monte del runtime
> (self-register, gate, JIT) descritto in `docs/ECOSYSTEM-PRODUCT-INTEGRATION.md`.
> Manager è la fonte di verità: `docs/MANAGER-ECOSYSTEM-SPEC.md`.
>
> Vale per due casi:
> - **Mono-installazione** (es. K Scorm): un deployment, molti clienti = molti
>   tenant *dentro* la stessa installazione.
> - **Multi-installazione** (es. OnDemand whitelabel): N deployment con **infra
>   propria** (Lambda/DB/region per cliente), stessa codebase.

---

## 0. Principi (perché il provisioning esiste)

1. **Provisioning ≠ runtime.** Il provisioning crea l'**identità** del prodotto/
   installazione (credenziale M2M, config). Solo *dopo*, a runtime, l'installazione
   si **annuncia** a Manager (self-register) usando quella credenziale. Il
   self-register NON può creare l'M2M: userebbe la chiave che sta cercando di
   ottenere (uovo/gallina). La chiave è **prerequisito**.
2. **Due mani.** Il provisioning è sempre: **Manager** crea le risorse Cognito
   (Opzione 1: Manager possiede il pool e le risorse-figlie) + **il prodotto** si
   configura e si deploya. Non è un unico script finché non si automatizza.
3. **OIDC una volta sola.** Il pool e il dominio di login (`auth.knowkube.com`)
   NON si ricreano mai. Un prodotto nuovo riusa/registra un **client web OIDC**;
   una nuova installazione dello **stesso** prodotto NON crea un client web nuovo.
4. **Zero segreti nel repo.** Il client secret M2M vive nel secret manager
   dell'installazione, iniettato al provisioning.
5. **Mono vs multi = quante volte si ripete.** I passi sono gli stessi; nel mono
   si fanno una volta, nel multi si ripetono (idealmente via pipeline) per ogni
   installazione, **senza toccare le installazioni esistenti**.

---

## 1. Glossario rapido

| Termine | Significato |
|---|---|
| **Prodotto** (`PRODUCT_KEY`) | software/codebase: `kscorm`, `ondemand`, … |
| **Installazione** (`INSTALLATION_ID`) | un deployment con infra propria. Mono: `= PRODUCT_KEY`. Multi: univoco (es. `ondemand-acme-eu`). |
| **Client M2M** | app-client Cognito `client_credentials`: la "chiave" del prodotto verso Manager. |
| **Client web OIDC** | app-client Cognito (PKCE) per il login utenti. Uno per prodotto, riusato dalle installazioni. |
| **Company/tenant** | il cliente. Valore in `custom:tenant_id` = slug company. |

---

## 2. Chi fa cosa (RACI sintetico)

| Passo | Manager | Prodotto |
|---|---|---|
| Crea client M2M (Cognito) | **R** | — |
| Crea/registra client web OIDC | **R** (una volta per prodotto) | fornisce callback/branding |
| Consegna credenziali M2M | **R** | riceve, mette in secret |
| Registra l'installazione | — | **R** (self-register runtime) |
| Attiva per company | **R** | — |
| Config + deploy infra | — | **R** |
| Emissione `custom:eco_role` nel token | **R** | mappa in casa |

`R` = responsabile.

---

## 3. Runbook GENERICO (template)

### Fase A — Provisioning identità (una volta per installazione)

**A1. (Manager) Crea il client M2M** su Cognito per l'installazione:
- app-client `client_credentials`, scope minimi `ecosystem/entitlements.read`,
  `ecosystem/wallet.read`, `ecosystem/wallet.write`;
- output: `client_id` + `client_secret` (il secret si vede una volta).

**A2. (Manager) Assicura il client web OIDC** del prodotto:
- se è il **primo** deployment del prodotto: registra/riusa un client web (PKCE,
  no secret) con callback/logout del prodotto, scope `openid email profile`;
- se è una **ulteriore installazione** dello stesso prodotto: valuta se riusa lo
  stesso client web (stessa audience) o se l'installazione ha domini/callback
  propri → in tal caso un client web per installazione (vedi §5, caso multi).

**A3. (Prodotto) Metti il secret M2M** nel secret manager dell'installazione
(mai nel repo). Es. AWS Secrets Manager.

**A4. (Prodotto) Configura l'installazione** (comune + per-installazione, vedi
`ECOSYSTEM-PRODUCT-INTEGRATION.md` §6):
```
# comune (uguale ovunque)
OIDC_ISSUER, OIDC_AUTH_DOMAIN=auth.knowkube.com, OIDC_TOKEN_USE=id
MANAGER_URL, ECOSYSTEM_TOKEN_URL, ECOSYSTEM_SCOPES
# per-installazione
PRODUCT_KEY, INSTALLATION_ID, INSTALLATION_REGION, INSTALLATION_DOMAINS
OIDC_CLIENT_ID                 # client web del prodotto
MANAGER_M2M_CLIENT_ID / SECRET # da secret manager
ECOSYSTEM_SELF_REGISTER=true
ENTITLEMENT_ENFORCE=soft|hard
WALLET_ENABLED=true|false
```

**A5. (Prodotto) Deploy** dell'infra/immagine con la config sopra.

### Fase B — Runtime (automatico, a ogni avvio)

**B1.** All'avvio l'installazione fa **self-register** (`POST
/installations/self`, idempotente, non bloccante). Manager la registra come
*disponibile, DISATTIVATA*.

### Fase C — Attivazione (operazione-dati su Manager)

**C1. (Manager)** Per la company cliente, flagga il prodotto/installazione come
*attivo* (crea il `Contract` con `status=active`).

**C2. (Manager)** Provisiona l'owner nel pool (`admin-create-user` con
`custom:tenant_id = slug`, `custom:eco_role = OWNER`), oppure l'owner esiste già.

### Fase D — Primo accesso (verifica)

**D1.** L'owner fa login (SSO d'ecosistema) e dall'hub entra nel prodotto.
**D2.** Il prodotto: valida token → **gate** (Manager dice "attivo") → **JIT**
crea l'utente dai claim (ruolo = mapping eco-role) → dentro, senza pre-creazione.

### Checklist DoD provisioning
- [ ] client M2M creato, secret nel secret manager (non nel repo)
- [ ] client web OIDC a posto (callback/logout/scope)
- [ ] config installazione completa; `INSTALLATION_ID` univoco
- [ ] deploy ok, health verde
- [ ] self-register visibile su Manager (installazione *disponibile*)
- [ ] attivazione per company fatta
- [ ] login reale → gate ok → JIT crea utente → accesso ok
- [ ] (se wallet) hold/capture/release verificati

---

## 4. Caso MONO — K Scorm (compilato)

Una sola installazione; ogni cliente = un tenant dentro la stessa installazione.
`PRODUCT_KEY = INSTALLATION_ID = kscorm`.

**Fase A — identità**
- A1 (Manager): crea client M2M `kscorm` → consegna `client_id` + **secret
  rigenerato** (il precedente era stato condiviso in chiaro: va rigenerato come
  parte del provisioning pulito).
- A2 (Manager): client web OIDC = **riusa `scorm-web`** (`48i3t9p2g5vqdkajssi7bv92r8`),
  già PKCE, callback `https://architect.knowkube.com/auth/callback`, logout
  `https://architect.knowkube.com/login`. Nessun client nuovo.
- A3 (K Scorm): secret M2M → AWS Secrets Manager.
- A4 (K Scorm): config in `infra/apprunner.tf`:
  ```
  PRODUCT_KEY=kscorm
  INSTALLATION_ID=kscorm
  INSTALLATION_REGION=eu-west-1
  INSTALLATION_DOMAINS=architect.knowkube.com
  MANAGER_URL=https://manager.knowkube.com/api/ecosystem
  ECOSYSTEM_TOKEN_URL=https://auth.knowkube.com/oauth2/token
  ECOSYSTEM_SELF_REGISTER=true
  ENTITLEMENT_ENFORCE=hard
  # secret: MANAGER_M2M_CLIENT_ID / MANAGER_M2M_CLIENT_SECRET
  ```
- A5 (K Scorm): build/push immagine API + `terraform apply`.

**Fase B/C/D**
- B1: K Scorm all'avvio si annuncia → Manager vede l'installazione `kscorm`.
- C1 (Manager): attiva `kscorm` per la company interna (la tua).
- C2: owner interno con `custom:tenant_id=<tuo-slug>`, `custom:eco_role=OWNER`.
- D: login → gate "attivo" → JIT crea l'utente in K Scorm (nessun wipe del DB,
  l'utente è nuovo) → dentro.

Note mono:
- Nessuna nuova infra per nuovo cliente: il cliente è solo un **tenant** nuovo,
  creato via JIT al primo login (o via invito admin). Il provisioning §A si fa
  **una volta sola** per K Scorm.

---

## 5. Caso MULTI — OnDemand whitelabel (compilato)

N installazioni, **infra propria** per cliente/region, stessa codebase.
Es. `PRODUCT_KEY=ondemand`, `INSTALLATION_ID=ondemand-acme-eu`.

**Differenza chiave vs mono:** la Fase A si ripete **per ogni installazione** e
va **automatizzata** (pipeline di provisioning parametrica), perché crea anche
infra dedicata. Ma le installazioni esistenti NON si toccano.

**Fase A — identità (per OGNI installazione, via pipeline)**
Input della pipeline: `installationId`, `region`, `domains`, `companyId`.
- A1: la pipeline (o Manager via API) crea un **client M2M dedicato** per
  l'installazione → secret nel secret manager di *quella* installazione.
- A2 (client web OIDC): due sotto-casi, da decidere per OnDemand:
  - **(i) client web condiviso** per tutte le whitelabel: possibile se le
    whitelabel condividono callback/dominio di login logico; una sola audience.
  - **(ii) client web per installazione**: necessario se ogni whitelabel ha
    **dominio/callback propri**. In tal caso l'`OIDC_CLIENT_ID` (e la relativa
    audience lato API) è **per installazione**, fornito dalla pipeline — NON
    hardcodato in Terraform condiviso. Questo è il motivo per cui l'audience non
    deve essere un valore fisso editato a mano (vedi §6 integrazione).
- A3: la pipeline provisiona l'**infra** (Lambda/DB/region) parametrica.
- A4: config dell'installazione generata dalla pipeline (gli stessi campi del
  template, valorizzati per quella whitelabel).
- A5: deploy della singola installazione.

**Fase B/C/D** (identiche al template)
- B1: ogni installazione si auto-annuncia col proprio `installationId`.
- C1 (Manager): attiva `(company, product=ondemand, installationId=...)`.
- D: login owner → gate filtra anche per `installationId` → JIT → dentro.

Note multi:
- **Idempotenza/di-provisioning:** la pipeline deve saper **ricreare** (deploy
  ripetuto) e **dismettere** un'installazione (teardown infra + revoca M2M su
  Cognito + `Contract` → cancelled su Manager). Documentare entrambe le direzioni.
- **Region:** `INSTALLATION_REGION` guida dove gira l'infra; il pool d'ecosistema
  (login) resta `eu-west-1` per tutti — cambia solo l'infra applicativa.
- **Oggi (una sola installazione, mono):** la pipeline multi NON serve ancora. Il
  runbook §5 è il template per quando arriveranno le whitelabel: finché c'è una
  sola installazione per prodotto, basta il §4 (mono).

---

## 6. Automazione (evoluzione, non ora)

Con poche installazioni: **runbook manuale** (questo doc). Quando le whitelabel
OnDemand diventano molte, trasformare la Fase A in **pipeline**:
- crea client M2M su Cognito (API AWS) + mette il secret nel secret manager;
- provisiona infra parametrica (modulo IaC riusabile su `installationId/region`);
- scrive la config e deploya;
- (opzionale) chiama Manager per pre-registrare l'installazione.

La regola resta: **l'infra non tiene l'elenco** di prodotti/installazioni/stato;
quello vive su Manager. La pipeline crea *una* installazione; Manager decide
disponibilità/attivazione a runtime.

---

## 7. Teardown (dismissione installazione)

1. (Manager) `Contract` → `cancelled` (eventuale `graceUntil`) per la/e company.
2. (Manager) revoca/elimina il **client M2M** dell'installazione su Cognito.
3. (Prodotto) teardown infra dell'installazione (mono: NON si fa, si rimuove solo
   il tenant/cliente; multi: teardown del deployment dedicato).
4. (Prodotto) rimuove il secret M2M dal secret manager.
Le altre installazioni NON sono impattate.
