import { z } from 'zod';

/**
 * Piani, limiti e feature flag (Requisito 1.4 / 1.5 / 11.4). La forma è definita
 * qui come fonte di verità unica e salvata come JSONB in Plan.limits /
 * Plan.featureFlags; validata a livello applicativo.
 */

export const PlanTier = z.enum(['PREMIUM', 'ENTERPRISE']);
export type PlanTier = z.infer<typeof PlanTier>;

/**
 * Limiti quantitativi del piano. `null` indica "illimitato". I nomi delle
 * risorse sono stabili e usati sia per l'enforcement sia per esporre il consumo.
 */
export const PlanLimits = z.object({
  /** Numero massimo di corsi per tenant. */
  maxCourses: z.number().int().nonnegative().nullable().default(null),
  /** Numero massimo di brand per tenant. */
  maxBrands: z.number().int().nonnegative().nullable().default(null),
  /** Dimensione totale della knowledge base, in megabyte. */
  maxKnowledgeMb: z.number().nonnegative().nullable().default(null),
  /** Export di pacchetti SCORM consentiti al mese. */
  maxExportsPerMonth: z.number().int().nonnegative().nullable().default(null),
  /** Numero massimo di utenti per tenant. */
  maxUsers: z.number().int().nonnegative().nullable().default(null),
});
export type PlanLimits = z.infer<typeof PlanLimits>;

/** Risorse quantificabili su cui si applicano i limiti. */
export const QuotaResource = z.enum([
  'courses',
  'brands',
  'knowledgeMb',
  'exportsPerMonth',
  'users',
]);
export type QuotaResource = z.infer<typeof QuotaResource>;

/** Mappa risorsa -> chiave del limite corrispondente in PlanLimits. */
export const QUOTA_LIMIT_KEY: Record<QuotaResource, keyof PlanLimits> = {
  courses: 'maxCourses',
  brands: 'maxBrands',
  knowledgeMb: 'maxKnowledgeMb',
  exportsPerMonth: 'maxExportsPerMonth',
  users: 'maxUsers',
};

/**
 * Feature flag booleani del piano. Ogni flag ha un default per-campo, così un
 * JSONB parziale (o vuoto) viene normalizzato ai valori attesi.
 */
export const FeatureFlags = z.object({
  /** Export in SCORM 1.2 oltre al 2004 (Requisito 9.1). */
  scorm12Export: z.boolean().default(true),
  /** Scenari a ramificazione valutati e interazioni avanzate. */
  advancedInteractions: z.boolean().default(true),
  /** Cancellazione dati su richiesta (Requisito 12.5, tipicamente Enterprise). */
  dataDeletion: z.boolean().default(false),
  /** SSO / OIDC enterprise. */
  sso: z.boolean().default(false),
});
export type FeatureFlags = z.infer<typeof FeatureFlags>;

/** Preset dei limiti per tier, usati per il seeding dei piani. */
export const DEFAULT_PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  PREMIUM: {
    maxCourses: 25,
    maxBrands: 3,
    maxKnowledgeMb: 500,
    maxExportsPerMonth: 100,
    maxUsers: 10,
  },
  ENTERPRISE: {
    maxCourses: null,
    maxBrands: null,
    maxKnowledgeMb: null,
    maxExportsPerMonth: null,
    maxUsers: null,
  },
};

export const DEFAULT_FEATURE_FLAGS: Record<PlanTier, FeatureFlags> = {
  PREMIUM: { scorm12Export: true, advancedInteractions: true, dataDeletion: false, sso: false },
  ENTERPRISE: { scorm12Export: true, advancedInteractions: true, dataDeletion: true, sso: true },
};
