-- Listino HeyGen per la CREAZIONE di un avatar (operazione una tantum). HeyGen
-- fattura "Avatar Creation" a 1 credito/chiamata, sia per Photo Avatar sia per
-- Digital Twin (1 credito = $0.50). I prompt avatar seguono la stessa pipeline
-- di creazione, quindi li prezziamo con la stessa tariffa.
-- Il metering registra 1 CALLS con model = "heygen-avatar-creation", source
-- "avatar_creation". courseId resta NULL (è un'operazione a livello di tenant,
-- non legata a un corso).
-- (Fonte prezzi: HeyGen API pricing / enterprise-pricing 2026, "Avatar Creation
--  1 credit / call". Rielaborato per conformità. Aggiornare `unitPriceUsd` se il
--  listino cambia: una riga più recente per `validFrom` sostituisce la vecchia.)

-- Aggiunge il valore 'CALLS' all'enum MeterUnit (chiamate a pagamento una tantum).
ALTER TYPE "MeterUnit" ADD VALUE IF NOT EXISTS 'CALLS';
