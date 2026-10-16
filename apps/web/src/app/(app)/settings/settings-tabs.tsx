'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Sparkles, Palette, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { getSession } from '@/lib/auth';
import type { AppUserRole } from '@/lib/api/types';

const ROLE_RANK: Record<AppUserRole, number> = { OWNER: 3, ADMIN: 2, EDITOR: 1, VIEWER: 0 };

interface Tab {
  href: string;
  label: string;
  icon: LucideIcon;
  requiresRole?: AppUserRole;
}

const TABS: Tab[] = [
  { href: '/settings/avatars', label: 'Avatar', icon: Sparkles },
  { href: '/settings/branding', label: 'Branding', icon: Palette },
  { href: '/settings/users', label: 'Utenti', icon: Users, requiresRole: 'ADMIN' },
];

/**
 * Navigazione a tab dell'area Impostazioni (Avatar / Branding / Utenti). Le
 * voci che richiedono un ruolo superiore a quello dell'utente sono nascoste
 * (gating cosmetico; l'enforcement reale è server-side).
 */
export function SettingsTabs() {
  const pathname = usePathname();
  const role = getSession()?.user.role;
  const myRank = ROLE_RANK[(role as AppUserRole) ?? 'VIEWER'] ?? 0;
  const tabs = TABS.filter((t) => !t.requiresRole || myRank >= ROLE_RANK[t.requiresRole]);

  return (
    <div className="mb-6 border-b" role="tablist" aria-label="Sezioni impostazioni">
      <nav className="-mb-px flex gap-1">
        {tabs.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(tab.href + '/');
          return (
            <Link
              key={tab.href}
              href={tab.href}
              role="tab"
              aria-selected={active}
              className={cn(
                'flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                active
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
              )}
            >
              <tab.icon className="size-4" aria-hidden />
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
