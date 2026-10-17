/*
 * default-feeds.ts — Catalogo ampio di feed RSS/Atom predefiniti, condiviso tra
 * backend e frontend. L'utente NON sceglie i singoli feed: indica un ARGOMENTO
 * e il sistema cerca notizie pertinenti su questi feed (più eventuali feed
 * personalizzati del tenant). La CATEGORIA restringe la ricerca a un'area
 * tematica: è il meccanismo che tiene veloce e pertinente l'import anche con un
 * catalogo grande (si interrogano solo i feed della categoria scelta).
 *
 * Criteri di selezione: fonti pubbliche, note e con feed storicamente stabili,
 * bilanciate tra Italia e mondo e tra testate generaliste e verticali. Alcuni
 * feed espongono solo un sommario: il full-text viene recuperato via scraping
 * (Readability) a valle del pre-filtro semantico, solo per i candidati scelti.
 *
 * NB: un feed che cambia URL o smette di rispondere viene semplicemente SALTATO
 * durante l'import, senza bloccare gli altri — il catalogo è ridondante apposta.
 */

/** Categoria tematica dei feed (per restringere e velocizzare la ricerca). */
export type FeedCategory =
  | 'italia'
  | 'mondo'
  | 'economia'
  | 'tech'
  | 'sicurezza'
  | 'scienza'
  | 'salute'
  | 'ambiente'
  | 'cultura'
  | 'sport'
  | 'politica';

export const FEED_CATEGORY_LABEL: Record<FeedCategory, string> = {
  italia: 'Italia — attualità',
  mondo: 'Mondo — internazionali',
  economia: 'Economia e finanza',
  tech: 'Tech, AI e sviluppo',
  sicurezza: 'Cybersecurity',
  scienza: 'Scienza e ricerca',
  salute: 'Salute e medicina',
  ambiente: 'Ambiente e clima',
  cultura: 'Cultura e media',
  sport: 'Sport',
  politica: 'Politica e mondo',
};

export interface DefaultFeed {
  name: string;
  url: string;
  category: FeedCategory;
  /** Lingua prevalente del feed (per eventuali filtri/ordinamenti futuri). */
  lang: 'it' | 'en';
}

/**
 * Catalogo dei feed predefiniti. Ordinato per categoria. Mantienilo curato.
 */
export const DEFAULT_FEEDS: readonly DefaultFeed[] = [
  // ======================= ITALIA — attualità =======================
  { name: "ANSA — Ultim'ora", url: 'https://www.ansa.it/sito/ansait_rss.xml', category: 'italia', lang: 'it' },
  { name: 'ANSA — Top News', url: 'https://www.ansa.it/sito/notizie/topnews/topnews_rss.xml', category: 'italia', lang: 'it' },
  { name: 'ANSA — Cronaca', url: 'https://www.ansa.it/sito/notizie/cronaca/cronaca_rss.xml', category: 'italia', lang: 'it' },
  { name: 'la Repubblica', url: 'https://www.repubblica.it/rss/homepage/rss2.0.xml', category: 'italia', lang: 'it' },
  { name: 'Corriere della Sera', url: 'https://xml2.corriereobjects.it/rss/homepage.xml', category: 'italia', lang: 'it' },
  { name: 'Rai News', url: 'https://www.rainews.it/rss/tutti', category: 'italia', lang: 'it' },
  { name: 'Open', url: 'https://www.open.online/feed/', category: 'italia', lang: 'it' },

  // ======================= MONDO — internazionali =======================
  { name: 'BBC News — World', url: 'http://feeds.bbci.co.uk/news/world/rss.xml', category: 'mondo', lang: 'en' },
  { name: 'The Guardian — World', url: 'https://www.theguardian.com/world/rss', category: 'mondo', lang: 'en' },
  { name: 'NPR — News', url: 'https://feeds.npr.org/1001/rss.xml', category: 'mondo', lang: 'en' },
  { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', category: 'mondo', lang: 'en' },
  { name: 'Deutsche Welle', url: 'https://rss.dw.com/rdf/rss-en-all', category: 'mondo', lang: 'en' },
  { name: 'France 24', url: 'https://www.france24.com/en/rss', category: 'mondo', lang: 'en' },
  { name: 'ANSA — Mondo', url: 'https://www.ansa.it/sito/notizie/mondo/mondo_rss.xml', category: 'mondo', lang: 'it' },

  // ======================= ECONOMIA e finanza =======================
  { name: 'Il Sole 24 Ore — Attualità', url: 'https://www.ilsole24ore.com/rss/italia--attualita.xml', category: 'economia', lang: 'it' },
  { name: 'ANSA — Economia', url: 'https://www.ansa.it/sito/notizie/economia/economia_rss.xml', category: 'economia', lang: 'it' },
  { name: 'The Guardian — Business', url: 'https://www.theguardian.com/business/rss', category: 'economia', lang: 'en' },
  { name: 'BBC — Business', url: 'http://feeds.bbci.co.uk/news/business/rss.xml', category: 'economia', lang: 'en' },
  { name: 'CNBC — Top News', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', category: 'economia', lang: 'en' },
  { name: 'MarketWatch — Top Stories', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', category: 'economia', lang: 'en' },

  // ======================= TECH, AI e sviluppo =======================
  { name: 'Wired Italia', url: 'https://www.wired.it/feed/rss', category: 'tech', lang: 'it' },
  { name: 'ANSA — Tecnologia', url: 'https://www.ansa.it/sito/notizie/tecnologia/tecnologia_rss.xml', category: 'tech', lang: 'it' },
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', category: 'tech', lang: 'en' },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', category: 'tech', lang: 'en' },
  { name: 'Ars Technica', url: 'https://arstechnica.com/feed/', category: 'tech', lang: 'en' },
  { name: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/', category: 'tech', lang: 'en' },
  { name: 'Hacker News (front page)', url: 'https://news.ycombinator.com/rss', category: 'tech', lang: 'en' },
  { name: 'Wired (US)', url: 'https://www.wired.com/feed/rss', category: 'tech', lang: 'en' },
  { name: 'Engadget', url: 'https://www.engadget.com/rss.xml', category: 'tech', lang: 'en' },
  { name: 'ZDNet', url: 'https://www.zdnet.com/news/rss.xml', category: 'tech', lang: 'en' },

  // ======================= CYBERSECURITY =======================
  { name: 'Proofpoint', url: 'https://www.proofpoint.com/us/rss.xml', category: 'sicurezza', lang: 'en' },
  { name: 'Krebs on Security', url: 'https://krebsonsecurity.com/feed/', category: 'sicurezza', lang: 'en' },
  { name: 'The Hacker News', url: 'https://feeds.feedburner.com/TheHackersNews', category: 'sicurezza', lang: 'en' },
  { name: 'BleepingComputer', url: 'https://www.bleepingcomputer.com/feed/', category: 'sicurezza', lang: 'en' },
  { name: 'Schneier on Security', url: 'https://www.schneier.com/feed/atom/', category: 'sicurezza', lang: 'en' },
  { name: 'Google Project Zero', url: 'https://googleprojectzero.blogspot.com/feeds/posts/default', category: 'sicurezza', lang: 'en' },

  // ======================= SCIENZA e ricerca =======================
  { name: 'Focus', url: 'https://www.focus.it/rss', category: 'scienza', lang: 'it' },
  { name: 'Galileo', url: 'https://www.galileonet.it/feed/', category: 'scienza', lang: 'it' },
  { name: 'Nature — News', url: 'https://www.nature.com/nature.rss', category: 'scienza', lang: 'en' },
  { name: 'Science Daily — Top', url: 'https://www.sciencedaily.com/rss/top/science.xml', category: 'scienza', lang: 'en' },
  { name: 'New Scientist', url: 'https://www.newscientist.com/feed/home/', category: 'scienza', lang: 'en' },
  { name: 'Phys.org', url: 'https://phys.org/rss-feed/', category: 'scienza', lang: 'en' },
  { name: 'Quanta Magazine', url: 'https://www.quantamagazine.org/feed/', category: 'scienza', lang: 'en' },

  // ======================= SALUTE e medicina =======================
  { name: 'The Guardian — Health', url: 'https://www.theguardian.com/society/health/rss', category: 'salute', lang: 'en' },
  { name: 'ScienceDaily — Health', url: 'https://www.sciencedaily.com/rss/top/health.xml', category: 'salute', lang: 'en' },
  { name: 'STAT News', url: 'https://www.statnews.com/feed/', category: 'salute', lang: 'en' },
  { name: 'Medical Xpress', url: 'https://medicalxpress.com/rss-feed/', category: 'salute', lang: 'en' },
  { name: 'Medscape', url: 'https://www.medscape.com/cx/rssfeeds/2700.xml', category: 'salute', lang: 'en' },

  // ======================= AMBIENTE e clima =======================
  { name: 'The Guardian — Environment', url: 'https://www.theguardian.com/environment/rss', category: 'ambiente', lang: 'en' },
  { name: 'ANSA — Ambiente & Energia', url: 'https://www.ansa.it/canale_ambiente/notizie/ambiente_rss.xml', category: 'ambiente', lang: 'it' },
  { name: 'Yale e360', url: 'https://e360.yale.edu/feed.xml', category: 'ambiente', lang: 'en' },
  { name: 'Inside Climate News', url: 'https://insideclimatenews.org/feed/', category: 'ambiente', lang: 'en' },
  { name: 'Grist', url: 'https://grist.org/feed/', category: 'ambiente', lang: 'en' },

  // ======================= CULTURA e media =======================
  { name: 'ANSA — Cultura', url: 'https://www.ansa.it/sito/notizie/cultura/cultura_rss.xml', category: 'cultura', lang: 'it' },
  { name: 'The Guardian — Culture', url: 'https://www.theguardian.com/culture/rss', category: 'cultura', lang: 'en' },
  { name: 'BBC — Entertainment & Arts', url: 'http://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml', category: 'cultura', lang: 'en' },
  { name: 'NPR — Arts', url: 'https://feeds.npr.org/1008/rss.xml', category: 'cultura', lang: 'en' },

  // ======================= SPORT =======================
  { name: 'ANSA — Sport', url: 'https://www.ansa.it/sito/notizie/sport/sport_rss.xml', category: 'sport', lang: 'it' },
  { name: 'ANSA — Calcio', url: 'https://www.ansa.it/sito/notizie/sport/calcio/calcio_rss.xml', category: 'sport', lang: 'it' },
  { name: 'BBC — Sport', url: 'https://feeds.bbci.co.uk/sport/rss.xml', category: 'sport', lang: 'en' },
  { name: 'The Guardian — Sport', url: 'https://www.theguardian.com/sport/rss', category: 'sport', lang: 'en' },
  { name: 'ESPN — Top', url: 'https://www.espn.com/espn/rss/news', category: 'sport', lang: 'en' },

  // ======================= POLITICA e mondo =======================
  { name: 'ANSA — Politica', url: 'https://www.ansa.it/sito/notizie/politica/politica_rss.xml', category: 'politica', lang: 'it' },
  { name: 'The Guardian — US Politics', url: 'https://www.theguardian.com/us-news/us-politics/rss', category: 'politica', lang: 'en' },
  { name: 'BBC — Politics', url: 'http://feeds.bbci.co.uk/news/politics/rss.xml', category: 'politica', lang: 'en' },
  { name: 'Politico — Politics', url: 'https://rss.politico.com/politics-news.xml', category: 'politica', lang: 'en' },
  { name: 'Politico Europe', url: 'https://www.politico.eu/feed/', category: 'politica', lang: 'en' },
];

/** Restituisce i feed di una categoria, o tutti se categoria assente. */
export function defaultFeedsForCategory(category?: FeedCategory): DefaultFeed[] {
  if (!category) return [...DEFAULT_FEEDS];
  return DEFAULT_FEEDS.filter((f) => f.category === category);
}

/** Tutte le categorie disponibili (per la UI), nell'ordine di presentazione. */
export const FEED_CATEGORIES: FeedCategory[] = [
  'italia',
  'mondo',
  'economia',
  'politica',
  'tech',
  'sicurezza',
  'scienza',
  'salute',
  'ambiente',
  'cultura',
  'sport',
];
