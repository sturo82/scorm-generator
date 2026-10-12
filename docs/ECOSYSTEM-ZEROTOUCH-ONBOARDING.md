# Knowkube — Onboarding prodotto ad attrito zero (spec per Manager)

> Documento **autosufficiente** e **da implementare in Manager** (control plane).
> Descrive come un prodotto/installazione nuovo entra nell'ecosistema **senza
> alcuno scambio manuale di credenziali o id**: nessun secret da consegnare,
> nessun client da creare a mano, nessun valore da incollare in config.
>
> Tutto ciò che serve è ripetuto qui dentro: parametri del pool, contratto HTTP,
> sequenza, modello di sicurezza, casi d'errore, definition of done. Non servono
> altri documenti per implementarlo.

---

## 0. Obiettivo e principio

**Obiettivo:** aggiungere un prodotto (o una whitelabel) = **deployarlo e basta**.
Al primo avvio il prodotto si annuncia a Manager; Manager crea in automatico
tutte le risorse d'identità (client OIDC web, client M2M, riga installazione) e
gli restituisce la configurazione completa. Zero operazioni manuali, zero
credenziali distribuite a mano.

**Principio di sicurezza (perché è possibile senza un segreto condiviso):** il
prodotto NON parte con una credenziale. Si autentica al primo contatto con la
**identità del proprio workload** (il ruolo IAM del task/servizio su AWS), che
Manager verifica crittograficamente. Nessun "secret di bootstrap" da custodire,
ruotare o condividere.

**Indipendenza dallo stack (requisito):** la soluzione NON deve dipendere dal
tipo di deploy. Ogni prodotto può girare su stack diversi (Lambda, ECS/Fargate,
Elastic Beanstalk, App Runner, EC2, …). La verifica d'identità è perciò un
**meccanismo PLUGGABILE** (una strategia "verifica workload"), non cablata a un
singolo ambiente:
- **Implementazione 1 — SigV4 (AWS), trasversale a TUTTI gli stack AWS.** È il
  minimo comune denominatore: ogni compute AWS fornisce al workload credenziali
  IAM e l'SDK sa firmare SigV4. Il prodotto fa la stessa identica cosa ovunque
  giri; non c'è nulla di specifico ad App Runner.
- **Estensione futura — OIDC/token del workload.** Per eventuali workload FUORI
  da AWS (altro cloud/on-prem), si aggiunge una strategia che valida un token
  OIDC del workload, SENZA rifare l'endpoint. Fuori scope per ora.

Regola: scegliere SigV4 perché è trasversale agli stack AWS, **non** perché un
prodotto specifico è su App Runner.

**Pool d'ecosistema (uguale per tutti; parametri che Manager già conosce):**
```
POOL ID = eu-west-1_jvwWWna9i
ISSUER  = https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_jvwWWna9i
JWKS    = <ISSUER>/.well-known/jwks.json
LOGIN   = https://auth.knowkube.com        (dominio owner, uguale per tutti)
TOKEN   = https://auth.knowkube.com/oauth2/token   (OAuth2 client-credentials)
REGION  = eu-west-1
Resource server = "ecosystem"  (scope: entitlements.read, wallet.read, wallet.write)
```

---

## 1. Attori e identità

- **Prodotto / installazione**: un deployment (es. K Scorm su App Runner, o una
  whitelabel OnDemand su Lambda in una region). Ha un **ruolo IAM** di esecuzione
  (il task role). È questa la sua identità.
- **Manager**: control plane. Possiede il pool Cognito e crea le risorse-figlie.
- **Workload identity**: l'identità AWS con cui il prodotto gira. Manager la
  verifica per decidere se un prodotto può auto-provisionarsi.

---

## 2. Il modello di autenticazione del PRIMO contatto (workload identity)

Problema da risolvere: il prodotto deve poter chiamare `self-register` **prima**
di avere qualsiasi credenziale M2M. Soluzione: prova la propria identità con una
**strategia di verifica pluggabile**; Manager la verifica senza che nessun
segreto sia stato scambiato. L'endpoint NON è cablato a una singola strategia:
espone un punto di estensione "verifica workload" con N implementazioni.

**Strategia 1 (ORA) — AWS SigV4 + GetCallerIdentity. Trasversale a tutti gli
stack AWS.**
Il prodotto costruisce una richiesta `sts:GetCallerIdentity` **pre-firmata** con
le sue credenziali IAM (SigV4) e la allega al self-register. Manager la ri-esegue
verso STS e ottiene l'**ARN del chiamante**. Nessun segreto condiviso: la prova è
la firma, producibile solo da chi detiene il ruolo.
Funziona **identico** su qualunque compute AWS, perché tutti forniscono al
workload credenziali IAM e l'SDK sa firmare SigV4:
```
Lambda        → execution role
ECS/Fargate   → task role
Beanstalk/EC2 → instance profile
App Runner    → instance role
```
Il prodotto NON fa nulla di diverso a seconda dello stack: usa la default
credential chain dell'SDK. Scegliamo SigV4 per questo (copertura universale AWS),
non perché un prodotto sta su App Runner.

**Difese obbligatorie di Manager sulla richiesta pre-firmata (anti-SSRF /
anti-replay):** `host` ∈ allowlist degli **endpoint STS SOLO regionali**
(`sts.<region>.amazonaws.com`); l'endpoint globale `sts.amazonaws.com` (legacy)
**non** è ammesso. Nessun host arbitrario; `Action=GetCallerIdentity` e
nient'altro; `X-Amz-Date` entro una finestra stretta (es. 5 min); rifiuto di
qualsiasi richiesta che non sia esattamente una GetCallerIdentity.

**Strategia 2 (FUTURA, fuori scope) — OIDC/token del workload.**
Per workload FUORI da AWS (altro cloud/on-prem) o contesti con token d'identità
(es. IRSA/OIDC): il prodotto presenta un token del workload, Manager lo valida
contro l'issuer. Si aggiunge come nuova implementazione della stessa astrazione,
senza modificare il contratto dell'endpoint.

**Controllo d'ammissione — trust-on-first-use con approvazione (nessun ARN da
comunicare in anticipo).** Il prodotto NON comunica il proprio ARN a voce né lo
registra prima. Al primo self-register firmato, Manager **scopre** l'ARN dalla
firma SigV4. Se quel workload non è ancora autorizzato, Manager:
- registra la richiesta come **in attesa** e risponde `202 pending_approval`
  (NON è un errore: il prodotto continua a ritentare, non bloccante);
- mostra la richiesta nella console Manager → un operatore **verifica l'ARN e
  approva con un clic**.

Al **tentativo successivo** dopo l'approvazione, lo stesso self-register ritorna
il **provisioning kit** completo. Nessun ARN comunicato a mano, nessuna
credenziale passata a mano: l'unica azione umana è un clic di approvazione in
console, lato Manager.

> Perché è sicuro: l'ARN non è auto-dichiarato dal prodotto (falsificabile) ma
> **derivato dalla firma** (solo chi detiene il ruolo può produrla). L'operatore
> approva un'identità verificata, non una stringa inviata dal client.

**Forma dell'ARN e pattern (importante).** STS restituisce l'ARN nella forma
**`assumed-role`** (credenziali temporanee del ruolo di esecuzione), es.
`arn:aws:sts::123456789012:assumed-role/<exec-role>/<request-id>`. I pattern di
approvazione matchano QUESTA forma (non `arn:aws:iam::...:role/...`). È l'ARN del
**componente che chiama Manager** (il backend: container/Lambda), non dell'intero
stack. Regole:
- **Approva questo ARN**: solo quel deployment.
- **Approva pattern** (es. `arn:aws:sts::123456789012:assumed-role/ondemand-*`):
  tutte le installazioni con quella convenzione di nome **nello stesso account**
  si agganciano da sole, anche future → attrito zero per le whitelabel.
- **VIETATO il jolly sull'account** (`arn:aws:sts::*:assumed-role/...`): un
  pattern è vincolato a **un singolo account**. Account diversi = una riga per
  account noto. (Vincolo di sicurezza, confermato con Manager.)

**Attrito-zero pieno (whitelabel):** con stesso account + convenzione di naming
dei ruoli (Terraform parametrico), UNA riga pattern copre tutte le whitelabel
presenti e future: ne deployi una nuova e si auto-provisiona senza toccare
Manager. Consapevole: un pattern aggancia deployment futuri **senza revisione
umana** — accettabile perché account e naming sono sotto il nostro controllo.

---

## 3. Endpoint: self-register con auto-provisioning

```
POST https://manager.knowkube.com/api/ecosystem/installations/self
Auth: firma workload-identity (SigV4 / token) nel campo `stsRequest`, NON Bearer
      M2M al primo giro. Nei giri successivi il prodotto usa la M2M (Bearer).

body {
  "product": "kscorm",                       // chiave prodotto (enum ecosistema)
  "installationId": "kscorm",                // univoco; whitelabel: es. "ondemand-acme-eu"
  "region": "eu-west-1",
  "domains": ["architect.knowkube.com"],     // per callback OIDC e branding/hub
  "ecoRoleMap": {                            // opzionale, solo per display su Manager
    "OWNER":"OWNER","ADMIN":"ADMIN","MEMBER":"EDITOR","VIEWER":"VIEWER"
  },
  "stsRequest": {                            // richiesta sts:GetCallerIdentity PRE-FIRMATA
    "url": "https://sts.eu-west-1.amazonaws.com/",      // host STS REGIONALE (no globale)
    "method": "POST",
    "headers": { "...": "..." },             // Authorization SigV4, X-Amz-Date, host STS
    "body": "Action=GetCallerIdentity&Version=2011-06-15"
  },
  "rotateM2m": false                         // true = Manager ricrea il client M2M (nuovo secret nel kit)
}
```
Manager ri-esegue `stsRequest` verso STS, ottiene l'ARN del chiamante e decide
(approvato → kit; non ancora → 202). Il prodotto NON invia il proprio ARN: lo
deriva Manager dalla firma.

**Comportamento di Manager (idempotente su `installationId`):**

1. **Verifica identità** (sezione 2) → ri-esegue `stsRequest`, ricava l'ARN del
   workload. Se il workload **non è ancora approvato** → registra la richiesta
   come *pending* e risponde **`202 pending_approval`** (non errore; il prodotto
   ritenta). Un operatore approva con un clic in console. Al tentativo
   successivo, approvato, si prosegue dal punto 2.
2. Se l'`installationId` è **nuovo**, crea su Cognito (è owner del pool):
   - **client web OIDC** (public/PKCE, no secret): callback
     `https://<domain>/auth/callback`, logout `https://<domain>/login`, scope
     `openid email profile`, per ciascun dominio in `domains`;
     **⚠️ OBBLIGATORIO: associare al client la hosted UI / Managed Login** —
     identity provider `COGNITO` abilitato per la hosted UI + un **Managed Login
     branding style** assegnato a QUESTO client. Senza, l'authorize del client
     redirige alla pagina di login del dominio ma questa risponde **403** (manca
     la UI configurata). Sintomo tipico: il login **dall'hub funziona** (sessione
     di pool già attiva → SSO silenzioso, UI mai mostrata) ma il **login diretto
     fallisce** (nessuna sessione → serve la hosted UI, che dà 403). Il branding
     può essere condiviso d'ecosistema (stesso style per tutti i client), ma
     l'**associazione al client va fatta a OGNI client creato**.
   - **client M2M** dedicato (grant `client_credentials`) con scope
     `ecosystem/entitlements.read ecosystem/wallet.read ecosystem/wallet.write`;
   - riga **Installation** (stato: *available*, non attiva per nessuna company).
3. Se l'`installationId` **esiste già**, NON ricrea: aggiorna `lastSeenAt`,
   domini/ecoRoleMap, e **non rigenera** il secret M2M (vedi rotazione, §6).
4. Risponde con il **provisioning kit** completo:

```
→ 200 {
  "installationId": "kscorm",
  "status": "available",
  "oidc": {
    "issuer":     "https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_jvwWWna9i",
    "clientId":   "<client web OIDC creato>",      // = OIDC_AUDIENCE del prodotto
    "authDomain": "auth.knowkube.com",
    "scope":      "openid email profile"
  },
  "m2m": {
    "clientId":     "<client M2M creato>",
    "clientSecret": "<secret, mostrato SOLO alla creazione>",  // vedi §6
    "tokenUrl":     "https://auth.knowkube.com/oauth2/token",
    "scope":        "ecosystem/entitlements.read ecosystem/wallet.read ecosystem/wallet.write"
  },
  "settings": {
    "enforce":       "soft",     // gate: off|soft|hard (Manager comanda)
    "walletEnabled": false
  }
}
```

**In attesa di approvazione (workload non ancora approvato):**
```
→ 202 { "status": "pending_approval", "retryAfterSec": 30 }
```
NON è un errore. Il prodotto **ritenta** periodicamente (es. ogni `retryAfterSec`)
in background, senza bloccare l'avvio. Appena un operatore approva in console, il
tentativo successivo restituisce `200` col provisioning kit.

**Il prodotto, ricevuto il kit:**
- **persiste** `m2m.clientId`/`clientSecret` nel proprio secret store (una volta);
- usa `oidc.clientId` come **audience** per validare gli ID token, e lo serve al
  proprio web **a runtime** (config dinamica, NON build-time) così nemmeno il
  frontend ha bisogno dell'id in anticipo;
- applica `settings.enforce`/`walletEnabled`;
- dai giri successivi usa la **M2M** come Bearer (non più la firma workload).

---

## 4. Sequenza completa (dal deploy al login owner)

```
[Deploy prodotto]  (solo immagine + ruolo IAM; nessuna credenziale iniettata)
      │
      ▼
1. Prodotto → POST /installations/self   (stsRequest firmato SigV4)
2. Manager ri-esegue stsRequest → ARN del chiamante
   └─ se NON approvato → 202 pending_approval → il prodotto RITENTA (non bloccante)
                         Manager: operatore approva con un clic in console
3. (dopo approvazione) Manager crea client OIDC + client M2M + Installation (se nuovi)
4. Manager → risponde 200 con provisioning kit (oidc + m2m + settings)
5. Prodotto persiste M2M, si auto-configura (audience, issuer, enforce, wallet)
      │
      ▼  (operazione-dati su Manager, quando vuoi attivare il cliente)
6. Manager: attiva (company, product[/installation]) → Contract active
7. Manager: owner nel pool con custom:tenant_id=<slug>, custom:eco_role=OWNER
      │
      ▼  (runtime, a ogni login)
8. Owner login via auth.knowkube.com (SSO del pool, silenzioso tra prodotti)
9. Prodotto valida ID token (aud = oidc.clientId del kit)
10. Prodotto → GET /entitlements?company_id=<slug>  (Bearer M2M)
      → accesso = available && status∈{active,grace}; altrimenti 403
11. JIT: se l'utente non esiste, il prodotto lo crea nel PROPRIO DB dai claim
      (ruolo interno = mapping di custom:eco_role). Mai nel pool.
12. Owner dentro, senza pre-creazione e senza alcuno scambio manuale.
```

---

## 5. Modello dati minimo su Manager (aggiunte)

```
Installation
  installationId   univoco (PK logica)
  product          enum: kscorm|klive|kdataroom|ondemand
  region, domains[]
  workloadArn      ARN del ruolo che si è auto-provisionato (audit)
  oidcClientId     client web creato
  m2mClientId      client M2M creato
  ecoRoleMap       JSON opzionale (display)
  status           available|...
  firstSeenAt, lastSeenAt

ProvisioningRequest  (trust-on-first-use: richieste viste, da approvare)
  workloadArn      ARN derivato dalla firma SigV4 (NON auto-dichiarato)
  product, installationId, domains[]
  status           pending | approved | rejected
  firstSeenAt, decidedAt, decidedBy
```
L'approvazione è un clic in console (status pending→approved). Opzionale: pattern
di auto-approvazione (es. `arn:...:role/scorm-*`) per saltare il clic sui
workload fidati.

Entitlement/Wallet/Contract/Owner restano come già specificato (non cambiano).

---

## 6. Sicurezza e rotazione

- **Nessun secret condiviso**: il primo contatto usa la firma del workload, non
  una credenziale statica. Il secret M2M dedicato nasce *dentro* la risposta e
  non è mai distribuito per altri canali.
- **Secret M2M mostrato una sola volta** (alla creazione). Il prodotto lo
  persiste subito. Cognito non rivela i secret esistenti; per ricrearlo si fa un
  nuovo client M2M e si restituisce al prossimo self-register autenticato.
- **Rotazione M2M**: endpoint dedicato o flag nel self-register
  (`"rotateM2m": true`) → Manager crea un nuovo secret/clienti e lo restituisce;
  il vecchio viene invalidato dopo una finestra di grazia.
- **Allowlist**: solo ARN/pattern noti possono provisionare. L'`installationId`
  è legato all'ARN che l'ha creato: un altro workload non può "rubare" una
  installazione esistente.
- **Idempotenza**: self-register ripetuto non ricrea né espone di nuovo il
  secret; aggiorna solo metadati e `lastSeenAt`.
- **Restrizione API** (consigliata prima del go-live): popolare l'allowlist dei
  `client_id` ammessi sulle API ecosistema (`ECOSYSTEM_COGNITO_ALLOWED_CLIENT_IDS`
  o equivalente), così solo i client M2M emessi da Manager accedono a
  entitlements/wallet.

---

## 7. Errori → comportamento

| Situazione | HTTP | Azione |
|---|---|---|
| Firma workload assente/non valida | 401 | il prodotto non può provisionare |
| Workload non ancora approvato | **202 `pending_approval`** | NON è errore: il prodotto ritenta; operatore approva con un clic |
| `product` non valido | 400 `invalid_product` | enum: kscorm\|klive\|kdataroom\|ondemand |
| `installationId` mancante | 400 `missing_installation_id` | — |
| Installazione già esistente | 200 | update metadati, nessuna ricreazione |
| Login diretto → pagina `/login` del dominio dà **403** | 403 (hosted UI) | manca la **hosted UI/Managed Login branding** sul client OIDC: associarla al client (vedi §3.2). L'hub funziona lo stesso, il login diretto no. |
| Manager irraggiungibile al boot | — | il prodotto parte comunque e ritenta (non bloccante) |

---

## 7bis. Attivazione del workload-auth (flag, OFF di default)

Il flag `workload_auth_enabled` (su EcosystemConfig di Manager) è **OFF di
default**: finché è spento, il self-register accetta **solo** il Bearer M2M
(nessun rischio in produzione). L'onboarding automatico è pronto nel codice ma
**inerte** finché non lo si accende.

Procedura per il test end-to-end (in **staging**):
1. Il prodotto parte e chiama self-register firmato → compare come richiesta in
   attesa (`202 pending_approval`).
2. In console Manager (**Ecosistema → Onboarding automatico**,
   `/ecosystem/allowlist/`): approvare l'ARN del prodotto (o il pattern).
3. Accendere l'interruttore `workload_auth_enabled`.
4. Al ritentativo il prodotto riceve il provisioning kit.

Rotazione M2M: self-register con `"rotateM2m": true` → Manager ricrea il client
M2M (nuovo secret nel kit una volta), invalida il precedente.

---

## 8. Definition of Done (lato Manager)

1. Verifica **workload identity** sul self-register tramite **strategia
   pluggabile** (astrazione "verifica workload"), con prima implementazione
   **SigV4+GetCallerIdentity** e difese anti-SSRF/anti-replay (§2);
   **trust-on-first-use**: ARN derivato dalla firma, `202 pending_approval` +
   approvazione con un clic in console (nessun ARN comunicato in anticipo).
   L'endpoint è **dual-auth**: workload-identity al primo giro, Bearer M2M ai
   giri successivi (retro-compatibile col test Bearer esistente).
2. Auto-creazione idempotente su Cognito di **client web OIDC** + **client M2M**
   per installazione nuova, con callback/logout derivati dai `domains`, **e
   associazione della hosted UI / Managed Login branding al client web OIDC**
   (identity provider `COGNITO` + branding style), altrimenti il login diretto
   dà 403 (vedi §3.2 e §7).
3. Risposta con **provisioning kit** completo (oidc + m2m + settings) come §3.
4. Modello dati **Installation** + **ProvisioningRequest** (pending/approved, §5).
5. Idempotenza + **rotazione** secret M2M (§6).
6. (Consigliato) allowlist dei `client_id` ammessi sulle API ecosistema.
7. Test: prodotto nuovo che si auto-provisiona da zero (solo ruolo IAM);
   secondo self-register idempotente; ARN non in allowlist rifiutato; login owner
   end-to-end dopo l'attivazione.

### Consegna a fasi (committabili separatamente)
Per tenere il lavoro verificabile, l'implementazione Manager può procedere così:
- **Fase 1:** modelli (`Installation` arricchita + `ProvisioningRequest`
  pending/approved) + migrazioni + admin/UI minima per approvare le richieste con
  un clic.
- **Fase 2:** auto-provisioning Cognito (crea client OIDC + M2M al primo
  self-register) + provisioning kit nella risposta, ancora dietro **Bearer**
  (testa la creazione risorse senza SigV4).
- **Fase 3:** auth **workload-identity** (SigV4+GetCallerIdentity) con
  trust-on-first-use (`202 pending_approval` + approvazione in console), dietro
  l'**astrazione pluggabile**, in **dual-auth** sull'endpoint.
- **Fase 4:** rotazione M2M (`rotateM2m`) + allowlist `client_id` sulle API
  ecosistema + documentazione.

---

## 9. Cosa fa il prodotto (riepilogo, per chiarezza del confine)

Il prodotto implementa SOLO: firmare il primo self-register con la sua identità
workload; persistere il provisioning kit; usare `oidc.clientId` come audience e
servirlo al web a runtime; usare la M2M per entitlement/wallet; JIT dell'utente
nel proprio DB con mapping eco-role. **Non** crea risorse Cognito, **non** detiene
segreti condivisi, **non** richiede config manuale all'onboarding.
