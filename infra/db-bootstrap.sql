-- Bootstrap del database di produzione, da eseguire UNA TANTUM con l'utente
-- MASTER di RDS (DATABASE_URL_ADMIN), prima del primo deploy.
--
--   psql "<DATABASE_URL_ADMIN senza ?schema>" -v app_password="<db_app_password>" -f db-bootstrap.sql
--
-- (db_app_password = output Terraform `db_app_password`.)
--
-- Crea:
--  1) l'estensione pgvector (serve all'app per gli embeddings);
--  2) il ruolo applicativo `scorm_app`, NON superuser, con BYPASSRLS.
--
-- Nota RLS: l'isolamento multi-tenant è garantito dal filtro `tenantId`
-- esplicito in ogni query. Il ruolo app ha BYPASSRLS al lancio (vedi
-- docs/DEPLOY_AWS.md § Sicurezza). Hardening futuro: runInTenant + togliere
-- BYPASSRLS.

CREATE EXTENSION IF NOT EXISTS vector;

-- Crea il ruolo solo se non esiste. `\gexec` esegue la query generata: la
-- sostituzione psql :'app_password' avviene QUI (testo normale, non dentro un
-- dollar-quote), quindi funziona.
SELECT format('CREATE ROLE scorm_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'scorm_app')
\gexec

-- Allinea sempre la password (idempotente su re-run).
SELECT format('ALTER ROLE scorm_app WITH PASSWORD %L', :'app_password')
\gexec

-- Permessi sullo schema public (le tabelle sono create dalle migrazioni con
-- l'utente master: scorm_app deve poterle usare).
GRANT USAGE ON SCHEMA public TO scorm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO scorm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO scorm_app;

-- Default privileges per le tabelle/sequenze create dalle MIGRAZIONI FUTURE.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO scorm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO scorm_app;
