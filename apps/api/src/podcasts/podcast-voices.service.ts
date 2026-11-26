import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ObjectStorage, SpeechProvider } from '@scorm/domain';
import { podcastVoiceKey, type PodcastVoiceOption, type PodcastVoiceProvider, type PodcastVoiceRef } from '@scorm/contracts';
import type { AppConfig } from '../config/configuration.js';
import { UsageMeterService } from '../metering/usage-meter.service.js';
import { OBJECT_STORAGE } from '../providers/provider.constants.js';
import { PODCAST_HEYGEN_SPEECH, PODCAST_SPEECH } from './podcast.constants.js';

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
    { key: 'polly:Bianca', provider: 'polly', mine: false, accent: false, id: 'Bianca', name: 'Bianca', gender: 'female', language: 'it-IT' },
    { key: 'polly:Beatrice', provider: 'polly', mine: false, accent: false, id: 'Beatrice', name: 'Beatrice', gender: 'female', language: 'it-IT' },
    { key: 'polly:Lorenzo', provider: 'polly', mine: false, accent: false, id: 'Lorenzo', name: 'Lorenzo', gender: 'male', language: 'it-IT' },
  ],
};

/** Modello con cui si registra il consumo delle voci HeyGen (deve esistere nel listino). */
export const HEYGEN_VOICE_MODEL = 'heygen-voice-1';
const CACHE_MS = 60 * 60_000;
const PREVIEW_URL_TTL_SEC = 3600;

/**
 * Le voci proprie dell'account HeyGen (clonate con gli avatar) sono di un solo account: si
 * mettono a disposizione solo dell'azienda della piattaforma, come gli avatar non assegnati.
 */
const platformTenantId = (): string => process.env['AVATAR_DEFAULT_TENANT'] || 'knowkube';

/** Catalogo delle voci del podcast (Polly e HeyGen) e anteprime. */
@Injectable()
export class PodcastVoicesService {
  private readonly logger = new Logger(PodcastVoicesService.name);
  private readonly cache = new Map<string, { at: number; voices: PodcastVoiceOption[] }>();
  constructor(
    @Inject(PODCAST_SPEECH) private readonly speech: SpeechProvider,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly meter: UsageMeterService,
    private readonly config: ConfigService<AppConfig, true>,
    @Optional() @Inject(PODCAST_HEYGEN_SPEECH) private readonly heygen: SpeechProvider | null = null,
  ) {}

  /** Il fornitore che produce le voci di un tipo. */
  speechFor(provider: PodcastVoiceProvider): SpeechProvider {
    if (provider === 'heygen') {
      if (!this.heygen) throw new NotFoundException('Le voci HeyGen non sono configurate');
      return this.heygen;
    }
    return this.speech;
  }

  private async listPolly(locale: string): Promise<PodcastVoiceOption[]> {
    const cfg = this.config.get('podcast', { infer: true });
    let voices: PodcastVoiceOption[] = [];
    try {
      if (this.speech.listVoices) {
        voices = (await this.speech.listVoices({ language: locale, engine: cfg.speechEngine })).map((v) => ({
          key: podcastVoiceKey({ provider: 'polly', id: v.id }),
          provider: 'polly' as const,
          id: v.id,
          name: v.name,
          gender: v.gender,
          language: v.language || locale,
          mine: false,
          accent: false,
        }));
      }
    } catch (err) {
      this.logger.warn(`Elenco voci non disponibile (${locale}): ${err instanceof Error ? err.message : 'errore'}. Uso l'elenco di riserva.`);
    }
    return voices.length > 0 ? voices : (FALLBACK[locale] ?? []);
  }

  private async listHeygen(locale: string): Promise<PodcastVoiceOption[]> {
    if (!this.heygen?.listVoices) return [];
    try {
      return (await this.heygen.listVoices({ language: locale })).map((v) => ({
        key: podcastVoiceKey({ provider: 'heygen', id: v.id }),
        provider: 'heygen' as const,
        id: v.id,
        name: v.name,
        gender: v.gender,
        language: v.language || locale,
        mine: v.mine ?? false,
        accent: v.accent ?? false,
        previewUrl: v.previewUrl,
      }));
    } catch (err) {
      this.logger.warn(`Voci HeyGen non disponibili (${locale}): ${err instanceof Error ? err.message : 'errore'}`);
      return [];
    }
  }

  /** Voci disponibili per la lingua della serie, per chi le chiede (le voci proprie sono riservate). */
  async list(language: string, tenantId: string): Promise<PodcastVoiceOption[]> {
    const locale = podcastLocale(language);
    let hit = this.cache.get(locale);
    if (!hit || Date.now() - hit.at >= CACHE_MS) {
      const [polly, heygen] = await Promise.all([this.listPolly(locale), this.listHeygen(locale)]);
      polly.sort((a, b) => a.name.localeCompare(b.name));
      const voices = [...polly, ...heygen];
      hit = { at: Date.now(), voices };
      // Non si conserva in cache un elenco vuoto: potrebbe essere un errore passeggero.
      if (voices.length > 0) this.cache.set(locale, hit);
    }
    const isPlatform = tenantId === platformTenantId();
    return hit.voices.filter((v) => !v.mine || isPlatform);
  }

  /** True se la voce è valida per la lingua e utilizzabile da quell'azienda. */
  async isValid(voice: Pick<PodcastVoiceRef, 'provider' | 'id'>, language: string, tenantId: string): Promise<boolean> {
    const key = podcastVoiceKey(voice);
    return (await this.list(language, tenantId)).some((v) => v.key === key);
  }

  /** Anteprima di una voce: audio di prova già pronto del fornitore, o breve sintesi conservata per riusarla. */
  async preview(tenantId: string, voice: Pick<PodcastVoiceRef, 'provider' | 'id'>, language: string): Promise<{ url: string }> {
    const locale = podcastLocale(language);
    const option = (await this.list(locale, tenantId)).find((v) => v.key === podcastVoiceKey(voice));
    if (!option) throw new NotFoundException('Voce non disponibile per questa lingua');
    if (option.previewUrl) return { url: option.previewUrl };
    const key = `podcast-previews/${tenantId}/${locale}-${option.provider}-${option.id}.mp3`;
    if (!(await this.storage.exists(key))) {
      const cfg = this.config.get('podcast', { infer: true });
      const text = SAMPLES[locale] ?? SAMPLES['en-US']!;
      const res = await this.speechFor(option.provider).synthesize({ text, language: locale, voice: option.id, engine: cfg.speechEngine });
      await this.storage.putObject(key, Buffer.from(res.bytes), { contentType: res.contentType });
      await this.meter.record(
        option.provider === 'heygen'
          ? { tenantId, courseId: null, provider: 'HEYGEN', model: HEYGEN_VOICE_MODEL, unit: 'CHARACTERS', quantity: text.length, source: 'podcast_preview' }
          : {
              tenantId,
              courseId: null,
              provider: 'POLLY',
              model: `polly-${res.engine ?? cfg.speechEngine}`,
              unit: 'CHARACTERS',
              quantity: text.length,
              source: 'podcast_preview',
              region: cfg.speechRegion,
            },
      );
    }
    return { url: await this.storage.getSignedUrl(key, { expiresInSec: PREVIEW_URL_TTL_SEC }) };
  }
}
