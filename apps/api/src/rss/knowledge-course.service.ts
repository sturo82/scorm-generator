import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { CoursesService } from '../courses/courses.service.js';
import { RetrievalService } from '../knowledge/retrieval.service.js';
import type { LessonFormat } from '@scorm/contracts';
import { RssBriefService } from './rss-brief.service.js';
import type { RssPreviewResult, FrozenPreview } from './rss-import.service.js';

/** Quanti chunk al massimo raccogliere per sintetizzare l'anteprima. */
const PREVIEW_CHUNK_LIMIT = 40;

export interface PreviewFromKnowledgeInput {
  tenantId: string;
  /** Documenti della knowledge GLOBAL scelti come fonti del corso. */
  documentIds: string[];
  language: string;
  /** Argomento/titolo indicativo (opzionale): orienta la sintesi. */
  topic?: string;
  audience?: string;
  tone?: string;
  scope?: string;
}

export interface CreateFromKnowledgeInput extends PreviewFromKnowledgeInput {
  title?: string;
  /** Anteprima CONGELATA approvata dall'autore (spina dorsale del corso). */
  preview?: FrozenPreview;
  /** Formato per-lezione di DEFAULT scelto nell'onboarding (orienta l'outline). */
  lessonFormatDefault?: LessonFormat;
  /** Eccezioni di formato per-lezione, indicizzate per titolo (onboarding). */
  lessonFormatHints?: Record<string, LessonFormat>;
}

export interface CreateFromKnowledgeResult {
  courseId: string;
  /** Numero di documenti knowledge collegati come fonti del corso. */
  importedCount: number;
  briefDrafted: boolean;
}

/**
 * Crea un corso "DAL MIO MATERIALE": niente ricerca web, le fonti sono i
 * documenti della knowledge GLOBAL del tenant scelti dall'autore. Riusa il
 * motore di anteprima/brief del flusso "da argomento" (RssBriefService),
 * alimentandolo con i CHUNK dei documenti selezionati invece che con articoli.
 * I documenti sono già indicizzati: non vengono ri-ingeriti, si agganciano al
 * corso come whitelist RAG (knowledgeDocIds) e marcatore fonti (courseSourceDocIds).
 */
@Injectable()
export class KnowledgeCourseService {
  private readonly logger = new Logger(KnowledgeCourseService.name);

  constructor(
    private readonly courses: CoursesService,
    private readonly retrieval: RetrievalService,
    private readonly briefService: RssBriefService,
  ) {}

  /** Argomento effettivo: quello indicato o un segnaposto neutro. */
  private topicOf(input: { topic?: string }): string {
    return input.topic?.trim() || 'il materiale caricato';
  }

  /** Raccoglie il testo rappresentativo dei documenti scelti come {title, summary}. */
  private async gatherArticles(
    tenantId: string,
    documentIds: string[],
  ): Promise<Array<{ title: string; summary: string }>> {
    const chunks = await this.retrieval.listGlobalChunksByDocs({
      tenantId,
      documentIds,
      limit: PREVIEW_CHUNK_LIMIT,
    });
    // Un "articolo" per chunk: titolo = nome documento (+ sezione), sommario = testo.
    return chunks.map((c) => ({
      title: c.section ? `${c.documentName} — ${c.section}` : c.documentName,
      summary: c.text,
    }));
  }

  /** Anteprima del corso dai documenti scelti (nessuna creazione). */
  async previewFromKnowledge(input: PreviewFromKnowledgeInput): Promise<RssPreviewResult> {
    if (input.documentIds.length === 0) {
      throw new BadRequestException('Seleziona almeno un documento della tua knowledge.');
    }
    const articles = await this.gatherArticles(input.tenantId, input.documentIds);
    if (articles.length === 0) {
      throw new BadRequestException(
        'I documenti scelti non hanno ancora contenuto indicizzato: attendi che l\'elaborazione sia completata.',
      );
    }
    const preview = await this.briefService.previewFromArticles({
      tenantId: input.tenantId,
      topic: this.topicOf(input),
      language: input.language,
      audience: input.audience,
      tone: input.tone,
      scope: input.scope,
      articles,
    });
    return { ...preview, sources: ['La tua knowledge'], examined: articles.length };
  }

  /** Crea il corso dai documenti scelti e precompila la bozza di brief. */
  async createFromKnowledge(input: CreateFromKnowledgeInput): Promise<CreateFromKnowledgeResult> {
    if (input.documentIds.length === 0) {
      throw new BadRequestException('Seleziona almeno un documento della tua knowledge.');
    }
    const preview = input.preview;
    const topic = this.topicOf(input);
    const title = input.title?.trim() || preview?.proposedTitle?.trim() || topic;
    const description = preview?.description?.trim() || `Corso costruito dal materiale selezionato.`;

    const course = await this.courses.create({
      tenantId: input.tenantId,
      title,
      language: input.language,
      description,
    });

    // I documenti GLOBAL sono già indicizzati: si agganciano come fonti del
    // corso (whitelist RAG + marcatore), senza ri-ingestione. Il brief eredita
    // l'anteprima congelata (o la sintetizza dai chunk se assente).
    let briefDrafted = false;
    try {
      const articles = await this.gatherArticles(input.tenantId, input.documentIds);
      briefDrafted = await this.briefService.draftBriefFromArticles({
        tenantId: input.tenantId,
        courseId: course.id,
        topic,
        language: input.language,
        audience: input.audience,
        tone: input.tone,
        scope: input.scope,
        preview,
        knowledgeDocIds: input.documentIds,
        lessonFormatDefault: input.lessonFormatDefault,
        lessonFormatHints: input.lessonFormatHints,
        articles,
      });
    } catch (err) {
      this.logger.warn(
        `Autocompletamento brief non riuscito (corso ${course.id} da materiale): ${err instanceof Error ? err.message : 'errore'}`,
      );
    }

    return { courseId: course.id, importedCount: input.documentIds.length, briefDrafted };
  }
}
