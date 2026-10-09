/*
 * seed-owner.mjs — Crea (idempotente) il tenant iniziale e il primo utente
 * OWNER, collegandolo al `sub` Cognito dell'operatore. Da eseguire UNA volta al
 * primo deploy (Fase 1 "tenant singolo"), prima di invitare altri utenti dal
 * pannello admin.
 *
 * Input via variabili d'ambiente:
 *   DATABASE_URL   stringa di connessione Postgres (richiesta)
 *   TENANT_ID      id del tenant (deve coincidere con il valore messo in
 *                  custom:tenant_id del primo utente Cognito). Default: "tenant-prod".
 *   TENANT_NAME    nome del tenant. Default: "Organizzazione".
 *   OWNER_SUB      il `sub` Cognito del primo OWNER (vedi DEPLOY-AWS.md). Richiesto.
 *   OWNER_EMAIL    email del primo OWNER. Richiesta.
 *   OWNER_NAME     nome visualizzato. Default: "Owner".
 *
 * Esecuzione (immagine migrate, che ha prisma + client generato):
 *   node apps/api/scripts/seed-owner.mjs
 *
 * Idempotente: Plan creato solo se il tenant non esiste; Tenant upsert per id;
 * User upsert per (tenantId, externalId).
 */
import { PrismaClient } from '@prisma/client';

const {
  TENANT_ID = 'tenant-prod',
  TENANT_NAME = 'Organizzazione',
  OWNER_SUB,
  OWNER_EMAIL,
  OWNER_NAME = 'Owner',
} = process.env;

function fail(msg) {
  console.error(`[seed-owner] ${msg}`);
  process.exit(1);
}

if (!process.env.DATABASE_URL) fail('DATABASE_URL mancante.');
if (!OWNER_SUB) fail('OWNER_SUB mancante (il `sub` Cognito del primo OWNER).');
if (!OWNER_EMAIL) fail('OWNER_EMAIL mancante.');

const prisma = new PrismaClient();

try {
  await prisma.$transaction(async (tx) => {
    // Imposta il tenant corrente per soddisfare le policy RLS su Tenant/User.
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${TENANT_ID}, true)`;

    const existingTenant = await tx.tenant.findUnique({ where: { id: TENANT_ID } });
    if (!existingTenant) {
      // Piano ENTERPRISE con tutte le feature abilitate (regolabile poi).
      const plan = await tx.plan.create({
        data: { tier: 'ENTERPRISE', limits: {}, featureFlags: { dataDeletion: true } },
      });
      await tx.tenant.create({ data: { id: TENANT_ID, name: TENANT_NAME, planId: plan.id } });
      console.log(`[seed-owner] creato tenant "${TENANT_ID}" (${TENANT_NAME}).`);
    } else {
      console.log(`[seed-owner] tenant "${TENANT_ID}" già presente.`);
    }

    const owner = await tx.user.upsert({
      where: { tenantId_externalId: { tenantId: TENANT_ID, externalId: OWNER_SUB } },
      update: { email: OWNER_EMAIL.toLowerCase(), displayName: OWNER_NAME, role: 'OWNER' },
      create: {
        tenantId: TENANT_ID,
        externalId: OWNER_SUB,
        email: OWNER_EMAIL.toLowerCase(),
        displayName: OWNER_NAME,
        role: 'OWNER',
      },
    });
    console.log(`[seed-owner] OWNER pronto: ${owner.email} (id=${owner.id}).`);
  });
  console.log('[seed-owner] completato. Ora puoi invitare altri utenti dal pannello Utenti.');
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await prisma.$disconnect();
}
