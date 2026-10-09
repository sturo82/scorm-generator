import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { QueryProvider } from '@/lib/query-provider';
import { ToastProvider } from '@/components/ui/toast';

export const metadata: Metadata = {
  title: 'SCORM Course Generator',
  description:
    'Genera corsi e-learning SCORM professionali con AI, knowledge base e branding multiplo.',
};

// App autenticata e interamente client-side (dati via API a runtime): niente da
// pre-renderizzare staticamente. Forziamo il rendering dinamico così il build di
// produzione non prova la SSG delle pagine, che usewrappano provider client
// (Theme/Query/Toast) e fallirebbe in fase di prerender.
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <QueryProvider>
            <ToastProvider>{children}</ToastProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
