import { Inject, Injectable, Logger } from '@nestjs/common';
import type { LLMProvider } from '@scorm/domain';
import { BriefDraft, type BriefDraft as BriefDraftType } from '@scorm/contracts';
import { languageDirective } from '../generation/prompts.js';
import { CoursesService } from '../courses/courses.service.js';
import { UsageMeterService } from '../metering/usage-meter.service.js';
import { LLM_PROVIDER } from '../providers/provider.constants.js';

export interface DraftBriefInput {
  tenantId: string;
  courseId: string;
  topic: string;
  language: string;
  /** Titoli + sommari degli articoli selezionati (contesto per il brief). */
  articles: Array<{ title: string; summary: string }>;
}

/** JSON Schema del sottoinsieme di brief che chiediamo al modello di proporre. */
const BRIEF_DRAFT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'learningObjectives', 'targetAudience', 'level', 'estimatedDurationMinutes', 'description'],
  properties: {
    title: { type: 'string', description: 'Titolo del corso, conciso e chiaro' },
    description: { type: 'string', description: 'Breve descrizione del corso (1-3 frasi)' },
    learningObjectives: {
      type: 'array',
      items: { type: 'string' },
      minItems: 3,
      maxItems: 6,
      description: 'Obiettivi di apprendimento misurabili',
    },
    targetAudience: { type: 'string', description: 'Pubblico destinatario' },
    level: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
    estimatedDurationMinutes: { type: 'integer', minimum: 10, maximum: 480 },
    desiredLessonCount: { type: 'integer', minimum: 2, maximum: 20 },
  },
};

/**
 * Autocompletamento del brief a partire dalle notizie raccolte dai feed.
 * Usa l'LLM (output vincolato a JSON) per proporre titolo, obiettivi, pubblico,
 * livello, durata e descrizione, poi salva una BOZZA di brief sul corso. Quando
 * l'utente apre il brief lo trova precompilato e modificabile.
 */
@Injectable()
export class RssBriefService {
  private readonly logger = new Logger(RssBriefService.name);

  constructor(
    private readonly courses: CoursesService,
    private readonly meter: UsageMeterService,
    @Inject(LLM_PROVIDER) private readonly llm: LLMProvider,
  ) {}

  /** Ritorna true se la bozza è stata generata e salvata. Best-effort. */
  async draftBriefFromArticles(input: DraftBriefInput): Promise<boolean> {
    const context = input.articles
      .slice(0, 20)
      .map((a, i) => `${i + 1}. ${a.title}\n${a.summary}`)
      .join('\n\n')
      .slice(0, 12000);
    if (!context.trim()) return false;

    const result = await this.llm.generate({
      system:
        'Sei un progettista didattico. A partire da una rassegna di notizie su un argomento, ' +
        'proponi il brief di un corso e-learning. Rispondi SOLO con JSON conforme allo schema. ' +
        'Sii concreto e fedele ai contenuti forniti. ' +
        // Stessa direttiva di lingua forte della generazione: la lingua del corso
        // vince SEMPRE, anche se le notizie di riferimento sono in un'altra lingua.
        languageDirective(input.language),
      messages: [
        {
          role: 'user',
          content:
            `Argomento del corso: ${input.topic}\n\n` +
            `Notizie di riferimento (titolo + sommario):\n${context}\n\n` +
            'Proponi il brief del corso.',
        },
      ],
      schema: BRIEF_DRAFT_SCHEMA,
      temperature: 0.4,
      maxTokens: 1200,
    });

    // Metering del consumo LLM dell'autocompletamento brief.
    void this.meter.record({
      tenantId: input.tenantId,
      courseId: input.courseId,
      provider: 'BEDROCK_LLM',
      model: result.model,
      unit: 'INPUT_TOKENS',
      quantity: result.usage.inputTokens,
      source: 'rss_brief',
    });
    void this.meter.record({
      tenantId: input.tenantId,
      courseId: input.courseId,
      provider: 'BEDROCK_LLM',
      model: result.model,
      unit: 'OUTPUT_TOKENS',
      quantity: result.usage.outputTokens,
      source: 'rss_brief',
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.text);
    } catch {
      this.logger.warn('Brief autocompilato: risposta LLM non JSON');
      return false;
    }

    // Costruisce una BriefDraft valida (campi parziali ammessi) dai campi proposti.
    const p = parsed as Record<string, unknown>;
    const draft: BriefDraftType = BriefDraft.parse({
      title: typeof p.title === 'string' ? p.title : input.topic,
      description: typeof p.description === 'string' ? p.description : undefined,
      learningObjectives: Array.isArray(p.learningObjectives)
        ? (p.learningObjectives as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        : undefined,
      targetAudience: typeof p.targetAudience === 'string' ? p.targetAudience : undefined,
      level: p.level === 'beginner' || p.level === 'intermediate' || p.level === 'advanced' ? p.level : undefined,
      estimatedDurationMinutes:
        typeof p.estimatedDurationMinutes === 'number' ? Math.round(p.estimatedDurationMinutes) : undefined,
      desiredLessonCount: typeof p.desiredLessonCount === 'number' ? Math.round(p.desiredLessonCount) : undefined,
      language: input.language,
    });

    await this.courses.saveBriefDraft(input.tenantId, input.courseId, draft);
    return true;
  }
}
