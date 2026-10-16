import { CourseDetailClient } from './course-detail-client';

// Export statico (output: 'export'): generiamo UN segnaposto come shell. Gli ID
// reali sono dati a runtime; la navigazione diretta a /courses/<id> è servita
// da CloudFront (fallback alla shell) e il client risolve il corso via API.
export function generateStaticParams() {
  return [{ id: 'placeholder' }];
}

// In PRODUZIONE (export statico) nessun parametro oltre quelli generati: non c'è
// server per renderizzare id arbitrari a build time, ci pensa il client + il
// fallback CDN. In SVILUPPO (`next dev`) invece permettiamo id dinamici, così
// la navigazione diretta a /courses/<id> funziona on-demand (senza 404).
export const dynamicParams = process.env.NODE_ENV !== 'production';

export default function CourseDetailPage() {
  return <CourseDetailClient />;
}
