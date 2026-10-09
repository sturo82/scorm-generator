import Link from 'next/link';

/**
 * Pagina 404 personalizzata e autosufficiente (nessun provider client), così il
 * build di produzione non fallisce il prerender della pagina d'errore di default
 * wrappata dai provider del root layout.
 */
export default function NotFound() {
  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        fontFamily: 'system-ui, sans-serif',
        padding: '1.5rem',
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Pagina non trovata</h1>
        <p style={{ color: '#64748b', marginTop: '0.5rem' }}>
          La pagina che cerchi non esiste o è stata spostata.
        </p>
        <Link href="/dashboard" style={{ color: '#4f46e5', fontWeight: 600 }}>
          Torna alla dashboard
        </Link>
      </div>
    </div>
  );
}
