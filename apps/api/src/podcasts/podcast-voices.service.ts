import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ObjectStorage, SpeechProvider } from '@scorm/domain';
import type { PodcastVoiceOption } from '@scorm/contracts';
import type { AppConfig } from '../config/configuration.js';
import { UsageMeterService } from '../metering/usage-meter.service.js';
import { OBJECT_STORAGE } from '../providers/provider.constants.js';
import { PODCAST_SPEECH } from './podcast.constants.js';

/** Locale per la sintesi: le voci generative sono per locale (it-IT, en-US, …). */
const LOCALES: Record<string, string> = {
  it: 'it-IT',
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  pt: 'pt-BR',
};

export function podcastLocale(language?: string | null): string {
  const raw = (language ?? '').trim();
  if (raw.includes('-')) return raw;
  return LOCALES[raw.slice(0, 2).toLowerCase()] ?? 'it-IT';
}

/** Frase di prova per l'anteprima di una voce, nella lingua della serie. */
const SAMPLES: Record<string, string> = {
  'it-IT': 'Ciao, benvenuti. Questa è la mia voce: vi accompagnerò nelle puntate di questo podcast.',
  'en-US': 'Hello, and welcome. This is my voice: I will be with you through the episodes of this podcast.',
  'es-ES': 'Hola, bienvenidos. Esta es mi voz: os acompañaré en los episodios de este pódcast.',
  'fr-FR': 'Bonjour et bienvenue. Voici ma voix : je vous accompagnerai dans les épisodes de ce podcast.',
  'de-DE': 'Hallo und willkommen. Das ist meine Stimme: Ich begleite Sie durch die Folgen dieses Podcasts.',
  'pt-BR': 'Olá, sejam bem-vindos. Esta é a minha voz: vou acompanhar vocês nos episódios deste podcast.',
};

/**
 * Elenco di riserva, usato se il fornitore non risponde (per esempio manca il permesso per
 * leggere il catalogo). Verificato sull'account: voci generative italiane a Francoforte.
 */
const FALLBACK: Record<string, PodcastVoiceOption[]> = {
  'it-IT': [
    { id: 'Bianca', name: 'Bianca', gender: 'female', language: 'it-IT' },
    { id: 'Beatrice', name: 'Beatrice', gender: 'female', language: 'it-IT' },
    { id: 'Lorenzo', name: 'Lorenzo', gender: 'male', language: 'it-IT' },
  ],
};

const CACHE_MS = 60 * 60_000;
const PREVIEW_URL_TTL_SEC = 3600;

/** Catalogo delle voci del podcast e anteprime. */
@Injectable()
export class PodcastVoicesService {
  private readonly logger = new Logger(PodcastVoicesService.name);
  private readonly cache = new Map<string, { at: number; voices: PodcastVoiceOption[] }>();

  constructor(
    @Inject(PODCAST_SPEECH) private readonly speech: SpeechProvider,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly meter: UsageMeterService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /** Voci disponibili per la lingua della serie. */
  async list(language: string): Promise<PodcastVoiceOption[]> {
    const locale = podcastLocale(language);
    const hit = this.cache.get(locale);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.voices;
    const cfg = this.config.get('podcast', { infer: true });
    let voices: PodcastVoiceOption[] = [];
    try {
      if (this.speech.listVoices) {
        voices = (await this.speech.listVoices({ language: locale, engine: cfg.speechEngine })).map((v) => ({
          id: v.id,
          name: v.name,
          gender: v.gender,
          language: v.language || locale,
        }));
      }
    } catch (err) {
      this.logger.warn(`Elenco voci non disponibile (${locale}): ${err instanceof Error ? err.message : 'errore'}. Uso l'elenco di riserva.`);
    }
    if (voices.length === 0) voices = FALLBACK[locale] ?? [];
    voices.sort((a, b) => a.name.localeCompare(b.name));
    // Non si conserva in cache un elenco vuoto: potrebbe essere un errore passeggero.
    if (voices.length > 0) this.cache.set(locale, { at: Date.now(), voices });
    return voices;
  }

  /** True se `voiceId` è una voce valida per la lingua. */
  async isValid(voiceId: string, language: string): Promise<boolean> {
    return (await this.list(language)).some((v) => v.id === voiceId);
  }

  /** Anteprima di una voce: breve audio di prova, conservato per riusarlo. Restituisce un link a scadenza. */
  async preview(tenantId: string, voiceId: string, language: string): Promise<{ url: string }> {
    const locale = podcastLocale(language);
    if (!(await this.isValid(voiceId, locale))) throw new NotFoundException('Voce non disponibile per questa lingua');
    const key = `podcast-previews/${tenantId}/${locale}-${voiceId}.mp3`;
    if (!(await this.storage.exists(key))) {
      const cfg = this.config.get('podcast', { infer: true });
      const text = SAMPLES[locale] ?? SAMPLES['en-US']!;
      const res = await this.speech.synthesize({ text, language: locale, voice: voiceId, engine: cfg.speechEngine });
      await this.storage.putObject(key, Buffer.from(res.bytes), { contentType: res.contentType });
      await this.meter.record({
        tenantId,
        courseId: null,
        provider: 'POLLY',
        model: `polly-${res.engine ?? cfg.speechEngine}`,
        unit: 'CHARACTERS',
        quantity: text.length,
        source: 'podcast_preview',
        region: cfg.speechRegion,
      });
    }
    return { url: await this.storage.getSignedUrl(key, { expiresInSec: PREVIEW_URL_TTL_SEC }) };
  }
}
