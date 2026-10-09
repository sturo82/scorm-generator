'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { NAV_ITEMS, ROLE_RANK } from './nav-items';
import { AppBrand } from './app-brand';
import { getSession } from '@/lib/auth';
import type { AppUserRole } from '@/lib/api/types';

/** Contenuto della navigazione, condiviso tra sidebar desktop e drawer mobile. */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  // Gating cosmetico: nasconde le voci che richiedono un ruolo superiore a
  // quello dell'utente corrente. L'enforcement reale è server-side.
  const roleStr = getSession()?.user.role;
  const myRank = ROLE_RANK[(roleStr as AppUserRole) ?? 'VIEWER'] ?? 0;
  const items = NAV_ITEMS.filter((it) => !it.requiresRole || myRank >= ROLE_RANK[it.requiresRole]);
  return (
    <nav className="flex flex-col gap-0.5 px-3 py-4" aria-label="Navigazione principale">
      {items.map((item, i) => {
        const active = pathname === item.href || pathname.startsWith(item.href + '/');
        return (
          <div key={item.href}>
            {/* Separatore sottile brand tra i gruppi di voci (ogni 3 voci). */}
            {i > 0 && i % 3 === 0 && (
              <div
                aria-hidden
                className="mx-3 my-2 h-px bg-gradient-to-r from-primary/20 via-primary/10 to-transparent"
              />
            )}
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
                active
                  ? 'bg-sidebar-accent text-accent-foreground shadow-card'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )}
            >
              {/* Indicatore attivo: barretta colorata a sinistra. */}
              <span
                aria-hidden
                className={cn(
                  'absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary transition-opacity',
                  active ? 'opacity-100' : 'opacity-0',
                )}
              />
              <span
                className={cn(
                  'grid size-7 place-items-center rounded-md transition-colors',
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground group-hover:bg-accent group-hover:text-foreground',
                )}
              >
                <item.icon className="size-4" />
              </span>
              {item.label}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}

/** Sidebar fissa su desktop (nascosta su mobile): premium, con header brandizzato. */
export function DesktopSidebar() {
  return (
    <aside className="hidden w-64 shrink-0 lg:flex lg:flex-col sidebar-premium">
      {/* Logo area: stesso sfondo dell'header (gradiente brand scuro) →
          lega visivamente sidebar e barra superiore come un unico blocco. */}
      <div className="sidebar-logo-area flex h-16 items-center px-5">
        <AppBrand className="text-[hsl(var(--header-foreground))]" />
      </div>
      {/* Separatore brandizzato sotto il logo. */}
      <div
        aria-hidden
        className="h-px bg-gradient-to-r from-primary/30 via-primary/15 to-transparent"
      />
      <div className="flex-1 overflow-y-auto">
        <SidebarNav />
      </div>
      {/* Piede sidebar con bordino brandizzato */}
      <div aria-hidden className="h-px bg-gradient-to-r from-primary/20 via-primary/10 to-transparent" />
      <div className="px-5 py-3">
        <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground/50">
          Piattaforma e-learning
        </p>
      </div>
    </aside>
  );
}
