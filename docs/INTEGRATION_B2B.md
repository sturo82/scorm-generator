# Integrazione B2B — Catalogo corsi e download pacchetti SCORM

Questa guida è per gli sviluppatori di una piattaforma terza (es. **OnDemand**,
auth Django) che deve leggere il catalogo dei corsi condivisi da un tenant di
SCORM Generator e scaricarne i pacchetti SCORM.

L'accesso è **macchina-a-macchina** (OAuth2 *client credentials*): la piattaforma
terza NON agisce per conto di un utente, ma come servizio autorizzato dal tenant.
È separato dal login utente (SSO), che è trattato altrove.

## 1. Autorizzazione (lato tenant)

Nel workspace di SCORM Generator, un utente con ruolo **ADMIN** o superiore crea
un *client di integrazione* (web app → sezione Integrazioni, oppure via API):

```
POST /integration/clients
Authorization: Bearer <token utente>
Content-Type: application/json

{ "name": "OnDemand produzione", "scopes": ["catalog:read", "package:download"] }
```

La risposta contiene `clientId` e `clientSecret`. **Il `clientSecret` è mostrato
una sola volta**: va copiato e conservato in modo sicuro (secret manager). Se si
perde, si crea un nuovo client e si revoca il vecchio.

Scopi disponibili:
- `catalog:read` — leggere il catalogo (metadati dei corsi, versioni pacchetto).
- `package:download` — ottenere l'URL di download di un pacchetto SCORM.

Un client si revoca con `POST /integration/clients/:id/revoke`: la revoca ha
effetto immediato anche sui token già emessi.

## 2. Ottenere un access token (lato terza parte)

Scambia `clientId`/`clientSecret` con un access token di servizio
(JWT, breve durata). Accettati sia JSON sia `application/x-www-form-urlencoded`
(standard OAuth2):

```bash
curl -X POST https://api.tuodominio.com/oauth/token \
  -d grant_type=client_credentials \
  -d client_id=oc_xxx \
  -d client_secret=os_xxx
```

Risposta:

```json
{
  "access_token": "eyJhbGci...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "catalog:read package:download"
}
```

Credenziali errate → `401 { "error": "invalid_client" }`.

### Esempio Django (richiesta token, con cache)

```python
import time, requests

_token = {"value": None, "exp": 0}

def get_service_token() -> str:
    if _token["value"] and time.time() < _token["exp"] - 60:
        return _token["value"]
    resp = requests.post(
        f"{SCORM_API_BASE}/oauth/token",
        data={
            "grant_type": "client_credentials",
            "client_id": settings.SCORM_CLIENT_ID,
            "client_secret": settings.SCORM_CLIENT_SECRET,
        },
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    _token["value"] = data["access_token"]
    _token["exp"] = time.time() + data["expires_in"]
    return _token["value"]
```

## 3. Leggere il catalogo

Usa l'access token come `Authorization: Bearer <access_token>`.

### Elenco dei corsi condivisi

```
GET /integration/catalog/courses        (scope: catalog:read)
```

Ritorna solo i corsi che il tenant ha reso **condivisibili** (`shareable`) **e**
che sono in stato **approvato**. Per ciascuno: metadati + copertina (URL firmato,
TTL 1 ora) + elenco delle versioni di pacchetto SCORM già pronte.

```json
[
  {
    "id": "course-123",
    "title": "Sicurezza sul lavoro",
    "description": "...",
    "language": "it",
    "coverImageUrl": "https://.../cover.jpg?X-Amz-...",
    "updatedAt": "2026-01-02T00:00:00.000Z",
    "availablePackages": [
      {
        "packageId": "pkg-9",
        "version": 9,
        "profile": "SCORM_2004_4TH",
        "brandId": "brand-1",
        "sizeBytes": 25148405,
        "createdAt": "2026-01-02T00:00:00.000Z"
      }
    ]
  }
]
```

Dettaglio singolo corso: `GET /integration/catalog/courses/:id`.
Solo versioni pacchetto: `GET /integration/catalog/courses/:id/packages`.

## 4. Scaricare il pacchetto SCORM

```
GET /integration/catalog/courses/:id/download
    [?profile=SCORM_2004_4TH|SCORM_12] [&brandId=...]
    (scope: catalog:read + package:download)
```

Ritorna un **URL di download firmato** (presigned S3, TTL 10 minuti) del
pacchetto `.zip`. Scaricalo subito e depositalo nel tuo sistema.

```json
{
  "courseId": "course-123",
  "packageId": "pkg-9",
  "version": 9,
  "profile": "SCORM_2004_4TH",
  "downloadUrl": "https://bucket.s3.amazonaws.com/packages/.../v9.zip?X-Amz-...",
  "expiresInSec": 600,
  "sizeBytes": 25148405
}
```

Se non esiste un pacchetto pronto per il profilo richiesto, viene costruito al
momento (la prima richiesta può quindi richiedere più tempo).

### Esempio Django (download)

```python
import requests

def download_scorm(course_id: str, dest_path: str) -> None:
    token = get_service_token()
    meta = requests.get(
        f"{SCORM_API_BASE}/integration/catalog/courses/{course_id}/download",
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    meta.raise_for_status()
    url = meta.json()["downloadUrl"]
    with requests.get(url, stream=True, timeout=120) as r:
        r.raise_for_status()
        with open(dest_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=1 << 20):
                f.write(chunk)
```

## Note di sicurezza

- Il `clientSecret` non è recuperabile dopo la creazione: conservalo nel secret
  manager, non nel codice.
- I token di servizio sono a vita breve (default 1 ora): richiedine uno nuovo
  alla scadenza (vedi cache nell'esempio Django).
- La revoca di un client blocca immediatamente anche i token non ancora scaduti.
- Gli URL di download sono firmati e scadono in 10 minuti: usali subito.
- Il tenant controlla cosa è esposto: solo i corsi `shareable` **e** approvati.

## Riferimento rapido endpoint

| Metodo | Endpoint | Auth | Scope |
| --- | --- | --- | --- |
| POST | `/oauth/token` | client_id/secret | — |
| GET | `/integration/catalog/courses` | service token | `catalog:read` |
| GET | `/integration/catalog/courses/:id` | service token | `catalog:read` |
| GET | `/integration/catalog/courses/:id/packages` | service token | `catalog:read` |
| GET | `/integration/catalog/courses/:id/download` | service token | `catalog:read` + `package:download` |
| POST | `/integration/clients` | utente ADMIN+ | — |
| GET | `/integration/clients` | utente ADMIN+ | — |
| POST | `/integration/clients/:id/revoke` | utente ADMIN+ | — |
| DELETE | `/integration/clients/:id` | utente ADMIN+ | — |

---

# SSO — Far entrare un utente nella web app (Scenario 2)

Oltre al download dei pacchetti (M2M), una piattaforma terza può far accedere un
proprio utente **direttamente nella web app di SCORM Generator** senza secondo
login. Il meccanismo è un **ticket monouso basato sulla tua API key**: niente
Cognito, niente OIDC lato tua piattaforma. Serve solo una chiamata HTTP + un
redirect del browser.

OnDemand resta la fonte di verità degli utenti: decide chi entra, con quale
email/nome e con **quale ruolo** (entro un massimo lato server, mai OWNER).

## Prerequisiti

- Il tuo IntegrationClient deve avere lo scope **`sso:issue`** (va concesso
  esplicitamente alla creazione: non è nei default).
- Tutti gli utenti creati via SSO appartengono allo **stesso tenant** della API
  key.

## Flusso

```
Utente (browser) su OnDemand
        │  clicca "Apri nel generatore corsi"
        ▼
OnDemand (backend)
   1. POST /oauth/token            → service token (come per il catalogo)
   2. POST /sso/ticket             → { ticket, redirectUrl }
   3. redirect del browser a redirectUrl  (WEB_APP_URL/sso?ticket=...)
        │
        ▼
Web app SCORM Generator
   4. POST /sso/redeem { ticket }  → sessione utente, poi dashboard
```

### 2. Emettere il ticket (backend OnDemand)

```
POST /sso/ticket
Authorization: Bearer <service token con scope sso:issue>
Content-Type: application/json

{
  "email": "mario@ondemand.test",
  "displayName": "Mario Rossi",
  "role": "EDITOR",                 // VIEWER | EDITOR | ADMIN (max lato server)
  "externalId": "ondemand-user-42"  // opzionale: id stabile dell'utente da te
}
```

Risposta:

```json
{
  "ticket": "7YzLqMsX...",
  "redirectUrl": "https://app.tuodominio.com/sso?ticket=7YzLqMsX...",
  "expiresInSec": 60
}
```

Note:
- Se ometti `externalId`, l'utente è identificato dall'email (`sso:<email>`).
- Al secondo accesso dello stesso `externalId`, l'utente NON viene duplicato:
  nome e ruolo vengono aggiornati a quanto dichiari (sei tu la fonte di verità).
- Un `role` superiore al massimo consentito dal server → `400`.

### 3. Reindirizzare il browser

Reindirizza l'utente a `redirectUrl` (il ticket scade in ~60s: fallo subito dopo
averlo ottenuto, non salvarlo).

### 4. Redeem (lato web app — già implementato)

La pagina `/sso` della web app scambia automaticamente il ticket:

```
POST /sso/redeem
Content-Type: application/json

{ "ticket": "7YzLqMsX..." }
```

Risposta (sessione utente):

```json
{
  "access_token": "eyJhbGci...",
  "token_type": "Bearer",
  "expires_in": 28800,
  "user": { "id": "...", "email": "mario@ondemand.test", "displayName": "Mario Rossi", "role": "EDITOR" },
  "tenant": { "id": "tenant-ondemand" }
}
```

Il ticket è **monouso**: un secondo redeem → `401`.

### Esempio Django (emissione ticket + redirect)

```python
import requests
from django.shortcuts import redirect

def open_in_scorm_generator(request):
    token = get_service_token()  # vedi sezione M2M
    resp = requests.post(
        f"{SCORM_API_BASE}/sso/ticket",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "email": request.user.email,
            "displayName": request.user.get_full_name(),
            "role": "EDITOR",
            "externalId": str(request.user.pk),
        },
        timeout=10,
    )
    resp.raise_for_status()
    return redirect(resp.json()["redirectUrl"])
```

## Sicurezza

- Il ticket vive pochi secondi, è monouso e salvato come hash (mai in chiaro).
- Il ruolo è deciso da te ma limitato lato server a `SSO_MAX_ROLE` (default
  `ADMIN`): non è mai possibile creare un OWNER via SSO.
- Il tenant è sempre quello della API key: non puoi creare utenti in altri tenant.
- Il token utente emesso dal redeem è un JWT con chiave dedicata e scadenza
  configurabile (`SSO_USER_TOKEN_TTL_SEC`, default 8h).

## Riferimento rapido endpoint SSO

| Metodo | Endpoint | Auth | Scope |
| --- | --- | --- | --- |
| POST | `/sso/ticket` | service token | `sso:issue` |
| POST | `/sso/redeem` | ticket monouso | — |
