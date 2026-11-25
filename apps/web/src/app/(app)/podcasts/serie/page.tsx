import { PodcastDetail } from '@/components/podcasts/podcast-detail';

// L'id della serie arriva dall'indirizzo (?id=…) e si legge nel browser: nessuna route dinamica,
// così la pagina funziona con l'export statico senza regole aggiuntive sulla CDN.
export default function PodcastSeriesPage() {
  return <PodcastDetail />;
}
