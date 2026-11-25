import { PODCAST_COVER, PODCAST_CATEGORIES } from '@scorm/contracts';

/** Scappa un testo per XML 1.0: caratteri speciali e caratteri di controllo non ammessi. */
export function xmlEscape(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface FeedPodcast {
  title: string;
  description: string;
  language: string;
  category: string;
  author?: string | null;
  contactEmail?: string | null;
  explicit: boolean;
}

export interface FeedEpisode {
  guid: string;
  title: string;
  summary: string;
  position: number;
  durationSec: number;
  sizeBytes: number;
  publishedAt: Date;
  audioUrl: string;
}

/** Lingua del feed: codice breve (it) o con regione (it-IT), come lo vogliono le piattaforme. */
function feedLanguage(language: string): string {
  return (language || 'it').trim().toLowerCase().replace('_', '-');
}

/**
 * Feed RSS 2.0 del podcast con lo spazio dei nomi iTunes. Segue i requisiti di Apple Podcasts:
 * dichiarazione XML, date RFC 2822, GUID che non cambia (`isPermaLink="false"`), un enclosure con
 * indirizzo, dimensione e tipo per ogni puntata, entità XML (non HTML).
 */
export function buildFeedXml(input: { podcast: FeedPodcast; feedUrl: string; siteUrl: string; coverUrl?: string; episodes: FeedEpisode[] }): string {
  const p = input.podcast;
  const e = xmlEscape;
  const description = p.description.trim() || p.title;
  const author = p.author?.trim() || p.title;
  const episodes = [...input.episodes].sort((a, b) => b.position - a.position || b.publishedAt.getTime() - a.publishedAt.getTime());
  const lastBuild = episodes.reduce((max, x) => (x.publishedAt > max ? x.publishedAt : max), new Date(0));
  const items = episodes
    .map(
      (x) => `    <item>
      <title>${e(x.title)}</title>
      <description>${e(x.summary.trim() || x.title)}</description>
      <itunes:summary>${e(x.summary.trim() || x.title)}</itunes:summary>
      <pubDate>${x.publishedAt.toUTCString()}</pubDate>
      <guid isPermaLink="false">${e(x.guid)}</guid>
      <enclosure url="${e(x.audioUrl)}" length="${Math.max(0, Math.round(x.sizeBytes))}" type="audio/mpeg"/>
      <itunes:duration>${Math.max(1, Math.round(x.durationSec))}</itunes:duration>
      <itunes:episode>${x.position}</itunes:episode>
      <itunes:episodeType>full</itunes:episodeType>
      <itunes:explicit>${p.explicit ? 'true' : 'false'}</itunes:explicit>
    </item>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${e(p.title)}</title>
    <link>${e(input.siteUrl)}</link>
    <description>${e(description)}</description>
    <language>${e(feedLanguage(p.language))}</language>
    <generator>K Scorm</generator>${episodes.length > 0 ? `\n    <lastBuildDate>${lastBuild.toUTCString()}</lastBuildDate>` : ''}
    <atom:link href="${e(input.feedUrl)}" rel="self" type="application/rss+xml"/>
    <itunes:author>${e(author)}</itunes:author>
    <itunes:summary>${e(description)}</itunes:summary>
    <itunes:explicit>${p.explicit ? 'true' : 'false'}</itunes:explicit>
    <itunes:type>episodic</itunes:type>
    <itunes:category text="${e(p.category)}"/>${p.contactEmail ? `\n    <itunes:owner>\n      <itunes:name>${e(author)}</itunes:name>\n      <itunes:email>${e(p.contactEmail)}</itunes:email>\n    </itunes:owner>` : ''}${input.coverUrl ? `\n    <itunes:image href="${e(input.coverUrl)}"/>\n    <image>\n      <url>${e(input.coverUrl)}</url>\n      <title>${e(p.title)}</title>\n      <link>${e(input.siteUrl)}</link>\n    </image>` : ''}
${items}
  </channel>
</rss>
`;
}

/**
 * Avvisi sul feed: cose che le piattaforme richiedono o consigliano. Non bloccano la pubblicazione
 * (un feed privato per una piattaforma custom può farne a meno), ma l'utente li vede.
 */
export function feedWarnings(
  podcast: Pick<FeedPodcast, 'description' | 'contactEmail' | 'author' | 'category'>,
  cover: { width: number; height: number } | null,
): string[] {
  const out: string[] = [];
  if (!cover) out.push('Manca la copertina: Apple Podcasts e Spotify la richiedono.');
  else if (cover.width !== cover.height || cover.width < PODCAST_COVER.minPx || cover.width > PODCAST_COVER.maxPx) {
    out.push(`La copertina deve essere quadrata, da ${PODCAST_COVER.minPx} a ${PODCAST_COVER.maxPx} px (questa è ${cover.width}×${cover.height}).`);
  }
  if (!podcast.description.trim()) out.push('Manca la descrizione della serie.');
  if (!podcast.contactEmail) out.push('Manca l\u2019email di contatto: serve per verificare la proprietà del feed.');
  if (!podcast.author?.trim()) out.push('Manca l\u2019autore: si userà il titolo della serie.');
  if (!(PODCAST_CATEGORIES as readonly string[]).includes(podcast.category)) out.push('Categoria non riconosciuta da Apple Podcasts.');
  return out;
}
