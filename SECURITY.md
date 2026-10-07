# Postura di sicurezza

Riepilogo dei controlli di sicurezza implementati (Requisito 12) e dei punti che
restano a carico del deployment.

## Implementato nell'applicazione

- **Isolamento multi-tenant**: filtro `tenantId` esplicito su tutte le query +
  Row-Level Security Postgres (ENABLE + FORCE) con policy per tenant. Verificato
  su DB reale (nessun accesso cross-tenant in lettura/scrittura).
- **Autenticazione**: dietro astrazione `AuthProvider` (JWT in dev, OIDC
  collegabile). Guard globale: tutte le rotte protette per default, opt-out
  esplicito con `@Public()`.
- **Autorizzazione**: ruoli gerarchici (Owner > Admin > Editor > Viewer) via
  `@Roles()` e guard globale.
- **Validazione input**: `ValidationPipe` globale (whitelist, no proprietà
  extra) + schema Zod dei contratti sui payload ricchi.
- **Sanitizzazione HTML**: tutto il rich-text generato/modificato è sanificato
  (allowlist) prima di finire nel pacchetto SCORM, contro XSS nell'LMS.
- **Upload**: validazione MIME allowlist e dimensione massima; file privati.
- **Accesso ai file**: solo tramite URL firmati a scadenza (file sorgente e
  pacchetti), mai URL pubblici.
- **Credenziali provider**: lette solo server-side (env o default credential
  chain AWS); mai esposte al client; non committate (`.env` in `.gitignore`).
- **Security headers HTTP**: Helmet (CSP, HSTS, X-Content-Type-Options, ecc.).
- **Rate limiting**: throttler globale (default 100 req/60s per client).
- **Audit trail**: azioni rilevanti (export, ecc.) registrate con utente,
  tenant, correlation id e timestamp.
- **Pacchetto SCORM offline**: nessuna dipendenza di rete a runtime nell'LMS.

## A carico del deployment / infrastruttura

- **Cifratura a riposo**: abilitare l'encryption dei volumi del database e del
  bucket di storage (es. RDS encryption, S3 SSE). L'applicazione non gestisce le
  chiavi: è responsabilità dell'infrastruttura.
- **Cifratura in transito**: terminare TLS davanti all'API (load balancer /
  ingress). HSTS è impostato da Helmet ma richiede HTTPS a monte.
- **Gestione segreti**: usare un secret manager (es. AWS Secrets Manager) invece
  di `.env` in produzione.
- **Rotazione credenziali** dei provider e del database.
- **Backup e retention** del database e dello storage.

## Note

- La conformità WCAG completa dei contenuti richiede test manuali con tecnologie
  assistive e review esperta; i renderer includono ARIA e navigazione da
  tastiera come base.
