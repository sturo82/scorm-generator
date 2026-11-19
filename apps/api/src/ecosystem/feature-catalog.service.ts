import { Injectable, Logger } from '@nestjs/common';

/**
 * Tariffa di una feature a consumo (come definita dal listino di Manager):
 *  - `item`: a elemento (operazioni, immagini, blocchi di 1.000 caratteri);
 *  - `minute`: al minuto;
 *  - `fixed`: importo fisso per operazione.
 */
export type FeatureTariff = 'item' | 'minute' | 'fixed';

/** Tipo di tariffa di ogni feature di K Scorm (dichiarate nel self-register). */
export const FEATURE_TARIFF: Readonly<Record<string, FeatureTariff>> = {
  text_light: 'item',
  text_standard: 'item',
  image_generation: 'item',
  audio_narration: 'item',
  video_transcription: 'minute',
  video_avatar_iii_twin: 'minute',
  video_avatar_iii: 'minute',
  video_avatar_iv_photo: 'minute',
  video_avatar_iv: 'minute',
  video_avatar_v: 'minute',
  avatar_creation_photo: 'fixed',
  avatar_creation_twin: 'fixed',
  video_render: 'minute',
  video_cartoon: 'minute',
  video_cartoon_ai: 'minute',
  // Pacchetti a prezzo fisso (pezzi di corso finiti): vedi docs/RICHIESTA-MANAGER-PACCHETTI.md.
  course_structure: 'fixed',
  lesson_standard: 'fixed',
  lesson_pillola: 'fixed',
  lesson_pillola_interattiva: 'fixed',
  lesson_video_first: 'fixed',
  course_test: 'fixed',
};

/** Elenco delle feature da dichiarare a Manager (campo `features` del self-register). */
export const KSCORM_FEATURES: readonly string[] = Object.keys(FEATURE_TARIFF);

/**
 * Prezzi in crediti comunicati da Manager (listino attivo). Sono solo il ripiego: il listino
 * vero arriva con il kit (`featureCatalog`) e lo sostituisce quando è disponibile. Una feature
 * assente o senza prezzo (es. `video_cartoon_ai`) non è prenotabile.
 */
const FALLBACK_PRICES: Readonly<Record<string, number>> = {
  text_light: 6,
  text_standard: 36,
  image_generation: 9,
  audio_narration: 4,
  video_transcription: 5,
  video_avatar_iii_twin: 120,
  video_avatar_iii: 200,
  video_avatar_iv_photo: 465,
  video_avatar_iv: 970,
  video_avatar_v: 1440,
  avatar_creation_photo: 265,
  avatar_creation_twin: 430,
  video_render: 24,
  video_cartoon: 120,
};

/**
 * Listino in crediti delle feature a consumo. Fonte di verità: Manager (kit del self-register:
 * `featureCatalog` con il prezzo e `featureUnits` con le feature a unità). Finché il kit non
 * lo fornisce vale il listino di ripiego sopra.
 */
@Injectable()
export class FeatureCatalogService {
  private readonly logger = new Logger(FeatureCatalogService.name);
  private prices = new Map<string, number>(Object.entries(FALLBACK_PRICES));
  private unitFeatures = new Set<string>(
    Object.entries(FEATURE_TARIFF)
      .filter(([, t]) => t !== 'fixed')
      .map(([f]) => f),
  );
  private _source: 'fallback' | 'manager' = 'fallback';

  get source(): 'fallback' | 'manager' {
    return this._source;
  }

  /** Applica `featureCatalog` e `featureUnits` ricevuti da Manager. Ignora valori non validi. */
  applyKit(kit: { featureCatalog?: unknown; featureUnits?: unknown } | undefined): void {
    if (!kit) return;
    const cat = kit.featureCatalog;
    if (cat && typeof cat === 'object' && !Array.isArray(cat)) {
      const next = new Map<string, number>();
      for (const [feature, price] of Object.entries(cat as Record<string, unknown>)) {
        if (typeof price === 'number' && Number.isFinite(price) && price >= 0) next.set(feature, Math.round(price));
      }
      if (next.size > 0) {
        this.prices = next;
        this._source = 'manager';
      }
    }
    const units = kit.featureUnits;
    if (units && typeof units === 'object') {
      // Accetta sia {feature: 'item'} sia un array di nomi.
      const names = Array.isArray(units) ? units.filter((u): u is string => typeof u === 'string') : Object.keys(units);
      if (names.length > 0) this.unitFeatures = new Set(names);
    }
    if (this._source === 'manager') {
      this.logger.log(`Listino crediti da Manager: ${this.prices.size} feature, ${this.unitFeatures.size} a unità`);
    }
  }

  /** Prezzo in crediti (per unità o fisso), undefined se la feature non è prezzata. */
  price(feature: string): number | undefined {
    return this.prices.get(feature);
  }

  /** True se la feature si tariffa a unità (elemento o minuto) e vuole `units`. */
  isUnit(feature: string): boolean {
    return this.unitFeatures.has(feature);
  }

  /**
   * Costo in crediti: fissa = prezzo × quantità (per i pacchetti `units` è il numero di pezzi, minimo
   * 1); a unità = prezzo × unità iniziate (arrotondate per eccesso, minimo 1). Ritorna undefined se la
   * feature non è prezzata.
   */
  credits(feature: string, units = 1): number | undefined {
    const p = this.price(feature);
    if (p === undefined) return undefined;
    if (!this.isUnit(feature)) return p * Math.max(1, Math.round(units));
    return p * Math.max(1, Math.ceil(units - 1e-9));
  }
}
