import { AuthGuard } from '@/components/app/auth-guard';
import { BrandingProvider } from '@/components/app/branding-provider';
import { DesktopSidebar } from '@/components/app/sidebar';
import { AppHeader } from '@/components/app/app-header';

/** Layout dell'area applicativa autenticata: sidebar desktop + header + contenuto. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <BrandingProvider>
        <div className="flex min-h-dvh">
          <DesktopSidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <AppHeader />
            <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
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
