import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EmbeddingsProvider, FeedProvider, FeedListItem } from '@scorm/domain';
import { DEFAULT_FEEDS, FEED_CATEGORIES, defaultFeedsForCategory, type FeedCategory } from '@scorm/contracts';
import type { AppConfig } from '../config/configuration.js';
import { CoursesService } from '../courses/courses.service.js';
import { KnowledgeService } from '../knowledge/knowledge.service.js';
import { UsageMeterService } from '../metering/usage-meter.service.js';
import { estimateTokensFromText } from '../metering/token-estimate.js';
import { TenantFeedService } from './tenant-feed.service.js';
import { RssBriefService } from './rss-brief.service.js';
import { EMBEDDINGS_PROVIDER, FEED_PROVIDER } from '../providers/provider.constants.js';

/**
 * Sorgente per la ricerca per argomento:
 *  - 'everywhere' (default): Google News (IT+EN) + feed curati + Wikipedia
 *    (+ i tuoi feed, se presenti). Massima copertura, zero configurazione.
 *  - 'mine': SOLO i feed personalizzati del tenant.
 */
export type FeedSource = 'everywhere' | 'mine';

/** Input per creare un corso a partire da un ARGOMENTO cercato sui feed. */
export interface CreateCourseFromRssInput {
  tenantId: string;
  /** Argomento su cui deve vertere il corso (query semantica). */
  topic: string;
  /** Titolo del corso (se vuoto, derivato dall'argomento). */
  title?: string;
  /** Lingua del corso (es. "it"). */
  language: string;
  /** Da dove prendere i feed: predefiniti, i miei, o entrambi. */
  source: FeedSource;
  /** Categoria dei feed predefiniti (opzionale: restringe la ricerca). */
  category?: FeedCategory;
  /** Pubblico destinatario (opzionale): vincola la bozza di brief. */
  audience?: string;
  /** Tono di voce (opzionale): vincola la bozza di brief. */
  tone?: string;
  /**
   * Anteprima CONGELATA approvata dall'autore. Se presente, è la spina dorsale
   * del corso: titolo/descrizione/concetti/lezioni vengono da qui invece di
   * essere rigenerati, per garantire coerenza con ciò che l'utente ha visto.
   */
  preview?: FrozenPreview;
  /** Numero di articoli pertinenti da includere (dopo filtro e dedup). */
  maxArticles: number;
  correlationId?: string;
}

/** Anteprima congelata passata a "Crea corso" per garantirne la coerenza. */
export interface FrozenPreview {
  proposedTitle?: string;
  description?: string;
  keyConcepts?: string[];
  suggestedLessons?: string[];
  proposedAudience?: string;
  proposedTone?: string;
}

export interface CreateCourseFromRssResult {
  courseId: string;
  /** Numero di articoli (storie distinte) ingeriti come knowledge. */
  importedCount: number;
  /** Numero di candidati esaminati (prima di filtro e dedup). */
  candidatesExamined: number;
  /** Feed non recuperati, con motivo. */
  failedFeeds: Array<{ url: string; reason: string }>;
  /** True se è stata generata una bozza di brief dalla knowledge. */
  briefDrafted: boolean;
}

// --- Parametri di resa (premium) -------------------------------------------
/** Articoli leggeri raccolti per feed prima del pre-filtro. */
const ITEMS_PER_FEED = 15;
/** Tetto di candidati su cui calcolare gli embeddings (controllo costi). */
const MAX_CANDIDATES = 60;
/**
 * Numero massimo di feed interrogati per una singola ricerca. Con un catalogo
 * ampio, interrogarli TUTTI sarebbe lento e costoso: ne interroghiamo al più
 * questo numero. Se la ricerca copre più categorie (nessuna categoria scelta),
 * i feed vengono campionati in modo DIVERSIFICATO tra le categorie, così da non
 * sbilanciare la raccolta su una sola area.
 */
const MAX_FEEDS_QUERIED = 24;
/** Soglia minima di similarità argomento↔articolo per considerarlo pertinente. */
const RELEVANCE_THRESHOLD = 0.28;
/** Soglia di similarità tra articoli oltre cui sono "near-duplicate". */
const NEAR_DUP_THRESHOLD = 0.92;
/** Peso della recenza nel punteggio finale (0 = solo pertinenza). */
const RECENCY_WEIGHT = 0.15;
/** Default/max di articoli finali. */
const DEFAULT_MAX_ARTICLES = 12;
const HARD_MAX_ARTICLES = 25;
/** Candidati usati per l'ANTEPRIMA (pochi: solo per sintetizzare i concetti). */
const PREVIEW_CANDIDATES = 24;

/** Pre-sommario mostrato all'utente prima di generare il corso. */
export interface RssPreviewResult {
  /** Titolo proposto per il corso. */
  proposedTitle: string;
  /** Breve descrizione (1-2 frasi) di cosa tratterà il corso. */
  description: string;
  /** Concetti chiave che il corso svilupperà. */
  keyConcepts: string[];
  /** Lezioni/moduli suggeriti (titoli). */
  suggestedLessons: string[];
  /** Pubblico destinatario (fornito dall'utente o proposto dall'anteprima). */
  proposedAudience: string;
  /** Tono di voce (fornito dall'utente o proposto dall'anteprima). */
  proposedTone: string;
  /** Fonti da cui provengono i contenuti trovati (per trasparenza). */
  sources: string[];
  /** Numero di contenuti esaminati per l'anteprima. */
  examined: number;
}

/** Provenienza di un candidato (determina se e come recuperare il full-text). */
type CandidateKind = 'feed' | 'gnews' | 'wikipedia' | 'oer';

interface Candidate extends FeedListItem {
  kind: CandidateKind;
  /** Testo già pronto (Wikipedia): se presente, non serve scraping. */
  readyText?: string;
  /** Embedding del titolo+sommario (riempito nel pre-filtro). */
  vector?: number[];
  /** Similarità coseno con l'argomento. */
  relevance?: number;
}

/**
 * Crea un corso a partire da un ARGOMENTO: cerca le notizie pertinenti su un
 * ampio set di feed (predefiniti e/o del tenant), seleziona SEMANTICAMENTE gli
 * articoli migliori (embeddings), ELIMINA i duplicati (stessa notizia da fonti
 * diverse), scarica il testo integrale dei soli articoli scelti e li ingerisce
 * come knowledge COURSE-scoped. Infine autocompila una bozza di brief dai
 * contenuti raccolti. Pensato come prodotto premium: niente rumore, niente
 * doppioni, storie distinte.
 */
@Injectable()
export class RssImportService {
  private readonly logger = new Logger(RssImportService.name);

  constructor(
    private readonly courses: CoursesService,
    private readonly knowledge: KnowledgeService,
    private readonly tenantFeeds: TenantFeedService,
    private readonly briefService: RssBriefService,
    private readonly meter: UsageMeterService,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(FEED_PROVIDER) private readonly feeds: FeedProvider,
    @Inject(EMBEDDINGS_PROVIDER) private readonly embeddings: EmbeddingsProvider,
  ) {}

  async createCourseFromRss(input: CreateCourseFromRssInput): Promise<CreateCourseFromRssResult> {
    const topic = input.topic?.trim();
    if (!topic) throw new BadRequestException('Indica un argomento per il corso');
    const maxArticles = Math.max(1, Math.min(Math.trunc(input.maxArticles || 0) || DEFAULT_MAX_ARTICLES, HARD_MAX_ARTICLES));

    // 1-3. Scoperta multi-fonte + dedup esatta (helper condiviso con la preview).
    const { candidates, failedFeeds } = await this.gatherCandidates(input);
    const candidatesExamined = candidates.length;

    // 4. Pre-filtro SEMANTICO: embedda argomento + candidati, calcola pertinenza.
    const topicText = topicQuery(topic, input.language);
    const candTexts = candidates.map((c) => `${c.title}\n${c.summary}`);
    const topicVec = (await this.embeddings.embed([topicText]))[0] ?? [];
    const candVecs = await this.embeddings.embed(candTexts);
    // Metering del consumo embeddings del pre-filtro (argomento + candidati).
    // Best-effort, non blocca. courseId non ancora creato: attribuito al tenant.
    void this.meter.record({
      tenantId: input.tenantId,
      courseId: null,
      provider: 'BEDROCK_EMBEDDINGS',
      model: this.config.get('bedrock', { infer: true }).embeddingsModelId,
      unit: 'INPUT_TOKENS',
      quantity: estimateTokensFromText([topicText, ...candTexts]),
      source: 'rss_prefilter',
    });
    const scored: Candidate[] = candidates.map((c, i) => {
      const vector = candVecs[i] ?? [];
      return { ...c, vector, relevance: cosine(topicVec, vector) };
    });

    // Tieni solo i pertinenti sopra soglia; se troppo pochi, allarga prendendo i
    // migliori comunque (così non resti a mani vuote con argomenti di nicchia).
    let relevant = scored.filter((c) => (c.relevance ?? 0) >= RELEVANCE_THRESHOLD);
    if (relevant.length < Math.min(maxArticles, 5)) {
      relevant = [...scored].sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0)).slice(0, maxArticles * 2);
    }

    // 5. DEDUP near-duplicate: collassa articoli troppo simili tra loro (stessa
    // notizia da testate diverse), tenendo il più pertinente. Greedy su score.
    const ordered = [...relevant].sort((a, b) => finalScore(b) - finalScore(a));
    const chosen: Candidate[] = [];
    for (const cand of ordered) {
      if (chosen.length >= maxArticles) break;
      const isDup = chosen.some((k) => cosine(k.vector ?? [], cand.vector ?? []) >= NEAR_DUP_THRESHOLD);
      if (!isDup) chosen.push(cand);
    }

    if (chosen.length === 0) {
      throw new BadRequestException(
        `Nessun articolo abbastanza pertinente all'argomento "${topic}". Prova un argomento più ampio o altri feed.`,
      );
    }

    // 6. Crea il corso. Se c'è un'anteprima congelata, titolo e descrizione
    // vengono da lì (coerenza con ciò che l'autore ha approvato); altrimenti
    // titolo dall'argomento e descrizione da template.
    const preview = input.preview;
    const title = input.title?.trim() || preview?.proposedTitle?.trim() || titleFromTopic(topic);
    const description =
      preview?.description?.trim() ||
      `Corso sull'argomento "${topic}", generato da ${chosen.length} notizie selezionate dai feed.`;
    const course = await this.courses.create({
      tenantId: input.tenantId,
      title,
      language: input.language,
      description,
    });

    // 7. Scarica il full-text dei SOLI scelti e ingerisci come knowledge COURSE.
    // Raccoglie gli id dei documenti creati: diventeranno la whitelist RAG del
    // brief, così la generazione resta ancorata alle SOLE fonti del corso.
    let imported = 0;
    const knowledgeDocIds: string[] = [];
    for (const item of chosen) {
      try {
        const html = await this.buildArticleHtml(item);
        const doc = await this.knowledge.upload({
          tenantId: input.tenantId,
          scope: 'COURSE',
          courseId: course.id,
          filename: safeFilename(item.title) + '.html',
          mimeType: 'text/html',
          content: Buffer.from(html, 'utf8'),
          correlationId: input.correlationId,
        });
        if (doc?.id) knowledgeDocIds.push(doc.id);
        imported++;
      } catch (err) {
        this.logger.warn(`Articolo non ingerito ("${item.title}"): ${rawError(err)}`);
      }
    }

    if (imported === 0) {
      throw new BadRequestException('Nessun articolo è stato importato (contenuti vuoti o quota esaurita).');
    }

    // 8. Autocompletamento del brief dalla knowledge raccolta (best-effort).
    // Con l'anteprima congelata il brief ne eredita struttura e campi; in ogni
    // caso knowledgeDocIds vincola il RAG alle fonti del corso.
    let briefDrafted = false;
    try {
      briefDrafted = await this.briefService.draftBriefFromArticles({
        tenantId: input.tenantId,
        courseId: course.id,
        topic,
        language: input.language,
        audience: input.audience,
        tone: input.tone,
        preview,
        knowledgeDocIds,
        articles: chosen.map((c) => ({ title: c.title, summary: c.summary })),
      });
    } catch (err) {
      this.logger.warn(`Autocompletamento brief non riuscito (corso ${course.id}): ${rawError(err)}`);
    }

    this.logger.log(
      `Corso ${course.id} da argomento "${topic}": ${imported} storie da ${candidatesExamined} candidati` +
        (briefDrafted ? ' + brief autocompilato' : ''),
    );
    return { courseId: course.id, importedCount: imported, candidatesExamined, failedFeeds, briefDrafted };
  }

  /**
   * ANTEPRIMA del corso: a partire dall'argomento fa SOLO la scoperta
   * multi-fonte (titoli + sommari, nessun embedding né ingestione né creazione
   * corso) e sintetizza con l'LLM un pre-sommario — titolo proposto, breve
   * descrizione, concetti chiave e lezioni suggerite — più l'elenco delle fonti
   * trovate. Dà all'autore consapevolezza di cosa otterrà, a costo minimo (una
   * sola chiamata LLM su testi brevi). È indicativa: la generazione finale può
   * rifinire.
   */
  async previewCourseFromRss(input: {
    tenantId: string;
    topic: string;
    language: string;
    source: FeedSource;
    category?: FeedCategory;
    /** Pubblico destinatario (opzionale): se assente lo propone l'anteprima. */
    audience?: string;
    /** Tono di voce (opzionale): se assente lo propone l'anteprima. */
    tone?: string;
  }): Promise<RssPreviewResult> {
    const topic = input.topic?.trim();
    if (!topic) throw new BadRequestException('Indica un argomento per l\'anteprima');

    const { candidates } = await this.gatherCandidates({
      tenantId: input.tenantId,
      topic,
      language: input.language,
      source: input.source,
      category: input.category,
      maxArticles: PREVIEW_CANDIDATES,
    });
    // Per l'anteprima bastano pochi candidati recenti/rilevanti: cap ridotto.
    const sample = candidates.slice(0, PREVIEW_CANDIDATES);
    const sources = Array.from(new Set(sample.map((c) => c.source).filter((s): s is string => !!s)));

    const preview = await this.briefService.previewFromArticles({
      tenantId: input.tenantId,
      topic,
      language: input.language,
      audience: input.audience,
      tone: input.tone,
      articles: sample.map((c) => ({ title: c.title, summary: c.summary })),
    });

    return { ...preview, sources, examined: sample.length };
  }

  /**
   * Scoperta multi-fonte condivisa (create + preview): raccoglie in parallelo
   * dai feed (tenant + curati) e, in modalità "ovunque", da Google News (IT+EN),
   * Wikipedia e materiali didattici aperti (OER). Ritorna i candidati deduplicati
   * (per URL/titolo) e i feed non raggiunti. Nessun embedding/ingestione qui.
   */
  private async gatherCandidates(
    input: CreateCourseFromRssInput,
  ): Promise<{ candidates: Candidate[]; failedFeeds: Array<{ url: string; reason: string }> }> {
    const topic = input.topic.trim();
    const failedFeeds: Array<{ url: string; reason: string }> = [];
    const collected: Candidate[] = [];

    const feedUrls = await this.resolveFeedUrls(input);
    if (input.source === 'mine' && feedUrls.length === 0) {
      throw new BadRequestException('Non hai feed personalizzati salvati. Aggiungine o scegli «Ovunque».');
    }

    const tasks: Array<Promise<void>> = [];

    // Feed RSS diretti (link risolvibili → full-text via Readability in create).
    tasks.push(
      (async () => {
        const lists = await Promise.all(
          feedUrls.map(async (url) => {
            try {
              const res = await this.feeds.listItems(url, { maxItems: ITEMS_PER_FEED });
              return res.items;
            } catch (err) {
              failedFeeds.push({ url, reason: rawError(err) });
              return [] as FeedListItem[];
            }
          }),
        );
        for (const items of lists) for (const it of items) collected.push({ ...it, kind: 'feed' });
      })(),
    );

    // Google News (IT+EN) + Wikipedia + OER: solo in modalità "ovunque".
    if (input.source === 'everywhere') {
      const gLang = input.language === 'en' ? 'en' : 'it';
      const gnLangs: Array<'it' | 'en'> = gLang === 'en' ? ['en'] : ['it', 'en'];
      for (const lang of gnLangs) {
        tasks.push(
          (async () => {
            try {
              const items = await this.feeds.searchGoogleNews(topic, { lang, maxItems: 20 });
              for (const it of items) collected.push({ ...it, kind: 'gnews' });
            } catch (err) {
              this.logger.warn(`Google News (${lang}) non raggiungibile: ${rawError(err)}`);
            }
          })(),
        );
      }
      tasks.push(
        (async () => {
          try {
            const arts = await this.feeds.searchWikipedia(topic, { lang: gLang, max: 3 });
            for (const a of arts) {
              collected.push({
                kind: 'wikipedia',
                title: a.title,
                link: a.url,
                summary: a.extract.slice(0, 2000),
                readyText: a.extract,
                source: 'Wikipedia',
              });
            }
          } catch (err) {
            this.logger.warn(`Wikipedia non raggiungibile: ${rawError(err)}`);
          }
        })(),
      );
      tasks.push(
        (async () => {
          try {
            const oer = await this.feeds.searchOpenEducation(topic, { lang: gLang, max: 4 });
            for (const o of oer) {
              collected.push({
                kind: 'oer',
                title: o.title,
                link: o.link,
                summary: o.summary,
                readyText: o.summary,
                isoDate: o.isoDate,
                source: o.source,
              });
            }
          } catch (err) {
            this.logger.warn(`Fonti didattiche aperte non raggiungibili: ${rawError(err)}`);
          }
        })(),
      );
    }

    await Promise.all(tasks);

    const candidates = dedupeExact(collected).slice(0, MAX_CANDIDATES);
    if (candidates.length === 0) {
      throw new BadRequestException(
        'Nessun contenuto trovato per questo argomento. Prova a riformularlo o riprova più tardi.',
      );
    }
    return { candidates, failedFeeds };
  }

  /**
   * Risolve l'elenco di URL di feed da interrogare in base alla sorgente, con
   * un CAP intelligente: i feed personalizzati del tenant hanno priorità (sono
   * una scelta esplicita), poi si aggiungono i predefiniti fino al tetto
   * MAX_FEEDS_QUERIED. Se non è scelta una categoria (ricerca "tutte le aree"),
   * i predefiniti sono campionati in modo DIVERSIFICATO tra le categorie
   * (round-robin) invece di prendere i primi N di una sola area.
   */
  private async resolveFeedUrls(input: CreateCourseFromRssInput): Promise<string[]> {
    const ordered: string[] = [];
    const seen = new Set<string>();
    const push = (url: string): void => {
      if (!seen.has(url)) {
        seen.add(url);
        ordered.push(url);
      }
    };

    // 1. Feed del tenant (priorità: scelta esplicita dell'utente). Sempre inclusi.
    const mine = await this.tenantFeeds.list(input.tenantId);
    for (const f of mine) push(f.url);

    // 2. Feed curati: solo in modalità "ovunque" (in "mine" si usano solo i miei).
    if (input.source === 'everywhere') {
      if (input.category) {
        for (const f of defaultFeedsForCategory(input.category)) push(f.url);
      } else {
        for (const url of interleaveByCategory()) push(url);
      }
    }

    return ordered.slice(0, MAX_FEEDS_QUERIED);
  }

  /**
   * Costruisce l'HTML dell'articolo in base alla provenienza:
   *  - wikipedia: usa l'estratto già pronto (nessuno scraping);
   *  - feed: tenta lo scraping full-text dal link (Readability), fallback sommario;
   *  - gnews: usa SOLO il sommario (il link Google News è un redirect offuscato
   *    non risolvibile; il full-text della stessa storia arriva dai feed diretti).
   */
  private async buildArticleHtml(item: Candidate): Promise<string> {
    let bodyHtml = `<p>${escapeHtml(item.summary)}</p>`;
    if ((item.kind === 'wikipedia' || item.kind === 'oer') && item.readyText) {
      // Wikipedia e OER: testo già fornito dalle API, nessuno scraping.
      bodyHtml = `<p>${escapeHtml(item.readyText)}</p>`;
    } else if (item.kind === 'feed' && item.link) {
      const art = await this.feeds.fetchArticle(item.link).catch(() => null);
      if (art && art.text.length > item.summary.length && art.html.trim()) {
        bodyHtml = art.html;
      }
    }
    const title = escapeHtml(item.title);
    const meta: string[] = [];
    if (item.source) meta.push(`Fonte: ${item.source}`);
    if (item.isoDate) meta.push(`Data: ${item.isoDate}`);
    if (item.link) meta.push(`URL: ${item.link}`);
    return [
      '<!doctype html><html><head><meta charset="utf-8"><title>',
      title,
      '</title></head><body>',
      `<h1>${title}</h1>`,
      meta.length ? `<p>${escapeHtml(meta.join(' — '))}</p>` : '',
      bodyHtml,
      '</body></html>',
    ].join('');
  }
}

/**
 * Ordina i feed predefiniti in ROUND-ROBIN tra le categorie: prende il 1° feed
 * di ogni categoria, poi il 2° di ogni categoria, ecc. Così, troncando al cap,
 * la raccolta resta bilanciata tra aree diverse invece di coprire solo le prime.
 */
function interleaveByCategory(): string[] {
  const byCat = FEED_CATEGORIES.map((c) => DEFAULT_FEEDS.filter((f) => f.category === c));
  const out: string[] = [];
  const maxLen = Math.max(0, ...byCat.map((g) => g.length));
  for (let i = 0; i < maxLen; i++) {
    for (const group of byCat) {
      const f = group[i];
      if (f) out.push(f.url);
    }
  }
  return out;
}

/** Query testuale per l'embedding dell'argomento (lingua inclusa come hint). */
function topicQuery(topic: string, language: string): string {
  return `Argomento del corso (${language}): ${topic}`;
}

/** Titolo del corso derivato dall'argomento (prima lettera maiuscola). */
function titleFromTopic(topic: string): string {
  const t = topic.trim();
  return t.length > 0 ? t.charAt(0).toUpperCase() + t.slice(1) : 'Rassegna stampa';
}

/** Punteggio finale = pertinenza + piccolo bonus di recenza (0..1). */
function finalScore(c: Candidate): number {
  const rel = c.relevance ?? 0;
  return rel * (1 - RECENCY_WEIGHT) + recencyScore(c.isoDate) * RECENCY_WEIGHT;
}

/** Recenza normalizzata: 1 oggi → ~0 dopo ~30 giorni. */
function recencyScore(iso?: string): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  const days = (Date.now() - t) / 86_400_000;
  if (days <= 0) return 1;
  if (days >= 30) return 0;
  return 1 - days / 30;
}

/** Dedup esatta per link e titolo normalizzato (mantiene il primo, più recente). */
function dedupeExact<T extends FeedListItem>(items: T[]): T[] {
  const seenLink = new Set<string>();
  const seenTitle = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const link = (it.link ?? '').trim().toLowerCase().replace(/[#?].*$/, '');
    const title = it.title.trim().toLowerCase().replace(/\s+/g, ' ');
    if (link && seenLink.has(link)) continue;
    if (title && seenTitle.has(title)) continue;
    if (link) seenLink.add(link);
    if (title) seenTitle.add(title);
    out.push(it);
  }
  return out;
}

/** Similarità coseno tra due vettori. 0 se uno è vuoto o di lunghezza diversa. */
function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function safeFilename(title: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
  return base || 'articolo';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function rawError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message) return cause.message;
    return err.message;
  }
  return typeof err === 'string' ? err : 'errore sconosciuto';
}
