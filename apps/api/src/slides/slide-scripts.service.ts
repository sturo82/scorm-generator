import { BadRequestException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import type { LLMProvider, ObjectStorage } from '@scorm/domain';
import type { UpdateSlideScripts } from '@scorm/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsageMeterService } from '../metering/usage-meter.service.js';
import { LLM_PROVIDER, OBJECT_STORAGE } from '../providers/provider.constants.js';
import { SlidesService, type SlideImportManifest } from './slides.service.js';

/** Velocità di parlato stimata (parole/secondo) per prevedere la durata del video. */
const WORDS_PER_SEC = 2.4;

export interface SlideScriptEntry {
  index: number;
  script: string;
  skip: boolean;
  /** Parole del copione e durata stimata (s): solo indicativa, la durata reale è quella della clip. */
  words: number;
  estSec: number;
}

export interface SlideScriptsDoc {
  importId: string;
  courseId: string;
  language: string;
  /** 'draft' = da rivedere; 'approved' = via libera alla generazione delle clip. */
  status: 'draft' | 'approved';
  model: string;
  updatedAt: string;
  slides: SlideScriptEntry[];
  totalWords: number;
  estTotalSec: number;
}

const SYSTEM_PROMPT = (language: string): string =>
  [
    'Sei un autore di video-lezioni aziendali. Ricevi il testo estratto da una presentazione (slide numerate) e scrivi,',
    'per OGNI slide, il copione PARLATO che un docente-avatar pronuncerà mentre la slide è a schermo.',
    '',
    'Regole di contenuto (il tema può essere sensibile, ad esempio tutela dei minori):',
    '- Sii FEDELE alle slide: non aggiungere fatti, numeri, norme, esempi o consigli che non siano nel testo. Puoi riformulare e collegare, non inventare.',
    '- Mantieni il significato e il livello di cautela dell\'originale. Non attenuare né rafforzare le prescrizioni.',
    '- Niente frasi di cornice che affermino cose nuove (es. "riguarda tutti senza eccezioni", "tre pilastri", "più dannosi"): le slide di raccordo introducono solo il tema successivo, con le parole delle slide.',
    '- Se il testo di una slide è troppo scarno per dire altro, scrivi una frase breve: meglio corto che inventato.',
    '',
    'Regole di stile:',
    `- Lingua del copione: ${language}. Traduci in modo naturale il testo delle slide se è in un'altra lingua.`,
    '- Tono professionale ma caldo e amichevole, rivolto a un pubblico di allenatori e staff: dai del "voi" o usa forme impersonali, mai del "tu".',
    '- Parlato, non elenco: frasi complete da leggere ad alta voce, senza markdown, senza simboli, senza numeri di slide, senza "come potete vedere in questa slide".',
    '- Le liste diventano un discorso fluido ("innanzitutto", "poi", "infine"), senza ripetere letteralmente ogni voce se non serve.',
    '- Il testo estratto può avere parole spezzate da spazi ("CHI LD SAFEGUARDI NG"): ricostruiscile. Ignora diciture legali o di copyright ricorrenti.',
    '- Dai continuità al discorso tra una slide e l\'altra, senza riassumere ogni volta e senza salutare di nuovo.',
    '- Slide di apertura: breve benvenuto e presentazione del tema. Slide di sezione (solo titolo): una frase di raccordo. Slide finale: breve chiusura.',
    '- Lunghezza: 25-45 parole per slide di sezione o titolo, 60-110 per le slide con contenuto, mai oltre 130.',
    '',
    'Rispondi SOLO con JSON conforme allo schema, con un elemento per ogni slide ricevuta, nello stesso ordine.',
  ].join('\n');

const SCHEMA = {
  type: 'object',
  properties: {
    slides: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          script: { type: 'string' },
        },
        required: ['index', 'script'],
      },
    },
  },
  required: ['slides'],
} as const;

/**
 * Fase 1 della pipeline "slide + avatar": genera i copioni italiani per slide
 * con una sola chiamata LLM sull'intero deck (per dare continuità al discorso),
 * li salva accanto all'import e li espone per revisione/modifica. Le clip avatar
 * (a pagamento) si generano solo a copioni APPROVATI.
 */
@Injectable()
export class SlideScriptsService {
  private readonly logger = new Logger(SlideScriptsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly slides: SlidesService,
    private readonly meter: UsageMeterService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(LLM_PROVIDER) private readonly llm: LLMProvider,
  ) {}

  private key(tenantId: string, courseId: string, importId: string): string {
    return `media/${tenantId}/${courseId}/slides/${importId}/scripts.json`;
  }

  async get(tenantId: string, courseId: string, importId: string): Promise<SlideScriptsDoc | null> {
    await this.slides.loadManifest(tenantId, courseId, importId);
    const key = this.key(tenantId, courseId, importId);
    if (!(await this.storage.exists(key))) return null;
    return JSON.parse((await this.storage.getObject(key)).toString('utf8')) as SlideScriptsDoc;
  }

  /** Genera (o rigenera) i copioni. Rifiuta se i copioni correnti sono già approvati. */
  async generate(tenantId: string, courseId: string, importId: string): Promise<SlideScriptsDoc> {
    const manifest = await this.slides.loadManifest(tenantId, courseId, importId);
    const existing = await this.get(tenantId, courseId, importId);
    if (existing?.status === 'approved') {
      throw new ConflictException('I copioni sono già approvati: modificali per riaprire la revisione.');
    }
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, tenantId },
      select: { language: true },
    });
    const language = languageName(course?.language ?? 'it');

    const { scripts, model } = await this.callLlm(tenantId, courseId, manifest, language);
    const entries = manifest.slides.map((s) => buildEntry(s.index, scripts.get(s.index) ?? '', false));
    const doc = this.toDoc(importId, courseId, language, 'draft', model, entries);
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
    const manifest = await this.slides.loadManifest(tenantId, courseId, importId);
    const existing = await this.get(tenantId, courseId, importId);
    if (!existing) throw new BadRequestException('Genera prima i copioni');

    const valid = new Set(manifest.slides.map((s) => s.index));
    const byIndex = new Map(input.slides.map((s) => [s.index, s]));
    for (const idx of byIndex.keys()) {
      if (!valid.has(idx)) throw new BadRequestException(`Slide ${idx} inesistente`);
    }
    const entries = existing.slides.map((e) => {
      const u = byIndex.get(e.index);
      return u ? buildEntry(e.index, u.script.trim(), u.skip) : e;
    });
    if (input.approved) {
      const empty = entries.filter((e) => !e.skip && e.script.trim().length === 0).map((e) => e.index);
      if (empty.length > 0) {
        throw new BadRequestException(`Copione vuoto per le slide: ${empty.join(', ')}. Compilale o escludile.`);
      }
      if (entries.every((e) => e.skip)) throw new BadRequestException('Tutte le slide sono escluse');
    }
    const doc = this.toDoc(importId, courseId, existing.language, input.approved ? 'approved' : 'draft', existing.model, entries);
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
  ): SlideScriptsDoc {
    const active = slides.filter((s) => !s.skip);
    return {
      importId,
      courseId,
      language,
      status,
      model,
      updatedAt: new Date().toISOString(),
      slides,
      totalWords: active.reduce((n, s) => n + s.words, 0),
      estTotalSec: active.reduce((n, s) => n + s.estSec, 0),
    };
  }

  private async save(tenantId: string, doc: SlideScriptsDoc): Promise<void> {
    await this.storage.putObject(this.key(tenantId, doc.courseId, doc.importId), Buffer.from(JSON.stringify(doc)), {
      contentType: 'application/json',
    });
  }

  /** Una chiamata sull'intero deck; le slide mancanti nella risposta vengono rigenerate una per una. */
  private async callLlm(
    tenantId: string,
    courseId: string,
    manifest: SlideImportManifest,
    language: string,
  ): Promise<{ scripts: Map<number, string>; model: string }> {
    const system = SYSTEM_PROMPT(language);
    const deckText = manifest.slides
      .map((s) => `### Slide ${s.index}\n${s.text.trim() || '(nessun testo: slide solo grafica)'}`)
      .join('\n\n');

    const scripts = new Map<number, string>();
    let model = '';
    const run = async (user: string, maxTokens: number): Promise<void> => {
      const result = await this.llm.generate({
        system,
        messages: [{ role: 'user', content: user }],
        schema: SCHEMA,
        temperature: 0.4,
        maxTokens,
      });
      model = result.model;
      for (const unit of ['INPUT_TOKENS', 'OUTPUT_TOKENS'] as const) {
        await this.meter.record({
          tenantId,
          courseId,
          provider: 'BEDROCK_LLM',
          model: result.model,
          unit,
          quantity: unit === 'INPUT_TOKENS' ? result.usage.inputTokens : result.usage.outputTokens,
          source: 'slide_script',
        });
      }
      for (const item of parseScripts(result.text)) scripts.set(item.index, item.script);
    };

    await run(`Presentazione (${manifest.slides.length} slide):\n\n${deckText}`, 8000);

    // Recupero delle slide non restituite: una chiamata ciascuna, con il deck come contesto.
    for (const s of manifest.slides) {
      if (scripts.has(s.index) && scripts.get(s.index)!.trim()) continue;
      this.logger.warn(`Copione mancante per la slide ${s.index}: rigenero singolarmente`);
      await run(
        `Contesto (intera presentazione):\n\n${deckText}\n\nScrivi SOLO il copione della slide ${s.index}.`,
        1200,
      );
    }
    for (const s of manifest.slides) {
      if (!scripts.get(s.index)?.trim()) {
        throw new Error(`Generazione copioni incompleta: manca la slide ${s.index}`);
      }
    }
    return { scripts, model };
  }
}

function buildEntry(index: number, script: string, skip: boolean): SlideScriptEntry {
  const words = script.split(/\s+/).filter(Boolean).length;
  return { index, script, skip, words, estSec: Math.round(words / WORDS_PER_SEC) };
}

function parseScripts(text: string): Array<{ index: number; script: string }> {
  try {
    const parsed = JSON.parse(text) as { slides?: Array<{ index?: unknown; script?: unknown }> };
    return (parsed.slides ?? [])
      .filter((s) => Number.isInteger(s.index) && typeof s.script === 'string')
      .map((s) => ({ index: s.index as number, script: (s.script as string).trim() }));
  } catch {
    return [];
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
