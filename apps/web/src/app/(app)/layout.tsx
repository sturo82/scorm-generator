import { AuthGuard } from '@/components/app/auth-guard';
import { BrandingProvider } from '@/components/app/branding-provider';
import { DesktopSidebar } from '@/components/app/sidebar';
import { AppHeader } from '@/components/app/app-header';

/** Layout dell'area applicativa autenticata: sidebar desktop + header + contenuto. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <BrandingProvider>
        {/* Skip-link (WCAG 2.4.1): visibile solo al focus da tastiera, porta
            direttamente al contenuto principale saltando sidebar e header. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground focus:shadow-elevate focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
        >
          Vai al contenuto
        </a>
        <div className="flex min-h-dvh">
          <DesktopSidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <AppHeader />
            <main
              id="main-content"
              tabIndex={-1}
              className="flex-1 overflow-y-auto p-4 outline-none md:p-6 lg:p-8"
            >
              {/* Contenuto ampio: sfrutta la larghezza dello schermo (fino a
                  1760px) riducendo i margini laterali. Le singole pagine che
                  necessitano di una colonna di lettura più stretta la impongono
                  internamente. */}
              <div className="mx-auto w-full max-w-[1760px]">{children}</div>
            </main>
          </div>
        </div>
      </BrandingProvider>
    </AuthGuard>
  );
}
