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
di avere qualsiasi credenziale M2M. Soluzione: firma la richiesta con la propria
identità AWS; Manager la verifica senza che nessun segreto sia stato scambiato.

Due varianti accettabili (Manager sceglie l'implementazione; il prodotto
supporta quella scelta):

**Variante A — AWS SigV4 + GetCallerIdentity (consigliata).**
Il prodotto firma la richiesta di self-register con le sue credenziali IAM
(SigV4). Manager verifica l'identità chiedendo a STS **chi è** il chiamante
(pattern "AWS IAM auth": il prodotto allega una richiesta `sts:GetCallerIdentity`
pre-firmata; Manager la esegue e ottiene l'ARN del ruolo del prodotto). Nessun
segreto condiviso: la prova è la firma SigV4, verificabile solo da chi detiene il
ruolo.

**Variante B — Token d'istanza/OIDC del workload.**
Se il prodotto gira in un contesto con token d'identità del workload (es.
IRSA/OIDC su EKS), presenta quel token; Manager lo valida contro l'issuer del
provider. (Per App Runner/Lambda la Variante A è più diretta.)

**Allowlist (controllo d'ammissione):** Manager tiene una lista di **ARN di
ruolo autorizzati** a provisionare (o un pattern, es.
`arn:aws:iam::<account>:role/scorm-*`). Solo i workload in allowlist possono
auto-provisionarsi. Aggiungere un prodotto nuovo = aggiungere il suo ARN
all'allowlist (unica azione umana, una riga, lato Manager — non lato prodotto).

> Nota: questo è l'UNICO atto "manuale" residuo, ed è su Manager, non sul
> prodotto. Il prodotto resta a zero-touch. L'allowlist si può anche
> parametrizzare (pattern per nome ruolo) per azzerare anche questo.

---

## 3. Endpoint: self-register con auto-provisioning

```
POST https://manager.knowkube.com/api/ecosystem/installations/self
Auth: firma workload-identity (SigV4 / token), NON Bearer M2M al primo giro.
      Nei giri successivi il prodotto può usare la sua M2M (Bearer) già ottenuta.

body {
  "product": "kscorm",                       // chiave prodotto (enum ecosistema)
  "installationId": "kscorm",                // univoco; whitelabel: es. "ondemand-acme-eu"
  "region": "eu-west-1",
  "domains": ["architect.knowkube.com"],     // per callback OIDC e branding/hub
  "ecoRoleMap": {                            // opzionale, solo per display su Manager
    "OWNER":"OWNER","ADMIN":"ADMIN","MEMBER":"EDITOR","VIEWER":"VIEWER"
  }
}
```

**Comportamento di Manager (idempotente su `installationId`):**

1. **Verifica identità** (sezione 2) → ricava l'ARN del workload; se non in
   allowlist → `403 workload_not_authorized`.
2. Se l'`installationId` è **nuovo**, crea su Cognito (è owner del pool):
   - **client web OIDC** (public/PKCE, no secret): callback
     `https://<domain>/auth/callback`, logout `https://<domain>/login`, scope
     `openid email profile`, per ciascun dominio in `domains`;
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
1. Prodotto → POST /installations/self   (firmato workload-identity)
2. Manager verifica ARN in allowlist
3. Manager crea client OIDC + client M2M + Installation (se nuovi)
4. Manager → risponde con provisioning kit (oidc + m2m + settings)
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

ProvisioningAllowlist
  pattern          ARN o pattern autorizzato (es. arn:...:role/scorm-*)
  note
```

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
| ARN non in allowlist | 403 `workload_not_authorized` | aggiungere l'ARN su Manager |
| `product` non valido | 400 `invalid_product` | enum: kscorm\|klive\|kdataroom\|ondemand |
| `installationId` mancante | 400 `missing_installation_id` | — |
| Installazione già esistente | 200 | update metadati, nessuna ricreazione |
| Manager irraggiungibile al boot | — | il prodotto parte comunque e ritenta (non bloccante) |

---

## 8. Definition of Done (lato Manager)

1. Verifica **workload identity** sul self-register (SigV4+GetCallerIdentity o
   token), con **allowlist** di ARN/pattern.
2. Auto-creazione idempotente su Cognito di **client web OIDC** + **client M2M**
   per installazione nuova, con callback/logout derivati dai `domains`.
3. Risposta con **provisioning kit** completo (oidc + m2m + settings) come §3.
4. Modello dati **Installation** + **ProvisioningAllowlist** (§5).
5. Idempotenza + **rotazione** secret M2M (§6).
6. (Consigliato) allowlist dei `client_id` ammessi sulle API ecosistema.
7. Test: prodotto nuovo che si auto-provisiona da zero (solo ruolo IAM);
   secondo self-register idempotente; ARN non in allowlist rifiutato; login owner
   end-to-end dopo l'attivazione.

---

## 9. Cosa fa il prodotto (riepilogo, per chiarezza del confine)

Il prodotto implementa SOLO: firmare il primo self-register con la sua identità
workload; persistere il provisioning kit; usare `oidc.clientId` come audience e
servirlo al web a runtime; usare la M2M per entitlement/wallet; JIT dell'utente
nel proprio DB con mapping eco-role. **Non** crea risorse Cognito, **non** detiene
segreti condivisi, **non** richiede config manuale all'onboarding.
