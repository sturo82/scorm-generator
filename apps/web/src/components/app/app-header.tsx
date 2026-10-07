'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { SidebarNav } from './sidebar';
import { AppBrand } from './app-brand';
import { getSession, logout, type DevSession } from '@/lib/auth';

/** Header responsive: menu hamburger + drawer su mobile, user menu, theme toggle. */
export function AppHeader() {
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [session, setSession] = React.useState<DevSession | null>(null);
  React.useEffect(() => setSession(getSession()), []);

  const initials = session?.user.displayName
    ? session.user.displayName.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()
    : 'U';

  function handleLogout() {
    logout();
    router.push('/login');
  }

  return (
    <>
      <header className="brand-header sticky top-0 z-30 flex h-16 items-center gap-3 px-4 md:px-6">
        <Button
          variant="ghost"
          size="icon"
          className="text-header-foreground lg:hidden"
          aria-label="Apri menu"
          onClick={() => setDrawerOpen(true)}
        >
          <Menu className="size-5" />
        </Button>

        <div className="lg:hidden">
          <AppBrand iconOnly size={28} />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <div className="flex items-center gap-3 rounded-full border border-white/20 bg-white/10 py-1 pl-3 pr-1 backdrop-blur-sm">
            <div className="hidden text-right sm:block">
              <div className="text-sm font-medium leading-tight text-header-foreground">
                {session?.user.displayName ?? 'Utente'}
              </div>
              <div className="text-xs leading-tight text-header-foreground/70">{session?.tenant.name}</div>
            </div>
            <div className="grid size-8 place-items-center rounded-full bg-white/90 text-xs font-semibold text-primary shadow-sm">
              {initials}
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Esci"
              className="text-header-foreground"
              onClick={handleLogout}
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Drawer mobile */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50 animate-fade-in"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <div className="absolute left-0 top-0 h-full w-72 bg-card shadow-xl">
            <div className="sidebar-logo-area flex h-16 items-center justify-between px-5">
              <AppBrand size={28} className="text-[hsl(var(--header-foreground))]" />
              <Button variant="ghost" size="icon" aria-label="Chiudi menu" className="text-[hsl(var(--header-foreground))]" onClick={() => setDrawerOpen(false)}>
                <X className="size-5" />
              </Button>
            </div>
            <div aria-hidden className="h-px bg-gradient-to-r from-primary/30 via-primary/15 to-transparent" />
            <SidebarNav onNavigate={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
