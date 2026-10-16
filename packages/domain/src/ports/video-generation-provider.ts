/**
 * Porta per la generazione di video con avatar parlante (text-to-video).
 * Astrae il provider concreto (default: HeyGen). Un avatar pronuncia uno
 * "script" testuale e il provider rende un file video (MP4) scaricabile.
 *
 * Il flusso è ASINCRONO (il rendering richiede tempo): startJob avvia la
 * generazione e ritorna un riferimento persistibile; fetchJob ne recupera lo
 * stato e, al termine, l'URL del video pronto. Lo stesso schema della porta di
 * trascrizione, così il servizio può fare polling resiliente a un riavvio.
 *
 * Il mock di sviluppo NON chiama servizi esterni: produce un video "finto"
 * deterministico, utile a testare il flusso senza consumare la quota HeyGen.
 */

/** Parametri per avviare la generazione di un video avatar. */
export interface GenerateVideoInput {
  /** Testo che l'avatar pronuncerà (copione). */
  script: string;
  /** Id dell'avatar da usare (es. look id HeyGen). Se assente usa il default. */
  avatarId?: string;
  /** Id della voce TTS. Se assente usa la voce di default dell'avatar. */
  voiceId?: string;
  /** Risoluzione di output (es. "720p"). Il piano Free è limitato a 720p. */
  resolution?: string;
  /** Rapporto d'aspetto (es. "16:9"). */
  aspectRatio?: string;
  /** Codice lingua del copione (per audit/scelta voce), es. "it". */
  language?: string;
  /**
   * Motore di rendering (specifico HeyGen): 'avatar_iii' | 'avatar_iv' | 'avatar_v'.
   * Avatar III è il più economico ed è il pipeline dedicato ai photo avatar;
   * Avatar IV (default lato HeyGen se omesso) è più costoso. Se assente,
   * l'adapter usa il default configurato.
   */
  engine?: string;
  /**
   * Richiede al provider di produrre i SOTTOTITOLI sincronizzati (sidecar, es.
   * SRT) senza bruciarli nel video. Permette di ricavare la trascrizione
   * karaoke dai dati del provider (gratis, già sincronizzati col parlato reale)
   * invece di ri-trascrivere l'audio con un servizio ASR a parte.
   */
  caption?: boolean;
}

/** Esito del recupero di un job di generazione video asincrono. */
export type GenerateVideoJobResult =
  | { status: 'processing' }
  | {
      status: 'completed';
      /** URL (temporaneo, presigned) da cui scaricare il video renderizzato. */
      videoUrl: string;
      /** Durata del video in secondi, se nota (per il metering). */
      durationSec?: number;
      /** URL della thumbnail, se disponibile. */
      thumbnailUrl?: string;
      /**
       * URL (temporaneo) del file sottotitoli sidecar (SRT), presente se la
       * generazione è stata avviata con caption. Da scaricare e parsare in cue
       * per la trascrizione karaoke, senza ricorrere a un ASR esterno.
       */
      subtitleUrl?: string;
    }
  | { status: 'failed'; reason: string };

/** Un avatar disponibile per la generazione (per la scelta nell'editor). */
export interface AvatarOption {
  id: string;
  name: string;
  /** URL di un'anteprima (immagine), se disponibile. */
  previewUrl?: string;
  /** Genere, se indicato dal provider. */
  gender?: string;
  /** Provenienza: 'mine' = avatar dell'account; 'stock' = catalogo pubblico. */
  source?: 'mine' | 'stock';
  /** Tipologia dell'avatar (es. "PHOTO", "PUBLIC", "PRIVATE"), per raggruppare. */
  groupType?: string;
  /** Nome del gruppo/personaggio di appartenenza (per sottosezioni). */
  group?: string;
}

/** Una voce TTS disponibile per la generazione. */
export interface VoiceOption {
  id: string;
  name: string;
  /** Lingua della voce (es. "Italian", "it-IT"), se nota. */
  language?: string;
  gender?: string;
  /** URL di un'anteprima audio della voce, se disponibile. */
  previewUrl?: string;
}

/** Una pagina di risultati con cursore per la pagina successiva. */
export interface Page<T> {
  items: T[];
  /** Cursore opaco per la pagina successiva; assente se non ce ne sono altre. */
  nextToken?: string;
}

/** Parametri per paginare gli avatar. */
export interface ListAvatarsInput {
  /** 'mine' = avatar dell'account; 'stock' = catalogo pubblico (default). */
  source?: 'mine' | 'stock';
  /** Cursore della pagina (dalla risposta precedente). Assente = prima pagina. */
  token?: string;
  /**
   * Ricerca testuale sul nome. Quando presente, il provider cerca nel catalogo
   * scorrendo le pagine (con un limite di sicurezza) e ritorna i match.
   */
  query?: string;
}

/** Parametri per paginare le voci. */
export interface ListVoicesInput {
  /** Lingua richiesta (es. "it"); filtra/ordina le voci di quella lingua. */
  language?: string;
  /** Cursore della pagina. Assente = prima pagina. */
  token?: string;
  /** Ricerca testuale sul nome (scorre il catalogo con un limite). */
  query?: string;
}

/** Tipo di avatar creabile via API (sottoinsieme supportato: foto e prompt). */
export type CreateAvatarType = 'photo' | 'prompt';

/** Input per creare un avatar. Per 'photo' serve l'immagine; per 'prompt' il testo. */
export interface CreateAvatarInput {
  type: CreateAvatarType;
  /** Nome dell'avatar (etichetta nel catalogo). */
  name: string;
  /** Byte dell'immagine (solo 'photo'); l'adapter la carica come asset. */
  image?: { bytes: Uint8Array | Buffer; contentType: string };
  /** Descrizione testuale del personaggio (solo 'prompt'). */
  prompt?: string;
}

/** Esito della creazione: il look creato (avatar_id) e lo stato iniziale. */
export interface CreateAvatarResult {
  /** Id del look (= avatar_id da usare nella generazione video). */
  avatarId: string;
  /** Id del gruppo/personaggio (per eliminazione). */
  groupId: string;
  name: string;
  /** 'processing' | 'completed' | 'failed'. */
  status: string;
  previewUrl?: string;
  /** Engine supportati dal look (es. ['avatar_iii','avatar_iv','avatar_v']). */
  supportedEngines?: string[];
}

/** Stato di un look avatar durante/dopo la creazione (per il polling). */
export interface AvatarLookStatus {
  status: 'processing' | 'completed' | 'failed';
  previewUrl?: string;
  supportedEngines?: string[];
  /** Motivo del fallimento, se status 'failed'. */
  reason?: string;
}

export interface VideoGenerationProvider {
  readonly id: string;
  /**
   * Avvia la generazione di un video avatar e ritorna un riferimento
   * persistibile (es. il video_id di HeyGen). Lancia in caso di errore del
   * provider (rete, quota, parametri non validi).
   */
  startJob(input: GenerateVideoInput): Promise<{ jobRef: string }>;
  /**
   * Recupera lo stato/risultato di un job avviato con startJob. Idempotente:
   * può essere richiamato dopo un riavvio del processo.
   */
  fetchJob(jobRef: string): Promise<GenerateVideoJobResult>;
  /**
   * Elenca gli avatar UNA PAGINA alla volta (non consuma quota). La prima
   * chiamata (senza token) è veloce; le successive usano `nextToken`. 'mine'
   * ritorna gli avatar dell'account (pochi, in blocco); 'stock' è paginato.
   */
  listAvatarsPage(input?: ListAvatarsInput): Promise<Page<AvatarOption>>;
  /**
   * Elenca le voci UNA PAGINA alla volta (non consuma quota). Prima pagina
   * veloce; `nextToken` per le successive. `language` filtra per lingua.
   */
  listVoicesPage(input?: ListVoicesInput): Promise<Page<VoiceOption>>;
  /**
   * Crea un nuovo avatar (foto o prompt). Operazione A PAGAMENTO una tantum e
   * ASINCRONA: ritorna il look con status 'processing'; usare getAvatarLook per
   * il polling fino a 'completed'. Opzionale: assente se il provider non la
   * supporta (es. mock minimale).
   */
  createAvatar?(input: CreateAvatarInput): Promise<CreateAvatarResult>;
  /** Stato di un look avatar (per il polling dopo createAvatar). Opzionale. */
  getAvatarLook?(lookId: string): Promise<AvatarLookStatus>;
  /** Elimina un avatar (gruppo + look). Opzionale. */
  deleteAvatar?(groupId: string): Promise<void>;
}
