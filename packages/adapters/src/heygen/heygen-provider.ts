import {
  type VideoGenerationProvider,
  type GenerateVideoInput,
  type GenerateVideoJobResult,
  type AvatarOption,
  type VoiceOption,
  type Page,
  type ListAvatarsInput,
  type ListVoicesInput,
  type CreateAvatarInput,
  type CreateAvatarResult,
  type AvatarLookStatus,
  ProviderUnavailableError,
} from '@scorm/domain';

/**
 * Adapter HeyGen (https://docs.heygen.com) per la generazione di video avatar.
 *
 * Usa l'API v3 (la v2 è legacy, dismessa il 2026-10-31):
 *  - POST /v3/videos               → avvia il rendering, ritorna { data: { video_id } }
 *  - GET  /v3/videos/{video_id}    → stato: pending|processing|completed|failed,
 *                                     con video_url/duration/thumbnail_url al termine
 *  - GET  /v3/avatars              → avatar disponibili (non consuma quota)
 *  - GET  /v3/voices               → voci disponibili (non consuma quota)
 *
 * Autenticazione via header `X-Api-Key`. Le credenziali restano server-side.
 *
 * Nota sul piano Free: 3 video/mese, ~1 minuto, 720p e watermark HeyGen
 * incorporato. La quota mensile è applicata A MONTE dal servizio applicativo
 * (contando gli UsageRecord), non da questo adapter: qui ci limitiamo a parlare
 * con l'API e a tradurre errori/stati in modo neutro.
 */
export interface HeyGenProviderOptions {
  apiKey: string;
  /** Base URL dell'API (override per i test). Default: https://api.heygen.com */
  baseUrl?: string;
  /** Avatar di default se l'input non ne specifica uno. */
  defaultAvatarId?: string;
  /** Voce di default se l'input non ne specifica una. */
  defaultVoiceId?: string;
  /** Risoluzione di default (il Free è 720p). */
  defaultResolution?: string;
  /**
   * Motore di default: 'avatar_iii' | 'avatar_iv' | 'avatar_v'. Se vuoto, non
   * inviamo `engine` e HeyGen usa il suo default (Avatar IV). Avatar III è il
   * più economico ed è adatto ai photo avatar (test a basso costo).
   */
  defaultEngine?: string;
  /** TTL (ms) della cache di avatar/voci. Default 1h. 0 = disabilita la cache. */
  cacheTtlMs?: number;
  /** fetch iniettabile per i test; default global fetch (Node 20+). */
  fetchImpl?: typeof fetch;
}

/** Forma (parziale) della risposta di POST /v3/videos. */
interface CreateVideoResponse {
  data?: { video_id?: string };
  error?: { message?: string } | string | null;
  message?: string;
}

/** Forma (parziale) della risposta di GET /v3/videos/{video_id}. */
interface GetVideoResponse {
  data?: {
    status?: string;
    video_url?: string;
    thumbnail_url?: string;
    duration?: number;
    /** File sottotitoli sidecar (SRT) quando il video è stato creato con caption. */
    subtitle_url?: string;
    error?: { message?: string } | null;
    failure_message?: string;
  };
  error?: { message?: string } | string | null;
}

/**
 * Risposta di GET /v3/avatars. HeyGen v3 restituisce gli avatar DIRETTAMENTE in
 * `data` (array), con campi `id`/`name`/`preview_image_url`/`gender`. (Alcune
 * versioni annidano in `data.avatars`: gestiamo entrambe per robustezza.)
 */
interface AvatarItem {
  id?: string;
  avatar_id?: string;
  name?: string;
  avatar_name?: string;
  preview_image_url?: string;
  gender?: string;
}
interface ListAvatarsResponse {
  data?: AvatarItem[] | { avatars?: AvatarItem[] };
  has_more?: boolean;
  next_token?: string | null;
}

/** Risposta di GET /v3/voices: voci in `data` (array) con `voice_id`/`name`/… */
interface VoiceItem {
  voice_id?: string;
  name?: string;
  language?: string;
  gender?: string;
  preview_audio_url?: string;
}
/** Risposta di GET /v2/avatar_group.list: gruppi avatar (miei o pubblici). */
interface AvatarGroup {
  id?: string;
  name?: string;
  preview_image?: string;
  group_type?: string;
  num_looks?: number;
}
interface AvatarGroupListResponse {
  data?: { avatar_group_list?: AvatarGroup[] };
}
/** Risposta di GET /v2/avatar_group/{group_id}/avatars: i look del gruppo. */
interface GroupAvatarItem {
  id?: string;
  name?: string;
  status?: string;
  image_url?: string;
  gender?: string;
}
interface GroupAvatarListResponse {
  data?: { avatar_list?: GroupAvatarItem[] };
}
interface ListVoicesResponse {
  data?: VoiceItem[] | { voices?: VoiceItem[] };
  has_more?: boolean;
  next_token?: string | null;
}

/** Risposta di POST /v3/assets (upload immagine): asset_id + url. */
interface UploadAssetResponse {
  data?: { asset_id?: string; id?: string; url?: string; mime_type?: string };
  error?: { message?: string } | string | null;
  message?: string;
}

/**
 * Risposta di POST /v3/avatars (creazione photo/prompt). HeyGen restituisce il
 * gruppo creato e il "look" iniziale (avatar_item), con gli engine supportati.
 */
interface CreateAvatarApiResponse {
  data?: {
    avatar_group?: { id?: string; status?: string };
    avatar_item?: {
      id?: string;
      status?: string;
      supported_api_engines?: string[];
      preview_image_url?: string;
      avatar_type?: string;
    };
  };
  error?: { message?: string } | string | null;
  message?: string;
}

/** Risposta di GET /v3/avatars/looks/{id}: stato di un look. */
interface AvatarLookResponse {
  data?: {
    status?: string;
    preview_image_url?: string;
    supported_api_engines?: string[];
    error?: { message?: string } | null;
    failure_message?: string;
  };
  error?: { message?: string } | string | null;
}

export class HeyGenVideoProvider implements VideoGenerationProvider {
  readonly id = 'heygen';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultAvatarId?: string;
  private readonly defaultVoiceId?: string;
  private readonly defaultResolution: string;
  private readonly defaultEngine?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly cacheTtlMs: number;
  // Cache in-memory degli avatar DELL'ACCOUNT ("mine"): richiedono una chiamata
  // a /v2/avatar_group.list e cambiano di rado; memorizzarli rende istantanea
  // la prima pagina. Gli stock/voci sono paginati on-demand (nessuna cache qui:
  // react-query lato client memorizza già le pagine viste).
  private mineCache?: { expires: number; promise: Promise<AvatarOption[]> };

  constructor(opts: HeyGenProviderOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? 'https://api.heygen.com').replace(/\/+$/, '');
    this.defaultAvatarId = opts.defaultAvatarId;
    this.defaultVoiceId = opts.defaultVoiceId;
    this.defaultResolution = opts.defaultResolution ?? '720p';
    this.defaultEngine = opts.defaultEngine;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    // TTL breve: l'elenco "mine" è piccolo ma cambia quando l'utente crea/
    // elimina avatar (anche fuori dalla piattaforma). 5 minuti bilancia
    // freschezza e numero di chiamate; il refresh esplicito lo bypassa.
    this.cacheTtlMs = opts.cacheTtlMs ?? 5 * 60_000; // 5 min
  }

  /** Invalida la cache degli avatar dell'account (dopo create/delete). */
  invalidateMineCache(): void {
    this.mineCache = undefined;
  }

  private headers(): Record<string, string> {
    return { 'X-Api-Key': this.apiKey, 'Content-Type': 'application/json' };
  }

  /** Estrae un messaggio di errore leggibile da una risposta non-ok. */
  private static errMessage(status: number, body: unknown): string {
    const b = body as { error?: { message?: string } | string | null; message?: string } | null;
    const fromError =
      typeof b?.error === 'string' ? b.error : b?.error?.message ?? undefined;
    return fromError || b?.message || `HeyGen HTTP ${status}`;
  }

  async startJob(input: GenerateVideoInput): Promise<{ jobRef: string }> {
    const avatarId = input.avatarId ?? this.defaultAvatarId;
    if (!avatarId) {
      throw new ProviderUnavailableError(
        'heygen',
        new Error('Nessun avatar_id specificato e nessun avatar di default configurato'),
      );
    }
    const script = input.script.trim();
    if (!script) {
      throw new ProviderUnavailableError('heygen', new Error('Script vuoto'));
    }
    const voiceId = input.voiceId ?? this.defaultVoiceId;
    const body: Record<string, unknown> = {
      type: 'avatar',
      avatar_id: avatarId,
      script,
      resolution: input.resolution ?? this.defaultResolution,
      aspect_ratio: input.aspectRatio ?? '16:9',
    };
    // voice_id è opzionale: se assente HeyGen usa la voce di default dell'avatar.
    if (voiceId) body.voice_id = voiceId;
    // Motore di rendering: 'avatar_iii' (più economico, pipeline photo avatar),
    // 'avatar_iv' (default HeyGen) o 'avatar_v'. Inviato solo se specificato;
    // altrimenti HeyGen applica il suo default (Avatar IV).
    const engine = input.engine ?? this.defaultEngine;
    if (engine) body.engine = { type: engine };
    // Sottotitoli: con un oggetto `caption` (senza `style`) HeyGen genera il
    // file SRT sidecar (subtitle_url) SENZA bruciarlo nel video. Da questo
    // ricaviamo la trascrizione karaoke, senza ASR esterno.
    if (input.caption) body.caption = {};

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/v3/videos`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new ProviderUnavailableError('heygen', err);
    }
    const json = (await res.json().catch(() => null)) as CreateVideoResponse | null;
    if (!res.ok) {
      throw new ProviderUnavailableError(
        'heygen',
        new Error(HeyGenVideoProvider.errMessage(res.status, json)),
      );
    }
    const videoId = json?.data?.video_id;
    if (!videoId) {
      throw new ProviderUnavailableError(
        'heygen',
        new Error('Risposta HeyGen senza video_id'),
      );
    }
    return { jobRef: videoId };
  }

  async fetchJob(jobRef: string): Promise<GenerateVideoJobResult> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/v3/videos/${encodeURIComponent(jobRef)}`, {
        headers: this.headers(),
      });
    } catch (err) {
      // Errore di rete: trattalo come fallimento recuperabile dal chiamante.
      return { status: 'failed', reason: err instanceof Error ? err.message : 'Errore di rete' };
    }
    const json = (await res.json().catch(() => null)) as GetVideoResponse | null;
    if (!res.ok) {
      return { status: 'failed', reason: HeyGenVideoProvider.errMessage(res.status, json) };
    }
    const data = json?.data;
    const status = (data?.status ?? '').toLowerCase();
    // Stati HeyGen: pending | processing | waiting | completed | failed.
    if (status === 'completed') {
      const videoUrl = data?.video_url;
      if (!videoUrl) {
        return { status: 'failed', reason: 'Video completato ma senza video_url' };
      }
      return {
        status: 'completed',
        videoUrl,
        durationSec: typeof data?.duration === 'number' ? data.duration : undefined,
        thumbnailUrl: data?.thumbnail_url,
        subtitleUrl: data?.subtitle_url,
      };
    }
    if (status === 'failed') {
      const reason =
        data?.error?.message || data?.failure_message || 'Generazione video fallita';
      return { status: 'failed', reason };
    }
    return { status: 'processing' };
  }

  /** GET generico di una pagina HeyGen con cursore. */
  private async getPage<T>(path: string, token?: string, extraParams?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (token) url.searchParams.set('token', token);
    for (const [k, v] of Object.entries(extraParams ?? {})) url.searchParams.set(k, v);
    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), { headers: this.headers() });
    } catch (err) {
      throw new ProviderUnavailableError('heygen', err);
    }
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as unknown;
      throw new ProviderUnavailableError('heygen', new Error(HeyGenVideoProvider.errMessage(res.status, json)));
    }
    return (await res.json()) as T;
  }

  private static mapAvatar(a: AvatarItem, source: 'mine' | 'stock', group?: string, groupType?: string): AvatarOption | null {
    const id = a.id ?? a.avatar_id;
    if (!id) return null;
    return {
      id,
      name: a.name ?? a.avatar_name ?? id,
      previewUrl: a.preview_image_url,
      gender: a.gender,
      source,
      group,
      groupType,
    };
  }

  /** Avatar DELL'ACCOUNT ("mine") via /v2/avatar_group.list?include_public=false. */
  /**
   * Avatar DELL'ACCOUNT ("mine"). HeyGen organizza gli avatar dell'utente in
   * GRUPPI (/v2/avatar_group.list), ciascuno con uno o più LOOK. La generazione
   * video (/v3/videos) richiede l'id del LOOK, NON quello del gruppo: usare il
   * group id dà "avatar_not_found". Quindi per ogni gruppo risolviamo i look
   * (/v2/avatar_group/{id}/avatars) ed emettiamo una voce per ogni look pronto
   * (status 'completed'), con `id` = look id. Il nome combina gruppo e look.
   *
   * `force` bypassa e ripopola la cache (usato dal refresh esplicito e dopo
   * create/delete di un avatar dalla piattaforma).
   */
  private async fetchMineAvatars(force = false): Promise<AvatarOption[]> {
    const now = Date.now();
    if (!force && this.mineCache && this.mineCache.expires > now && this.cacheTtlMs > 0) {
      return this.mineCache.promise;
    }
    const promise = (async (): Promise<AvatarOption[]> => {
      const json = await this.getPage<AvatarGroupListResponse>('/v2/avatar_group.list', undefined, {
        include_public: 'false',
      });
      const groups = (json.data?.avatar_group_list ?? []).filter((g) => g.id);

      // Per ogni gruppo, risolve i look in parallelo. Un errore su un gruppo non
      // deve far fallire l'intera lista: in quel caso il gruppo viene saltato.
      const perGroup = await Promise.all(
        groups.map(async (g): Promise<AvatarOption[]> => {
          try {
            const looks = await this.fetchGroupLooks(g.id as string);
            const ready = looks.filter((l) => l.id && (l.status ?? '').toLowerCase() === 'completed');
            // Se non ci sono look pronti risolvibili, salta il gruppo: esporre il
            // group id non sarebbe utilizzabile per la generazione.
            if (ready.length === 0) return [];
            const multi = ready.length > 1;
            return ready.map((l): AvatarOption => ({
              id: l.id as string,
              name: multi && l.name ? `${g.name ?? 'Avatar'} — ${l.name}` : g.name ?? l.name ?? (l.id as string),
              previewUrl: l.image_url ?? g.preview_image,
              gender: l.gender,
              source: 'mine',
              group: g.name,
              groupType: g.group_type,
            }));
          } catch {
            return [];
          }
        }),
      );
      return perGroup.flat();
    })();
    if (this.cacheTtlMs > 0) this.mineCache = { expires: now + this.cacheTtlMs, promise };
    else this.mineCache = undefined;
    return promise;
  }

  /** Look di un gruppo avatar (/v2/avatar_group/{id}/avatars). */
  private async fetchGroupLooks(groupId: string): Promise<GroupAvatarItem[]> {
    const json = await this.getPage<GroupAvatarListResponse>(
      `/v2/avatar_group/${encodeURIComponent(groupId)}/avatars`,
    );
    return json.data?.avatar_list ?? [];
  }

  async listAvatarsPage(input?: ListAvatarsInput): Promise<Page<AvatarOption>> {
    const source = input?.source ?? 'stock';
    const query = (input?.query ?? '').trim().toLowerCase();

    // "Mine": pochi, ritornati in blocco (una chiamata, cache). Filtra per query.
    if (source === 'mine') {
      let items = await this.fetchMineAvatars(input?.refresh === true);
      if (query) items = items.filter((a) => a.name.toLowerCase().includes(query));
      return { items };
    }

    // "Stock" con ricerca: scorre le pagine del catalogo accumulando i match,
    // con un cap di pagine (il catalogo è enorme). Senza ricerca: una pagina.
    if (query) {
      return this.searchStockAvatars(query, input?.token);
    }
    const json = await this.getPage<ListAvatarsResponse>('/v3/avatars', input?.token);
    const raw = (Array.isArray(json.data) ? json.data : json.data?.avatars ?? []) as AvatarItem[];
    const items = raw
      .map((a) => HeyGenVideoProvider.mapAvatar(a, 'stock'))
      .filter((x): x is AvatarOption => x !== null);
    return { items, nextToken: json.has_more ? json.next_token ?? undefined : undefined };
  }

  /** Cerca negli avatar stock scorrendo le pagine (cap) finché trova abbastanza match. */
  private async searchStockAvatars(query: string, startToken?: string): Promise<Page<AvatarOption>> {
    const out: AvatarOption[] = [];
    let token = startToken;
    const MAX_PAGES = 30; // ~600 avatar scanditi per ricerca; sufficiente e rapido.
    for (let i = 0; i < MAX_PAGES; i++) {
      const json = await this.getPage<ListAvatarsResponse>('/v3/avatars', token);
      const raw = (Array.isArray(json.data) ? json.data : json.data?.avatars ?? []) as AvatarItem[];
      for (const a of raw) {
        const opt = HeyGenVideoProvider.mapAvatar(a, 'stock');
        if (opt && opt.name.toLowerCase().includes(query)) out.push(opt);
      }
      const next = json.has_more ? json.next_token ?? undefined : undefined;
      if (out.length >= 24 || !next) {
        return { items: out, nextToken: next };
      }
      token = next;
    }
    return { items: out };
  }

  async listVoicesPage(input?: ListVoicesInput): Promise<Page<VoiceOption>> {
    const want = normalizeLanguage(input?.language); // es. "italian"
    const query = (input?.query ?? '').trim().toLowerCase();

    // IMPORTANTE: HeyGen /v3/voices supporta il FILTRO LINGUA NATIVO via
    // `?language=<Nome>` (es. "Italian"), restituendo una pagina già filtrata in
    // modo VELOCE. Lo usiamo invece di scorrere il catalogo (che era lentissimo).
    const extra: Record<string, string> = {};
    if (want) extra.language = capitalizeFirst(want); // "italian" -> "Italian"

    // La ricerca testuale non è supportata nativamente: se c'è una query, la
    // applichiamo sulle pagine (già ristrette dalla lingua) con un piccolo cap.
    if (query) {
      return this.searchVoices({ want, query, startToken: input?.token, extra });
    }
    const json = await this.getPage<ListVoicesResponse>('/v3/voices', input?.token, extra);
    const raw = (Array.isArray(json.data) ? json.data : json.data?.voices ?? []) as VoiceItem[];
    const items = raw.filter((v) => v.voice_id).map(HeyGenVideoProvider.mapVoice);
    return { items, nextToken: json.has_more ? json.next_token ?? undefined : undefined };
  }

  private static mapVoice(v: VoiceItem): VoiceOption {
    return {
      id: v.voice_id as string,
      name: v.name ?? (v.voice_id as string),
      language: v.language,
      gender: v.gender,
      previewUrl: v.preview_audio_url,
    };
  }

  /**
   * Cerca per testo tra le voci, scorrendo le pagine (già ristrette dal filtro
   * lingua nativo via `extra`), con un piccolo cap. Veloce perché la lingua è
   * applicata lato HeyGen, quindi le pagine da scorrere sono poche.
   */
  private async searchVoices(opts: {
    want: string | null;
    query: string;
    startToken?: string;
    extra?: Record<string, string>;
  }): Promise<Page<VoiceOption>> {
    const out: VoiceOption[] = [];
    let token = opts.startToken;
    const MAX_PAGES = 10;
    for (let i = 0; i < MAX_PAGES; i++) {
      const json = await this.getPage<ListVoicesResponse>('/v3/voices', token, opts.extra);
      const raw = (Array.isArray(json.data) ? json.data : json.data?.voices ?? []) as VoiceItem[];
      for (const v of raw) {
        if (!v.voice_id) continue;
        if (!opts.query || (v.name ?? '').toLowerCase().includes(opts.query)) {
          out.push(HeyGenVideoProvider.mapVoice(v));
        }
      }
      const next = json.has_more ? json.next_token ?? undefined : undefined;
      if (out.length >= 20 || !next) {
        return { items: out, nextToken: next };
      }
      token = next;
    }
    return { items: out };
  }

  // --- Creazione / gestione avatar (operazioni a pagamento una tantum) ---------

  /**
   * Carica un'immagine come asset HeyGen e ritorna l'asset_id. Upload multipart
   * (campo `file`) su POST /v3/assets. Autenticazione via X-Api-Key (niente
   * Content-Type manuale: lo imposta fetch con il boundary del FormData).
   */
  private async uploadAsset(image: { bytes: Uint8Array | Buffer; contentType: string }): Promise<string> {
    const form = new FormData();
    // Blob dai byte: copia in un Uint8Array "pulito" per compatibilità di tipi.
    const bytes = image.bytes instanceof Uint8Array ? image.bytes : new Uint8Array(image.bytes);
    const blob = new Blob([bytes], { type: image.contentType });
    const ext = image.contentType.includes('png') ? 'png' : 'jpg';
    form.append('file', blob, `avatar.${ext}`);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/v3/assets`, {
        method: 'POST',
        headers: { 'X-Api-Key': this.apiKey },
        body: form,
      });
    } catch (err) {
      throw new ProviderUnavailableError('heygen', err);
    }
    const json = (await res.json().catch(() => null)) as UploadAssetResponse | null;
    if (!res.ok) {
      throw new ProviderUnavailableError('heygen', new Error(HeyGenVideoProvider.errMessage(res.status, json)));
    }
    const assetId = json?.data?.asset_id ?? json?.data?.id;
    if (!assetId) {
      throw new ProviderUnavailableError('heygen', new Error('Upload asset senza asset_id'));
    }
    return assetId;
  }

  async createAvatar(input: CreateAvatarInput): Promise<CreateAvatarResult> {
    const name = input.name.trim();
    if (!name) {
      throw new ProviderUnavailableError('heygen', new Error('Nome avatar mancante'));
    }
    const body: Record<string, unknown> = { type: input.type, name };
    if (input.type === 'photo') {
      if (!input.image) {
        throw new ProviderUnavailableError('heygen', new Error('Immagine mancante per avatar photo'));
      }
      const assetId = await this.uploadAsset(input.image);
      // `file` è discriminato per `type`: con 'asset_id' si passa l'asset caricato.
      body.file = { type: 'asset_id', asset_id: assetId };
    } else {
      const prompt = (input.prompt ?? '').trim();
      if (!prompt) {
        throw new ProviderUnavailableError('heygen', new Error('Prompt mancante per avatar prompt'));
      }
      body.prompt = prompt;
    }

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/v3/avatars`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new ProviderUnavailableError('heygen', err);
    }
    const json = (await res.json().catch(() => null)) as CreateAvatarApiResponse | null;
    if (!res.ok) {
      throw new ProviderUnavailableError('heygen', new Error(HeyGenVideoProvider.errMessage(res.status, json)));
    }
    const group = json?.data?.avatar_group;
    const look = json?.data?.avatar_item;
    const avatarId = look?.id;
    const groupId = group?.id;
    if (!avatarId || !groupId) {
      throw new ProviderUnavailableError('heygen', new Error('Risposta HeyGen senza avatar_item/avatar_group id'));
    }
    // Un nuovo avatar invalida la cache "mine" così la lista si aggiorna.
    this.mineCache = undefined;
    return {
      avatarId,
      groupId,
      name,
      status: (look?.status ?? 'processing').toLowerCase(),
      previewUrl: look?.preview_image_url,
      supportedEngines: look?.supported_api_engines,
    };
  }

  async getAvatarLook(lookId: string): Promise<AvatarLookStatus> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/v3/avatars/looks/${encodeURIComponent(lookId)}`, {
        headers: this.headers(),
      });
    } catch (err) {
      throw new ProviderUnavailableError('heygen', err);
    }
    const json = (await res.json().catch(() => null)) as AvatarLookResponse | null;
    if (!res.ok) {
      throw new ProviderUnavailableError('heygen', new Error(HeyGenVideoProvider.errMessage(res.status, json)));
    }
    const data = json?.data;
    const raw = (data?.status ?? '').toLowerCase();
    const status: AvatarLookStatus['status'] =
      raw === 'completed' ? 'completed' : raw === 'failed' ? 'failed' : 'processing';
    return {
      status,
      previewUrl: data?.preview_image_url,
      supportedEngines: data?.supported_api_engines,
      reason: status === 'failed' ? data?.error?.message || data?.failure_message || undefined : undefined,
    };
  }

  async deleteAvatar(groupId: string): Promise<void> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/v3/avatars/${encodeURIComponent(groupId)}`, {
        method: 'DELETE',
        headers: this.headers(),
      });
    } catch (err) {
      throw new ProviderUnavailableError('heygen', err);
    }
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as unknown;
      throw new ProviderUnavailableError('heygen', new Error(HeyGenVideoProvider.errMessage(res.status, json)));
    }
    // Elimina dalla cache "mine" così sparisce subito dalla lista.
    this.mineCache = undefined;
  }
}

/** Capitalizza la prima lettera (es. "italian" -> "Italian") per HeyGen. */
function capitalizeFirst(s: string): string {
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/** Normalizza il codice/nome lingua richiesto a un nome HeyGen minuscolo. */
function normalizeLanguage(language?: string): string | null {
  if (!language) return null;
  const key = language.slice(0, 2).toLowerCase();
  const map: Record<string, string> = {
    it: 'italian',
    en: 'english',
    es: 'spanish',
    fr: 'french',
    de: 'german',
    pt: 'portuguese',
    nl: 'dutch',
    ja: 'japanese',
    ru: 'russian',
    pl: 'polish',
    tr: 'turkish',
    ar: 'arabic',
    hi: 'hindi',
  };
  return map[key] ?? language.toLowerCase();
}
