import type {
  StockImageProvider,
  StockPhoto,
  StockPhotoAsset,
} from '@scorm/domain';

/**
 * Adapter Unsplash (https://unsplash.com/documentation). Immagini royalty-free;
 * la licenza richiede OBBLIGATORIAMENTE di: (1) accreditare il fotografo con
 * link, (2) "tracciare" il download chiamando l'endpoint download_location prima
 * di usare l'immagine. fetchFull assolve entrambi i requisiti.
 *
 * Autenticazione: header `Authorization: Client-ID <access key>`.
 */
export interface UnsplashProviderOptions {
  accessKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

interface UnsplashPhoto {
  id: string;
  width: number;
  height: number;
  description: string | null;
  alt_description: string | null;
  urls: { thumb: string; small: string; regular: string; full: string };
  links: { html: string; download_location: string };
  user: { name: string; links: { html: string } };
}

export class UnsplashStockImageProvider implements StockImageProvider {
  readonly id = 'unsplash';
  private readonly accessKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: UnsplashProviderOptions) {
    this.accessKey = opts.accessKey;
    this.baseUrl = opts.baseUrl ?? 'https://api.unsplash.com';
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private headers(): Record<string, string> {
    return { Authorization: `Client-ID ${this.accessKey}` };
  }

  async search(query: string, opts?: { perPage?: number }): Promise<StockPhoto[]> {
    const perPage = Math.min(opts?.perPage ?? 24, 30);
    const url = `${this.baseUrl}/search/photos?query=${encodeURIComponent(query)}&per_page=${perPage}`;
    const res = await this.fetchImpl(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`Unsplash search ${res.status}`);
    const json = (await res.json()) as { results?: UnsplashPhoto[] };
    return (json.results ?? []).map((p) => this.toPhoto(p));
  }

  async fetchFull(photoId: string): Promise<StockPhotoAsset> {
    const metaRes = await this.fetchImpl(`${this.baseUrl}/photos/${encodeURIComponent(photoId)}`, {
      headers: this.headers(),
    });
    if (!metaRes.ok) throw new Error(`Unsplash photo ${metaRes.status}`);
    const p = (await metaRes.json()) as UnsplashPhoto;

    // Requisito licenza Unsplash: registra il download prima dell'uso.
    try {
      await this.fetchImpl(p.links.download_location, { headers: this.headers() });
    } catch {
      /* best-effort: il tracking non deve bloccare l'uso dell'immagine */
    }

    const imgRes = await this.fetchImpl(p.urls.regular);
    if (!imgRes.ok) throw new Error(`Unsplash download ${imgRes.status}`);
    const bytes = new Uint8Array(await imgRes.arrayBuffer());
    const contentType = imgRes.headers.get('content-type') ?? 'image/jpeg';
    const photo = this.toPhoto(p);
    return { bytes, contentType, alt: photo.alt, attribution: photo.attribution };
  }

  private toPhoto(p: UnsplashPhoto): StockPhoto {
    return {
      id: p.id,
      provider: this.id,
      thumbUrl: p.urls.small,
      alt: p.alt_description ?? p.description ?? '',
      width: p.width,
      height: p.height,
      attribution: {
        provider: 'Unsplash',
        authorName: p.user.name,
        authorUrl: p.user.links.html,
        sourceUrl: p.links.html,
      },
    };
  }
}
