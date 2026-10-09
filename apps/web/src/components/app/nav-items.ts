import { BookOpen, Database, LayoutDashboard, Palette, Gauge, ScrollText, Settings, Video, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AppUserRole } from '@/lib/api/types';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Se presente, la voce è mostrata solo a chi ha questo ruolo o superiore. */
  requiresRole?: AppUserRole;
}

/** Voci di navigazione principali dell'area applicativa. */
export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/courses', label: 'Corsi', icon: BookOpen },
  { href: '/knowledge', label: 'Knowledge', icon: Database },
  { href: '/videos', label: 'Video', icon: Video },
  { href: '/brands', label: 'Brand', icon: Palette },
  { href: '/usage', label: 'Utilizzo', icon: Gauge },
  { href: '/audit', label: 'Audit', icon: ScrollText },
  { href: '/settings/branding', label: 'Branding', icon: Settings },
  { href: '/settings/users', label: 'Utenti', icon: Users, requiresRole: 'ADMIN' },
];

/** Gerarchia ruoli per il gating cosmetico della nav. */
export const ROLE_RANK: Record<AppUserRole, number> = { OWNER: 3, ADMIN: 2, EDITOR: 1, VIEWER: 0 };
