import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ALL_PACKAGE_FEATURES,
  PACKAGE_FEATURES,
  avatarFeature,
  lessonPackageFeature,
  lessonImageCap,
  plannedLessonFormats,
  plannedModuleCount,
  resolveLessonLayout,
  Brief,
  CourseOutline,
  type CourseEstimateInput,
  type CourseEstimateLine,
  type CourseEstimateView,
  type LessonFormat,
  type CompanyWalletAccess, type CourseCreditsView, type WalletTransactionsView, type WalletView } from '@scorm/contracts';
import type { AppConfig } from '../config/configuration.js';
import { FeatureCatalogService } from '../ecosystem/feature-catalog.service.js';
import {
  CompanyWalletMissingException,
  FeatureNotPricedException,
  InsufficientCreditsException,
  WalletService,
} from '../ecosystem/wallet.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantPrismaService } from '../tenancy/tenant-prisma.service.js';
import { currentPayer, type Payer } from './payer-context.js';
import { isPersonalTenant } from '../tenancy/personal-space.js';

/** Voce di spesa: feature del listino e, per le feature a unità, le unità (elementi o minuti). */
export interface BillItem {
  feature: string;
  units?: number;
}

/** Riserva di crediti (uno o più hold), serializzabile per essere salvata con il lavoro. */
export interface Reservation {
  /** Wallet su cui sono state fatte le riserve (company o personale): capture e release vanno allo stesso. */
  companyId: string;
  /** Prefisso del `reference` (ogni hold usa `${ref}:${feature}`). */
  ref: string;
  /**
   * Un hold per feature a unità; per le feature fisse un hold per pezzo (`fixed`), con l'importo del
   * prezzo di listino: così un lavoro a più pezzi (es. 8 lezioni) addebita solo quelli riusciti.
   */
  holds: Array<{ feature: string; holdId: string; units?: number; credits: number; fixed?: boolean }>;
}

export interface QuoteLine {
  feature: string;
  units: number;
  /** Crediti per questa voce; null se la feature non è ancora prezzata. */
  credits: number | null;
}

export interface Quote {
  lines: QuoteLine[];
  /** Totale in crediti delle voci prezzate. */
  total: number;
  /** False se almeno una voce non è prezzata (l'operazione non sarebbe prenotabile). */
  priced: boolean;
}

export { avatarFeature };

/** Margine sulle unità stimate quando la durata si conosce solo a lavoro finito (clip avatar). */
export const ESTIMATE_MARGIN = 1.25;

const BILLED_CACHE_MS = 30_000;

/**
 * Addebito in crediti delle generazioni, sopra il wallet di Manager. Il prezzo lo decide solo
 * Manager (`FeatureCatalogService`); qui si prenota prima (`reserve`), si addebita il consumo
 * reale a fine lavoro (`settle`) e si libera su errore (`release`).
 *
 * Con il wallet abilitato sull'installazione (deciso da Manager) ogni generazione si paga: con il
 * wallet dell'azienda, se Manager ne ha uno per quella company, oppure con il wallet personale
 * scelto dall'utente. Un'azienda senza wallet su Manager non può generare (402
 * `company_wallet_missing`). Con il wallet spento sull'installazione ogni metodo è un no-op.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly companyCache = new Map<string, { value: 'ok' | 'missing'; until: number }>();
  /** Stripe in modalità di prova (sandbox): noto da `livemode` di Manager o dall'indirizzo di una sessione di pagamento. */
  private stripeTest: boolean | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly wallet: WalletService,
    private readonly catalog: FeatureCatalogService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /** Chi paga la richiesta in corso: wallet personale scelto dall'utente oppure, di default, l'azienda. */
  payerFor(tenantId: string): Payer {
    return currentPayer() ?? { companyId: tenantId, kind: 'company' };
  }

  /**
   * True se la generazione in corso si addebita in crediti: wallet abilitato sull'installazione e
   * (azienda con addebito attivo oppure utente che ha scelto di pagare con il wallet personale).
   */
  async isBilled(_tenantId: string): Promise<boolean> {
    return this.wallet.isEnabled();
  }
  /** Blocca se paga l'azienda e Manager non ha un wallet per lei. */
  private async assertPayerWallet(tenantId: string): Promise<void> {
    const payer = this.payerFor(tenantId);
    if (payer.kind === 'company' && (await this.companyState(tenantId)) === 'missing') {
      throw new CompanyWalletMissingException(tenantId);
    }
  }

  /** True se Manager ha prezzato tutti i pacchetti del corso: allora struttura, lezioni e test si addebitano a pacchetto. */
  packagesActive(): boolean {
    return ALL_PACKAGE_FEATURES.every((f) => this.catalog.price(f) !== undefined);
  }

  /** Voce della struttura del corso: pacchetto, oppure un'operazione di testo del listino attuale. */
  structureItems(): BillItem[] {
    return this.packagesActive() ? [{ feature: PACKAGE_FEATURES.structure, units: 1 }] : [{ feature: 'text_standard', units: 1 }];
  }

  /** Voci di un gruppo di lezioni (formato di ciascuna): pacchetti per formato, o testi del listino attuale. */
  lessonItems(formats: Array<string | null | undefined>): BillItem[] {
    if (formats.length === 0) return [];
    if (!this.packagesActive()) return [{ feature: 'text_standard', units: formats.length }];
    const counts = new Map<string, number>();
    for (const f of formats) counts.set(lessonPackageFeature(f), (counts.get(lessonPackageFeature(f)) ?? 0) + 1);
    return [...counts.entries()].map(([feature, units]) => ({ feature, units }));
  }

  /** Voci di `n` test. */
  testItems(n: number): BillItem[] {
    if (n <= 0) return [];
    return [{ feature: this.packagesActive() ? PACKAGE_FEATURES.test : 'text_standard', units: n }];
  }

  /** True se la riserva è a pacchetti: le immagini della lezione sono incluse e non si addebitano a parte. */
  static usesPackages(res: Reservation | null | undefined): boolean {
    return Boolean(res?.holds.some((h) => ALL_PACKAGE_FEATURES.includes(h.feature)));
  }

  /**
   * Converte il lavoro riuscito di un job (`structure`, `test`, `lesson:<formato>`) nelle unità delle
   * sue riserve, sia a pacchetti sia con il listino attuale (dove tutto è `text_standard`).
   */
  static jobActual(res: Reservation, done: Record<string, number>): Record<string, number> {
    const lessonsOf = (feature?: string) =>
      Object.entries(done)
        .filter(([k]) => k.startsWith('lesson:') && (feature === undefined || lessonPackageFeature(k.slice(7)) === feature))
        .reduce((n, [, v]) => n + v, 0);
    const out: Record<string, number> = {};
    for (const h of res.holds) {
      if (h.feature in out) continue;
      if (h.feature === PACKAGE_FEATURES.structure) out[h.feature] = done.structure ?? 0;
      else if (h.feature === PACKAGE_FEATURES.test) out[h.feature] = done.test ?? 0;
      else if (Object.values(PACKAGE_FEATURES.lesson).includes(h.feature as never)) out[h.feature] = lessonsOf(h.feature);
      else if (h.feature === 'text_standard') out[h.feature] = (done.structure ?? 0) + (done.test ?? 0) + lessonsOf();
      else out[h.feature] = done[h.feature] ?? 0;
    }
    return out;
  }

  /**
   * Preventivo di un corso ancora da creare, dal piano del brief. È un tetto: lezioni, moduli,
   * immagini e tentativi sono limitati nel codice, quindi l'addebito non lo supera.
   */
  async estimateCourse(tenantId: string, input: CourseEstimateInput): Promise<CourseEstimateView> {
    const formats = plannedLessonFormats(input);
    const modules = plannedModuleCount(formats.length);
    const tests = (input.requestedAssessments.includes('intermediate') ? modules : 0) + (input.requestedAssessments.includes('final') ? 1 : 0);
    return this.withBalance(tenantId, {
      ...this.buildEstimate({ structure: true, formats, images: input.autoGenerateImages, tests, cover: input.cover }),
      modules,
    });
  }

  /**
   * Quanto manca per completare un corso esistente: struttura (se non c'è), lezioni ancora vuote con
   * il loro formato e test previsti ancora da fare. Senza struttura vale il piano del brief.
   */
  async estimateExistingCourse(tenantId: string, courseId: string): Promise<CourseEstimateView> {
    const course = await this.prisma.course.findFirst({ where: { id: courseId, tenantId }, select: { brief: true, outline: true } });
    if (!course) throw new NotFoundException('Corso non trovato');
    const brief = course.brief ? Brief.safeParse(course.brief) : null;
    const b = brief?.success ? brief.data : null;
    const outline = course.outline ? CourseOutline.safeParse(course.outline) : null;
    const images = b ? b.autoGenerateImages !== false : true;
    const requested = b?.requestedAssessments ?? [];
    if (!outline?.success) {
      const input = { ...(b ?? {}), requestedAssessments: requested };
      const formats = plannedLessonFormats(input);
      const modules = plannedModuleCount(formats.length);
      const tests = (requested.includes('intermediate') ? modules : 0) + (requested.includes('final') ? 1 : 0);
      return this.withBalance(tenantId, { ...this.buildEstimate({ structure: true, formats, images, tests, cover: false }), modules });
    }
    const mods = await this.prisma.module.findMany({
      where: { courseId },
      select: { id: true, lessons: { select: { blocks: true, format: true, videoFirst: true, pillola: true } } },
    });
    const formats = mods
      .flatMap((m) => m.lessons)
      .filter((l) => !Array.isArray(l.blocks) || (l.blocks as unknown[]).length === 0)
      .map((l) => resolveLessonLayout({ format: l.format, videoFirst: l.videoFirst, pillola: l.pillola }));
    const wantsIntermediate = requested.includes('intermediate') || outline.data.modules.some((m) => m.hasIntermediateAssessment);
    const wantsFinal = requested.includes('final') || outline.data.hasFinalAssessment;
    const existing = await this.prisma.assessment.findMany({ where: { courseId }, select: { scope: true, moduleId: true } });
    const done = new Set(existing.map((a) => `${a.scope}:${a.moduleId ?? 'final'}`));
    const tests =
      (wantsIntermediate ? mods.filter((m) => !done.has(`INTERMEDIATE:${m.id}`)).length : 0) + (wantsFinal && !done.has('FINAL:final') ? 1 : 0);
    return this.withBalance(tenantId, { ...this.buildEstimate({ structure: false, formats, images, tests, cover: false }), modules: mods.length });
  }

  /** Voci e totale del preventivo, con i pacchetti se Manager li ha prezzati, altrimenti per operazione. */
  private buildEstimate(p: {
    structure: boolean;
    formats: Array<LessonFormat | null>;
    images: boolean;
    tests: number;
    cover: boolean;
  }): Omit<CourseEstimateView, 'billed' | 'available' | 'modules'> {
    const packages = this.packagesActive();
    const c = (feature: string, units: number) => this.catalog.credits(feature, units) ?? null;
    const lines: CourseEstimateLine[] = [];
    if (p.structure) lines.push({ kind: 'structure', quantity: 1, credits: c(packages ? PACKAGE_FEATURES.structure : 'text_standard', 1) });
    // Le lezioni con formato scelto dall'AI valgono come standard (il pacchetto più caro).
    const byFormat = new Map<LessonFormat, number>();
    for (const f of p.formats) byFormat.set(f ?? 'standard', (byFormat.get(f ?? 'standard') ?? 0) + 1);
    for (const [format, n] of byFormat) {
      lines.push({ kind: 'lessons', format, quantity: n, credits: c(packages ? lessonPackageFeature(format) : 'text_standard', n) });
    }
    if (!packages && p.images) {
      const imgs = p.formats.reduce((n, f) => n + lessonImageCap(f ?? 'standard'), 0);
      if (imgs > 0) lines.push({ kind: 'images', quantity: imgs, credits: c('image_generation', imgs) });
    }
    if (p.tests > 0) lines.push({ kind: 'tests', quantity: p.tests, credits: c(packages ? PACKAGE_FEATURES.test : 'text_standard', p.tests) });
    if (p.cover) lines.push({ kind: 'cover', quantity: 1, credits: c('image_generation', 1) });
    // Prezzo massimo di una lezione: il pacchetto, oppure testo + immagini fino al tetto del formato.
    const lessonPrice = (f: LessonFormat) => {
      const text = c(packages ? lessonPackageFeature(f) : 'text_standard', 1);
      if (packages || !p.images || text === null) return text;
      const img = c('image_generation', lessonImageCap(f));
      return img === null ? null : text + img;
    };
    return {
      mode: packages ? 'package' : 'operation',
      prices: {
        structure: c(packages ? PACKAGE_FEATURES.structure : 'text_standard', 1),
        test: c(packages ? PACKAGE_FEATURES.test : 'text_standard', 1),
        image: c('image_generation', 1),
        lesson: {
          standard: lessonPrice('standard'),
          pillola: lessonPrice('pillola'),
          pillola_interattiva: lessonPrice('pillola_interattiva'),
          video_first: lessonPrice('video_first'),
        },
      },
      lines,
      total: lines.reduce((n, l) => n + (l.credits ?? 0), 0),
      priced: lines.every((l) => l.credits !== null),
      lessons: p.formats.length,
      tests: p.tests,
      aiChosenFormats: p.formats.filter((f) => f === null).length,
    };
  }

  /** Aggiunge se i crediti sono attivi e il disponibile del wallet che paga. */
  private async withBalance(tenantId: string, e: Omit<CourseEstimateView, 'billed' | 'available'>): Promise<CourseEstimateView> {
    const billed = await this.isBilled(tenantId);
    const bal = billed ? await this.wallet.getBalance(this.payerFor(tenantId).companyId) : null;
    return { ...e, billed, ...(bal ? { available: bal.available } : {}) };
  }

  /** Preventivo in crediti (calcolo puro sul listino, senza toccare il wallet). */
  quote(items: BillItem[]): Quote {
    const lines: QuoteLine[] = normalize(items, this.catalog).map((i) => ({
      feature: i.feature,
      units: i.units,
      credits: this.catalog.credits(i.feature, i.units) ?? null,
    }));
    return {
      lines,
      total: lines.reduce((n, l) => n + (l.credits ?? 0), 0),
      priced: lines.every((l) => l.credits !== null),
    };
  }

  /**
   * Prenota i crediti prima di eseguire. Ritorna null se l'azienda non è addebitata. Se una voce
   * non basta, libera quelle già prenotate e lancia 402; se non è prezzata lancia 503.
   */
  async reserve(tenantId: string, ref: string, items: BillItem[]): Promise<Reservation | null> {
    if (!(await this.isBilled(tenantId))) return null;
    await this.assertPayerWallet(tenantId);
    const payer = this.payerFor(tenantId);
    const lines = normalize(items, this.catalog);
    if (lines.length === 0) return { ref, companyId: payer.companyId, holds: [] };
    const holds: Reservation['holds'] = [];
    try {
      for (const l of lines) {
        const price = this.catalog.price(l.feature);
        if (price === undefined) throw new FeatureNotPricedException(l.feature);
        const unit = this.catalog.isUnit(l.feature);
        if (!unit) {
          // Feature fissa: un hold per pezzo, ciascuno con l'importo del prezzo di listino.
          const count = Math.max(1, Math.round(l.units));
          for (let i = 0; i < count; i++) {
            const hold = await this.wallet.hold({
              companyId: payer.companyId,
              feature: l.feature,
              reference: count === 1 ? `${ref}:${l.feature}` : `${ref}:${l.feature}:${i + 1}`,
              amount: price,
            });
            holds.push({ feature: l.feature, holdId: hold.holdId, credits: price, fixed: true });
          }
          continue;
        }
        const hold = await this.wallet.hold({
          companyId: payer.companyId,
          feature: l.feature,
          reference: `${ref}:${l.feature}`,
          units: l.units,
        });
        holds.push({
          feature: l.feature,
          holdId: hold.holdId,
          units: l.units,
          credits: this.catalog.credits(l.feature, l.units) ?? 0,
        });
      }
    } catch (err) {
      await Promise.all(holds.map((h) => this.wallet.release(payer.companyId, h.holdId)));
      throw err;
    }
    return { ref, companyId: payer.companyId, holds };
  }

  /**
   * Addebita il consumo reale. `actual` indica le unità realmente consumate per feature; una
   * feature assente si addebita per intero (voci esatte). Consumo zero libera la riserva; un
   * consumo oltre la riserva si addebita fino alla riserva e si registra l'eccedenza.
   */
  async settle(tenantId: string, res: Reservation | null, actual?: Record<string, number>): Promise<void> {
    if (!res) return;
    const charged: Array<{ feature: string; units?: number; credits: number }> = [];
    try {
      await this.settleHolds(res, actual, charged);
    } finally {
      await this.recordCharges(tenantId, res, charged);
    }
  }

  private async settleHolds(
    res: Reservation,
    actual: Record<string, number> | undefined,
    charged: Array<{ feature: string; units?: number; credits: number }>,
  ): Promise<void> {
    const company = res.companyId;
    // Feature fisse: si addebitano i primi `actual` pezzi e si liberano gli altri.
    const fixedDone = new Set<string>();
    for (const h of res.holds) {
      if (!(h.fixed || h.units === undefined) || fixedDone.has(h.feature)) continue;
      fixedDone.add(h.feature);
      const pieces = res.holds.filter((x) => x.feature === h.feature);
      const a = actual?.[h.feature];
      const take = a === undefined ? pieces.length : Math.max(0, Math.min(pieces.length, Math.ceil(a - 1e-9)));
      if (a !== undefined && a > pieces.length + 1e-9) {
        this.logger.warn(`Pezzi oltre la riserva (${h.feature}, ref=${res.ref}): ${a} > ${pieces.length}. Si addebita la riserva.`);
      }
      for (let i = 0; i < pieces.length; i++) {
        const p = pieces[i]!;
        if (i < take) {
          if (await this.wallet.capture(company, p.holdId)) charged.push({ feature: p.feature, units: 1, credits: p.credits });
        } else {
          await this.wallet.release(company, p.holdId);
        }
      }
    }
    for (const h of res.holds) {
      if (h.fixed || h.units === undefined) continue;
      const a = actual?.[h.feature];
      if (a === undefined) {
        if (await this.wallet.capture(company, h.holdId)) charged.push({ feature: h.feature, units: h.units, credits: h.credits });
        continue;
      }
      if (a <= 0) {
        await this.wallet.release(company, h.holdId);
        continue;
      }
      if (a > h.units + 1e-9) {
        this.logger.warn(
          `Consumo oltre la riserva (${h.feature}, ref=${res.ref}): reale ${a} > riservato ${h.units}. Si addebita la riserva.`,
        );
      }
      const units = Math.min(a, h.units);
      if (await this.wallet.capture(company, h.holdId, { units })) charged.push({ feature: h.feature, units, credits: this.catalog.credits(h.feature, units) ?? h.credits });
    }
  }

  /**
   * Registra in locale i crediti addebitati, collegati al corso (o al video da slide) da cui
   * nasce la riserva. Best-effort: un errore qui non annulla l'addebito già fatto su Manager.
   */
  private async recordCharges(
    tenantId: string,
    res: Reservation,
    charged: Array<{ feature: string; units?: number; credits: number }>,
  ): Promise<void> {
    if (charged.length === 0) return;
    // Una riga per feature (i pezzi fissi dello stesso lavoro si sommano).
    const byFeature = new Map<string, { feature: string; units?: number; credits: number }>();
    for (const c of charged) {
      const cur = byFeature.get(c.feature);
      if (cur) {
        cur.credits += c.credits;
        cur.units = cur.units === undefined || c.units === undefined ? undefined : cur.units + c.units;
      } else byFeature.set(c.feature, { ...c });
    }
    charged = [...byFeature.values()];
    try {
      const scope = await this.scopeOf(tenantId, res.ref);
      const payer = res.companyId === tenantId ? 'COMPANY' : 'PERSONAL';
      await this.tenantPrisma.runInTenant(tenantId, (tx) =>
        tx.creditCharge.createMany({
          data: charged.map((c) => ({
            tenantId,
            courseId: scope.courseId ?? null,
            slideImportId: scope.slideImportId ?? null,
            feature: c.feature,
            units: c.units ?? null,
            credits: Math.round(c.credits),
            walletId: res.companyId,
            payer,
            reference: res.ref,
          })),
          skipDuplicates: true,
        }),
      );
    } catch (err) {
      this.logger.warn(`Registrazione addebito fallita (ref=${res.ref}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Corso (e import slide) a cui appartiene una riserva, ricavato dal suo `reference`. */
  private async scopeOf(tenantId: string, ref: string): Promise<{ courseId?: string; slideImportId?: string }> {
    const [, kind, id] = ref.split(':');
    if (!id) return {};
    switch (kind) {
      case 'job': {
        const job = await this.prisma.generationJob.findFirst({ where: { id, tenantId }, select: { courseId: true } });
        return { courseId: job?.courseId ?? undefined };
      }
      case 'cover':
      case 'rss-brief':
        return { courseId: id };
      case 'module-cover': {
        const m = await this.prisma.module.findFirst({ where: { id }, select: { courseId: true, course: { select: { tenantId: true } } } });
        return m?.course.tenantId === tenantId ? { courseId: m.courseId } : {};
      }
      case 'images':
      case 'narration':
      case 'video':
      case 'cartoon': {
        const l = await this.prisma.lesson.findFirst({
          where: { id },
          select: { module: { select: { courseId: true, course: { select: { tenantId: true } } } } },
        });
        return l?.module.course.tenantId === tenantId ? { courseId: l.module.courseId } : {};
      }
      case 'slide-clips':
      case 'slide-scripts':
      case 'slide-sections':
      case 'slide-lesson': {
        // Gli import slide non sono una tabella: il corso si ricava dai consumi già registrati.
        const u = await this.prisma.usageRecord.findFirst({
          where: { tenantId, slideImportId: id, courseId: { not: null } },
          select: { courseId: true },
        });
        return { courseId: u?.courseId ?? undefined, slideImportId: id };
      }
      default:
        return {};
    }
  }

  /** Crediti addebitati per un corso, per feature (quello che ha pagato il cliente). */
  async courseCredits(tenantId: string, courseId: string): Promise<CourseCreditsView> {
    const rows = await this.prisma.creditCharge.groupBy({
      by: ['feature'],
      where: { tenantId, courseId },
      _sum: { credits: true, units: true },
      _count: { _all: true },
    });
    const lines = rows
      .map((r) => ({ feature: r.feature, units: r._sum.units ?? undefined, operations: r._count._all, credits: r._sum.credits ?? 0 }))
      .sort((a, b) => b.credits - a.credits);
    return { courseId, total: lines.reduce((n, l) => n + l.credits, 0), lines };
  }

  /** Libera tutta la riserva (operazione fallita o annullata). */
  async release(_tenantId: string, res: Reservation | null): Promise<void> {
    if (!res) return;
    await Promise.all(res.holds.map((h) => this.wallet.release(res.companyId, h.holdId)));
  }

  /**
   * Controlla che il saldo disponibile copra le voci SENZA riservare (per lavori le cui parti si
   * prenotano a fasi). Se il saldo non è leggibile non blocca: ci pensa l'hold.
   */
  async assertAvailable(tenantId: string, items: BillItem[]): Promise<void> {
    if (!(await this.isBilled(tenantId))) return;
    await this.assertPayerWallet(tenantId);
    const q = this.quote(items);
    if (!q.priced) throw new FeatureNotPricedException(q.lines.find((l) => l.credits === null)?.feature ?? '');
    const bal = await this.wallet.getBalance(this.payerFor(tenantId).companyId);
    if (bal && bal.available < q.total) {
      throw new InsufficientCreditsException(q.lines[0]?.feature ?? '', q.total, bal.available);
    }
  }

  /**
   * Esegue `work` dentro una riserva: addebita il consumo reale restituito (`actual`) se riesce,
   * libera se lancia.
   */
  async run<T>(
    tenantId: string,
    ref: string,
    items: BillItem[],
    work: () => Promise<{ result: T; actual?: Record<string, number> }>,
  ): Promise<T> {
    const res = await this.reserve(tenantId, ref, items);
    try {
      const { result, actual } = await work();
      await this.settle(tenantId, res, actual);
      return result;
    } catch (err) {
      await this.release(tenantId, res);
      throw err;
    }
  }

  /**
   * Stato dei wallet mostrato in app: addebito attivo per chi sta generando, wallet scelto, saldo
   * dell'azienda e, se già attivato, del wallet personale. Il wallet personale NON si crea qui:
   * Manager lo crea alla prima chiamata, quindi si attiva solo quando l'utente lo sceglie.
   */
  async walletView(tenantId: string, userId: string, role: string): Promise<WalletView> {
    const walletOn = await this.wallet.isEnabled();
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { walletPayer: true, personalWalletId: true },
    });
    // Nello spazio personale non c'è un wallet aziendale: paga sempre quello personale.
    const personalSpace = isPersonalTenant(tenantId);
    const payer: 'COMPANY' | 'PERSONAL' =
      personalSpace || (user?.walletPayer === 'PERSONAL' && user.personalWalletId) ? 'PERSONAL' : 'COMPANY';
    const companyRes = !personalSpace && walletOn ? await this.wallet.companyWallet(tenantId) : null;
    this.rememberCompany(tenantId, companyRes?.status);
    const companyBal = companyRes?.status === 'ok' ? companyRes.balance : null;
    const companyBilled = companyBal !== null;
    const personalBal = walletOn && user?.personalWalletId ? await this.wallet.getBalance(user.personalWalletId) : null;
    const livemode = [companyBal, personalBal].find((b) => typeof b?.livemode === 'boolean')?.livemode;
    if (typeof livemode === 'boolean') this.stripeTest = !livemode;
    const current = payer === 'PERSONAL' ? personalBal : companyBal;
    let companyAccess: CompanyWalletAccess = 'active';
    if (personalSpace) companyAccess = 'none';
    else if (!walletOn) companyAccess = 'unavailable';
    else if (companyRes?.status === 'missing') companyAccess = 'missing';
    else if (!companyBilled) companyAccess = 'unavailable';
    return {
      enabled: walletOn,
      payer,
      balance: current?.balance,
      available: current?.available,
      currency: 'CREDITS',
      topupUrl: payer === 'COMPANY' ? this.topupUrl() : undefined,
      canTopup: payer === 'PERSONAL' ? true : role === 'OWNER',
      company: companyBilled
        ? { balance: companyBal?.balance, available: companyBal?.available, lastTopupAt: companyBal?.last_topup_at ?? undefined, topupUrl: this.topupUrl(), canTopup: role === 'OWNER', canViewMovements: role === 'OWNER' || role === 'ADMIN' }
        : null,
      personal: {
        // Il wallet personale esiste solo dopo l'attivazione; prima di allora non si interroga Manager.
        active: Boolean(user?.personalWalletId),
        balance: personalBal?.balance,
        available: personalBal?.available,
        lastTopupAt: personalBal?.last_topup_at ?? undefined,
      },
      companyAccess,
      companyId: personalSpace ? undefined : tenantId,
      personalAvailable: walletOn,
      personalSpace,
      stripeTestMode: this.stripeTest,
    };
  }

  /**
   * Movimenti che cambiano il saldo (ricariche, addebiti, rettifiche, rimborsi) del wallet
   * dell'azienda dell'utente o del suo wallet personale. Hold e release sono solo audit e si omettono.
   */
  async transactions(
    tenantId: string,
    userId: string,
    role: string,
    wallet: 'company' | 'personal',
    page: number,
  ): Promise<WalletTransactionsView> {
    const empty: WalletTransactionsView = { page, pages: 0, total: 0, results: [] };
    let companyId: string | null | undefined;
    if (wallet === 'company') {
      if (isPersonalTenant(tenantId) || (await this.companyState(tenantId)) !== 'ok') return empty;
      // Il dettaglio dei movimenti dell'azienda è per chi la amministra.
      if (role !== 'OWNER' && role !== 'ADMIN') throw new ForbiddenException('Movimenti riservati agli amministratori');
      companyId = tenantId;
    } else {
      const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId }, select: { personalWalletId: true } });
      companyId = user?.personalWalletId;
    }
    if (!companyId) return empty;
    const res = await this.wallet.getTransactions(companyId, page, 20);
    if (!res) return empty;
    return {
      page: res.page,
      pages: res.pages,
      total: res.total,
      results: res.results
        .filter((r) => r.affects_balance !== false && !['hold', 'release'].includes(r.type))
        .map((r) => ({
          id: r.id,
          type: r.type,
          amount: r.amount,
          feature: r.feature,
          product: r.product,
          balanceAfter: r.balance_after,
          createdAt: r.created_at,
        })),
    };
  }
  /** Cambia il wallet che paga le generazioni dell'utente; il personale si attiva alla prima scelta. */
  async setPayer(tenantId: string, userId: string, kind: 'COMPANY' | 'PERSONAL'): Promise<void> {
    if (kind === 'COMPANY' && isPersonalTenant(tenantId)) {
      throw new BadRequestException("Nello spazio personale paga sempre il wallet personale.");
    }
if (kind === 'PERSONAL') await this.ensurePersonalWallet(tenantId, userId);
    await this.tenantPrisma.runInTenant(tenantId, (tx) =>
      tx.user.updateMany({ where: { id: userId, tenantId }, data: { walletPayer: kind } }),
    );
  }

  /** Pagina di pagamento Stripe per ricaricare il wallet personale dell'utente. */
  async startPersonalTopup(tenantId: string, userId: string, amountEur: number): Promise<{ url: string; testMode: boolean }> {
    const companyId = await this.ensurePersonalWallet(tenantId, userId);
    const web = this.config.get('webAppUrl', { infer: true }).replace(/\/+$/, '');
    const session = await this.wallet.createPersonalTopupSession({
      companyId,
      amountEur,
      successUrl: `${web}/wallet?topup=success`,
      cancelUrl: `${web}/wallet?topup=cancel`,
    });
    // Le sessioni di Stripe in prova hanno un id che inizia con cs_test_ (cs_live_ in produzione).
    const testMode = /\/cs_test_/.test(session.url);
    if (testMode || /\/cs_live_/.test(session.url)) this.stripeTest = testMode;
    return { url: session.url, testMode };
  }

  /** company_id del wallet personale: lo chiede a Manager la prima volta e lo salva (mai ricostruito da noi). */
  async ensurePersonalWallet(tenantId: string, userId: string): Promise<string> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: { externalId: true, email: true, personalWalletId: true },
    });
    if (!user) throw new NotFoundException('Utente non trovato');
    if (user.personalWalletId) return user.personalWalletId;
    const personal = await this.wallet.getOrCreatePersonal(user.externalId, user.email);
    await this.tenantPrisma.runInTenant(tenantId, (tx) =>
      tx.user.updateMany({ where: { id: userId, tenantId }, data: { personalWalletId: personal.company_id } }),
    );
    return personal.company_id;
  }

  /** Stato del wallet dell'azienda su Manager, con una cache breve. */
  private async companyState(tenantId: string): Promise<'ok' | 'missing' | 'error'> {
    const hit = this.companyCache.get(tenantId);
    if (hit && hit.until > Date.now()) return hit.value;
    const res = await this.wallet.companyWallet(tenantId);
    this.rememberCompany(tenantId, res.status);
    return res.status;
  }
  private rememberCompany(tenantId: string, status: 'ok' | 'missing' | 'error' | undefined): void {
    // Gli errori di rete non si ricordano: alla richiesta dopo si riprova.
    if (status === 'ok' || status === 'missing') {
      this.companyCache.set(tenantId, { value: status, until: Date.now() + BILLED_CACHE_MS });
    }
  }

  /** Portale owner di Manager, dove l'azienda si ricarica con Stripe. */
  private topupUrl(): string | undefined {
    const base = this.config.get('ecosystem', { infer: true }).managerUrl;
    if (!base) return undefined;
    try {
      return `${new URL(base).origin}/owner/`;
    } catch {
      return undefined;
    }
  }
}

/** Unisce le voci per feature, scarta quelle vuote e porta le unità a un valore valido. */
function normalize(items: BillItem[], catalog: FeatureCatalogService): Array<{ feature: string; units: number }> {
  const merged = new Map<string, number>();
  for (const i of items) {
    const unit = catalog.isUnit(i.feature);
    // Feature fisse: `units` è il numero di pezzi (intero, minimo 1).
    const u = unit ? (i.units ?? 1) : Math.max(1, Math.round(i.units ?? 1));
    if (!(i.units === undefined || i.units > 0)) continue;
    merged.set(i.feature, (merged.get(i.feature) ?? 0) + u);
  }
  return [...merged.entries()].map(([feature, units]) => ({ feature, units }));
}
