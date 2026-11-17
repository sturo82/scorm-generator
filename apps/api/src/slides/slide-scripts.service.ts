import { BadRequestException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import type { DocumentExtractor, LLMProvider, ObjectStorage } from '@scorm/domain';
import type { GenerateSlideScripts, PronunciationEntry, UpdateSlideScripts } from '@scorm/contracts';
import { DocumentExtractorRegistry } from '@scorm/adapters/extractors';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsageMeterService } from '../metering/usage-meter.service.js';
import {
  DOCUMENT_EXTRACTORS,
  LLM_PROVIDER,
  OBJECT_STORAGE,
} from '../providers/provider.constants.js';
import { SlidesService, type SlideImportManifest } from './slides.service.js';
import { meterCourseId } from './slide-owner.js';

/** Velocità di parlato stimata (parole/secondo) per prevedere la durata del video. */
const WORDS_PER_SEC = 2.4;
/** Tetto di parole di knowledge passate al confronto con le slide (circa 35k token). */
const MAX_KNOWLEDGE_WORDS = 25000;

const JOB_LEASE_MS = 5 * 60_000;

/** Stato della generazione in background dei copioni (file `scripts-job.json`). */
export interface ScriptsGenerationState {
  status: 'running' | 'failed' | 'completed';
  error?: string;
  startedAt: string;
  updatedAt: string;
  /** Scadenza del lease: oltre, un lavoro 'running' non attivo in questo processo è considerato interrotto. */
  leaseUntil?: number;
}

/** Argomento della knowledge non coperto dalle slide (slide "extra" opzionale). */
export interface ExtraTopic {
  title: string;
  summary: string;
  bullets: string[];
}

export interface SlideScriptEntry {
  index: number;
  script: string;
  skip: boolean;
  /** Parole del copione e durata stimata (s): solo indicativa, la durata reale è quella della clip. */
  words: number;
  estSec: number;
  /** True se il copione integra contenuti della knowledge assenti dalla slide. */
  usedKnowledge?: boolean;
  /** Contraddizioni slide/knowledge rilevate (la slide prevale nel copione). */
  conflicts?: string[];
  /**
   * Presente solo per le slide "extra": argomenti della knowledge che nessuna slide copre.
   * Con `skip: true` (default) finiscono nella parte scritta della lezione; con `skip: false`
   * diventano una slide narrata aggiuntiva.
   */
  extra?: ExtraTopic;
}

export interface SlideScriptsDoc {
  importId: string;
  courseId: string;
  language: string;
  /** 'draft' = da rivedere; 'approved' = via libera alla generazione clip. */
  status: 'draft' | 'approved';
  model: string;
  updatedAt: string;
  /** Documenti di knowledge usati nel confronto (vuoto = solo slide). */
  knowledgeDocIds: string[];
  knowledgeNames: string[];
  slides: SlideScriptEntry[];
  totalWords: number;
  estTotalSec: number;
  /** Pronuncia di nomi e sigle: vale solo per l'audio delle clip. */
  glossary?: PronunciationEntry[];
}

const BASE_RULES = (language: string): string[] => [
  'Sei un autore di video-lezioni aziendali. Ricevi il testo estratto da una presentazione (slide numerate) e scrivi,',
  'per OGNI slide, il copione PARLATO che un docente-avatar pronuncerà mentre la slide è a schermo.',
  '',
  'Regole di contenuto (il tema può essere sensibile, ad esempio tutela dei minori):',
  '- Sii FEDELE alle slide: non aggiungere fatti, numeri, norme, esempi o consigli che non siano nel testo. Puoi riformulare e collegare, non inventare.',
  "- Mantieni il significato e il livello di cautela dell'originale. Non attenuare né rafforzare le prescrizioni.",
  '- Niente frasi di cornice che affermino cose nuove (es. "riguarda tutti senza eccezioni", "tre pilastri", "più dannosi"): le slide di raccordo introducono solo il tema successivo, con le parole delle slide.',
  '- Se il testo di una slide è troppo scarno per dire altro, scrivi una frase breve: meglio corto che inventato.',
  '',
  'Regole di stile:',
  `- Lingua del copione: ${language}. Traduci in modo naturale il testo delle slide se è in un'altra lingua.`,
  '- Tono professionale ma caldo e amichevole, rivolto a un pubblico di allenatori e staff: dai del "voi" o usa forme impersonali, mai del "tu".',
  '- Parlato, non elenco: frasi complete da leggere ad alta voce, senza markdown, senza simboli, senza numeri di slide, senza "come potete vedere in questa slide".',
  '- Le liste diventano un discorso fluido ("innanzitutto", "poi", "infine"), senza ripetere letteralmente ogni voce se non serve.',
  '- Il testo estratto può avere parole spezzate da spazi ("CHI LD SAFEGUARDI NG"): ricostruiscile. Ignora diciture legali o di copyright ricorrenti.',
  "- Dai continuità al discorso tra una slide e l'altra, senza riassumere ogni volta e senza salutare di nuovo.",
  '- Slide di apertura: breve benvenuto e presentazione del tema. Slide di sezione (solo titolo): una frase di raccordo. Slide finale: breve chiusura.',
];

const LENGTH_SLIDES_ONLY = '- Lunghezza: 25-45 parole per slide di sezione o titolo, 60-110 per le slide con contenuto, mai oltre 130.';

const KNOWLEDGE_RULES = [
  '',
  'Hai anche la KNOWLEDGE: documenti di approfondimento (anche trascrizioni parlate). Confronta slide e knowledge:',
  '- Le SLIDE sono la fonte prevalente; la knowledge serve a spiegarle meglio e a completarle.',
  '- Per ogni slide usa dalla knowledge SOLO ciò che è pertinente a quella slide (stesso argomento): chiarimenti, motivazioni, esempi, indicazioni operative. Non importare contenuti di altri argomenti.',
  '- Assegna ogni contenuto della knowledge alla slide più pertinente, senza ripeterlo in più slide.',
  '- Se la knowledge CONTRADDICE una slide, nel copione segui la slide e descrivi il contrasto in "conflicts" (una frase: cosa dice la slide, cosa dice la knowledge).',
  '- "usedKnowledge" è true se il copione integra contenuti che NON sono nella slide.',
  '- Lunghezza LIBERA: quanto serve per spiegare compiutamente la slide con i contenuti pertinenti della knowledge (di norma 80-250 parole); le slide di sezione o titolo restano brevi.',
  '- La knowledge può essere parlata (esitazioni, errori di riconoscimento vocale, ripetizioni): usa il contenuto, non il modo di parlare, e correggi i termini evidentemente sbagliati.',
  '- In "uncovered" elenca gli argomenti IMPORTANTI della knowledge che NESSUNA slide tratta (massimo 8). Per ciascuno: titolo breve, riassunto di 2-3 frasi, 3-5 punti, e un breve copione parlato (60-120 parole) da usare se diventasse una slide aggiuntiva. Non inserire ciò che hai già usato nelle slide né saluti, battute o contenuti non informativi.',
];

const SCHEMA_PLAIN = {
  type: 'object',
  properties: {
    slides: {
      type: 'array',
      items: {
        type: 'object',
        properties: { index: { type: 'integer' }, script: { type: 'string' } },
        required: ['index', 'script'],
      },
    },
  },
  required: ['slides'],
} as const;

const SCHEMA_KNOWLEDGE = {
  type: 'object',
  properties: {
    slides: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          script: { type: 'string' },
          usedKnowledge: { type: 'boolean' },
          conflicts: { type: 'array', items: { type: 'string' } },
        },
        required: ['index', 'script', 'usedKnowledge', 'conflicts'],
      },
    },
    uncovered: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          summary: { type: 'string' },
          bullets: { type: 'array', items: { type: 'string' } },
          script: { type: 'string' },
        },
        required: ['title', 'summary', 'bullets', 'script'],
      },
    },
  },
  required: ['slides', 'uncovered'],
} as const;

interface LlmSlide {
  index: number;
  script: string;
  usedKnowledge?: boolean;
  conflicts?: string[];
}
interface LlmUncovered {
  title: string;
  summary: string;
  bullets: string[];
  script: string;
}

/**
 * Fase 1 della pipeline "slide + avatar": genera i copioni per slide con una sola
 * chiamata LLM sull'intero deck (per dare continuità al discorso), li salva accanto
 * all'import e li espone per revisione/modifica. Con la knowledge selezionata la
 * stessa chiamata confronta slide e knowledge: arricchisce i copioni con i contenuti
 * pertinenti, segnala le contraddizioni (la slide prevale) e raccoglie gli argomenti
 * non coperti dalle slide come slide "extra" opzionali. Le clip avatar (a pagamento)
 * si generano solo a copioni APPROVATI.
 */
@Injectable()
export class SlideScriptsService {
  private readonly logger = new Logger(SlideScriptsService.name);
  private readonly registry: DocumentExtractorRegistry;
  private readonly active = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly slides: SlidesService,
    private readonly meter: UsageMeterService,
    @Inject(DOCUMENT_EXTRACTORS) extractors: DocumentExtractor[],
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(LLM_PROVIDER) private readonly llm: LLMProvider,
  ) {
    this.registry = new DocumentExtractorRegistry(extractors);
  }

  private key(tenantId: string, courseId: string, importId: string): string {
    return `media/${tenantId}/${courseId}/slides/${importId}/scripts.json`;
  }

  private jobKey(tenantId: string, courseId: string, importId: string): string {
    return `media/${tenantId}/${courseId}/slides/${importId}/scripts-job.json`;
  }

  /** Stato della generazione in background (null se non è mai partita). Un lavoro orfano diventa 'failed'. */
  async generationState(tenantId: string, courseId: string, importId: string): Promise<ScriptsGenerationState | null> {
    const key = this.jobKey(tenantId, courseId, importId);
    if (!(await this.storage.exists(key))) return null;
    const st = JSON.parse((await this.storage.getObject(key)).toString('utf8')) as ScriptsGenerationState;
    if (st.status === 'running' && !this.active.has(`${tenantId}:${importId}`) && (st.leaseUntil ?? 0) < Date.now()) {
      const failed: ScriptsGenerationState = {
        ...st,
        status: 'failed',
        error: 'Generazione interrotta (riavvio del server): riprova.',
        updatedAt: new Date().toISOString(),
      };
      await this.storage.putObject(key, Buffer.from(JSON.stringify(failed)), { contentType: 'application/json' });
      return failed;
    }
    return st;
  }

  private async saveGenerationState(tenantId: string, courseId: string, importId: string, st: ScriptsGenerationState): Promise<void> {
    await this.storage.putObject(this.jobKey(tenantId, courseId, importId), Buffer.from(JSON.stringify(st)), {
      contentType: 'application/json',
    });
  }

  async get(tenantId: string, courseId: string, importId: string): Promise<SlideScriptsDoc | null> {
    await this.slides.loadManifest(tenantId, courseId, importId);
    const key = this.key(tenantId, courseId, importId);
    if (!(await this.storage.exists(key))) return null;
    const doc = JSON.parse((await this.storage.getObject(key)).toString('utf8')) as SlideScriptsDoc;
    // Documenti salvati prima dell'introduzione della knowledge.
    doc.knowledgeDocIds ??= [];
    doc.knowledgeNames ??= [];
    return doc;
  }

  /**
   * Avvia in background la generazione (o rigenerazione) dei copioni e ritorna subito.
   * Con la knowledge la chiamata LLM dura oltre i 120 s concessi a una richiesta HTTP,
   * quindi il client interroga lo stato (`generationState`) finché non termina. Le
   * validazioni (copioni già approvati, knowledge non pronta o troppo lunga) restano
   * sincrone, così gli errori d'input tornano subito.
   */
  async startGenerate(
    tenantId: string,
    courseId: string,
    importId: string,
    input: GenerateSlideScripts = { knowledgeDocIds: [] },
  ): Promise<ScriptsGenerationState> {
    const manifest = await this.slides.loadManifest(tenantId, courseId, importId);
    const existing = await this.get(tenantId, courseId, importId);
    if (existing?.status === 'approved') {
      throw new ConflictException('I copioni sono già approvati: modificali per riaprire la revisione.');
    }
    const current = await this.generationState(tenantId, courseId, importId);
    if (current?.status === 'running') throw new ConflictException('Generazione dei copioni già in corso.');
    const knowledge = await this.loadKnowledge(tenantId, input.knowledgeDocIds);
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, tenantId },
      select: { language: true },
    });
    const language = languageName(course?.language ?? manifest.language ?? 'it');

    const now = new Date().toISOString();
    const state: ScriptsGenerationState = { status: 'running', startedAt: now, updatedAt: now, leaseUntil: Date.now() + JOB_LEASE_MS };
    await this.saveGenerationState(tenantId, courseId, importId, state);
    const runKey = `${tenantId}:${importId}`;
    this.active.add(runKey);
    void (async () => {
      const heartbeat = setInterval(() => {
        state.leaseUntil = Date.now() + JOB_LEASE_MS;
        state.updatedAt = new Date().toISOString();
        void this.saveGenerationState(tenantId, courseId, importId, state).catch(() => undefined);
      }, 60_000);
      try {
        await this.runGenerate(tenantId, courseId, importId, manifest, language, knowledge);
        state.status = 'completed';
      } catch (err) {
        state.status = 'failed';
        state.error = err instanceof Error ? err.message.slice(0, 300) : 'errore sconosciuto';
        this.logger.error(`Generazione copioni fallita (import ${importId}): ${state.error}`);
      } finally {
        clearInterval(heartbeat);
        this.active.delete(runKey);
        state.updatedAt = new Date().toISOString();
        state.leaseUntil = undefined;
        await this.saveGenerationState(tenantId, courseId, importId, state).catch(() => undefined);
      }
    })();
    return state;
  }

  private async runGenerate(
    tenantId: string,
    courseId: string,
    importId: string,
    manifest: SlideImportManifest,
    language: string,
    knowledge: { text: string; ids: string[]; names: string[] } | null,
  ): Promise<SlideScriptsDoc> {
    const out = await this.callLlm(tenantId, courseId, manifest, language, knowledge?.text ?? null);
    const entries: SlideScriptEntry[] = manifest.slides.map((s) => {
      const r = out.slides.get(s.index)!;
      return buildEntry(s.index, r.script, false, {
        usedKnowledge: knowledge ? r.usedKnowledge === true : undefined,
        conflicts: knowledge ? (r.conflicts ?? []).filter((c) => c.trim()) : undefined,
      });
    });
    // Argomenti non coperti: slide "extra" escluse di default (finiscono nella parte scritta).
    let next = manifest.slides.length;
    for (const u of out.uncovered) {
      next += 1;
      entries.push(
        buildEntry(next, u.script.trim(), true, {
          extra: { title: u.title.trim(), summary: u.summary.trim(), bullets: u.bullets.map((b) => b.trim()).filter(Boolean) },
        }),
      );
    }
    const previous = await this.get(tenantId, courseId, importId);
    const doc = this.toDoc(importId, courseId, language, 'draft', out.model, entries, knowledge, previous?.glossary);
    await this.save(tenantId, doc);
    return doc;
  }

  /** Salva le modifiche del revisore; `approved` apre/chiude il via libera. */
  async update(
    tenantId: string,
    courseId: string,
    importId: string,
    input: UpdateSlideScripts,
  ): Promise<SlideScriptsDoc> {
    await this.slides.loadManifest(tenantId, courseId, importId);
    const existing = await this.get(tenantId, courseId, importId);
    if (!existing) throw new BadRequestException('Genera prima i copioni');

    const valid = new Set(existing.slides.map((s) => s.index));
    const byIndex = new Map(input.slides.map((s) => [s.index, s]));
    for (const idx of byIndex.keys()) {
      if (!valid.has(idx)) throw new BadRequestException(`Slide ${idx} inesistente`);
    }
    const entries = existing.slides.map((e) => {
      const u = byIndex.get(e.index);
      return u ? buildEntry(e.index, u.script.trim(), u.skip, e) : e;
    });
    if (input.approved) {
      const empty = entries.filter((e) => !e.skip && e.script.trim().length === 0).map((e) => e.index);
      if (empty.length > 0) {
        throw new BadRequestException(`Copione vuoto per le slide: ${empty.join(', ')}. Compilale o escludile.`);
      }
      if (entries.every((e) => e.skip)) throw new BadRequestException('Tutte le slide sono escluse');
    }
    const doc = this.toDoc(
      importId,
      courseId,
      existing.language,
      input.approved ? 'approved' : 'draft',
      existing.model,
      entries,
      { ids: existing.knowledgeDocIds, names: existing.knowledgeNames },
      existing.glossary,
    );
    await this.save(tenantId, doc);
    return doc;
  }

  /**
   * Aggiorna il glossario di pronuncia. Si può modificare anche a copioni approvati e a clip già
   * generate: cambia solo l'audio, e le clip interessate si rigenerano dal passo successivo.
   */
  async setGlossary(
    tenantId: string,
    courseId: string,
    importId: string,
    glossary: PronunciationEntry[],
  ): Promise<SlideScriptsDoc> {
    const existing = await this.get(tenantId, courseId, importId);
    if (!existing) throw new BadRequestException('Genera prima i copioni');
    const seen = new Set<string>();
    const clean = glossary.filter((e) => {
      const k = e.term.trim().toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const doc: SlideScriptsDoc = { ...existing, glossary: clean, updatedAt: new Date().toISOString() };
    if (clean.length === 0) delete doc.glossary;
    await this.save(tenantId, doc);
    return doc;
  }

  private toDoc(
    importId: string,
    courseId: string,
    language: string,
    status: 'draft' | 'approved',
    model: string,
    slides: SlideScriptEntry[],
    knowledge: { ids: string[]; names: string[] } | null,
    glossary?: PronunciationEntry[],
  ): SlideScriptsDoc {
    const active = slides.filter((s) => !s.skip);
    return {
      importId,
      courseId,
      language,
      status,
      model,
      updatedAt: new Date().toISOString(),
      knowledgeDocIds: knowledge?.ids ?? [],
      knowledgeNames: knowledge?.names ?? [],
      slides,
      totalWords: active.reduce((n, s) => n + s.words, 0),
      estTotalSec: active.reduce((n, s) => n + s.estSec, 0),
      ...(glossary && glossary.length > 0 ? { glossary } : {}),
    };
  }

  private async save(tenantId: string, doc: SlideScriptsDoc): Promise<void> {
    await this.storage.putObject(this.key(tenantId, doc.courseId, doc.importId), Buffer.from(JSON.stringify(doc)), {
      contentType: 'application/json',
    });
  }

  /** Testo dei documenti di knowledge scelti (devono essere pronti e del tenant). */
  private async loadKnowledge(
    tenantId: string,
    documentIds: string[],
  ): Promise<{ text: string; ids: string[]; names: string[] } | null> {
    const ids = [...new Set(documentIds)];
    if (ids.length === 0) return null;
    const docs = await this.prisma.knowledgeDoc.findMany({ where: { id: { in: ids }, tenantId } });
    if (docs.length !== ids.length) throw new BadRequestException('Uno o più documenti di knowledge non sono stati trovati');
    const notReady = docs.filter((d) => d.status !== 'READY').map((d) => d.filename);
    if (notReady.length > 0) throw new BadRequestException(`Documenti non ancora pronti: ${notReady.join(', ')}`);

    const parts: string[] = [];
    let words = 0;
    for (const d of docs) {
      const content = await this.storage.getObject(d.storageKey);
      const extracted = await this.registry.extract({ filename: d.filename, mimeType: d.mimeType, content });
      const text = extracted.text.trim();
      if (!text) continue;
      words += text.split(/\s+/).filter(Boolean).length;
      parts.push(`### FONTE: ${d.filename}\n${text}`);
    }
    if (parts.length === 0) throw new BadRequestException('I documenti di knowledge non contengono testo utilizzabile');
    if (words > MAX_KNOWLEDGE_WORDS) {
      throw new BadRequestException(
        `Knowledge troppo lunga per il confronto (${words} parole, massimo ${MAX_KNOWLEDGE_WORDS}). ` +
          'Crea prima una «knowledge strutturata» dai documenti e usa quella.',
      );
    }
    return { text: parts.join('\n\n'), ids: docs.map((d) => d.id), names: docs.map((d) => d.filename) };
  }

  /** Una chiamata sull'intero deck; le slide mancanti nella risposta vengono rigenerate una per una. */
  private async callLlm(
    tenantId: string,
    courseId: string,
    manifest: SlideImportManifest,
    language: string,
    knowledge: string | null,
  ): Promise<{ slides: Map<number, LlmSlide>; uncovered: LlmUncovered[]; model: string }> {
    const system = [
      ...BASE_RULES(language),
      ...(knowledge ? KNOWLEDGE_RULES : [LENGTH_SLIDES_ONLY]),
      '',
      'Rispondi SOLO con JSON conforme allo schema, con un elemento per ogni slide ricevuta, nello stesso ordine.',
    ].join('\n');
    const deckText = manifest.slides
      .map((s) => `### Slide ${s.index}\n${s.text.trim() || '(nessun testo: slide solo grafica)'}`)
      .join('\n\n');
    const knowledgeBlock = knowledge ? `\n\n=== KNOWLEDGE ===\n${knowledge}` : '';

    const slides = new Map<number, LlmSlide>();
    let uncovered: LlmUncovered[] = [];
    let model = '';
    const run = async (user: string, maxTokens: number, first: boolean): Promise<void> => {
      const result = await this.llm.generate({
        system,
        messages: [{ role: 'user', content: user }],
        schema: (knowledge ? SCHEMA_KNOWLEDGE : SCHEMA_PLAIN) as unknown as Record<string, unknown>,
        temperature: 0.4,
        maxTokens,
      });
      if (result.finishReason === 'max_tokens') throw new Error('Generazione dei copioni troncata (limite token)');
      model = result.model;
      for (const unit of ['INPUT_TOKENS', 'OUTPUT_TOKENS'] as const) {
        await this.meter.record({
          tenantId,
          courseId: meterCourseId(courseId),
          provider: 'BEDROCK_LLM',
          model: result.model,
          unit,
          quantity: unit === 'INPUT_TOKENS' ? result.usage.inputTokens : result.usage.outputTokens,
          source: 'slide_script',
        });
      }
      const parsed = parseOutput(result.text);
      for (const item of parsed.slides) slides.set(item.index, item);
      if (first) uncovered = parsed.uncovered;
    };

    await run(`Presentazione (${manifest.slides.length} slide):\n\n${deckText}${knowledgeBlock}`, knowledge ? 16000 : 8000, true);

    // Recupero delle slide non restituite: una chiamata ciascuna, con il deck come contesto.
    for (const s of manifest.slides) {
      if (slides.get(s.index)?.script.trim()) continue;
      this.logger.warn(`Copione mancante per la slide ${s.index}: rigenero singolarmente`);
      await run(
        `Contesto (intera presentazione):\n\n${deckText}${knowledgeBlock}\n\nScrivi SOLO il copione della slide ${s.index} (lascia "uncovered" vuoto).`,
        3000,
        false,
      );
    }
    for (const s of manifest.slides) {
      if (!slides.get(s.index)?.script.trim()) {
        throw new Error(`Generazione copioni incompleta: manca la slide ${s.index}`);
      }
    }
    return { slides, uncovered: uncovered.filter((u) => u.title?.trim() && u.script?.trim()), model };
  }
}

function buildEntry(
  index: number,
  script: string,
  skip: boolean,
  extras: Partial<Pick<SlideScriptEntry, 'usedKnowledge' | 'conflicts' | 'extra'>> = {},
): SlideScriptEntry {
  const words = script.split(/\s+/).filter(Boolean).length;
  const entry: SlideScriptEntry = { index, script, skip, words, estSec: Math.round(words / WORDS_PER_SEC) };
  if (extras.usedKnowledge !== undefined) entry.usedKnowledge = extras.usedKnowledge;
  if (extras.conflicts !== undefined) entry.conflicts = extras.conflicts;
  if (extras.extra !== undefined) entry.extra = extras.extra;
  return entry;
}

function parseOutput(text: string): { slides: LlmSlide[]; uncovered: LlmUncovered[] } {
  try {
    const parsed = JSON.parse(text) as { slides?: Array<Record<string, unknown>>; uncovered?: Array<Record<string, unknown>> };
    const slides = (parsed.slides ?? [])
      .filter((s) => Number.isInteger(s.index) && typeof s.script === 'string')
      .map((s) => ({
        index: s.index as number,
        script: (s.script as string).trim(),
        usedKnowledge: s.usedKnowledge === true,
        conflicts: Array.isArray(s.conflicts) ? (s.conflicts as unknown[]).filter((c): c is string => typeof c === 'string') : [],
      }));
    const uncovered = (parsed.uncovered ?? [])
      .filter((u) => typeof u.title === 'string' && typeof u.script === 'string')
      .map((u) => ({
        title: u.title as string,
        summary: typeof u.summary === 'string' ? u.summary : '',
        bullets: Array.isArray(u.bullets) ? (u.bullets as unknown[]).filter((b): b is string => typeof b === 'string') : [],
        script: u.script as string,
      }));
    return { slides, uncovered };
  } catch {
    return { slides: [], uncovered: [] };
  }
}

function languageName(code: string): string {
  const c = code.toLowerCase().slice(0, 2);
  const names: Record<string, string> = {
    it: 'italiano',
    en: 'inglese',
    fr: 'francese',
    de: 'tedesco',
    es: 'spagnolo',
    pt: 'portoghese',
  };
  return names[c] ?? code;
}
