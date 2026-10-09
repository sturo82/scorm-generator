import type {
  StockImageProvider,
  StockPhoto,
  StockPhotoAsset,
} from '@scorm/domain';

/**
 * Adapter Pexels (https://www.pexels.com/api/). Immagini royalty-free; la
 * licenza raccomanda di accreditare autore e Pexels. Autenticazione via header
 * `Authorization: <API key>`. Nessun tracking di download obbligatorio.
 */
export interface PexelsProviderOptions {
  apiKey: string;
  /** Base URL (override per i test). */
  baseUrl?: string;
  /** fetch iniettabile per i test; default global fetch (Node 20+). */
  fetchImpl?: typeof fetch;
}

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  alt?: string;
  photographer: string;
  photographer_url?: string;
  src: { tiny: string; medium: string; large2x: string; original: string };
}

export class PexelsStockImageProvider implements StockImageProvider {
  readonly id = 'pexels';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: PexelsProviderOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? 'https://api.pexels.com/v1';
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async search(query: string, opts?: { perPage?: number }): Promise<StockPhoto[]> {
    const perPage = Math.min(opts?.perPage ?? 24, 80);
    const url = `${this.baseUrl}/search?query=${encodeURIComponent(query)}&per_page=${perPage}`;
    const res = await this.fetchImpl(url, { headers: { Authorization: this.apiKey } });
    if (!res.ok) throw new Error(`Pexels search ${res.status}`);
    const json = (await res.json()) as { photos?: PexelsPhoto[] };
    return (json.photos ?? []).map((p) => ({
      id: String(p.id),
      provider: this.id,
      thumbUrl: p.src.medium,
      alt: p.alt ?? '',
      width: p.width,
      height: p.height,
      attribution: {
        provider: 'Pexels',
        authorName: p.photographer,
        authorUrl: p.photographer_url,
        sourceUrl: p.url,
      },
    }));
  }

  async fetchFull(photoId: string): Promise<StockPhotoAsset> {
    // Recupera i metadati della foto (per URL a piena risoluzione + attribuzione).
    const metaRes = await this.fetchImpl(`${this.baseUrl}/photos/${encodeURIComponent(photoId)}`, {
      headers: { Authorization: this.apiKey },
    });
    if (!metaRes.ok) throw new Error(`Pexels photo ${metaRes.status}`);
    const p = (await metaRes.json()) as PexelsPhoto;
    // Scarica i byte (large2x è un buon compromesso qualità/peso per lo SCORM).
    const imgUrl = p.src.large2x || p.src.original || p.src.large2x;
    const imgRes = await this.fetchImpl(imgUrl);
    if (!imgRes.ok) throw new Error(`Pexels download ${imgRes.status}`);
    const bytes = new Uint8Array(await imgRes.arrayBuffer());
    const contentType = imgRes.headers.get('content-type') ?? 'image/jpeg';
    return {
      bytes,
      contentType,
      alt: p.alt ?? '',
      attribution: {
        provider: 'Pexels',
        authorName: p.photographer,
        authorUrl: p.photographer_url,
        sourceUrl: p.url,
      },
    };
  }
}
