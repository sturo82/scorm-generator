import { Buffer } from 'node:buffer';
import { PollyClient, SynthesizeSpeechCommand, type Engine } from '@aws-sdk/client-polly';
import {
  type SpeechProvider,
  type SpeechSynthesizeInput,
  type SpeechSynthesizeResult,
  type SpeechSynthesizeWithMarksResult,
  type SpeechWordMark,
  ProviderUnavailableError,
} from '@scorm/domain';

export interface PollySpeechProviderOptions {
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  /** Engine Polly: "neural" (default) o "standard". */
  engine?: Engine;
  /** Voce di default se non specificata nell'input e lingua non mappata. */
  defaultVoice?: string;
}

/**
 * Voce neurale di default per lingua (Amazon Polly). Copre le lingue più comuni
 * dei corsi; per lingue non mappate si usa `defaultVoice`.
 */
const VOICE_BY_LANGUAGE: Record<string, string> = {
  it: 'Bianca',
  'it-IT': 'Bianca',
  en: 'Joanna',
  'en-US': 'Joanna',
  'en-GB': 'Amy',
  es: 'Lucia',
  'es-ES': 'Lucia',
  fr: 'Lea',
  'fr-FR': 'Lea',
  de: 'Vicki',
  'de-DE': 'Vicki',
  pt: 'Ines',
  'pt-PT': 'Ines',
};

/**
 * Adapter SpeechProvider su Amazon Polly (text-to-speech batch). Sintetizza il
 * testo in un MP3 con una voce neurale coerente con la lingua. Le credenziali
 * restano server-side (Requisito 10.5): opzioni o default credential chain.
 */
export class PollySpeechProvider implements SpeechProvider {
  readonly id = 'polly';
  private readonly client: PollyClient;
  private readonly engine: Engine;
  private readonly defaultVoice: string;

  constructor(opts: PollySpeechProviderOptions = {}) {
    this.engine = opts.engine ?? 'neural';
    this.defaultVoice = opts.defaultVoice ?? 'Joanna';
    this.client = new PollyClient({
      region: opts.region ?? 'us-west-2',
      credentials:
        opts.accessKeyId && opts.secretAccessKey
          ? {
              accessKeyId: opts.accessKeyId,
              secretAccessKey: opts.secretAccessKey,
              sessionToken: opts.sessionToken,
            }
          : undefined,
    });
  }

  async synthesize(input: SpeechSynthesizeInput): Promise<SpeechSynthesizeResult> {
    const voice = input.voice ?? this.voiceForLanguage(input.language) ?? this.defaultVoice;
    // Engine per-richiesta (scelta del corso/generazione) con fallback al default
    // del provider: 'standard' | 'neural' | 'generative' (voce iper-realistica).
    const engine: Engine = (input.engine as Engine) ?? this.engine;

    let response;
    try {
      response = await this.client.send(
        new SynthesizeSpeechCommand({
          Text: input.text,
          TextType: input.ssml ? 'ssml' : undefined,
          OutputFormat: 'mp3',
          VoiceId: voice as never,
          Engine: engine,
        }),
      );
    } catch (err) {
      throw new ProviderUnavailableError('polly', err);
    }

    const stream = response.AudioStream;
    if (!stream) throw new ProviderUnavailableError('polly', new Error('AudioStream vuoto'));
    const bytes = await (stream as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();

    return {
      bytes: Buffer.from(bytes),
      contentType: 'audio/mpeg',
      voice,
      engine: reportEngine(engine),
    };
  }

  /**
   * Sintesi CON speech marks a livello di parola. Polly ha un limite di ~3000
   * caratteri FATTURABILI per chiamata sincrona (SynthesizeSpeechCommand): i
   * voiceover lunghi (video-lezione di qualche minuto) lo superano e
   * fallirebbero con TextLengthExceededException. Per questo spezziamo il testo
   * in CHUNK ai confini di frase (<= MAX_TTS_CHARS), sintetizziamo ciascun chunk
   * (MP3 + marks) e CONCATENIAMO: gli MP3 in sequenza, i word-marks con offset
   * cumulativo (il tempo di ogni chunk riparte da 0, quindi va traslato della
   * durata dei chunk precedenti). Il taglio ai confini di frase riduce al minimo
   * il drift di sync tra un chunk e il successivo.
   */
  async synthesizeWithMarks(input: SpeechSynthesizeInput): Promise<SpeechSynthesizeWithMarksResult> {
    const voice = input.voice ?? this.voiceForLanguage(input.language) ?? this.defaultVoice;
    const engine: Engine = (input.engine as Engine) ?? this.engine;
    const ssml = input.ssml === true;
    // Chunking: SSML si spezza ai confini di <break> (ogni chunk resta un
    // documento <speak> valido); testo semplice ai confini di frase.
    const chunks = ssml ? splitSsmlForTts(input.text, MAX_TTS_CHARS) : splitTextForTts(input.text, MAX_TTS_CHARS);

    // Caso comune (testo breve): una sola chiamata, nessun offset. Veloce.
    if (chunks.length <= 1) {
      const only = await this.synthesizeChunk(input.text, voice, engine, ssml);
      return {
        bytes: only.audio,
        contentType: 'audio/mpeg',
        voice,
        engine: only.reportedEngine,
        marks: only.marks,
      };
    }

    // Testo lungo: sintetizza ogni chunk e concatena audio + marks (offset).
    // CRUCIALE per il sync: l'offset di ciascun chunk è la DURATA REALE dell'MP3
    // dei chunk precedenti (sommando i frame MP3), NON una stima dai word-marks
    // — l'ultima parola di ogni chunk ha endMs==startMs e stimare dall'ultimo
    // mark lascia l'offset INDIETRO, ammassando tutte le parole all'inizio
    // (il karaoke sembrerebbe "ripetere la prima parte").
    const audioParts: Buffer[] = [];
    const allMarks: SpeechWordMark[] = [];
    let offsetMs = 0;
    let reportedEngine: 'standard' | 'neural' | 'generative' = 'neural';
    for (const chunk of chunks) {
      const res = await this.synthesizeChunk(chunk, voice, engine, ssml);
      reportedEngine = res.reportedEngine;
      audioParts.push(res.audio);
      for (const m of res.marks) {
        allMarks.push({ word: m.word, startMs: m.startMs + offsetMs, endMs: m.endMs + offsetMs });
      }
      // Durata reale dell'MP3 di questo chunk (dai frame): è quanto dura davvero
      // l'audio, quindi l'offset del chunk successivo è esatto.
      offsetMs += mp3DurationMs(res.audio);
    }
    // Ricalcola endMs come start della parola successiva (coerente con la
    // semantica di parsePollySpeechMarks), così il karaoke scorre senza buchi.
    for (let i = 0; i < allMarks.length - 1; i++) {
      allMarks[i]!.endMs = allMarks[i + 1]!.startMs;
    }

    return {
      bytes: Buffer.concat(audioParts),
      contentType: 'audio/mpeg',
      voice,
      engine: reportedEngine,
      marks: allMarks,
    };
  }

  /**
   * Sintesi di UN chunk: MP3 + word-marks.
   * - standard/neural: audio e marks dallo stesso engine (word-marks nativi).
   * - generative (voce iper-realistica): Polly NON fornisce speech marks per
   *   questo engine. Quindi l'AUDIO è generative, ma i WORD-MARKS si derivano
   *   dalla voce NEURAL della stessa persona e si RISCALANO linearmente sulla
   *   durata reale dell'MP3 generative: il karaoke resta agganciato alla voce
   *   vera (precisione molto alta, il ritmo neural↔generative è quasi identico).
   */
  private async synthesizeChunk(
    text: string,
    voice: string,
    engine: Engine,
    ssml = false,
  ): Promise<{ audio: Buffer; marks: SpeechWordMark[]; reportedEngine: 'standard' | 'neural' | 'generative' }> {
    const textType = ssml ? ('ssml' as const) : undefined;
    let effectiveEngine: Engine = engine;
    let audioResponse;
    try {
      audioResponse = await this.client.send(
        new SynthesizeSpeechCommand({ Text: text, TextType: textType, OutputFormat: 'mp3', VoiceId: voice as never, Engine: engine }),
      );
    } catch (err) {
      // Fallback difensivo: se la voce non supporta 'generative' (dipende dalla
      // lingua), ricade su 'neural' invece di fallire tutto il job.
      if (engine === ('generative' as Engine)) {
        effectiveEngine = 'neural' as Engine;
        try {
          audioResponse = await this.client.send(
            new SynthesizeSpeechCommand({ Text: text, TextType: textType, OutputFormat: 'mp3', VoiceId: voice as never, Engine: effectiveEngine }),
          );
        } catch (err2) {
          throw new ProviderUnavailableError('polly', err2);
        }
      } else {
        throw new ProviderUnavailableError('polly', err);
      }
    }
    // Speech marks: 'generative' non li fornisce → sempre da 'neural'.
    const isGenerative = effectiveEngine === ('generative' as Engine);
    const marksEngine: Engine = isGenerative ? ('neural' as Engine) : effectiveEngine;
    let marksResponse;
    try {
      marksResponse = await this.client.send(
        new SynthesizeSpeechCommand({
          Text: text,
          TextType: textType,
          OutputFormat: 'json',
          SpeechMarkTypes: ['word'],
          VoiceId: voice as never,
          Engine: marksEngine,
        }),
      );
    } catch (err) {
      throw new ProviderUnavailableError('polly', err);
    }

    const audioStream = audioResponse.AudioStream;
    if (!audioStream) throw new ProviderUnavailableError('polly', new Error('AudioStream vuoto'));
    const audioBytes = await (audioStream as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
    const audio = Buffer.from(audioBytes);

    const marksStream = marksResponse.AudioStream;
    if (!marksStream) throw new ProviderUnavailableError('polly', new Error('SpeechMarks vuoti'));
    const marksRaw = await (marksStream as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
    let marks = parsePollySpeechMarks(Buffer.from(marksRaw).toString('utf8'));

    // Generative: riscala i marks (ricavati da neural) sulla durata REALE
    // dell'audio generative, così l'ultima parola cade alla fine dell'audio vero.
    if (isGenerative && marks.length > 0) {
      const genMs = mp3DurationMs(audio);
      const neuralEndMs = marks[marks.length - 1]!.startMs;
      if (genMs > 0 && neuralEndMs > 0) {
        const k = genMs / neuralEndMs;
        marks = marks.map((m) => ({ word: m.word, startMs: Math.round(m.startMs * k), endMs: Math.round(m.endMs * k) }));
      }
    }

    return { audio, marks, reportedEngine: reportEngine(effectiveEngine) };
  }

  private voiceForLanguage(language?: string): string | undefined {
    if (!language) return undefined;
    return VOICE_BY_LANGUAGE[language] ?? VOICE_BY_LANGUAGE[language.split('-')[0]!];
  }
}

/**
 * Limite di caratteri per chunk TTS. Polly consente ~3000 caratteri FATTURABILI
 * per SynthesizeSpeechCommand sincrona; stiamo sotto con margine per sicurezza.
 */
export const MAX_TTS_CHARS = 2800;

/** Engine effettivo per audit/metering (classi di costo rilevanti). */
function reportEngine(engine: Engine): 'standard' | 'neural' | 'generative' {
  if (engine === ('standard' as Engine)) return 'standard';
  if (engine === ('generative' as Engine)) return 'generative';
  return 'neural';
}

// Tabelle MPEG audio per il calcolo della durata reale di un MP3 (vedi mp3DurationMs).
const MP3_BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const MP3_BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const MP3_SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG1
  2: [22050, 24000, 16000], // MPEG2
  0: [11025, 12000, 8000], // MPEG2.5
};

/**
 * Durata REALE (ms) di un buffer MP3, sommando la durata di ogni frame audio.
 * Legge gli header dei frame MPEG (sync 0xFFE) e per ciascuno calcola
 * campioni/bitrate; robusto a CBR e VBR, salta tag ID3v2 iniziali. Serve a
 * offsettare con precisione i chunk concatenati del TTS (sync karaoke esatto).
 * Se non riconosce frame validi, ritorna 0 (il chiamante non avanza l'offset).
 */
export function mp3DurationMs(buf: Buffer): number {
  let i = 0;
  // Salta un eventuale tag ID3v2 in testa: "ID3" + ver(2) + flags(1) + size(4, synchsafe).
  if (buf.length > 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    const size = ((buf[6]! & 0x7f) << 21) | ((buf[7]! & 0x7f) << 14) | ((buf[8]! & 0x7f) << 7) | (buf[9]! & 0x7f);
    i = 10 + size;
  }
  let durationMs = 0;
  while (i + 4 <= buf.length) {
    // Sync word: 11 bit a 1 (0xFF seguito da 0xE_).
    if (buf[i] !== 0xff || (buf[i + 1]! & 0xe0) !== 0xe0) {
      i += 1;
      continue;
    }
    const verBits = (buf[i + 1]! >> 3) & 0x03; // 3=MPEG1, 2=MPEG2, 0=MPEG2.5
    const layerBits = (buf[i + 1]! >> 1) & 0x03; // 1=Layer III
    const bitrateIdx = (buf[i + 2]! >> 4) & 0x0f;
    const sampleIdx = (buf[i + 2]! >> 2) & 0x03;
    const padding = (buf[i + 2]! >> 1) & 0x01;
    const rates = MP3_SAMPLE_RATES[verBits];
    if (layerBits !== 1 || !rates || sampleIdx === 3 || bitrateIdx === 0 || bitrateIdx === 15) {
      i += 1;
      continue;
    }
    const sampleRate = rates[sampleIdx]!;
    const bitrateKbps = (verBits === 3 ? MP3_BITRATES_V1_L3 : MP3_BITRATES_V2_L3)[bitrateIdx]!;
    const bitrate = bitrateKbps * 1000;
    // Campioni per frame: 1152 per MPEG1 L3, 576 per MPEG2/2.5 L3.
    const samplesPerFrame = verBits === 3 ? 1152 : 576;
    const frameLen = Math.floor((samplesPerFrame / 8 * bitrate) / sampleRate) + padding;
    if (frameLen <= 0) {
      i += 1;
      continue;
    }
    durationMs += (samplesPerFrame / sampleRate) * 1000;
    i += frameLen;
  }
  return Math.round(durationMs);
}

/**
 * Spezza un testo in chunk <= maxChars tagliando ai confini di FRASE (., !, ?,
 * newline), così ogni chunk è pronunciabile in modo naturale e il punto di
 * giunzione cade su una pausa. Se una singola frase supera maxChars, la spezza
 * ulteriormente ai confini di parola. Funzione pura: testabile.
 */
export function splitTextForTts(text: string, maxChars = MAX_TTS_CHARS): string[] {
  const trimmed = (text ?? '').trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  // Spezza in frasi conservando la punteggiatura di chiusura.
  const sentences = trimmed.match(/[^.!?\n]+[.!?\n]*\s*/g) ?? [trimmed];
  const chunks: string[] = [];
  let current = '';
  const pushCurrent = (): void => {
    const c = current.trim();
    if (c.length > 0) chunks.push(c);
    current = '';
  };
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      // Frase troppo lunga: svuota il buffer e spezza per parole.
      pushCurrent();
      let wordBuf = '';
      for (const word of sentence.split(/\s+/)) {
        if ((wordBuf + ' ' + word).trim().length > maxChars) {
          const w = wordBuf.trim();
          if (w.length > 0) chunks.push(w);
          wordBuf = word;
        } else {
          wordBuf = wordBuf ? `${wordBuf} ${word}` : word;
        }
      }
      if (wordBuf.trim().length > 0) current = wordBuf.trim();
      continue;
    }
    if ((current + sentence).length > maxChars) pushCurrent();
    current += sentence;
  }
  pushCurrent();
  return chunks;
}

/**
 * Converte l'output NDJSON degli speech marks di Polly in WordMark[]. Ogni riga
 * è un JSON tipo `{"time":500,"type":"word","start":5,"end":10,"value":"mondo"}`
 * dove `time` è l'offset in ms della parola. `endMs` di ciascuna parola è lo
 * `startMs` della successiva (l'ultima resta senza fine nota: endMs = startMs).
 * Robusto a righe vuote/malformate (ignorate). Funzione pura: testabile.
 */
export function parsePollySpeechMarks(ndjson: string): SpeechWordMark[] {
  const marks: SpeechWordMark[] = [];
  for (const line of ndjson.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: { time?: unknown; type?: unknown; value?: unknown };
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue; // riga non JSON: ignorata
    }
    if (obj.type !== 'word') continue;
    const time = typeof obj.time === 'number' ? obj.time : Number(obj.time);
    const value = typeof obj.value === 'string' ? obj.value : '';
    if (!Number.isFinite(time)) continue;
    // Con SSML, Polly emette anche "word" per i TAG (es. value "<break …/>"):
    // sono pause, non parole da mostrare nel karaoke → scartali.
    if (value.startsWith('<') || value.trim().length === 0) continue;
    marks.push({ word: value, startMs: time, endMs: time });
  }
  // endMs = start della parola successiva (ultima parola: resta uguale a start).
  for (let i = 0; i < marks.length - 1; i++) {
    marks[i]!.endMs = marks[i + 1]!.startMs;
  }
  return marks;
}

/**
 * Spezza un documento SSML (<speak>…</speak>) in chunk <= maxChars, ciascuno
 * un <speak> valido. Taglia ai confini dei tag <break …/> (pause naturali),
 * mai dentro un altro tag. Robusto: se non trova punti di taglio sotto il
 * limite, ritorna l'SSML intero (meglio una chiamata grande che un markup
 * rotto). Funzione pura: testabile.
 */
export function splitSsmlForTts(ssml: string, maxChars = MAX_TTS_CHARS): string[] {
  const trimmed = (ssml ?? '').trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  // Estrae il contenuto interno di <speak>…</speak> (se presente).
  const open = trimmed.match(/^<speak[^>]*>/i);
  const openTag = open ? open[0] : '<speak>';
  const inner = trimmed
    .replace(/^<speak[^>]*>/i, '')
    .replace(/<\/speak>\s*$/i, '')
    .trim();

  // Segmenta ai confini dei <break .../> mantenendo il tag col segmento che lo precede.
  const segments = inner.split(/(?<=<break\b[^>]*\/>)/i).filter((s) => s.trim().length > 0);
  const wrap = (body: string): string => `${openTag}${body}</speak>`;
  const chunks: string[] = [];
  let current = '';
  for (const seg of segments) {
    // +15 circa per i tag <speak></speak> di wrapping.
    if (current && wrap(current + seg).length > maxChars) {
      chunks.push(wrap(current.trim()));
      current = seg;
    } else {
      current += seg;
    }
  }
  if (current.trim().length > 0) chunks.push(wrap(current.trim()));
  return chunks.length > 0 ? chunks : [trimmed];
}
