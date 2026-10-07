import { BookOpen, Database, LayoutDashboard, Palette, Gauge, ScrollText, Settings, Video } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
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
];
