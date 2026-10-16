/**
 * Porta per il recupero di contenuti da FEED RSS/Atom. Astrae il provider
 * concreto (default: rss-parser + scraping full-text via Readability). Serve a
 * creare corsi a partire dalle notizie: gli articoli recuperati diventano
 * documenti della knowledge base del corso, poi usati dalla generazione (RAG).
 *
 * SICUREZZA: gli URL sono forniti dall'utente → rischio SSRF. L'adapter DEVE
 * accettare solo http/https e rifiutare host privati/loopback/link-local e gli
 * endpoint di metadata cloud, con timeout e limite di dimensione.
 */

/** Un articolo recuperato da un feed. */
export interface FeedItem {
  /** Titolo dell'articolo. */
  title: string;
  /** URL canonico dell'articolo (per lo scraping full-text e la citazione). */
  link?: string;
  /**
   * Contenuto testuale dell'articolo. Se lo scraping full-text riesce è il testo
   * integrale; altrimenti il contenuto/sommario fornito dal feed.
   */
  content: string;
  /** Contenuto in HTML (per l'ingestion come text/html), se disponibile. */
  contentHtml?: string;
  /** Data di pubblicazione in ISO 8601, se nota (per ordinare i più recenti). */
  isoDate?: string;
  /** True se `content` proviene dallo scraping full-text (non solo dal feed). */
  fullText: boolean;
}

/** Esito del recupero di un feed. */
export interface FeedResult {
  /** Titolo del feed (es. "ANSA Ultim'ora"), se esposto. */
  feedTitle?: string;
  /** URL del feed richiesto. */
  feedUrl: string;
  items: FeedItem[];
}

/** Opzioni per il recupero di un feed. */
export interface FetchFeedOptions {
  /** Numero massimo di articoli da restituire (i più recenti). */
  maxItems?: number;
  /**
   * Se true, prova a scaricare la pagina di ogni articolo ed estrarne il testo
   * integrale (Readability). Se false o in caso di errore, usa il contenuto del
   * feed. Operazione di rete aggiuntiva per articolo.
   */
  fullText?: boolean;
}

/** Voce LEGGERA di un feed: metadati + sommario, SENZA scraping full-text. */
export interface FeedListItem {
  title: string;
  link?: string;
  /** Sommario/estratto dal feed (testo piano), per il pre-filtro semantico. */
  summary: string;
  isoDate?: string;
  /** Nome della fonte (titolo del feed), per attribuzione e tie-break. */
  source?: string;
}

/** Voce di Wikipedia con estratto (contesto evergreen). */
export interface WikipediaArticle {
  title: string;
  /** Estratto testuale (introduzione della voce). */
  extract: string;
  /** URL della voce su Wikipedia. */
  url: string;
}

/** Testo integrale di un singolo articolo (scraping Readability). */
export interface FetchedArticle {
  title?: string;
  /** Testo integrale leggibile. */
  text: string;
  /** HTML pulito dell'articolo (per l'ingestion come text/html). */
  html: string;
}

export interface FeedProvider {
  readonly id: string;
  /**
   * Scarica e parsa un feed RSS/Atom, restituendo gli articoli ordinati dal più
   * recente. Applica i controlli anti-SSRF sull'URL del feed (e sui link degli
   * articoli, quando fa lo scraping full-text). Lancia in caso di URL non valido
   * o irraggiungibile.
   */
  fetchFeed(url: string, opts?: FetchFeedOptions): Promise<FeedResult>;
  /**
   * Cerca notizie su GOOGLE NEWS per una query testuale, in una lingua/paese.
   * Google News aggrega centinaia di testate e filtra già per argomento, quindi
   * dà ampiezza e scoperta. NB: i link articolo di Google News sono redirect
   * offuscati non risolvibili in modo affidabile: gli item restituiti hanno il
   * SOMMARIO (niente full-text), e `link` punta alla pagina Google News. Usare
   * per il pre-filtro/scoperta; il testo integrale viene dai feed diretti.
   */
  searchGoogleNews(query: string, opts?: { lang?: 'it' | 'en'; maxItems?: number }): Promise<FeedListItem[]>;
  /**
   * Cerca voci di WIKIPEDIA pertinenti a un argomento e ne restituisce
   * l'estratto (introduzione). Fonte "evergreen" di contesto stabile, utile per
   * fondare il corso oltre alle notizie di cronaca. Usa le API ufficiali
   * MediaWiki; `lang` seleziona l'edizione (it/en). Ritorna articoli con testo
   * già pronto (niente scraping).
   */
  searchWikipedia(query: string, opts?: { lang?: 'it' | 'en'; max?: number }): Promise<WikipediaArticle[]>;
  /**
   * Elenca le voci di un feed in forma LEGGERA (titolo + sommario + link + data),
   * senza scaricare il full-text. Usato per raccogliere molti candidati a basso
   * costo prima del pre-filtro semantico. Ordina dal più recente.
   */
  listItems(url: string, opts?: { maxItems?: number }): Promise<{ feedTitle?: string; items: FeedListItem[] }>;
  /**
   * Scarica la pagina di un singolo articolo ed estrae il testo integrale
   * (Readability). Applica l'anti-SSRF sull'URL. Lancia se non estraibile.
   */
  fetchArticle(url: string): Promise<FetchedArticle>;
}
