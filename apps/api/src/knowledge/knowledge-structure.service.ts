import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { StructureKnowledge } from '@scorm/contracts';
import type { DocumentExtractor, JobQueue, LLMProvider, ObjectStorage } from '@scorm/domain';
import { DocumentExtractorRegistry } from '@scorm/adapters/extractors';
import { UsageMeterService } from '../metering/usage-meter.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  DOCUMENT_EXTRACTORS,
  JOB_QUEUE,
  LLM_PROVIDER,
  OBJECT_STORAGE,
} from '../providers/provider.constants.js';
import type { KnowledgeDocView } from './knowledge.service.js';

/** Parole massime per segmento della fase "mappa" (circa 8-9k token in ingresso). */
const SEGMENT_WORDS = 6000;
/** Sotto questa soglia il documento si struttura in una sola chiamata. */
const SINGLE_PASS_WORDS = 9000;
/** Tetto di sicurezza sul totale delle fonti (circa 4 ore di parlato). */
const MAX_TOTAL_WORDS = 60000;
const MAP_CONCURRENCY = 3;

const LANGUAGE_NAMES: Record<string, string> = {
  it: 'italiano', en: 'inglese', fr: 'francese', de: 'tedesco', es: 'spagnolo', pt: 'portoghese',
};

const NOTES_SCHEMA = {
  type: 'object',
  properties: {
    topics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          points: { type: 'array', items: { type: 'string' } },
          definitions: {
            type: 'array',
            items: {
              type: 'object',
              properties: { term: { type: 'string' }, meaning: { type: 'string' } },
              required: ['term', 'meaning'],
            },
          },
        },
        required: ['title', 'points'],
      },
    },
    unclear: { type: 'array', items: { type: 'string' } },
  },
  required: ['topics'],
} as const;

interface Notes {
  topics: Array<{ title: string; points: string[]; definitions?: Array<{ term: string; meaning: string }> }>;
  unclear?: string[];
}

const FIDELITY_RULES = [
  'Regole di fedeltà (il materiale può riguardare temi sensibili):',
  '- Usa SOLO ciò che è nel testo. Non aggiungere fatti, numeri, norme, esempi o consigli tuoi.',
  '- Conserva il significato e il livello di cautela originali: non rendere più forte o più debole un\'affermazione.',
  '- Se il testo è ambiguo, incompleto o si contraddice, non risolverlo: segnalalo tra i punti da chiarire.',
  '- Il testo può essere una trascrizione parlata: ignora esitazioni, ripetizioni e chiacchiere non pertinenti, ma non eliminare contenuto informativo.',
].join('\n');

/**
 * Crea una "knowledge strutturata": a partire da documenti già caricati (anche
 * trascrizioni lunghe) produce un documento Markdown ordinato (sintesi, argomenti,
 * concetti chiave, punti da chiarire) e lo salva come nuova fonte, che entra nel
 * RAG come ogni altro documento. Per testi lunghi lavora in due fasi: estrae note
 * strutturate da ogni segmento e poi le fonde nel documento finale.
 */
@Injectable()
export class KnowledgeStructureService {
  private readonly logger = new Logger(KnowledgeStructureService.name);
  private readonly registry: DocumentExtractorRegistry;

  constructor(
    private readonly prisma: PrismaService,
    private readonly meter: UsageMeterService,
    @Inject(DOCUMENT_EXTRACTORS) extractors: DocumentExtractor[],
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(LLM_PROVIDER) private readonly llm: LLMProvider,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
  ) {
    this.registry = new DocumentExtractorRegistry(extractors);
  }

  /** Avvia la creazione: ritorna subito il nuovo documento (in elaborazione). */
  async start(
    tenantId: string,
    input: StructureKnowledge,
    correlationId?: string,
  ): Promise<KnowledgeDocView> {
    if (input.scope === 'COURSE') {
      const course = await this.prisma.course.findFirst({
        where: { id: input.courseId, tenantId },
        select: { id: true },
      });
      if (!course) throw new NotFoundException('Corso non trovato per il tenant');
    }
    const sources = await this.prisma.knowledgeDoc.findMany({
      where: { id: { in: input.documentIds }, tenantId },
    });
    if (sources.length !== new Set(input.documentIds).size) {
      throw new NotFoundException('Uno o più documenti non sono stati trovati');
    }
    const notReady = sources.filter((d) => d.status !== 'READY').map((d) => d.filename);
    if (notReady.length > 0) {
      throw new BadRequestException(`Documenti non ancora pronti: ${notReady.join(', ')}`);
    }

    const docId = randomUUID();
    const safe = input.title.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'knowledge';
    const filename = `${safe}.md`;
    const storageKey = `knowledge/${tenantId}/${docId}/${filename}`;
    const doc = await this.prisma.knowledgeDoc.create({
      data: {
        id: docId,
        tenantId,
        scope: input.scope,
        courseId: input.scope === 'COURSE' ? input.courseId : null,
        filename,
        mimeType: 'text/markdown',
        sizeBytes: 0,
        storageKey,
        status: 'PROCESSING',
      },
    });

    void this.run(tenantId, doc.id, storageKey, input, sources, correlationId).catch(async (err) => {
      const message = err instanceof Error ? err.message : 'errore sconosciuto';
      this.logger.error(`Knowledge strutturata ${doc.id} fallita: ${message}`);
      await this.prisma.knowledgeDoc
        .update({ where: { id: doc.id }, data: { status: 'FAILED', error: message.slice(0, 500) } })
        .catch(() => undefined);
    });

    return {
      id: doc.id,
      filename: doc.filename,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      scope: doc.scope,
      courseId: doc.courseId,
      status: doc.status,
    };
  }

  private async run(
    tenantId: string,
    docId: string,
    storageKey: string,
    input: StructureKnowledge,
    sources: Array<{ id: string; filename: string; mimeType: string; storageKey: string; courseId: string | null }>,
    correlationId?: string,
  ): Promise<void> {
    const language = LANGUAGE_NAMES[input.language.slice(0, 2).toLowerCase()] ?? input.language;
    const meterCourseId: string | null = input.scope === 'COURSE' ? (input.courseId ?? null) : null;

    // 1. Testo delle fonti, in ordine.
    const texts: Array<{ name: string; text: string }> = [];
    for (const s of sources) {
      const content = await this.storage.getObject(s.storageKey);
      const extracted = await this.registry.extract({ filename: s.filename, mimeType: s.mimeType, content });
      if (extracted.text.trim()) texts.push({ name: s.filename, text: extracted.text.trim() });
    }
    if (texts.length === 0) throw new Error('Le fonti non contengono testo utilizzabile');
    const totalWords = texts.reduce((n, t) => n + countWords(t.text), 0);
    if (totalWords > MAX_TOTAL_WORDS) {
      throw new Error(
        `Fonti troppo lunghe (${totalWords} parole, massimo ${MAX_TOTAL_WORDS}): selezionane meno o dividile.`,
      );
    }

    // 2. Struttura: una chiamata se il testo è breve, altrimenti mappa + fusione.
    let markdown: string;
    const sourceNames = texts.map((t) => t.name).join(', ');
    if (totalWords <= SINGLE_PASS_WORDS) {
      const body = texts.map((t) => `### Fonte: ${t.name}\n${t.text}`).join('\n\n');
      markdown = await this.writeDocument(tenantId, meterCourseId, input.title, language, sourceNames, body, 'testo');
    } else {
      const segments = texts.flatMap((t) => splitSegments(t.text, SEGMENT_WORDS).map((s, i, a) => ({
        label: a.length > 1 ? `${t.name} (parte ${i + 1}/${a.length})` : t.name,
        text: s,
      })));
      this.logger.log(`Knowledge strutturata ${docId}: ${totalWords} parole in ${segments.length} segmenti`);
      const notes: string[] = new Array(segments.length);
      let next = 0;
      const worker = async (): Promise<void> => {
        for (;;) {
          const i = next++;
          if (i >= segments.length) return;
          const seg = segments[i]!;
          notes[i] = await this.extractNotes(tenantId, meterCourseId, language, seg.label, seg.text);
        }
      };
      await Promise.all(Array.from({ length: Math.min(MAP_CONCURRENCY, segments.length) }, worker));
      markdown = await this.writeDocument(
        tenantId, meterCourseId, input.title, language, sourceNames, notes.join('\n\n'), 'note',
      );
    }

    // 3. Salvataggio e ingestione come ogni altro documento.
    const body = Buffer.from(markdown, 'utf8');
    await this.storage.putObject(storageKey, body, {
      contentType: 'text/markdown',
      custom: { tenantId, documentId: docId },
    });
    await this.prisma.knowledgeDoc.update({
      where: { id: docId },
      data: { sizeBytes: body.byteLength, status: 'PENDING', error: null },
    });
    await this.jobs.enqueue(
      'knowledge.ingest',
      { documentId: docId },
      { tenant: { tenantId }, correlationId: correlationId ?? randomUUID() },
    );
    this.logger.log(`Knowledge strutturata ${docId} creata (${totalWords} parole in ingresso)`);
  }

  /** Fase mappa: note strutturate di un segmento, in forma testuale compatta. */
  private async extractNotes(
    tenantId: string,
    courseId: string | null,
    language: string,
    label: string,
    text: string,
  ): Promise<string> {
    const result = await this.llm.generate({
      system: 'Sei un analista che organizza materiale formativo grezzo in note strutturate e fedeli.',
      messages: [
        {
          role: 'user',
          content: [
            `Lingua delle note: ${language}.`,
            'Dal testo seguente estrai gli argomenti trattati. Per ciascuno: un titolo breve, i punti informativi (frasi complete e autonome) e le eventuali definizioni di termini.',
            'In "unclear" elenca ciò che è ambiguo, incompleto o contraddittorio.',
            FIDELITY_RULES,
            '',
            `FONTE: ${label}`,
            text,
          ].join('\n'),
        },
      ],
      schema: NOTES_SCHEMA as unknown as Record<string, unknown>,
      temperature: 0.2,
      maxTokens: 6000,
    });
    await this.record(tenantId, courseId, result);
    if (result.finishReason === 'max_tokens') throw new Error(`Note troncate per ${label}`);
    const notes = JSON.parse(result.text) as Notes;
    const lines: string[] = [`## Note da: ${label}`];
    for (const t of notes.topics ?? []) {
      lines.push(`### ${t.title}`);
      for (const p of t.points ?? []) lines.push(`- ${p}`);
      for (const d of t.definitions ?? []) lines.push(`- Definizione — ${d.term}: ${d.meaning}`);
    }
    if (notes.unclear?.length) {
      lines.push('### Da chiarire');
      for (const u of notes.unclear) lines.push(`- ${u}`);
    }
    return lines.join('\n');
  }

  /** Documento finale in Markdown, dal testo (passata unica) o dalle note (testi lunghi). */
  private async writeDocument(
    tenantId: string,
    courseId: string | null,
    title: string,
    language: string,
    sourceNames: string,
    material: string,
    kind: 'testo' | 'note',
  ): Promise<string> {
    const result = await this.llm.generate({
      system: 'Sei un redattore di knowledge base aziendali: organizzi materiale formativo in documenti chiari e fedeli.',
      messages: [
        {
          role: 'user',
          content: [
            `Scrivi in ${language} un documento di knowledge strutturato in Markdown dal ${kind === 'note' ? 'materiale di note' : 'testo'} seguente.`,
            'Struttura OBBLIGATORIA, con questi titoli di secondo livello e in quest\'ordine:',
            `# ${title}`,
            '## Sintesi — 120-200 parole, il quadro generale.',
            '## Argomenti — un "###" per argomento, con i punti principali come elenco puntato; unisci i duplicati e ordina in modo logico, non per ordine di apparizione se non ha senso.',
            '## Concetti chiave e glossario — termini importanti con definizione breve (solo se presenti nel testo).',
            '## Indicazioni operative — procedure, regole e cosa fare/non fare, SOLO se presenti nel testo; altrimenti ometti la sezione.',
            '## Punti da chiarire — ambiguità, lacune o contraddizioni emerse; se non ce ne sono scrivi "Nessuno rilevato".',
            FIDELITY_RULES,
            'Restituisci SOLO il Markdown, senza commenti prima o dopo.',
            '',
            `FONTI: ${sourceNames}`,
            '',
            material,
          ].join('\n'),
        },
      ],
      temperature: 0.2,
      maxTokens: 12000,
    });
    await this.record(tenantId, courseId, result);
    if (result.finishReason === 'max_tokens') throw new Error('Documento troncato (limite token)');
    const md = result.text.trim();
    if (md.length < 200) throw new Error('Documento generato troppo breve');
    const header = `> Documento generato dall'AI a partire da: ${sourceNames}. Da verificare prima dell'uso.\n\n`;
    return md.startsWith('#') ? md.replace(/^(#[^\n]*\n)/, `$1\n${header}`) : header + md;
  }

  private async record(
    tenantId: string,
    courseId: string | null,
    result: { model: string; usage: { inputTokens: number; outputTokens: number } },
  ): Promise<void> {
    for (const unit of ['INPUT_TOKENS', 'OUTPUT_TOKENS'] as const) {
      await this.meter.record({
        tenantId,
        courseId,
        provider: 'BEDROCK_LLM',
        model: result.model,
        unit,
        quantity: unit === 'INPUT_TOKENS' ? result.usage.inputTokens : result.usage.outputTokens,
        source: 'knowledge_structure',
      });
    }
  }
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Divide un testo in segmenti di circa `maxWords` parole, spezzando ai confini di paragrafo. */
export function splitSegments(text: string, maxWords: number): string[] {
  const paragraphs = text.split(/\n{2,}/);
  const out: string[] = [];
  let buf: string[] = [];
  let words = 0;
  const flush = (): void => {
    if (buf.length) out.push(buf.join('\n\n'));
    buf = [];
    words = 0;
  };
  for (const p of paragraphs) {
    const w = countWords(p);
    if (w > maxWords) {
      // Paragrafo enorme (trascrizione senza a capo): taglia per parole.
      flush();
      const tokens = p.split(/\s+/).filter(Boolean);
      for (let i = 0; i < tokens.length; i += maxWords) out.push(tokens.slice(i, i + maxWords).join(' '));
      continue;
    }
    if (words + w > maxWords) flush();
    buf.push(p);
    words += w;
  }
  flush();
  return out;
}
