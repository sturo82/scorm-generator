import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join as pathJoin, relative as pathRelative } from 'node:path';
import JSZip from 'jszip';
import type { Brand, Course } from '@scorm/contracts';
import { INTERACTIONS_CSS, compileTheme } from '@scorm/contracts';
import { sanitizeHtml } from '../sanitize/html-sanitizer.js';
import { RUNTIME_ASSET_FILES, runtimeAssetPath } from '../runtime/index.js';
import { semanticAssetsDir, EMBED_MODEL_ID, EMBED_DIM } from './semantic-embedder.js';
import { generateManifest, type ScormProfile } from './manifest.js';
import { renderScoPage, PLAYER_CSS } from './page-template.js';
import { validateCourseForExport, type ValidationReport } from './validation.js';
import { buildSemanticIndex } from './semantic-index.js';

export interface BuildPackageInput {
  course: Course;
  brand: Brand;
  profile: ScormProfile;
  /** Consenti export anche con elementi non approvati (Requisito 8.3). */
  allowUnapproved?: boolean;
  /**
   * Risolve i media referenziati nei block (per `storageKey`) nei loro byte, così
   * da includerli nel pacchetto e renderlo autonomo/offline (Requisito 9.4). Se
   * assente, i media restano riferimenti esterni (storageKey invariato).
   */
  fetchMedia?: (storageKey: string) => Promise<MediaAsset | null>;
  /**
   * Chunk della knowledge del corso (testo + citazione) per il RAG offline:
   * impacchettati nel pacchetto come window.__RAG__ e interrogati client-side
   * dal widget "Chiedi al corso" (ricerca lessicale, nessun LLM/rete). `ref`
   * indica l'origine (lezione del corso vs documento) per il salto/attribuzione.
   */
  ragChunks?: RagChunkInput[];
  /**
   * Embeddings neurali pre-calcolati dei chunk (stesso ordine di ragChunks),
   * uno per chunk, dimensione EMBED_DIM, L2-normalizzati. Calcolati all'export
   * con lo STESSO modello (MiniLM) che gira poi nel browser. Quando presenti, il
   * runtime impacchetta il modello e usa la ricerca semantica neurale (query
   * embeddata a runtime + cosine). Senza, resta BM25+TF-IDF.
   */
  ragEmbeddings?: number[][];
  /**
   * @deprecated L'indice semantico TF-IDF è ora SEMPRE incluso (coerenza con
   * l'anteprima). Il flag è mantenuto per compatibilità ma non ha più effetto.
   */
  includeSemanticSearch?: boolean;
  /**
   * Metadati extra per il file descrittivo `sw-course.json` scritto nella root
   * del pacchetto (convenzione della piattaforma di ingest: arricchisce
   * titolo/descrizione/copertina/durata/lingue della landing senza intervento
   * manuale). Tutti opzionali; i valori mancanti vengono omessi dal JSON.
   */
  descriptor?: {
    /** Durata stimata in minuti (dal brief). */
    durationMinutes?: number;
    /** Categoria del corso. */
    category?: string;
    /** Lingue dichiarate (audio/sottotitoli presenti). Etichette informative. */
    languages?: string[];
    /** Punteggio di superamento (0-100). */
    masteryScore?: number;
  };
}

/** Chunk RAG impacchettato: testo + attribuzione + eventuale riferimento lezione. */
export interface RagChunkInput {
  text: string;
  documentName: string;
  section?: string;
  ref?: {
    kind: 'lesson' | 'knowledge';
    lessonId?: string;
    moduleIndex?: number;
    lessonIndex?: number;
  };
}

export interface MediaAsset {
  bytes: Uint8Array;
  contentType: string;
}

export interface BuildPackageResult {
  zip: Buffer;
  validation: ValidationReport;
  /** Avvisi del tema (asset/font mancanti). */
  themeWarnings: string[];
  /** Avvisi sui media non inclusi (download fallito/assente). */
  mediaWarnings: string[];
}

export class PackageValidationError extends Error {
  constructor(readonly report: ValidationReport) {
    super(`Export bloccato: ${report.errors.join(' ')}`);
    this.name = 'PackageValidationError';
  }
}

/**
 * Normalizza il testo di un chunk RAG nel formato impacchettato nel runtime:
 * sanifica l'HTML, rimuove i tag residui e normalizza gli spazi. DEVE essere
 * usata sia dal builder (pacchetto) sia dall'anteprima (API /rag-chunks), così
 * i due indicizzano ESATTAMENTE le stesse stringhe → ricerca coerente.
 * Idempotente: applicarla due volte dà lo stesso risultato.
 */
export function ragRuntimeText(text: string): string {
  return sanitizeHtml(text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Aggiunge ricorsivamente il contenuto di una directory del filesystem al folder zip. */
function addDirToZip(folder: JSZip, dir: string): void {
  const walk = (abs: string): void => {
    for (const entry of readdirSync(abs)) {
      const full = pathJoin(abs, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else {
        // Path relativo alla root della directory, con separatori "/" per lo zip.
        const rel = pathRelative(dir, full).split(/[\\/]+/).join('/');
        folder.file(rel, readFileSync(full));
      }
    }
  };
  walk(dir);
}

/**
 * Assembla il pacchetto SCORM come .zip (Requisito 9.2 / 9.3 / 9.4). Struttura:
 *   /imsmanifest.xml
 *   /runtime/*.js            (wrapper API, scoring, renderers, player)
 *   /assets/theme/theme.css  (tema del brand compilato)
 *   /assets/player.css
 *   /content/course.js       (modello del corso, sanificato)
 *   /pages/module-N.html     (uno SCO per modulo)
 * Tutto self-contained e offline (Requisito 9.4). L'HTML del contenuto è
 * sanificato (Requisito 12.3).
 */
export async function buildScormPackage(input: BuildPackageInput): Promise<BuildPackageResult> {
  // 1. Validazione pre-export (blocca se non conforme/non approvato).
  const validation = validateCourseForExport(input.course, {
    allowUnapproved: input.allowUnapproved,
  });
  if (!validation.ok) {
    throw new PackageValidationError(validation);
  }

  // 2. Sanifica il contenuto del corso prima di includerlo.
  const safeCourse = sanitizeCourse(input.course);

  // 3. Compila il tema del brand.
  const theme = compileTheme(input.brand);

  const zip = new JSZip();

  // 3-bis. Media embedded: scarica i media referenziati e riscrive gli
  // storageKey a path relativi dentro il pacchetto (self-contained, offline).
  const mediaWarnings = input.fetchMedia
    ? await embedMedia(safeCourse, input.fetchMedia, zip)
    : [];

  // 4. Runtime (asset statici copiati tali e quali).
  const runtime = zip.folder('runtime')!;
  for (const file of RUNTIME_ASSET_FILES) {
    runtime.file(file, readFileSync(runtimeAssetPath(file)));
  }

  // 5. Tema e stile del player.
  const assets = zip.folder('assets')!;
  assets.folder('theme')!.file('theme.css', theme.css);
  assets.file('player.css', PLAYER_CSS);
  // Micro-interazioni premium (Blocco F): foglio condiviso con l'anteprima web
  // così il player SCORM e la preview hanno lo stesso identico aspetto.
  assets.file('interactions.css', INTERACTIONS_CSS);

  // 6. Modello del corso + brand come variabili globali (niente fetch runtime).
  // __BRAND__ espone logo e nome per l'header del player (colori/font arrivano
  // da theme.css). Il logo, se è una chiave di storage, è stato riscritto da
  // embedMedia a path relativo (self-contained).
  const brandForRuntime = {
    name: input.brand.name,
    logoUrl: theme.logoUrl,
  };
  // Indice RAG offline: chunk della knowledge (testo + citazione), interrogati
  // client-side dal widget "Chiedi al corso". Nessun dato sensibile oltre a ciò
  // che è già nel corso; sanificato per sicurezza (plain text).
  const ragForRuntime = (input.ragChunks ?? []).map((c) => ({
    text: ragRuntimeText(c.text),
    documentName: c.documentName,
    section: c.section,
    ref: c.ref,
  }));
  // Indice semantico TF-IDF pre-calcolato per cosine similarity. SEMPRE incluso:
  // garantisce che la ricerca del pacchetto SCORM sia IDENTICA a quella
  // dell'anteprima (che calcola lo stesso indice con buildSemanticIndex). Peso
  // aggiuntivo tipico: 5-50 KB (proporzionale a vocabolario e numero di chunk).
  const semanticJson = buildSemanticIndex(ragForRuntime.map((c) => c.text));

  // Ricerca semantica NEURALE (opzionale ma predefinita quando gli embeddings
  // sono forniti): impacchetta il modello MiniLM + runtime e gli embeddings dei
  // chunk pre-calcolati. Il runtime embedda la query con lo STESSO modello →
  // ranking identico ad anteprima e pacchetto. Senza embeddings resta il
  // lessicale (BM25 + TF-IDF).
  const embeddings = input.ragEmbeddings;
  const hasNeural =
    Array.isArray(embeddings) &&
    embeddings.length === ragForRuntime.length &&
    embeddings.length > 0;
  let embedMeta: { model: string; dim: number; count: number } | null = null;
  if (hasNeural) {
    // Quantizza gli embeddings (vettori L2-normalizzati, componenti in ~[-1,1])
    // a Int8 con scala 127: ~1/4 del peso dei float, perdita trascurabile per il
    // ranking a cosine. Serializzati in un file binario separato.
    const dim = EMBED_DIM;
    const count = embeddings.length;
    const buf = new Int8Array(count * dim);
    for (let i = 0; i < count; i++) {
      const v = embeddings[i] ?? [];
      for (let j = 0; j < dim; j++) {
        const x = Math.max(-1, Math.min(1, v[j] ?? 0));
        buf[i * dim + j] = Math.round(x * 127);
      }
    }
    // JSZip richiede Uint8Array/Buffer/ArrayBuffer: passa la vista Uint8Array
    // sullo stesso buffer dell'Int8Array (stessi byte).
    zip.folder('content')!.file('rag-embeddings.bin', new Uint8Array(buf.buffer));
    embedMeta = { model: EMBED_MODEL_ID, dim, count };
    // Copia il modello + runtime Transformers.js sotto runtime/semantic/.
    addDirToZip(zip.folder('runtime')!.folder('semantic')!, semanticAssetsDir());
  }

  zip
    .folder('content')!
    .file(
      'course.js',
      `window.__COURSE__ = ${JSON.stringify(safeCourse)};\n` +
        `window.__BRAND__ = ${JSON.stringify(brandForRuntime)};\n` +
        `window.__RAG__ = ${JSON.stringify(ragForRuntime)};` +
        (semanticJson ? `\nwindow.__RAG_SEMANTIC__ = ${JSON.stringify(semanticJson)};` : '') +
        (embedMeta ? `\nwindow.__RAG_EMBED_META__ = ${JSON.stringify(embedMeta)};` : ''),
    );

  // 7. Pagina SCO unica: l'intero corso è un solo SCO con navigazione a step
  // interna (gating). Un solo item impedisce all'LMS di sovrapporre la propria
  // navigazione tra moduli, che bypasserebbe il gating.
  const pages = zip.folder('pages')!;
  pages.file(
    'index.html',
    renderScoPage({ courseTitle: safeCourse.title, language: safeCourse.language }),
  );

  // 8. Manifest con i file condivisi referenziati.
  const sharedFiles = [
    ...RUNTIME_ASSET_FILES.map((f) => `runtime/${f}`),
    'assets/theme/theme.css',
    'assets/player.css',
    'assets/interactions.css',
    'content/course.js',
  ];
  zip.file(
    'imsmanifest.xml',
    generateManifest({
      course: safeCourse,
      profile: input.profile,
      sharedFiles,
    }),
  );

  // 9. File descrittivo opzionale per la piattaforma di ingest: arricchisce la
  // landing (titolo/descrizione/copertina/durata/lingue) senza intervento
  // manuale. Convenzione: sw-course.json nella ROOT, accanto al manifest.
  zip.file('sw-course.json', renderSwCourseJson(safeCourse, input));

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return { zip: buffer, validation, themeWarnings: theme.warnings, mediaWarnings };
}

/**
 * Costruisce il file descrittivo `sw-course.json` (convenzione della piattaforma
 * di ingest). Tutte le chiavi sono opzionali: i campi vuoti vengono omessi, così
 * il JSON resta pulito. `cover` è un path RELATIVO ALLA ROOT del contenuto (es.
 * `media/asset-0.jpg`): la copertina del corso, dopo embedMedia, è riscritta
 * come `../media/asset-N.ext` (relativa alle pagine in pages/), quindi la
 * normalizziamo togliendo il prefisso `../`.
 */
export function renderSwCourseJson(course: Course, input: BuildPackageInput): string {
  const d = input.descriptor ?? {};
  const descriptor: Record<string, unknown> = {};

  if (course.title) descriptor.title = course.title;
  if (course.description) descriptor.description = course.description;

  // Copertina: solo se inclusa nel pacchetto (path relativo). Normalizza il
  // prefisso ../ (relativo a pages/) a path relativo alla root del contenuto.
  const cover = course.coverImageKey;
  if (typeof cover === 'string' && cover && !/^https?:\/\//.test(cover)) {
    descriptor.cover = cover.replace(/^(\.\.\/)+/, '');
  }

  if (course.language) descriptor.language = course.language;
  if (d.languages && d.languages.length > 0) descriptor.languages = d.languages;
  if (d.category) descriptor.category = d.category;
  if (typeof d.durationMinutes === 'number' && d.durationMinutes > 0) {
    descriptor.duration_minutes = d.durationMinutes;
  }
  if (course.instructor?.name) descriptor.author = course.instructor.name;
  if (typeof d.masteryScore === 'number') descriptor.mastery_score = d.masteryScore;

  return JSON.stringify(descriptor, null, 2);
}

/**
 * Scarica i media referenziati nei block (per storageKey) e li inserisce in
 * `media/` nel pacchetto, riscrivendo ogni storageKey al path relativo. I media
 * già risolti come URL http(s) o già relativi vengono ignorati. Ritorna gli
 * avvisi per i media non scaricabili (lasciati invariati).
 */
async function embedMedia(
  course: Course,
  fetchMedia: (storageKey: string) => Promise<MediaAsset | null>,
  zip: JSZip,
): Promise<string[]> {
  const warnings: string[] = [];
  const folder = zip.folder('media')!;
  // Cache per deduplicare media condivisi tra più block.
  const resolved = new Map<string, string | null>();
  let counter = 0;

  const isDownloadableKey = (key: unknown): key is string =>
    typeof key === 'string' &&
    key.length > 0 &&
    !/^https?:\/\//.test(key) &&
    !key.startsWith('../media/');

  // Raccoglie tutti gli oggetti con una proprietà di media "a chiave":
  // - storageKey nei block (immagini, ecc.)
  // - narrationKey sulle lezioni (audio TTS)
  const refs: Array<{
    obj: Record<string, unknown>;
    prop: 'storageKey' | 'narrationKey' | 'coverImageKey' | 'avatarKey';
  }> = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (node === null || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if (isDownloadableKey(obj.storageKey)) refs.push({ obj, prop: 'storageKey' });
    for (const v of Object.values(obj)) visit(v);
  };
  // Copertina del corso (hero della schermata iniziale).
  const courseObj = course as unknown as Record<string, unknown>;
  if (isDownloadableKey(courseObj.coverImageKey)) {
    refs.push({ obj: courseObj, prop: 'coverImageKey' });
  }
  // Foto del docente (header sempre visibile).
  const instructorObj = courseObj.instructor as Record<string, unknown> | undefined;
  if (instructorObj && isDownloadableKey(instructorObj.avatarKey)) {
    refs.push({ obj: instructorObj, prop: 'avatarKey' });
  }
  for (const m of course.modules ?? []) {
    const modObj = m as unknown as Record<string, unknown>;
    if (isDownloadableKey(modObj.coverImageKey)) {
      refs.push({ obj: modObj, prop: 'coverImageKey' });
    }
    for (const l of m.lessons ?? []) {
      for (const b of l.blocks ?? []) visit(b);
      const lesson = l as unknown as Record<string, unknown>;
      if (isDownloadableKey(lesson.narrationKey)) refs.push({ obj: lesson, prop: 'narrationKey' });
    }
  }

  for (const { obj, prop } of refs) {
    const key = obj[prop] as string;
    if (resolved.has(key)) {
      const path = resolved.get(key);
      if (path) obj[prop] = path;
      continue;
    }
    try {
      const asset = await fetchMedia(key);
      if (!asset) {
        warnings.push(`Media non trovato: ${key}`);
        resolved.set(key, null);
        continue;
      }
      const ext = extFromKeyOrType(key, asset.contentType);
      const filename = `asset-${counter++}.${ext}`;
      folder.file(filename, asset.bytes);
      // Le pagine SCO sono in pages/, i media in media/: path relativo "../media".
      const relPath = `../media/${filename}`;
      obj[prop] = relPath;
      resolved.set(key, relPath);
    } catch (err) {
      warnings.push(`Media non incluso (${key}): ${err instanceof Error ? err.message : 'errore'}`);
      resolved.set(key, null);
    }
  }
  return warnings;
}

function extFromKeyOrType(key: string, contentType: string): string {
  const fromKey = key.split('.').pop();
  if (fromKey && fromKey.length <= 4 && !fromKey.includes('/')) return fromKey;
  if (contentType.includes('jpeg')) return 'jpg';
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('mp4')) return 'mp4';
  if (contentType.includes('webm')) return 'webm';
  if (contentType.includes('mpeg')) return 'mp3';
  return 'bin';
}

/** Sanifica tutti i campi HTML rich-text del corso (Requisito 12.3). */
function sanitizeCourse(course: Course): Course {
  const clone = structuredClone(course);
  for (const module of clone.modules ?? []) {
    for (const lesson of module.lessons ?? []) {
      for (const block of lesson.blocks ?? []) {
        sanitizeBlockHtml(block as unknown as { type: string; payload: Record<string, unknown> });
      }
    }
  }
  return clone;
}

function sanitizeBlockHtml(block: { type: string; payload: Record<string, unknown> }): void {
  const p = block.payload;
  const rich = (rt: unknown): void => {
    if (rt && typeof rt === 'object' && 'html' in rt) {
      const n = rt as { html: string };
      n.html = sanitizeHtml(n.html);
    }
  };
  switch (block.type) {
    case 'rich_text':
      rich((p as { content?: unknown }).content);
      break;
    case 'accordion_tabs':
      for (const panel of (p.panels as Array<{ content: unknown }>) ?? []) rich(panel.content);
      break;
    case 'flashcard':
      for (const c of (p.cards as Array<{ front: unknown; back: unknown }>) ?? []) {
        rich(c.front);
        rich(c.back);
      }
      break;
    case 'timeline':
      for (const e of (p.events as Array<{ content: unknown }>) ?? []) rich(e.content);
      break;
    case 'image_hotspot':
      for (const h of (p.hotspots as Array<{ content: unknown }>) ?? []) rich(h.content);
      break;
    case 'click_reveal':
      for (const it of (p.items as Array<{ content: unknown }>) ?? []) rich(it.content);
      break;
    case 'branching_scenario':
      for (const n of (p.nodes as Array<{ content: unknown }>) ?? []) rich(n.content);
      break;
    case 'carousel_steps':
      for (const s of (p.steps as Array<{ content: unknown }>) ?? []) rich(s.content);
      break;
    default:
      break;
  }
}
