import Parser from 'rss-parser';
import { JSDOM, VirtualConsole } from 'jsdom';
import { Readability } from '@mozilla/readability';
import {
  type FeedProvider,
  type FeedResult,
  type FeedItem,
  type FeedListItem,
  type FetchedArticle,
  type FetchFeedOptions,
  type WikipediaArticle,
  ProviderUnavailableError,
} from '@scorm/domain';
import { assertSafeUrl, BlockedUrlError } from './ssrf-guard.js';

export interface RssFeedProviderOptions {
  /** Timeout per richiesta (ms). Default 15s. */
  timeoutMs?: number;
  /** Dimensione massima scaricabile per risorsa (byte). Default 5MB. */
  maxBytes?: number;
  /** User-Agent inviato nelle richieste. */
  userAgent?: string;
  /** fetch iniettabile (per i test). Default: global fetch (Node 20+). */
  fetchImpl?: typeof fetch;
  /** Risolutore DNS iniettabile (per i test dell'anti-SSRF). */
  dnsResolver?: (host: string) => Promise<string[]>;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_UA = 'KScormBot/1.0 (+https://knowkube.com)';

/**
 * Adapter FeedProvider basato su rss-parser per il parsing di RSS/Atom e su
 * Mozilla Readability (su JSDOM) per lo scraping del testo integrale degli
 * articoli. Ogni richiesta di rete passa per i controlli anti-SSRF
 * (assertSafeUrl) ed è vincolata da timeout e limite di dimensione.
 */
export class RssFeedProvider implements FeedProvider {
  readonly id = 'rss';
  private readonly parser: Parser;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly dnsResolver?: (host: string) => Promise<string[]>;

  constructor(opts: RssFeedProviderOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    this.userAgent = opts.userAgent ?? DEFAULT_UA;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.dnsResolver = opts.dnsResolver;
    this.parser = new Parser({ timeout: this.timeoutMs });
  }

  async fetchFeed(url: string, opts: FetchFeedOptions = {}): Promise<FeedResult> {
    const maxItems = Math.max(1, Math.min(opts.maxItems ?? 10, 50));

    // 1. Valida l'URL del feed (anti-SSRF) e scarica l'XML.
    let xml: string;
    try {
      const safe = await this.safeUrl(url);
      xml = await this.download(safe.toString());
    } catch (err) {
      if (err instanceof BlockedUrlError) {
        throw new ProviderUnavailableError('rss', new Error(`URL del feed non consentito: ${err.message}`));
      }
      throw new ProviderUnavailableError('rss', err);
    }

    // 2. Parsa il feed.
    let parsed: Parser.Output<Record<string, unknown>>;
    try {
      parsed = await this.parser.parseString(xml);
    } catch (err) {
      throw new ProviderUnavailableError('rss', new Error('Feed non valido o non parsabile'));
    }

    // 3. Ordina per data (più recenti prima) e prendi i primi maxItems.
    const sorted = [...(parsed.items ?? [])].sort((a, b) => dateMs(b.isoDate) - dateMs(a.isoDate));
    const picked = sorted.slice(0, maxItems);

    // 4. Costruisci gli item; se richiesto, prova lo scraping full-text.
    const items: FeedItem[] = [];
    for (const it of picked) {
      const title = (it.title ?? '').trim() || 'Articolo senza titolo';
      const link = typeof it.link === 'string' ? it.link : undefined;
      const feedHtml = pickFeedHtml(it);
      const feedText = htmlToPlainText(feedHtml) || (it.contentSnippet ?? '').trim();

      let content = feedText;
      let contentHtml = feedHtml;
      let fullText = false;

      if (opts.fullText && link) {
        const scraped = await this.scrapeArticle(link).catch(() => null);
        if (scraped && scraped.text.length > feedText.length) {
          content = scraped.text;
          contentHtml = scraped.html;
          fullText = true;
        }
      }

      items.push({
        title,
        link,
        content,
        contentHtml,
        isoDate: it.isoDate,
        fullText,
      });
    }

    return { feedTitle: parsed.title, feedUrl: url, items };
  }

  async listItems(url: string, opts: { maxItems?: number } = {}): Promise<{ feedTitle?: string; items: FeedListItem[] }> {
    const maxItems = Math.max(1, Math.min(opts.maxItems ?? 30, 100));
    let xml: string;
    try {
      const safe = await this.safeUrl(url);
      xml = await this.download(safe.toString());
    } catch (err) {
      if (err instanceof BlockedUrlError) {
        throw new ProviderUnavailableError('rss', new Error(`URL del feed non consentito: ${err.message}`));
      }
      throw new ProviderUnavailableError('rss', err);
    }
    let parsed: Parser.Output<Record<string, unknown>>;
    try {
      parsed = await this.parser.parseString(xml);
    } catch {
      throw new ProviderUnavailableError('rss', new Error('Feed non valido o non parsabile'));
    }
    const sorted = [...(parsed.items ?? [])].sort((a, b) => dateMs(b.isoDate) - dateMs(a.isoDate));
    const items: FeedListItem[] = sorted.slice(0, maxItems).map((it) => ({
      title: (it.title ?? '').trim() || 'Articolo senza titolo',
      link: typeof it.link === 'string' ? it.link : undefined,
      summary: (htmlToPlainText(pickFeedHtml(it)) || (it.contentSnippet ?? '').trim()).slice(0, 2000),
      isoDate: it.isoDate,
      source: parsed.title,
    }));
    return { feedTitle: parsed.title, items };
  }

  async searchGoogleNews(query: string, opts: { lang?: 'it' | 'en'; maxItems?: number } = {}): Promise<FeedListItem[]> {
    const q = query.trim();
    if (!q) return [];
    const lang = opts.lang ?? 'it';
    const maxItems = Math.max(1, Math.min(opts.maxItems ?? 15, 50));
    // Parametri lingua/paese di Google News.
    const [hl, gl, ceid] = lang === 'en' ? ['en-US', 'US', 'US:en'] : ['it', 'IT', 'IT:it'];
    const url =
      `https://news.google.com/rss/search?q=${encodeURIComponent(q)}` +
      `&hl=${hl}&gl=${gl}&ceid=${ceid}`;
    let xml: string;
    try {
      // Host fisso e fidato (news.google.com): salta l'anti-SSRF (serve per gli
      // URL forniti dall'utente, non per un endpoint nostro noto).
      xml = await this.download(url);
    } catch {
      return []; // Google News non raggiungibile: nessun candidato da qui.
    }
    let parsed: Parser.Output<Record<string, unknown>>;
    try {
      parsed = await this.parser.parseString(xml);
    } catch {
      return [];
    }
    const sorted = [...(parsed.items ?? [])].sort((a, b) => dateMs(b.isoDate) - dateMs(a.isoDate));
    return sorted.slice(0, maxItems).map((it) => {
      // Il titolo Google News è "Titolo - Testata": separiamo la fonte.
      const rawTitle = (it.title ?? '').trim();
      const sepIdx = rawTitle.lastIndexOf(' - ');
      const title = sepIdx > 0 ? rawTitle.slice(0, sepIdx).trim() : rawTitle || 'Articolo senza titolo';
      const sourceFromTitle = sepIdx > 0 ? rawTitle.slice(sepIdx + 3).trim() : undefined;
      // Il sommario è HTML con un link offuscato: ne teniamo solo il testo.
      const summary = (htmlToPlainText(pickFeedHtml(it)) || (it.contentSnippet ?? '').trim()).slice(0, 2000);
      return {
        title,
        // link Google News (redirect non risolvibile): lo lasciamo come
        // riferimento, ma NON tentiamo lo scraping full-text su di esso.
        link: typeof it.link === 'string' ? it.link : undefined,
        summary,
        isoDate: it.isoDate,
        source: sourceFromTitle || (it as { source?: { title?: string } }).source?.title || 'Google News',
      } satisfies FeedListItem;
    });
  }

  async searchWikipedia(query: string, opts: { lang?: 'it' | 'en'; max?: number } = {}): Promise<WikipediaArticle[]> {
    const q = query.trim();
    if (!q) return [];
    const lang = opts.lang === 'en' ? 'en' : 'it';
    const max = Math.max(1, Math.min(opts.max ?? 3, 5));
    const base = `https://${lang}.wikipedia.org/w/api.php`;
    try {
      // 1. Ricerca delle voci pertinenti.
      const searchUrl =
        `${base}?action=query&list=search&srsearch=${encodeURIComponent(q)}` +
        `&srlimit=${max}&format=json&origin=*`;
      const searchJson = JSON.parse(await this.download(searchUrl)) as {
        query?: { search?: Array<{ title?: string }> };
      };
      const titles = (searchJson.query?.search ?? [])
        .map((s) => s.title)
        .filter((t): t is string => !!t);
      if (titles.length === 0) return [];

      // 2. Estratti (introduzione) + URL delle voci trovate.
      const extractUrl =
        `${base}?action=query&prop=extracts|info&inprop=url&exintro=1&explaintext=1` +
        `&titles=${encodeURIComponent(titles.join('|'))}&format=json&origin=*`;
      const extractJson = JSON.parse(await this.download(extractUrl)) as {
        query?: { pages?: Record<string, { title?: string; extract?: string; fullurl?: string }> };
      };
      const pages = extractJson.query?.pages ?? {};
      const out: WikipediaArticle[] = [];
      for (const key of Object.keys(pages)) {
        const p = pages[key]!;
        const extract = (p.extract ?? '').trim();
        if (p.title && extract.length > 80) {
          out.push({
            title: p.title,
            extract,
            url: p.fullurl ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title)}`,
          });
        }
      }
      return out;
    } catch {
      return []; // Wikipedia non raggiungibile: nessun contesto da qui.
    }
  }

  async fetchArticle(url: string): Promise<FetchedArticle> {
    try {
      const scraped = await this.scrapeArticle(url);
      return { text: scraped.text, html: scraped.html, title: scraped.title };
    } catch (err) {
      if (err instanceof BlockedUrlError) {
        throw new ProviderUnavailableError('rss', new Error(`URL articolo non consentito: ${err.message}`));
      }
      throw new ProviderUnavailableError('rss', err);
    }
  }

  /** Scarica la pagina dell'articolo ed estrae il testo leggibile (Readability). */
  private async scrapeArticle(link: string): Promise<{ text: string; html: string; title?: string }> {
    const safe = await this.safeUrl(link);
    const html = await this.download(safe.toString());
    // VirtualConsole "muto": le pagine reali hanno CSS/JS che jsdom non riesce a
    // parsare ("Could not parse CSS stylesheet"); per l'estrazione del TESTO con
    // Readability non ci interessa, quindi sopprimiamo gli errori jsdom invece di
    // farli emergere. Niente esecuzione di script o fetch di sotto-risorse.
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', () => undefined);
    const dom = new JSDOM(html, { url: safe.toString(), virtualConsole });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    if (!article) throw new Error('Articolo non estraibile');
    const text = (article.textContent ?? '').replace(/\s+\n/g, '\n').trim();
    const contentHtml = article.content ?? '';
    return { text, html: contentHtml, title: article.title ?? undefined };
  }

  private safeUrl(url: string): Promise<URL> {
    return this.dnsResolver ? assertSafeUrl(url, this.dnsResolver) : assertSafeUrl(url);
  }

  /** GET con timeout, limite dimensione e User-Agent; ritorna il corpo come stringa. */
  private async download(url: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': this.userAgent, Accept: 'application/rss+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Limita la dimensione leggendo lo stream con un tetto.
      const buf = await this.readCapped(res);
      return buf.toString('utf8');
    } finally {
      clearTimeout(timer);
    }
  }

  /** Legge il corpo della risposta fino a maxBytes, abortendo se eccede. */
  private async readCapped(res: Response): Promise<Buffer> {
    const reader = res.body?.getReader();
    if (!reader) {
      const ab = await res.arrayBuffer();
      if (ab.byteLength > this.maxBytes) throw new Error('Risorsa troppo grande');
      return Buffer.from(ab);
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > this.maxBytes) {
          await reader.cancel();
          throw new Error('Risorsa troppo grande');
        }
        chunks.push(value);
      }
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c)));
  }
}

/** Millisecondi dall'epoch per una data ISO; 0 se assente/non valida. */
function dateMs(iso?: string): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** Sceglie il miglior HTML disponibile per un item di feed (content vari). */
function pickFeedHtml(it: Record<string, unknown> & { content?: string }): string {
  // rss-parser popola `content` (RSS description/content:encoded) e a volte
  // `content:encoded`. Prendiamo il più ricco disponibile.
  const encoded = (it as Record<string, unknown>)['content:encoded'];
  if (typeof encoded === 'string' && encoded.trim()) return encoded;
  if (typeof it.content === 'string' && it.content.trim()) return it.content;
  return '';
}

/** Riduce HTML a testo piano leggibile (rimuove i tag, normalizza spazi). */
function htmlToPlainText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
