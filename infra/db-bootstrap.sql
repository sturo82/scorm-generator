-- Bootstrap del database di produzione, da eseguire UNA TANTUM con l'utente
-- MASTER di RDS (DATABASE_URL_ADMIN), prima del primo deploy.
--
--   psql "<DATABASE_URL_ADMIN>" -v app_password="'<db_app_password>'" -f db-bootstrap.sql
--
-- (db_app_password = output Terraform `db_app_password`.)
--
-- Crea:
--  1) l'estensione pgvector (serve all'app per gli embeddings);
--  2) il ruolo applicativo `scorm_app`, NON superuser.
--
-- Decisione RLS al lancio (vedi docs/DEPLOY_AWS.md § Sicurezza):
--  Le migrazioni abilitano FORCE ROW LEVEL SECURITY su alcune tabelle, ma oggi
--  l'applicazione NON imposta la GUC app.current_tenant sulla maggior parte dei
--  percorsi: l'isolamento multi-tenant è garantito dal filtro `tenantId`
--  esplicito in ogni query (verificato nel codice). Per non cambiare questo
--  comportamento al lancio, il ruolo app riceve l'attributo BYPASSRLS: resta un
--  utente a privilegi ridotti (niente superuser, niente DDL arbitrario) ma non
--  è bloccato dalle policy. Attivare la RLS "vera" (togliere BYPASSRLS) richiede
--  prima di passare tutti i percorsi tenant a runInTenant: è hardening futuro
--  pianificato, non necessario per la correttezza dell'isolamento.

CREATE EXTENSION IF NOT EXISTS vector;

-- Ruolo applicativo: login, non superuser, con BYPASSRLS (vedi nota sopra).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'scorm_app') THEN
    EXECUTE format('CREATE ROLE scorm_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS', :app_password);
  ELSE
    EXECUTE format('ALTER ROLE scorm_app PASSWORD %L', :app_password);
  END IF;
END $$;

-- Permessi sullo schema public (le tabelle sono create dalle migrazioni, eseguite
-- con l'utente master: scorm_app deve poterle usare).
GRANT USAGE ON SCHEMA public TO scorm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO scorm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO scorm_app;

-- Default privileges: anche le tabelle/sequenze create dalle MIGRAZIONI FUTURE
-- (sempre con l'utente master) saranno accessibili a scorm_app.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO scorm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO scorm_app;
