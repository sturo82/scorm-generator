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

  // Chiusura del drawer con Esc (accessibilità da tastiera).
  React.useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

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
          className="lg:hidden"
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
          <div className="flex items-center gap-3 rounded-full border border-border bg-foreground/5 py-1 pl-3 pr-1">
            <div className="hidden text-right sm:block">
              <div className="text-sm font-medium leading-tight text-foreground">
                {session?.user.displayName ?? 'Utente'}
              </div>
              <div className="text-xs leading-tight text-muted-foreground">{session?.tenant.name}</div>
            </div>
            <div className="grid size-8 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground shadow-sm">
              {initials}
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Esci"
              onClick={handleLogout}
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Drawer mobile */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Menu di navigazione"
        >
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
