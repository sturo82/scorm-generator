import type { UserRole } from '@prisma/client';

/**
 * Vocabolario eco-role d'ecosistema (fonte: Manager, claim `custom:eco_role`).
 * Stabile e versionato: OWNER | ADMIN | MEMBER | VIEWER (vedi doc d'ecosistema).
 */
export type EcoRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

/**
 * Mapping eco-role → ruolo interno di K Scorm. Il mapping lo esegue SEMPRE il
 * prodotto (disaccoppiamento da Manager). I ruoli interni di K Scorm sono
 * OWNER | ADMIN | EDITOR | VIEWER (enum Prisma UserRole).
 */
const ECO_ROLE_MAP: Record<EcoRole, UserRole> = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MEMBER: 'EDITOR',
  VIEWER: 'VIEWER',
};

/** Default sicuro (minimo privilegio) se il claim manca o è sconosciuto. */
export const DEFAULT_INTERNAL_ROLE: UserRole = 'VIEWER';

/**
 * Mappa un eco-role (dal token) sul ruolo interno di K Scorm. Accetta anche
 * ruoli interni già espliciti (OWNER/ADMIN/EDITOR/VIEWER) per retro-compatibilità
 * col vecchio claim `custom:role`. Case-insensitive. Default: VIEWER.
 */
export function mapEcoRoleToInternal(ecoRole: string | undefined): UserRole {
  if (!ecoRole) return DEFAULT_INTERNAL_ROLE;
  const upper = ecoRole.toUpperCase();
  if (upper in ECO_ROLE_MAP) {
    return ECO_ROLE_MAP[upper as EcoRole];
  }
  // Fallback: il vecchio claim poteva già portare un ruolo interno K Scorm.
  if (upper === 'OWNER' || upper === 'ADMIN' || upper === 'EDITOR' || upper === 'VIEWER') {
    return upper as UserRole;
  }
  return DEFAULT_INTERNAL_ROLE;
}
