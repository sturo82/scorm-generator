import { Inject, Injectable, Logger } from '@nestjs/common';
import type { LLMProvider } from '@scorm/domain';
import { BriefDraft, type BriefDraft as BriefDraftType, type LessonFormat } from '@scorm/contracts';
import { languageDirective } from '../generation/prompts.js';
import { CoursesService } from '../courses/courses.service.js';
import { UsageMeterService } from '../metering/usage-meter.service.js';
import { LLM_PROVIDER } from '../providers/provider.constants.js';

/** Anteprima congelata approvata dall'autore, spina dorsale del brief. */
export interface FrozenPreviewInput {
  proposedTitle?: string;
  description?: string;
  keyConcepts?: string[];
  suggestedLessons?: string[];
  proposedAudience?: string;
  proposedTone?: string;
  proposedScope?: string;
}

export interface DraftBriefInput {
  tenantId: string;
  courseId: string;
  topic: string;
  language: string;
  /** Pubblico destinatario scelto dall'utente (vincola il brief se presente). */
  audience?: string;
  /** Tono di voce scelto dall'utente (vincola il brief se presente). */
  tone?: string;
  /** Taglio/scope scelto dall'utente (vincola il brief se presente). */
  scope?: string;
  /**
   * Anteprima CONGELATA approvata dall'autore: se presente, il brief ne eredita
   * titolo, descrizione, obiettivi (dai concetti chiave), lezioni suggerite,
   * pubblico, tono e taglio — senza una nuova sintesi LLM — per non discostarsi
   * da ciò che l'utente ha visto. Il brief resta comunque una bozza modificabile.
   */
  preview?: FrozenPreviewInput;
  /**
   * Whitelist di documenti knowledge (le fonti ingerite del corso): salvata nel
   * brief per vincolare il RAG della generazione alle SOLE fonti del corso.
   */
  knowledgeDocIds?: string[];
  /** Formato per-lezione di DEFAULT scelto nell'onboarding (orienta l'outline). */
  lessonFormatDefault?: LessonFormat;
  /** Eccezioni di formato per-lezione, indicizzate per titolo (onboarding). */
  lessonFormatHints?: Record<string, LessonFormat>;
  /** Titoli + sommari degli articoli selezionati (contesto per il brief). */
  articles: Array<{ title: string; summary: string }>;
}

export interface PreviewInput {
  tenantId: string;
  topic: string;
  language: string;
  /** Pubblico destinatario, se specificato dall'utente. Se assente, lo propone l'LLM. */
  audience?: string;
  /** Tono di voce del corso, se specificato dall'utente. Se assente, lo propone l'LLM. */
  tone?: string;
  /**
   * Taglio/scope del corso: l'ANGOLAZIONE con cui trattare l'argomento (es.
   * "pratico-applicativo per docenti; prospettiva d'uso in classe; NO fondamenti
   * tecnici"). Se assente, lo propone l'LLM. Serve a tenere le lezioni dentro
   * l'obiettivo reale del corso, non solo pertinenti al titolo.
   */
  scope?: string;
  articles: Array<{ title: string; summary: string }>;
}

export interface PreviewOutput {
  proposedTitle: string;
  description: string;
  keyConcepts: string[];
  suggestedLessons: string[];
  /** Pubblico destinatario (riflette quello fornito, o proposto dall'LLM). */
  proposedAudience: string;
  /** Tono di voce (riflette quello fornito, o proposto dall'LLM). */
  proposedTone: string;
  /** Taglio/scope del corso (riflette quello fornito, o proposto dall'LLM). */
  proposedScope: string;
}

/** JSON Schema del pre-sommario (anteprima) mostrato prima della generazione. */
const PREVIEW_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'proposedTitle',
    'description',
    'keyConcepts',
    'suggestedLessons',
    'proposedAudience',
    'proposedTone',
    'proposedScope',
  ],
  properties: {
    proposedTitle: { type: 'string', description: 'Titolo proposto per il corso' },
    description: { type: 'string', description: 'Descrizione sintetica (1-2 frasi) del corso' },
    proposedAudience: {
      type: 'string',
      description: 'Pubblico destinatario del corso (chi è lo studente tipo, suo livello/ruolo)',
    },
    proposedTone: {
      type: 'string',
      description: 'Tono di voce consigliato per il corso (es. professionale, divulgativo, informale)',
    },
    proposedScope: {
      type: 'string',
      description:
        "Taglio/angolazione del corso: con quale prospettiva tratta l'argomento per servire il " +
        'pubblico (es. "applicativo: come il docente USA questi strumenti in classe", vs ' +
        '"teorico: come funziona internamente"). Definisce cosa resta DENTRO e cosa è FUORI scope.',
    },
    keyConcepts: {
      type: 'array',
      items: { type: 'string' },
      minItems: 4,
      maxItems: 10,
      description: 'Concetti chiave che il corso svilupperà',
    },
    suggestedLessons: {
      type: 'array',
      items: { type: 'string' },
      minItems: 3,
      maxItems: 8,
      description: 'Titoli delle lezioni/moduli suggeriti',
    },
  },
};

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
    // PERCORSO ANTEPRIMA CONGELATA: se l'autore ha approvato un pre-sommario, il
    // brief ne eredita DIRETTAMENTE struttura e campi (nessuna nuova sintesi LLM,
    // zero costo e zero deriva): titolo, descrizione, obiettivi (dai concetti
    // chiave), lezioni suggerite, pubblico e tono. Resta una bozza modificabile.
    if (this.hasUsablePreview(input.preview)) {
      return this.draftBriefFromPreview(input);
    }

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
            (input.audience?.trim()
              ? `Pubblico destinatario (vincolo): «${input.audience.trim()}». Usa questo valore in targetAudience ` +
                'e adatta obiettivi e livello a questo pubblico.\n'
              : '') +
            (input.tone?.trim()
              ? `Tono di voce (vincolo): «${input.tone.trim()}». La descrizione deve rifletterlo.\n`
              : '') +
            `\nNotizie di riferimento (titolo + sommario):\n${context}\n\n` +
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
      tone: input.tone?.trim() || undefined,
      courseFocus: input.scope?.trim() || undefined,
      // Vincola il RAG della generazione alle SOLE fonti del corso (se presenti).
      knowledgeDocIds: input.knowledgeDocIds?.length ? input.knowledgeDocIds : undefined,
      // Questi documenti SONO le fonti costitutive del corso (marcatore per la UI).
      courseSourceDocIds: input.knowledgeDocIds?.length ? input.knowledgeDocIds : undefined,
      // Preferenze di formato per-lezione scelte nell'onboarding (orientano l'outline).
      lessonFormatDefault: input.lessonFormatDefault,
      lessonFormatHints:
        input.lessonFormatHints && Object.keys(input.lessonFormatHints).length > 0
          ? input.lessonFormatHints
          : undefined,
      language: input.language,
    });

    await this.courses.saveBriefDraft(input.tenantId, input.courseId, draft);
    return true;
  }

  /** True se l'anteprima ha abbastanza contenuto da fungere da spina dorsale. */
  private hasUsablePreview(preview?: FrozenPreviewInput): preview is FrozenPreviewInput {
    if (!preview) return false;
    const hasConcepts = (preview.keyConcepts?.filter((s) => s.trim()).length ?? 0) > 0;
    const hasLessons = (preview.suggestedLessons?.filter((s) => s.trim()).length ?? 0) > 0;
    return hasConcepts || hasLessons;
  }

  /**
   * Costruisce e salva il brief DALL'anteprima congelata, senza chiamata LLM.
   * Mappa: concetti chiave → obiettivi di apprendimento; lezioni suggerite →
   * suggestedLessons (seed dell'outline) + desiredLessonCount; titolo,
   * descrizione, pubblico e tono dai campi dell'anteprima (o dai valori espliciti
   * dell'utente, che hanno priorità). Livello e durata sono stime di default,
   * modificabili nel wizard. Vincola il RAG alle fonti via knowledgeDocIds.
   */
  private async draftBriefFromPreview(input: DraftBriefInput): Promise<boolean> {
    const pv = input.preview!;
    const clean = (arr?: string[]): string[] => (arr ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
    const concepts = clean(pv.keyConcepts);
    const lessons = clean(pv.suggestedLessons);
    const audience = input.audience?.trim() || pv.proposedAudience?.trim() || undefined;
    const tone = input.tone?.trim() || pv.proposedTone?.trim() || undefined;
    const courseFocus = input.scope?.trim() || pv.proposedScope?.trim() || undefined;

    // Obiettivi: dai concetti chiave; fallback alle lezioni se mancano i concetti.
    const objectives = concepts.length > 0 ? concepts.slice(0, 6) : lessons.slice(0, 6);
    // Durata euristica: ~12 min per lezione suggerita (o per obiettivo), con tetti.
    const lessonCount = lessons.length > 0 ? lessons.length : Math.max(3, objectives.length);
    const estimatedDurationMinutes = Math.min(480, Math.max(20, lessonCount * 12));

    const draft: BriefDraftType = BriefDraft.parse({
      title: pv.proposedTitle?.trim() || input.topic,
      description: pv.description?.trim() || undefined,
      learningObjectives: objectives.length > 0 ? objectives : undefined,
      targetAudience: audience,
      level: 'beginner',
      estimatedDurationMinutes,
      desiredLessonCount: lessons.length > 0 ? Math.min(20, Math.max(2, lessons.length)) : undefined,
      suggestedLessons: lessons.length > 0 ? lessons : undefined,
      tone,
      courseFocus,
      knowledgeDocIds: input.knowledgeDocIds?.length ? input.knowledgeDocIds : undefined,
      // Marcatore UI: questi documenti sono le fonti costitutive del corso.
      courseSourceDocIds: input.knowledgeDocIds?.length ? input.knowledgeDocIds : undefined,
      // Preferenze di formato per-lezione scelte nell'onboarding (orientano l'outline).
      lessonFormatDefault: input.lessonFormatDefault,
      lessonFormatHints:
        input.lessonFormatHints && Object.keys(input.lessonFormatHints).length > 0
          ? input.lessonFormatHints
          : undefined,
      language: input.language,
    });

    await this.courses.saveBriefDraft(input.tenantId, input.courseId, draft);
    return true;
  }

  /**
   * Sintetizza un PRE-SOMMARIO del corso (anteprima) dai titoli/sommari trovati:
   * titolo proposto, descrizione, concetti chiave e lezioni suggerite. Non crea
   * nulla; serve a dare all'autore consapevolezza di cosa otterrà. Lingua forzata
   * a quella del corso (anche se le fonti sono in un'altra lingua).
   */
  async previewFromArticles(input: PreviewInput): Promise<PreviewOutput> {
    const context = input.articles
      .slice(0, 24)
      .map((a, i) => `${i + 1}. ${a.title}\n${a.summary}`)
      .join('\n\n')
      .slice(0, 12000);

    const audience = input.audience?.trim();
    const tone = input.tone?.trim();
    // Vincoli: se l'utente ha indicato target e/o tono, il pre-sommario DEVE
    // esservi coerente (e proposedAudience/proposedTone li ripetono invariati);
    // altrimenti l'LLM li propone lui.
    const constraints: string[] = [];
    if (audience) {
      constraints.push(
        `Il corso è rivolto a questo pubblico: «${audience}». Adatta concetti e lezioni a questo pubblico ` +
          'e riporta lo stesso valore nel campo proposedAudience.',
      );
    } else {
      constraints.push('Proponi tu il pubblico destinatario più adatto nel campo proposedAudience.');
    }
    if (tone) {
      constraints.push(
        `Usa questo tono di voce: «${tone}». Descrizione e lezioni devono rifletterlo, e riporta lo stesso ` +
          'valore nel campo proposedTone.',
      );
    } else {
      constraints.push('Proponi tu il tono di voce più adatto nel campo proposedTone.');
    }
    const scope = input.scope?.trim();
    if (scope) {
      constraints.push(
        `TAGLIO/SCOPE del corso (vincolo forte): «${scope}». Concetti e lezioni DEVONO restare dentro ` +
          'questo taglio; ESCLUDI tutto ciò che ne esce, anche se pertinente al titolo. Riporta lo stesso ' +
          'valore nel campo proposedScope.',
      );
    } else {
      constraints.push(
        'Proponi tu il TAGLIO/SCOPE più adatto nel campo proposedScope: con quale angolazione il corso ' +
          'serve il pubblico (es. applicativo vs teorico), definendo cosa resta dentro e cosa fuori.',
      );
    }

    const result = await this.llm.generate({
      system:
        'Sei un progettista didattico. A partire da una rassegna di contenuti su un argomento, ' +
        'proponi un PRE-SOMMARIO del corso che si potrebbe generare: titolo, descrizione sintetica, ' +
        'pubblico destinatario, tono di voce, taglio/scope, i concetti chiave che verranno sviluppati e ' +
        'le lezioni suggerite. Rispondi SOLO con JSON conforme allo schema. Sii concreto e fedele ai ' +
        'contenuti forniti. ' +
        // Regola di SCOPE: le lezioni devono servire il PUBBLICO nel fare ciò che il corso promette.
        'REGOLA DI SCOPE: ragiona sempre dal punto di vista del pubblico e dell\'obiettivo del corso. ' +
        'Se il taglio è applicativo/professionale (es. "usare uno strumento nel proprio lavoro"), NON ' +
        'includere lezioni che spiegano il dominio "dall\'interno" o i suoi fondamenti tecnici/teorici, a ' +
        'meno che non siano strettamente necessari all\'uso pratico. Una lezione pertinente al TITOLO ma ' +
        'non all\'OBIETTIVO del pubblico è FUORI scope e va esclusa. ' +
        languageDirective(input.language),
      messages: [
        {
          role: 'user',
          content:
            `Argomento: ${input.topic}\n\n` +
            `Vincoli:\n- ${constraints.join('\n- ')}\n\n` +
            `Contenuti di riferimento (titolo + sommario):\n${context || '(nessun contenuto: basati sull\'argomento)'}\n\n` +
            'Proponi il pre-sommario del corso.',
        },
      ],
      schema: PREVIEW_SCHEMA,
      temperature: 0.4,
      maxTokens: 1200,
    });

    // Metering del consumo LLM dell'anteprima (courseId null: non ancora creato).
    void this.meter.record({
      tenantId: input.tenantId,
      courseId: null,
      provider: 'BEDROCK_LLM',
      model: result.model,
      unit: 'INPUT_TOKENS',
      quantity: result.usage.inputTokens,
      source: 'rss_preview',
    });
    void this.meter.record({
      tenantId: input.tenantId,
      courseId: null,
      provider: 'BEDROCK_LLM',
      model: result.model,
      unit: 'OUTPUT_TOKENS',
      quantity: result.usage.outputTokens,
      source: 'rss_preview',
    });

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(result.text) as Record<string, unknown>;
    } catch {
      this.logger.warn('Anteprima: risposta LLM non JSON');
    }
    const asStrings = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
    // Il valore fornito dall'utente ha priorità; altrimenti quello proposto dall'LLM.
    const outAudience =
      audience || (typeof parsed.proposedAudience === 'string' ? parsed.proposedAudience.trim() : '');
    const outTone = tone || (typeof parsed.proposedTone === 'string' ? parsed.proposedTone.trim() : '');
    const outScope = scope || (typeof parsed.proposedScope === 'string' ? parsed.proposedScope.trim() : '');
    return {
      proposedTitle: typeof parsed.proposedTitle === 'string' ? parsed.proposedTitle : input.topic,
      description: typeof parsed.description === 'string' ? parsed.description : '',
      keyConcepts: asStrings(parsed.keyConcepts),
      suggestedLessons: asStrings(parsed.suggestedLessons),
      proposedAudience: outAudience,
      proposedTone: outTone,
      proposedScope: outScope,
    };
  }
}
