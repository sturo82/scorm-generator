import { CourseDetailClient } from './course-detail-client';

// Export statico (output: 'export'): generiamo UN segnaposto come shell. Gli ID
// reali sono dati a runtime; la navigazione diretta a /courses/<id> è servita
// da CloudFront (fallback alla shell) e il client risolve il corso via API.
export function generateStaticParams() {
  return [{ id: 'placeholder' }];
}

// Nessun parametro oltre quelli generati: con output:'export' non c'è server per
// renderizzare id arbitrari a build time; ci pensa il client + il fallback CDN.
export const dynamicParams = false;

export default function CourseDetailPage() {
  return <CourseDetailClient />;
}
