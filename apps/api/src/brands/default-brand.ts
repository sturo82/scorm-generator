import type { PrismaClient } from '@prisma/client';

/** Brand predefinito di sistema: i colori K Scorm, creato quando un tenant non ha ancora un brand. */
export const SYSTEM_DEFAULT_BRAND = {
  name: 'Brand predefinito',
  assets: { logoPrimaryUrl: '' },
  colors: {
    primary: '#1F9D66',
    onPrimary: '#FFFFFF',
    secondary: '#0EA5E9',
    surface: '#FFFFFF',
    onSurface: '#111827',
    success: '#16A34A',
    warning: '#D97706',
    error: '#DC2626',
  },
  typography: { fontFamilyHeading: 'Inter', fontFamilyBody: 'Inter' },
  voice: { tone: 'chiaro, professionale e cordiale' },
} as const;

type Db = Pick<PrismaClient, 'tenant' | 'brand'>;

/**
 * Brand predefinito del tenant. Se manca si usa il primo brand esistente; se il tenant non ne ha
 * nessuno si crea il brand di sistema. Così ogni corso ha sempre un tema, anche senza configurare
 * nulla, e l'export non si blocca per la mancanza di un brand.
 */
export async function ensureDefaultBrandId(db: Db, tenantId: string): Promise<string> {
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { defaultBrandId: true } });
  if (t?.defaultBrandId) return t.defaultBrandId;
  const first = await db.brand.findFirst({ where: { tenantId }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  let id = first?.id;
  if (!id) {
    const created = await db.brand
      .create({ data: { tenantId, name: SYSTEM_DEFAULT_BRAND.name, definition: SYSTEM_DEFAULT_BRAND as unknown as object } })
      .catch(async () => db.brand.findFirst({ where: { tenantId, name: SYSTEM_DEFAULT_BRAND.name }, select: { id: true } }));
    id = created?.id;
  }
  if (!id) throw new Error('Brand predefinito non disponibile');
  await db.tenant.updateMany({ where: { id: tenantId, defaultBrandId: null }, data: { defaultBrandId: id } });
  const now = await db.tenant.findUnique({ where: { id: tenantId }, select: { defaultBrandId: true } });
  return now?.defaultBrandId ?? id;
}
