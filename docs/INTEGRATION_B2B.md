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
