'use client';

/**
 * Boundary d'errore globale (App Router). Autosufficiente: rende il proprio
 * <html>/<body> e non dipende dai provider client del root layout. Evita il
 * fallback a `pages/_error` che, nel build standalone, falliva il prerender di
 * /404 e /500 ("useContext of null").
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="it">
      <body
        style={{
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          fontFamily: 'system-ui, sans-serif',
          padding: '1.5rem',
          margin: 0,
        }}
      >
        <div style={{ textAlign: 'center', maxWidth: 420 }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Si è verificato un errore</h1>
          <p style={{ color: '#64748b', marginTop: '0.5rem' }}>
            Riprova. Se il problema persiste, ricarica la pagina.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1rem',
              borderRadius: 8,
              border: 'none',
              background: '#22b573',
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Riprova
          </button>
        </div>
      </body>
    </html>
  );
}
