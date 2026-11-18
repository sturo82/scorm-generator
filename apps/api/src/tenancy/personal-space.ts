/**
 * Spazio personale: un utente senza company (token senza `custom:tenant_id`) lavora in un tenant di
 * cui è l'unico utente, creato al primo accesso. L'id è derivato dal suo `sub` e non può collidere
 * con gli slug delle company di Manager.
 */
export const PERSONAL_TENANT_PREFIX = 'personal-';

export function personalTenantId(subject: string): string {
  return `${PERSONAL_TENANT_PREFIX}${subject}`;
}

export function isPersonalTenant(tenantId: string): boolean {
  return tenantId.startsWith(PERSONAL_TENANT_PREFIX);
}
