'use client';

import * as React from 'react';

/**
 * Estrae l'id reale di una route dinamica dall'URL del browser.
 *
 * Con l'export statico di Next.js (output: 'export') le route /courses/[id] e
 * /brands/[id] sono generate come un unico shell "placeholder" e il CDN lo serve
 * per qualsiasi id. In quel contesto `useParams()` restituisce il parametro di
 * BUILD ("placeholder"), non il segmento reale dell'URL. Leggiamo quindi l'id
 * direttamente da `location.pathname`.
 *
 * @param segment il segmento precedente all'id, es. "courses" o "brands".
 * @returns l'id dall'URL, oppure stringa vuota prima dell'idratazione.
 */
export function useDynamicRouteId(segment: string): string {
  const [id, setId] = React.useState('');

  React.useEffect(() => {
    const read = () => {
      // pathname es.: /courses/<id> oppure /courses/<id>/ (trailingSlash).
      const parts = window.location.pathname.split('/').filter(Boolean);
      const i = parts.indexOf(segment);
      const next = i >= 0 && parts[i + 1] ? decodeURIComponent(parts[i + 1]) : '';
      setId((prev) => (prev === next ? prev : next));
    };
    read();
    // La navigazione client-side può cambiare l'URL senza remount del componente.
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, [segment]);

  return id;
}
