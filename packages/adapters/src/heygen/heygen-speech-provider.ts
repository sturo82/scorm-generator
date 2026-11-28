import { Buffer } from 'node:buffer';
import {
  ProviderUnavailableError,
  type SpeechProvider,
  type SpeechSynthesizeInput,
  type SpeechSynthesizeResult,
  type SpeechVoice,
} from '@scorm/domain';

export interface HeygenSpeechProviderOptions {
  apiKey: string;
  baseUrl?: string;
  /** Modello di voce HeyGen (default heygen-voice-1). */
  model?: string;
  /**
   * Motore di sintesi. Vuoto = endpoint /v3/models/audio/tts (heygen-voice-1). Con un motore
   * ('elevenlabs_v3', 'elevenlabs', 'orca', 'starfish', 'heygen_voice') si usa /v3/voices/speech.
   * Quell'audio è MP3 a 44,1 kHz: il podcast lo ricampiona nel mix (serve ffmpeg).
   */
  engine?: string;
  fetchImpl?: typeof fetch;
  /** Pausa minima tra due richieste (ms): HeyGen ammette 30 richieste al minuto per utente. */
  minIntervalMs?: number;
}

interface AudioVoice {
  voice_id?: string;
  name?: string;
  gender?: string;
  language?: string;
  status?: string;
  preview_audio_url?: string;
}
interface VoicesPage {
  data?: AudioVoice[];
  has_more?: boolean;
  next_token?: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const baseLang = (code?: string): string => (code ?? '').slice(0, 2).toLowerCase();
/** Voci "di catalogo" in più, tra quelle multilingua, quando HeyGen non ha voci native per la lingua. */
const MULTILINGUAL_EXTRA = 16;
const NATIVE_ENOUGH = 4;

/**
 * Voce con HeyGen Voice (POST /v3/models/audio/tts): voci del catalogo e voci proprie dell'account
 * (cloni creati con gli avatar). L'audio esce in MP3 mono a 24 kHz, come quello di Polly, così le
 * battute di fornitori diversi si uniscono nello stesso file.
 */
export class HeygenSpeechProvider implements SpeechProvider {
  readonly id = 'heygen';
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly minIntervalMs: number;
  private nextSlot = 0;

  constructor(private readonly opts: HeygenSpeechProviderOptions) {
    this.baseUrl = (opts.baseUrl ?? 'https://api.heygen.com').replace(/\/+$/, '');
    this.model = opts.model ?? 'heygen-voice-1';
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.minIntervalMs = opts.minIntervalMs ?? 2200;
  }

  private headers(): Record<string, string> {
    return { 'X-Api-Key': this.opts.apiKey, 'Content-Type': 'application/json' };
  }

  private async getVoices(query: Record<string, string>, maxPages: number): Promise<AudioVoice[]> {
    const out: AudioVoice[] = [];
    let token: string | undefined;
    for (let i = 0; i < maxPages; i++) {
      const qs = new URLSearchParams({ limit: '50', ...query, ...(token ? { token } : {}) });
      const res = await this.fetchImpl(`${this.baseUrl}/v3/models/audio/voices?${qs}`, { headers: this.headers() });
      if (!res.ok) throw new ProviderUnavailableError(`HeyGen voci: HTTP ${res.status}`);
      const json = (await res.json()) as VoicesPage;
      out.push(...(json.data ?? []));
      if (!json.has_more || !json.next_token) break;
      token = json.next_token;
    }
    return out;
  }

  /**
   * Voci per una lingua: prima le proprie (clonate), poi quelle del catalogo nella lingua; se il
   * catalogo ne ha poche (per l'italiano nessuna) si aggiungono le migliori multilingua, segnalate.
   */
  async listVoices(input: { language?: string } = {}): Promise<SpeechVoice[]> {
    const lang = baseLang(input.language) || 'en';
    const toVoice = (v: AudioVoice, mine: boolean, accent: boolean): SpeechVoice => ({
      id: v.voice_id as string,
      name: v.name ?? (v.voice_id as string),
      gender: v.gender === 'female' || v.gender === 'male' ? v.gender : 'unknown',
      language: input.language ?? lang,
      mine,
      accent,
      previewUrl: v.preview_audio_url,
    });
    const own = (await this.getVoices({}, 2)).filter((v) => v.voice_id && v.status === 'ACTIVE');
    const native = (await this.getVoices({ type: 'public', language: lang }, 2)).filter((v) => v.voice_id && v.status !== 'FAILED');
    const extra =
      native.length < NATIVE_ENOUGH
        ? (await this.getVoices({ type: 'public' }, 1)).filter((v) => v.voice_id && baseLang(v.language) !== lang).slice(0, MULTILINGUAL_EXTRA)
        : [];
    const seen = new Set<string>();
    const all: SpeechVoice[] = [];
    for (const [list, mine, accentFor] of [
      [own, true, (v: AudioVoice) => baseLang(v.language) !== lang],
      [native, false, () => false],
      [extra, false, () => true],
    ] as const) {
      for (const v of list) {
        if (seen.has(v.voice_id!)) continue;
        seen.add(v.voice_id!);
        all.push(toVoice(v, mine, accentFor(v)));
      }
    }
    return all;
  }

  /** Crea una voce nuova da una descrizione (età, tono, accento, stile). Restituisce subito l'id: la voce è pronta dopo qualche secondo. */
  async designVoice(input: { name: string; language: string; description: string }): Promise<string> {
    const res = await this.fetchImpl(`${this.baseUrl}/v3/models/audio/voices`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ mode: 'design', name: input.name, language: baseLang(input.language) || 'it', description: input.description }),
    });
    if (res.status === 429) throw new ProviderUnavailableError('HeyGen: troppe voci create di recente, riprova più tardi');
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      throw new ProviderUnavailableError(`HeyGen non ha creato la voce: HTTP ${res.status} ${detail}`);
    }
    const json = (await res.json()) as { data?: { voice_id?: string } };
    const id = json.data?.voice_id;
    if (!id) throw new ProviderUnavailableError('HeyGen: risposta senza identificativo della voce');
    return id;
  }

  /** Stato di una voce dell'account: PENDING finché si prepara, ACTIVE quando si può usare. */
  async voiceStatus(voiceId: string): Promise<{ status: 'PENDING' | 'ACTIVE' | 'FAILED'; previewUrl?: string }> {
    const res = await this.fetchImpl(`${this.baseUrl}/v3/models/audio/voices/${encodeURIComponent(voiceId)}`, { headers: this.headers() });
    if (!res.ok) throw new ProviderUnavailableError(`HeyGen voce: HTTP ${res.status}`);
    const json = (await res.json()) as { data?: AudioVoice };
    const st = json.data?.status;
    const status = st === 'ACTIVE' && json.data?.preview_audio_url ? 'ACTIVE' : st === 'FAILED' ? 'FAILED' : 'PENDING';
    return { status, previewUrl: json.data?.preview_audio_url };
  }

  /** Aspetta il proprio turno per restare sotto il limite di richieste al minuto. */
  private async pace(): Promise<void> {
    const now = Date.now();
    const at = Math.max(now, this.nextSlot);
    this.nextSlot = at + this.minIntervalMs;
    if (at > now) await sleep(at - now);
  }

  async synthesize(input: SpeechSynthesizeInput): Promise<SpeechSynthesizeResult> {
    if (!input.voice) throw new ProviderUnavailableError('HeyGen: manca la voce');
    const engine = this.opts.engine?.trim();
    const speed = input.speed && Math.abs(input.speed - 1) > 0.01 ? { speed: Math.min(1.5, Math.max(0.5, input.speed)) } : {};
    const language = baseLang(input.language) || undefined;
    const path = engine ? '/v3/voices/speech' : '/v3/models/audio/tts';
    const body = engine
      ? JSON.stringify({ voice_id: input.voice, text: input.text, language, engine, ...speed })
      : JSON.stringify({
          voice_id: input.voice,
          text: input.text,
          language,
          model: this.model,
          ...speed,
          output_format: { encoding: 'mp3', sample_rate_hertz: 24000 },
        });
    let lastStatus = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      await this.pace();
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, { method: 'POST', headers: this.headers(), body });
      lastStatus = res.status;
      if (res.status === 429 || res.status === 503 || res.status === 500) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep((Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 4 * 2 ** attempt) * 1000);
        continue;
      }
      if (res.status === 402) throw new ProviderUnavailableError('HeyGen: crediti API esauriti');
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 200);
        throw new ProviderUnavailableError(`HeyGen voce: HTTP ${res.status} ${detail}`);
      }
      const json = (await res.json()) as { data?: { audio_url?: string } };
      const url = json.data?.audio_url;
      if (!url) throw new ProviderUnavailableError('HeyGen voce: risposta senza audio');
      const audio = await this.fetchImpl(url);
      if (!audio.ok) throw new ProviderUnavailableError(`HeyGen voce: download audio HTTP ${audio.status}`);
      return { bytes: Buffer.from(await audio.arrayBuffer()), contentType: 'audio/mpeg', voice: input.voice };
    }
    throw new ProviderUnavailableError(`HeyGen voce: servizio occupato (HTTP ${lastStatus}), riprova più tardi`);
  }
}
