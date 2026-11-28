import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { FeedProvider, LLMProvider, ObjectStorage, SpeechProvider } from '@scorm/domain';
import {
  PODCAST_LIMITS,
  PodcastArticleRef,
  PodcastBrief,
  PodcastHosts,
  PodcastScript,
  podcastScriptFit,
  podcastScriptWords,
  type PodcastEstimateView,
  type PodcastIdea,
  type PodcastOverlap,
  type PodcastSource,
  type SuggestPodcastIdeas,
} from '@scorm/contracts';
import type { AppConfig } from '../config/configuration.js';
import { BillingService, type BillItem, type Reservation } from '../billing/billing.service.js';
import { RetrievalService } from '../knowledge/retrieval.service.js';
import { formatContext } from '../generation/prompts.js';
import { UsageMeterService } from '../metering/usage-meter.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OBJECT_STORAGE } from '../providers/provider.constants.js';
import { AUDIO_WEIGHT, ENERGY_SPEED, assembleDialogue, energyFactors, podcastProviderOf, scriptAudioUnits, smoothEnergies, textForVoice, tidyScript } from './podcast-audio.js';
import { IDEAS_SCHEMA, REVIEW_SCHEMA, SCRIPT_SCHEMA, ideasPrompt, reviewPrompt, scriptPrompt } from './podcast-prompts.js';
import { PODCAST_FEED, PODCAST_LLM } from './podcast.constants.js';
import { HEYGEN_VOICE_MODEL, PodcastVoicesService, podcastLocale } from './podcast-voices.service.js';

const LEASE_MS = 5 * 60_000;
const HEARTBEAT_MS = 60_000;
const MAX_CONTEXT_CHARS = 30_000;
const ARTICLE_CHARS = 5_000;
/** Caratteri medi per parola in italiano (spazi compresi), per stimare il costo dell'audio prima di scrivere il copione. */
const CHARS_PER_WORD = 6.5;
const INTERRUPTED = 'Il lavoro è stato interrotto da un riavvio del servizio: riprova.';

const IdeasOut = z.object({ episodes: z.array(z.object({ title: z.string().trim().min(1), summary: z.string().trim() })) });
const ScriptOut = z.object({ turns: z.array(z.object({ host: z.string(), text: z.string(), overlap: z.string().optional(), mood: z.string().optional(), energy: z.number().optional() })) });

type Episode = Prisma.PodcastEpisodeGetPayload<Record<string, never>>;
type PodcastRow = Prisma.PodcastGetPayload<Record<string, never>>;

/** Messaggio leggibile per l'utente a partire da un errore. */
function userMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/\s+/g, ' ').slice(0, 280) || 'Errore sconosciuto';
}

/**
 * Generazione dei podcast: piano della serie, copioni a due conduttori e audio. Ogni passo è un
 * lavoro in background con crediti riservati prima e addebitati solo per il lavoro riuscito.
 * Se il servizio si riavvia il lavoro non riprende da solo: le puntate interrotte tornano in
 * errore, la riserva si libera e l'utente può riprovare.
 */
@Injectable()
export class PodcastGenerationService implements OnModuleInit {
  private readonly logger = new Logger(PodcastGenerationService.name);
  /** Serie con un lavoro in corso in questo processo. */
  private readonly active = new Set<string>();
  /** Serie per cui l'utente ha chiesto di annullare. */
  private readonly cancelled = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PODCAST_LLM) private readonly llm: LLMProvider,
    @Inject(PODCAST_FEED) private readonly feeds: FeedProvider,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly retrieval: RetrievalService,
    private readonly billing: BillingService,
    private readonly meter: UsageMeterService,
    private readonly voices: PodcastVoicesService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  onModuleInit(): void {
    // Dopo l'avvio, libera i lavori rimasti a metà (con un deploy a rotazione i lavori dell'istanza
    // precedente hanno il lease ancora valido e non si toccano).
    const t = setTimeout(() => void this.recoverStale().catch((e) => this.logger.warn(`Recupero lavori podcast: ${userMessage(e)}`)), 20_000);
    t.unref?.();
  }

  // --- Stato e controlli ----------------------------------------------------

  private async requirePodcast(tenantId: string, podcastId: string): Promise<PodcastRow> {
    const p = await this.prisma.podcast.findFirst({ where: { id: podcastId, tenantId } });
    if (!p) throw new NotFoundException('Podcast non trovato');
    return p;
  }

  private async episodesOf(tenantId: string, podcastId: string): Promise<Episode[]> {
    return this.prisma.podcastEpisode.findMany({ where: { podcastId, tenantId }, orderBy: { position: 'asc' } });
  }

  private assertIdle(eps: Episode[]): void {
    if (eps.some((e) => e.state === 'WRITING' || e.state === 'VOICING')) {
      throw new ConflictException('C\u2019è già un lavoro in corso su questa serie: attendi che finisca.');
    }
  }

  /** Chiede di fermare il lavoro in corso: si ferma prima della prossima puntata e si addebita il già fatto. */
  cancel(podcastId: string): void {
    if (this.active.has(podcastId)) this.cancelled.add(podcastId);
  }

  /** Libera i lavori interrotti da un riavvio: puntate in errore e riserve di crediti rilasciate. */
  async recoverStale(): Promise<void> {
    const stale = await this.prisma.podcastEpisode.findMany({
      where: { state: { in: ['WRITING', 'VOICING'] }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] },
    });
    if (stale.length === 0) return;
    const released = new Set<string>();
    for (const e of stale) {
      const res = e.billing as unknown as Reservation | null;
      if (res?.ref && !released.has(res.ref)) {
        released.add(res.ref);
        await this.billing.release(e.tenantId, res).catch((err) => this.logger.warn(`Rilascio riserva ${res.ref}: ${userMessage(err)}`));
      }
      await this.prisma.podcastEpisode.update({
        where: { id: e.id },
        data: { state: 'FAILED', error: INTERRUPTED, leaseUntil: null, billing: Prisma.DbNull },
      });
    }
    this.logger.log(`Puntate podcast interrotte liberate: ${stale.length}`);
  }

  private heartbeat(ids: string[]): NodeJS.Timeout {
    const t = setInterval(() => {
      void this.prisma.podcastEpisode
        .updateMany({ where: { id: { in: ids }, state: { in: ['WRITING', 'VOICING'] } }, data: { leaseUntil: new Date(Date.now() + LEASE_MS) } })
        .catch(() => undefined);
    }, HEARTBEAT_MS);
    t.unref?.();
    return t;
  }

  // --- Fonti ----------------------------------------------------------------

  /** Contesto per l'AI: passaggi dei documenti scelti e testo degli articoli scelti (fonti della puntata, più quelle di default della serie). */
  private async buildContext(
    tenantId: string,
    sources: { docIds: string[]; articles: PodcastArticleRef[] },
    query: string,
  ): Promise<{ text: string; sources: PodcastSource[] }> {
    const parts: string[] = [];
    const used: PodcastSource[] = [];
    if (sources.docIds.length > 0) {
      const found = await this.retrieval.retrieve({ tenantId, text: query, documentIds: sources.docIds, topK: 8 });
      const ctx = formatContext(found.chunks);
      if (ctx) parts.push(ctx);
      for (const c of found.citations) used.push({ kind: 'document', title: c.documentName });
    }
    const texts: string[] = [];
    for (const a of sources.articles) {
      try {
        const fetched = await this.feeds.fetchArticle(a.url);
        const text = fetched.text.replace(/\s+/g, ' ').trim().slice(0, ARTICLE_CHARS);
        if (text) {
          texts.push(`### ${a.title}\n(${a.url})\n${text}`);
          used.push({ kind: 'article', title: a.title, url: a.url });
        }
      } catch (err) {
        this.logger.warn(`Articolo non letto (${a.url}): ${userMessage(err)}`);
      }
    }
    if (texts.length > 0) parts.push(`Articoli di riferimento:\n${texts.join('\n\n')}`);
    return { text: parts.join('\n\n').slice(0, MAX_CONTEXT_CHARS), sources: used };
  }

  /** Fonti di una puntata: le sue, più quelle di default della serie (senza doppioni). */
  private sourcesOf(podcast: PodcastRow, e?: Episode): { docIds: string[]; articles: PodcastArticleRef[] } {
    const strings = z.array(z.string()).catch([]);
    const arts = z.array(PodcastArticleRef).catch([]);
    const docIds = [...new Set([...strings.parse(podcast.knowledgeDocIds), ...(e ? strings.parse(e.knowledgeDocIds) : [])])];
    const articles = [...arts.parse(podcast.articles), ...(e ? arts.parse(e.articles) : [])];
    const seen = new Set<string>();
    return { docIds, articles: articles.filter((a) => (seen.has(a.url) ? false : (seen.add(a.url), true))) };
  }

  private async callLlm(tenantId: string, source: string, system: string, user: string, schema: object, maxTokens: number, temperature = 0.6): Promise<string> {
    const result = await this.llm.generate({
      system,
      messages: [{ role: 'user', content: user }],
      schema: schema as Record<string, unknown>,
      temperature,
      maxTokens,
    });
    for (const unit of ['INPUT_TOKENS', 'OUTPUT_TOKENS'] as const) {
      await this.meter.record({
        tenantId,
        courseId: null,
        provider: 'BEDROCK_LLM',
        model: result.model,
        unit,
        quantity: unit === 'INPUT_TOKENS' ? result.usage.inputTokens : result.usage.outputTokens,
        source,
      });
    }
    return result.text;
  }

  // --- Preventivo -----------------------------------------------------------

  /** Preventivo in crediti. Per l'audio si stima dalla durata (o dal copione, se c'è già). */
  estimate(
    billed: boolean,
    /** Audio: unità già pesate dal copione (`units`), oppure stima dalla durata × peso medio delle voci. */
    work: { plan: boolean; scripts: number; audio: Array<{ minutes: number; units?: number; weight?: number }> },
  ): PodcastEstimateView {
    const lines: PodcastEstimateView['lines'] = [];
    const add = (kind: 'plan' | 'scripts' | 'audio', quantity: number, items: BillItem[]): void => {
      if (quantity <= 0) return;
      const q = this.billing.quote(items);
      lines.push({ kind, quantity: Math.round(quantity * 10) / 10, credits: q.priced ? q.total : null });
    };
    if (work.plan) add('plan', 1, [{ feature: 'text_light', units: 1 }]);
    if (work.scripts > 0) add('scripts', work.scripts, [{ feature: 'text_standard', units: work.scripts }]);
    const units = work.audio.reduce((n, a) => n + (a.units ?? (a.minutes * PODCAST_LIMITS.wordsPerMinute * CHARS_PER_WORD * (a.weight ?? 1)) / 1000), 0);
    if (units > 0) add('audio', units, [{ feature: 'audio_narration', units: this.margin(units) }]);
    return {
      billed,
      priced: lines.every((l) => l.credits !== null),
      total: lines.reduce((n, l) => n + (l.credits ?? 0), 0),
      lines,
    };
  }

  /** Margine sulle unità riservate per l'audio: il copione può uscire un po' più lungo del previsto. */
  private margin(units: number): number {
    return Math.ceil(units * 1.1 * 10) / 10;
  }

  // --- Idee per le prossime puntate -------------------------------------------

  /** Propone idee di puntata (non crea nulla). Costa quanto un testo leggero e si addebita solo se riesce. */
  async suggestIdeas(tenantId: string, podcastId: string, input: SuggestPodcastIdeas): Promise<PodcastIdea[]> {
    const podcast = await this.requirePodcast(tenantId, podcastId);
    const brief = PodcastBrief.parse(podcast.brief);
    const hosts = PodcastHosts.parse(podcast.hosts);
    const existing = (await this.episodesOf(tenantId, podcastId)).map((e) => e.title);
    const reservation = await this.billing.reserve(tenantId, `kscorm:podcast-ideas:${podcastId}:${randomUUID()}`, [{ feature: 'text_light', units: 1 }]);
    try {
      const ctx = await this.buildContext(tenantId, this.sourcesOf(podcast), [input.focus ?? '', brief.topic, ...brief.objectives].filter(Boolean).join('. ') || podcast.title);
      const { system, user } = ideasPrompt({
        language: podcast.language,
        title: podcast.title,
        description: podcast.description,
        brief,
        hosts,
        count: input.count,
        minutes: brief.episodeMinutes,
        focus: input.focus,
        existing: existing.slice(-40),
        context: ctx.text,
      });
      const raw = await this.callLlm(tenantId, 'podcast_ideas', system, user, IDEAS_SCHEMA, 2500, 0.8);
      const ideas = IdeasOut.parse(JSON.parse(raw)).episodes.slice(0, input.count).map((i) => ({ title: i.title.slice(0, 140), summary: i.summary.slice(0, 1000) }));
      if (ideas.length === 0) throw new Error('Nessuna idea proposta');
      await this.billing.settle(tenantId, reservation, { text_light: 1 });
      return ideas;
    } catch (err) {
      await this.billing.release(tenantId, reservation).catch(() => undefined);
      this.logger.error(`Idee podcast ${podcastId} non riuscite: ${userMessage(err)}`);
      throw new BadRequestException(`Non sono riuscito a proporre idee: ${userMessage(err)}`);
    }
  }

  // --- Copioni --------------------------------------------------------------

  /** Avvia la scrittura dei copioni. Senza `episodeIds`: tutte le puntate ancora senza copione. */
  async startScripts(tenantId: string, podcastId: string, episodeIds?: string[]): Promise<{ started: number }> {
    await this.requirePodcast(tenantId, podcastId);
    const all = await this.episodesOf(tenantId, podcastId);
    this.assertIdle(all);
    const todo = episodeIds?.length ? all.filter((e) => episodeIds.includes(e.id)) : all.filter((e) => !e.script);
    if (todo.length === 0) throw new BadRequestException('Nessuna puntata da scrivere');
    const reservation = await this.billing.reserve(tenantId, `kscorm:podcast-scripts:${podcastId}:${randomUUID()}`, [
      { feature: 'text_standard', units: todo.length },
    ]);
    await this.prisma.podcastEpisode.updateMany({
      where: { id: { in: todo.map((e) => e.id) }, tenantId },
      data: {
        state: 'WRITING',
        error: null,
        leaseUntil: new Date(Date.now() + LEASE_MS),
        billing: reservation ? (reservation as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    });
    this.active.add(podcastId);
    void this.runScripts(tenantId, podcastId, todo, all, reservation).finally(() => {
      this.active.delete(podcastId);
      this.cancelled.delete(podcastId);
    });
    return { started: todo.length };
  }

  private async runScripts(tenantId: string, podcastId: string, todo: Episode[], all: Episode[], reservation: Reservation | null): Promise<void> {
    const hb = this.heartbeat(todo.map((e) => e.id));
    let done = 0;
    try {
      const podcast = await this.requirePodcast(tenantId, podcastId);
      const brief = PodcastBrief.parse(podcast.brief);
      const hosts = PodcastHosts.parse(podcast.hosts);
      for (const e of todo) {
        if (this.cancelled.has(podcastId)) {
          await this.restore(e.id, e.script ? 'SCRIPT_READY' : 'DRAFT');
          continue;
        }
        try {
          // Per la continuità bastano le ultime puntate: una serie può averne molte.
          const previous = all.filter((x) => x.position < e.position).slice(-6).map((x) => ({ title: x.title, summary: x.summary }));
          const ctx = await this.buildContext(tenantId, this.sourcesOf(podcast, e), `${e.title}. ${e.summary}. ${e.notes}. ${brief.topic}`);
          const script = await this.writeScript(tenantId, podcast, brief, hosts, e, previous, ctx.text);
          await this.prisma.podcastEpisode.update({
            where: { id: e.id },
            data: {
              script: script as unknown as Prisma.InputJsonValue,
              state: 'SCRIPT_READY',
              error: null,
              leaseUntil: null,
              billing: Prisma.DbNull,
              sources: ctx.sources as unknown as Prisma.InputJsonValue,
              // Un copione nuovo rende obsoleto un audio già generato.
              audioStale: Boolean(e.audioKey),
            },
          });
          done += 1;
        } catch (err) {
          this.logger.error(`Copione podcast ${e.id} fallito: ${userMessage(err)}`);
          await this.prisma.podcastEpisode.update({
            where: { id: e.id },
            data: { state: 'FAILED', error: `Copione non riuscito: ${userMessage(err)}`, leaseUntil: null, billing: Prisma.DbNull },
          });
        }
      }
    } finally {
      clearInterval(hb);
      await this.billing.settle(tenantId, reservation, { text_standard: done }).catch((err) => this.logger.warn(`Addebito copioni: ${userMessage(err)}`));
    }
  }

  private async restore(episodeId: string, state: 'DRAFT' | 'SCRIPT_READY'): Promise<void> {
    await this.prisma.podcastEpisode.update({ where: { id: episodeId }, data: { state, leaseUntil: null, billing: Prisma.DbNull } });
  }

  /** Scrive il copione di una puntata: se esce fuori misura chiede una seconda versione tarata sulla durata. */
  private async writeScript(
    tenantId: string,
    podcast: PodcastRow,
    brief: PodcastBrief,
    hosts: ReturnType<typeof PodcastHosts.parse>,
    e: Episode,
    previous: Array<{ title: string; summary: string }>,
    context: string,
  ): Promise<PodcastScript> {
    let best: PodcastScript | null = null;
    let retry: { words: number; text: string } | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const { system, user, budget } = scriptPrompt({
        language: podcast.language,
        title: podcast.title,
        brief,
        hosts,
        episode: { position: e.position, title: e.title, summary: e.summary, notes: e.notes, minutes: e.targetMinutes },
        previous,
        context,
        retry,
      });
      const raw = await this.callLlm(tenantId, 'podcast_script', system, user, SCRIPT_SCHEMA, Math.min(30_000, Math.ceil(budget.max * 7) + 4000), 0.9);
      const tidy = tidyScript(ScriptOut.parse(JSON.parse(raw)), hosts.map((h) => h.key));
      if (tidy.problems.length > 0) {
        if (attempt === 1 && !best) throw new Error(`Copione non valido: ${tidy.problems.join('; ')}`);
        continue;
      }
      best = tidy.script;
      const words = podcastScriptWords(tidy.script);
      if (podcastScriptFit(words, e.targetMinutes).status === 'ok') return this.reviewScript(tenantId, podcast, brief, hosts, e, tidy.script);
      retry = { words, text: tidy.script.turns.map((t) => `${t.host}: ${t.text}`).join('\n') };
    }
    if (!best) throw new Error('Copione non generato');
    return PodcastScript.parse(best);
  }

  /**
   * Controllo di realismo: un secondo passaggio toglie o sposta ciò che una persona vera non farebbe (risate senza motivo,
   * esitazioni a caso, reazioni fuori posto). Con una sola voce non serve. Se il passaggio fallisce o stravolge il copione, resta l'originale.
   */
  private async reviewScript(
    tenantId: string,
    podcast: PodcastRow,
    brief: PodcastBrief,
    hosts: ReturnType<typeof PodcastHosts.parse>,
    e: Episode,
    script: PodcastScript,
  ): Promise<PodcastScript> {
    if (hosts.length < 2) return script;
    try {
      const { system, user } = reviewPrompt({ language: podcast.language, hosts, brief, script: script.turns });
      const raw = await this.callLlm(tenantId, 'podcast_script_review', system, user, REVIEW_SCHEMA, Math.min(30_000, Math.ceil(podcastScriptWords(script) * 7) + 4000), 0.4);
      const tidy = tidyScript(ScriptOut.parse(JSON.parse(raw)), hosts.map((h) => h.key));
      const before = podcastScriptWords(script);
      const after = podcastScriptWords(tidy.script);
      const sane = tidy.problems.length === 0 && Math.abs(after - before) <= before * 0.12 && podcastScriptFit(after, e.targetMinutes).status === 'ok';
      if (!sane) {
        this.logger.warn(`Controllo di realismo scartato (puntata ${e.id}): ${tidy.problems.join('; ') || `parole ${before} → ${after}`}`);
        return script;
      }
      return PodcastScript.parse(tidy.script);
    } catch (err) {
      this.logger.warn(`Controllo di realismo non riuscito (puntata ${e.id}): ${userMessage(err)}`);
      return script;
    }
  }

  // --- Audio ----------------------------------------------------------------

  /** Avvia la sintesi dell'audio. Senza `episodeIds`: le puntate con copione e senza audio aggiornato. */
  async startAudio(tenantId: string, podcastId: string, episodeIds?: string[]): Promise<{ started: number }> {
    const podcast = await this.requirePodcast(tenantId, podcastId);
    const all = await this.episodesOf(tenantId, podcastId);
    this.assertIdle(all);
    const withScript = (e: Episode): boolean => PodcastScript.safeParse(e.script).success;
    const todo = episodeIds?.length
      ? all.filter((e) => episodeIds.includes(e.id))
      : all.filter((e) => withScript(e) && (!e.audioKey || e.audioStale));
    if (todo.length === 0) throw new BadRequestException('Nessuna puntata da registrare');
    const missing = todo.find((e) => !withScript(e));
    if (missing) throw new BadRequestException(`La puntata «${missing.title}» non ha ancora il copione`);
    const hosts = PodcastHosts.parse(podcast.hosts);
    for (const h of hosts) {
      if (!(await this.voices.isValid(h.voice, podcast.language, tenantId))) {
        throw new BadRequestException(`La voce di ${h.name} non è disponibile per questa lingua: sceglierne un'altra`);
      }
    }
    const providerOf = podcastProviderOf(hosts);
    const units = todo.reduce((n, e) => n + scriptAudioUnits(PodcastScript.parse(e.script), providerOf), 0);
    const reservation = await this.billing.reserve(tenantId, `kscorm:podcast-audio:${podcastId}:${randomUUID()}`, [
      { feature: 'audio_narration', units: this.margin(units) },
    ]);
    await this.prisma.podcastEpisode.updateMany({
      where: { id: { in: todo.map((e) => e.id) }, tenantId },
      data: {
        state: 'VOICING',
        error: null,
        leaseUntil: new Date(Date.now() + LEASE_MS),
        billing: reservation ? (reservation as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      },
    });
    this.active.add(podcastId);
    void this.runAudio(tenantId, podcast, todo, reservation).finally(() => {
      this.active.delete(podcastId);
      this.cancelled.delete(podcastId);
    });
    return { started: todo.length };
  }

  private async runAudio(tenantId: string, podcast: PodcastRow, todo: Episode[], reservation: Reservation | null): Promise<void> {
    const hb = this.heartbeat(todo.map((e) => e.id));
    let units = 0;
    try {
      for (const e of todo) {
        if (this.cancelled.has(podcast.id)) {
          await this.restore(e.id, 'SCRIPT_READY');
          continue;
        }
        try {
          units += await this.voiceEpisode(tenantId, podcast, e);
        } catch (err) {
          this.logger.error(`Audio podcast ${e.id} fallito: ${userMessage(err)}`);
          await this.prisma.podcastEpisode.update({
            where: { id: e.id },
            data: { state: 'FAILED', error: `Audio non riuscito: ${userMessage(err)}`, leaseUntil: null, billing: Prisma.DbNull },
          });
        }
      }
    } finally {
      clearInterval(hb);
      await this.billing
        .settle(tenantId, reservation, { audio_narration: Math.round(units * 100) / 100 })
        .catch((err) => this.logger.warn(`Addebito audio: ${userMessage(err)}`));
    }
  }

  /** Sintetizza una puntata battuta per battuta, unisce l'audio e lo salva. Restituisce le unità `audio_narration` (caratteri pesati / 1000). */
  private async voiceEpisode(tenantId: string, podcast: PodcastRow, e: Episode): Promise<number> {
    const cfg = this.config.get('podcast', { infer: true });
    const script = PodcastScript.parse(e.script);
    const hosts = PodcastHosts.parse(podcast.hosts);
    const voiceOf = new Map(hosts.map((h) => [h.key, h.voice]));
    const locale = podcastLocale(podcast.language);
    const parts: Array<{ bytes: Uint8Array; text: string; overlap?: PodcastOverlap; host?: string; tempo?: number; energy?: number }> = [];
    const energy = PodcastBrief.parse(podcast.brief).energy;
    // Velocità: quella scelta per il partecipante o, in mancanza, quella dell'energia della serie.
    const hostSpeed = new Map(hosts.map((h) => [h.key, h.speed ?? ENERGY_SPEED[energy]]));
    const charsBy: Record<'polly' | 'heygen', number> = { polly: 0, heygen: 0 };
    const energies = smoothEnergies(script.turns);
    for (const [ti, turn] of script.turns.entries()) {
      const voice = voiceOf.get(turn.host)!;
      // Velocità della battuta: quella del partecipante (o della serie) modulata dall'energia del momento.
      // Un po' di variazione casuale (±3%, sempre uguale per lo stesso copione): nessuno parla alla stessa velocità due volte.
      const jitter = 1 + 0.03 * (2 * (Math.abs(Math.sin((ti + 1) * 78.233) * 43758.5453) % 1) - 1);
      const speed = (hostSpeed.get(turn.host) ?? 1) * energyFactors(energies[ti]!).speed * jitter;
      const spoken = textForVoice(turn, voice.provider, podcast.language);
      // HeyGen accelera la voce da sé (resa migliore); con Polly si accelera nel montaggio, se c'è ffmpeg.
      const res = await this.synthWithRetry(this.voices.speechFor(voice.provider), spoken, locale, voice.id, cfg.speechEngine, voice.provider === 'heygen' ? speed : undefined);
      parts.push({ bytes: res.bytes, text: turn.text, overlap: turn.overlap, host: turn.host, tempo: voice.provider === 'heygen' ? undefined : speed, energy: energies[ti] });
      charsBy[voice.provider] += spoken.length;
    }
    const { audio, timings, durationMs } = await assembleDialogue(parts, energy);
    const key = `podcasts/${tenantId}/${podcast.id}/${e.id}.mp3`;
    await this.storage.putObject(key, audio, { contentType: 'audio/mpeg' });
    await this.meter.record({
      tenantId,
      courseId: null,
      provider: 'POLLY',
      model: `polly-${cfg.speechEngine}`,
      unit: 'CHARACTERS',
      quantity: charsBy.polly,
      source: 'podcast_audio',
      region: cfg.speechRegion,
    });
    await this.meter.record({
      tenantId,
      courseId: null,
      provider: 'HEYGEN',
      model: HEYGEN_VOICE_MODEL,
      unit: 'CHARACTERS',
      quantity: charsBy.heygen,
      source: 'podcast_audio',
    });
    const units = (charsBy.polly * AUDIO_WEIGHT.polly + charsBy.heygen * AUDIO_WEIGHT.heygen) / 1000;
    await this.prisma.podcastEpisode.update({
      where: { id: e.id },
      data: {
        state: 'READY',
        error: null,
        leaseUntil: null,
        billing: Prisma.DbNull,
        audioKey: key,
        audioStale: false,
        durationSec: Math.max(1, Math.round(durationMs / 1000)),
        sizeBytes: audio.length,
        turnTimings: timings as unknown as Prisma.InputJsonValue,
      },
    });
    return units;
  }

  /** Una battuta: fino a 3 tentativi con attesa crescente (limiti di frequenza o errori passeggeri). */
  private async synthWithRetry(speech: SpeechProvider, text: string, language: string, voice: string, engine: 'standard' | 'neural' | 'generative', speed?: number) {
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await speech.synthesize({ text, language, voice, engine, speed });
      } catch (err) {
        last = err;
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    throw new Error(`Sintesi vocale non riuscita (${userMessage(last)}): «${text.slice(0, 40)}…»`);
  }
}
