import { SlideVideoSpec, type SlideVideoCard, type AvatarFrame, type SlideShot, type PipPosition, type SlideCue, type SlideVideoLayout, type SlideVideoTheme } from '@scorm/contracts';

/** Una slide pronta per il montaggio: asset già risolti in URL e sottotitoli SRT grezzi. */
export interface AssemblySlide {
  id: string;
  /** URL dell'immagine; assente per le slide "extra", disegnate dal renderer da `textSlide`. */
  imageUrl?: string;
  textSlide?: { title: string; bullets: string[] };
  clipUrl: string;
  durationSec: number;
  title?: string;
  /** Copione narrato: unica cue di ripiego se la clip non ha sottotitoli. */
  narration?: string;
  /** Sottotitoli SRT della clip (tempi relativi alla clip). */
  srt?: string;
  /** Posizione dell'avatar per questa slide (layout pip). */
  pipPosition?: PipPosition;
  /** Inquadratura della slide (layout dynamic). */
  shot?: SlideShot;
}

/**
 * Converte un SRT in cue con tempi relativi alla clip. Robusto a CRLF, BOM e
 * separatore decimale con virgola o punto; ignora i blocchi malformati.
 */
export function parseSrtCues(srt: string): SlideCue[] {
  const clean = srt.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const toSec = (t: string): number => {
    const m = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/.exec(t.trim());
    if (!m) return NaN;
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number((m[4] ?? '0').padEnd(3, '0')) / 1000;
  };
  const cues: SlideCue[] = [];
  for (const block of clean.split(/\n{2,}/)) {
    const lines = block.split('\n').filter((l) => l.trim());
    const t = lines.findIndex((l) => l.includes('-->'));
    if (t === -1) continue;
    const [a, b] = lines[t]!.split('-->');
    const start = toSec(a ?? '');
    const end = toSec(b ?? '');
    const text = lines.slice(t + 1).join(' ').replace(/\s+/g, ' ').trim();
    if (!Number.isFinite(start) || !text) continue;
    cues.push({ start, end: Number.isFinite(end) ? Math.max(end, start) : start, text });
  }
  return cues.sort((x, y) => x.start - y.start);
}

/**
 * Unisce righe di sottotitolo troppo brevi in cue più lunghe e leggibili: le cue
 * HeyGen sono spezzate in frammenti da 1-2 secondi, che su un video lungo
 * affaticano la lettura. Il limite è per durata e per numero di caratteri.
 */
export function mergeCues(cues: SlideCue[], maxChars = 72, maxSec = 5): SlideCue[] {
  const out: SlideCue[] = [];
  for (const c of cues) {
    const last = out[out.length - 1];
    if (last && last.text.length + 1 + c.text.length <= maxChars && c.end - last.start <= maxSec) {
      last.text = `${last.text} ${c.text}`;
      last.end = c.end;
    } else {
      out.push({ ...c });
    }
  }
  return out;
}

export interface BuildSpecInput {
  slides: AssemblySlide[];
  layout?: SlideVideoLayout;
  pipPosition?: PipPosition;
  burnCaptions?: boolean;
  avatarFrame?: Partial<AvatarFrame>;
  sectionTitle?: string;
  theme?: Partial<SlideVideoTheme>;
  cover?: SlideVideoCard;
  outro?: SlideVideoCard;
}

/** Costruisce e valida lo SlideVideoSpec per il render a partire dalle slide con clip. */
export function buildSlideVideoSpec(input: BuildSpecInput): SlideVideoSpec {
  const slides = input.slides.map((s) => {
    const parsed = s.srt ? mergeCues(parseSrtCues(s.srt)) : [];
    const cues: SlideCue[] =
      parsed.length > 0
        ? parsed
        : s.narration
          ? [{ start: 0, end: s.durationSec, text: s.narration }]
          : [];
    return {
      id: s.id,
      imageUrl: s.imageUrl,
      textSlide: s.textSlide,
      clipUrl: s.clipUrl,
      durationSec: s.durationSec,
      title: s.title,
      narration: s.narration,
      cues,
      pipPosition: s.pipPosition,
      shot: s.shot,
    };
  });
  return SlideVideoSpec.parse({
    version: 1,
    layout: input.layout ?? 'split',
    pipPosition: input.pipPosition ?? 'bottom-right',
    burnCaptions: input.burnCaptions ?? false,
    avatarFrame: input.avatarFrame ?? {},
    theme: input.theme ?? {},
    sectionTitle: input.sectionTitle,
    cover: input.cover,
    outro: input.outro,
    slides,
  });
}
