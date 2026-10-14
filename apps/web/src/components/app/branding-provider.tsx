'use client';

import * as React from 'react';
import { useBranding } from '@/lib/api/hooks';
import { composeDocumentTitle } from '@/lib/app-brand';

/**
 * Applica il sotto-brand del TENANT lato client. Volutamente minimale: il brand
 * della piattaforma (colori, favicon, tema) è FISSO e non viene toccato. L'unico
 * effetto globale è il titolo della scheda del browser, composto come
 * "<nome tenant> · <nome app>" quando il tenant ha un nome visibile proprio.
 *
 * Il logo e il nome del tenant vengono mostrati in un punto contenuto
 * (sidebar/header) dal componente AppBrand, non da qui.
 */
export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const { data } = useBranding();

  React.useEffect(() => {
    document.title = composeDocumentTitle(data?.appName);
  }, [data?.appName]);

  return <>{children}</>;
}
