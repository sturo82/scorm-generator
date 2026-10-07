'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { getSession } from '@/lib/auth';

/**
 * Guard client-side dell'area applicativa: senza sessione dev reindirizza al
 * login. Evita il flash di contenuto protetto mostrando null finché non è
 * verificata la sessione.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    if (!getSession()) router.replace('/login');
    else setReady(true);
  }, [router]);

  if (!ready) return null;
  return <>{children}</>;
}
