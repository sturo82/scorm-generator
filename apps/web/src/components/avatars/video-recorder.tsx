'use client';

import * as React from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Square,
  Video,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/** Durata consigliata per addestrare un digital twin e limiti di registrazione. */
const TARGET_SEC = 120;
const MIN_SEC = 20; // il servizio accetta da 15 s: un margine per il taglio iniziale
const MAX_SEC = 300; // a 2,5 Mbit/s sono circa 95 MB, sotto il limite di caricamento
const COUNTDOWN_SEC = 3;

/**
 * Testo da leggere (circa 2 minuti a ritmo naturale): frasi varie, con domande, elenchi ed enfasi,
 * così il gemello digitale impara espressioni e intonazioni diverse.
 */
const DEFAULT_SCRIPT = [
  'Ciao, e benvenuto. Oggi ti racconto come lavoriamo ogni giorno e cosa ci sta più a cuore.',
  'Quando iniziamo un progetto, la prima cosa che facciamo è ascoltare: capire che cosa serve davvero, a chi serve e perché.',
  'Hai mai avuto la sensazione che le informazioni importanti si perdano tra mille email e riunioni? Succede a tutti. Per questo cerchiamo di essere chiari, concreti e puntuali.',
  'Spieghiamo le cose passo dopo passo, con esempi semplici, e ci fermiamo ogni volta che serve per verificare che sia tutto comprensibile.',
  'Ci sono tre idee che guidano il nostro lavoro. La prima: la sicurezza viene prima di tutto. La seconda: il rispetto per le persone, sempre. La terza: la cura per i dettagli, anche quelli che sembrano piccoli.',
  'A volte le cose non vanno come previsto, ed è normale. Quello che conta è reagire con calma, capire che cosa è successo, imparare e migliorare.',
  'Lavorare in squadra significa fidarsi gli uni degli altri, dare una mano quando serve e saper chiedere aiuto senza paura.',
  'Se qualcosa non ti è chiaro, chiedi pure: nessuna domanda è fuori luogo. Meglio un dubbio chiarito oggi che un problema domani.',
  'Nelle prossime lezioni vedremo insieme esempi pratici, casi reali e qualche consiglio utile da mettere in pratica fin da subito.',
  'Grazie per l’attenzione. Ci vediamo alla prossima lezione e, intanto, ti auguro una splendida giornata.',
].join('\n\n');

const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

type Phase = 'starting' | 'ready' | 'countdown' | 'recording' | 'review' | 'error';

/**
 * Gobbo: il testo scorre da solo in alto, vicino alla webcam, a caratteri grandi, così chi
 * registra legge guardando in camera. La riga da leggere resta all'altezza del segno; velocità e
 * dimensione si regolano, lo scorrimento si mette in pausa (barra spaziatrice) e si sposta con la
 * rotella del mouse.
 */
function Teleprompter({
  text,
  running,
  wpm,
  fontPx,
  resetKey,
  tall,
}: {
  text: string;
  running: boolean;
  wpm: number;
  fontPx: number;
  resetKey: number;
  tall: boolean;
}) {
  const boxRef = React.useRef<HTMLDivElement>(null);
  const innerRef = React.useRef<HTMLDivElement>(null);
  const offset = React.useRef(0);
  const [atEnd, setAtEnd] = React.useState(false);

  const apply = React.useCallback(() => {
    const box = boxRef.current;
    const inner = innerRef.current;
    if (!box || !inner) return;
    const max = Math.max(0, inner.scrollHeight - box.clientHeight * 0.35);
    offset.current = Math.min(Math.max(0, offset.current), max);
    inner.style.transform = `translateY(${-offset.current}px)`;
    setAtEnd(max > 0 && offset.current >= max - 1);
  }, []);

  React.useEffect(() => {
    offset.current = 0;
    apply();
  }, [resetKey, text, apply]);

  React.useEffect(() => {
    apply();
  }, [fontPx, apply]);

  // Scorrimento: la velocità in parole al minuto si traduce in pixel al secondo sull'altezza del testo.
  React.useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const inner = innerRef.current;
      const dt = (now - last) / 1000;
      last = now;
      if (inner) {
        const durationSec = (words(text) / wpm) * 60;
        const pxPerSec = durationSec > 0 ? inner.scrollHeight / durationSec : 0;
        offset.current += pxPerSec * dt;
        apply();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, wpm, text, apply]);

  return (
    <div
      ref={boxRef}
      onWheel={(e) => {
        offset.current += e.deltaY;
        apply();
      }}
      className={cn('relative overflow-hidden rounded-xl bg-neutral-950 text-white', tall ? 'h-[42vh]' : 'h-56 sm:h-64')}
      aria-label="Testo da leggere"
    >
      {/* Segno della riga da leggere e sfumature: l'occhio resta sempre allo stesso punto, vicino alla camera. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-[26%] z-10 flex items-center">
        <span className="h-0 w-0 border-y-[10px] border-l-[14px] border-y-transparent border-l-primary" />
        <span className="h-px flex-1 bg-primary/30" />
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[22%] bg-gradient-to-b from-neutral-950 to-transparent" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-1/3 bg-gradient-to-t from-neutral-950 to-transparent" />
      <div ref={innerRef} className="px-8 pb-[60%] pt-[22%] will-change-transform sm:px-14" style={{ fontSize: fontPx, lineHeight: 1.45 }}>
        {text.split(/\n{2,}/).map((p, i) => (
          <p key={i} className="mb-[0.9em] text-center font-semibold tracking-wide">
            {p}
          </p>
        ))}
      </div>
      {atEnd && (
        <p className="absolute inset-x-0 bottom-3 z-20 text-center text-sm text-white/70">
          Fine del testo: continua a parlare con parole tue oppure ferma la registrazione.
        </p>
      )}
    </div>
  );
}

/**
 * Registrazione dal browser del video di addestramento di un digital twin, con gobbo: testo
 * grande che scorre in alto vicino alla webcam, conto alla rovescia, timer verso i 2 minuti
 * consigliati e revisione prima di usarla. Il file prodotto è identico a un video caricato.
 */
export function VideoRecorder({ onDone, onCancel }: { onDone: (file: File) => void; onCancel: () => void }) {
  const [phase, setPhase] = React.useState<Phase>('starting');
  const [error, setError] = React.useState<string | null>(null);
  const [seconds, setSeconds] = React.useState(0);
  const [count, setCount] = React.useState(COUNTDOWN_SEC);
  const [devices, setDevices] = React.useState<{ cams: MediaDeviceInfo[]; mics: MediaDeviceInfo[] }>({ cams: [], mics: [] });
  const [camId, setCamId] = React.useState('');
  const [micId, setMicId] = React.useState('');
  const [result, setResult] = React.useState<{ blob: Blob; url: string; mime: string } | null>(null);
  // Gobbo.
  const [text, setText] = React.useState(DEFAULT_SCRIPT);
  const [editing, setEditing] = React.useState(false);
  const [wpm, setWpm] = React.useState(130);
  const [fontPx, setFontPx] = React.useState(34);
  const [scrolling, setScrolling] = React.useState(false);
  const [resetKey, setResetKey] = React.useState(0);
  const [full, setFull] = React.useState(false);

  const rootRef = React.useRef<HTMLDivElement>(null);
  const liveRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const recRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const timerRef = React.useRef<number | null>(null);

  const stopStream = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startStream = React.useCallback(
    async (cam?: string, mic?: string) => {
      stopStream();
      setPhase('starting');
      setError(null);
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
        setError('Questo browser non permette di registrare dal sito: carica un video, oppure usa un browser aggiornato (Chrome, Edge, Safari).');
        setPhase('error');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { ...(cam ? { deviceId: { exact: cam } } : { facingMode: 'user' }), width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: { ...(mic ? { deviceId: { exact: mic } } : {}), echoCancellation: true, noiseSuppression: true },
        });
        streamRef.current = stream;
        if (liveRef.current) {
          liveRef.current.srcObject = stream;
          void liveRef.current.play().catch(() => undefined);
        }
        // Dopo il permesso i nomi dei dispositivi sono leggibili.
        const all = await navigator.mediaDevices.enumerateDevices();
        setDevices({ cams: all.filter((d) => d.kind === 'videoinput'), mics: all.filter((d) => d.kind === 'audioinput') });
        setCamId(stream.getVideoTracks()[0]?.getSettings().deviceId ?? '');
        setMicId(stream.getAudioTracks()[0]?.getSettings().deviceId ?? '');
        setPhase('ready');
      } catch (err) {
        const name = err instanceof DOMException ? err.name : '';
        setError(
          name === 'NotAllowedError'
            ? 'Hai negato l’accesso a fotocamera o microfono. Consentilo dalle impostazioni del sito nel browser e riprova.'
            : name === 'NotFoundError'
              ? 'Non trovo una fotocamera o un microfono collegati.'
              : name === 'NotReadableError'
                ? 'Fotocamera o microfono sono usati da un’altra applicazione: chiudila e riprova.'
                : 'Non riesco ad aprire fotocamera e microfono.',
        );
        setPhase('error');
      }
    },
    [stopStream],
  );

  React.useEffect(() => {
    void startStream();
    const onFs = () => setFull(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    return () => {
      if (result) URL.revokeObjectURL(result.url);
    };
  }, [result]);

  // Barra spaziatrice: pausa e ripresa dello scorrimento (fuori dai campi di testo).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.code !== 'Space' || tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || tag === 'BUTTON') return;
      if (phase !== 'recording' && phase !== 'ready') return;
      e.preventDefault();
      setScrolling((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  function beginRecording() {
    const stream = streamRef.current;
    if (!stream) return;
    const mime = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
    const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 2_500_000 });
    chunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const type = (rec.mimeType || mime || 'video/webm').split(';')[0]!;
      const blob = new Blob(chunksRef.current, { type });
      setResult({ blob, url: URL.createObjectURL(blob), mime: type });
      setScrolling(false);
      setPhase('review');
    };
    recRef.current = rec;
    rec.start(1000);
    setSeconds(0);
    setPhase('recording');
    setScrolling(true);
    const t0 = Date.now();
    timerRef.current = window.setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      setSeconds(s);
      if (s >= MAX_SEC) stop();
    }, 250);
  }

  /** Conto alla rovescia: il testo torna all'inizio e si parte quando si è pronti. */
  function start() {
    setEditing(false);
    setScrolling(false);
    setResetKey((k) => k + 1);
    setCount(COUNTDOWN_SEC);
    setPhase('countdown');
    let n = COUNTDOWN_SEC;
    const t = window.setInterval(() => {
      n -= 1;
      setCount(n);
      if (n <= 0) {
        window.clearInterval(t);
        beginRecording();
      }
    }, 1000);
  }

  function stop() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
  }

  function retake() {
    setResult(null);
    setResetKey((k) => k + 1);
    void startStream(camId || undefined, micId || undefined);
  }

  function use() {
    if (!result) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    const ext = result.mime.includes('mp4') ? 'mp4' : 'webm';
    onDone(new File([result.blob], `registrazione.${ext}`, { type: result.mime }));
  }

  function toggleFull() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void rootRef.current?.requestFullscreen?.().catch(() => undefined);
  }

  const pct = Math.min(100, Math.round((seconds / TARGET_SEC) * 100));
  const readSec = Math.round((words(text) / wpm) * 60);

  if (phase === 'error') {
    return (
      <div className="space-y-3 rounded-lg border border-amber-300/60 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
        </p>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void startStream()}>
            Riprova
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Chiudi
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className={cn('space-y-3', full && 'flex h-screen flex-col overflow-y-auto bg-background p-6')}>
      {/* 1. Gobbo, in alto: è la parte di schermo più vicina alla webcam. */}
      {phase !== 'review' &&
        (editing ? (
          <div className="space-y-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={9}
              className="w-full rounded-xl border bg-background p-4 text-base leading-relaxed"
              aria-label="Testo da leggere"
            />
            <div className="flex justify-between gap-2">
              <Button size="sm" variant="ghost" onClick={() => setText(DEFAULT_SCRIPT)}>
                Ripristina il testo consigliato
              </Button>
              <Button size="sm" onClick={() => setEditing(false)}>
                Fatto
              </Button>
            </div>
          </div>
        ) : (
          <Teleprompter text={text} running={scrolling} wpm={wpm} fontPx={fontPx} resetKey={resetKey} tall={full} />
        ))}

      {/* Comandi del gobbo */}
      {phase !== 'review' && !editing && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Button size="sm" variant="outline" onClick={() => setScrolling((v) => !v)} disabled={phase === 'countdown' || phase === 'starting'}>
            {scrolling ? <Pause className="size-4" /> : <Play className="size-4" />} {scrolling ? 'Pausa testo' : phase === 'recording' ? 'Riprendi testo' : 'Prova lo scorrimento'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setResetKey((k) => k + 1)} title="Torna all’inizio del testo">
            <RotateCcw className="size-4" /> Dall&apos;inizio
          </Button>
          <label className="flex items-center gap-2 rounded-md border px-2 py-1">
            <span className="text-muted-foreground">Velocità</span>
            <input type="range" min={90} max={190} step={5} value={wpm} onChange={(e) => setWpm(Number(e.target.value))} aria-label="Velocità del testo" />
            <span className="w-24 tabular-nums text-muted-foreground">{wpm} parole/min</span>
          </label>
          <div className="flex items-center gap-1 rounded-md border px-1 py-0.5">
            <Button size="icon" variant="ghost" className="size-7" onClick={() => setFontPx((f) => Math.max(22, f - 4))} aria-label="Testo più piccolo">
              <Minus className="size-3.5" />
            </Button>
            <span className="w-10 text-center tabular-nums text-muted-foreground">{fontPx}px</span>
            <Button size="icon" variant="ghost" className="size-7" onClick={() => setFontPx((f) => Math.min(64, f + 4))} aria-label="Testo più grande">
              <Plus className="size-3.5" />
            </Button>
          </div>
          {phase !== 'recording' && phase !== 'countdown' && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              <Pencil className="size-4" /> Usa un tuo testo
            </Button>
          )}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={toggleFull}>
            {full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />} {full ? 'Esci da schermo intero' : 'Schermo intero'}
          </Button>
        </div>
      )}

      {/* 2. Anteprima della camera (o della registrazione), sotto il testo. */}
      <div className={cn('grid gap-3', full ? 'flex-1 md:grid-cols-[1fr_220px]' : 'md:grid-cols-[1fr_220px]')}>
        <div className="relative mx-auto aspect-video w-full max-w-2xl overflow-hidden rounded-xl border bg-black">
          {phase !== 'review' && (
            <>
              <video ref={liveRef} muted playsInline className="size-full -scale-x-100 object-cover" />
              <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="h-[78%] w-[34%] rounded-[50%] border-2 border-dashed border-white/40" />
              </div>
              {phase === 'starting' && (
                <div className="absolute inset-0 grid place-items-center bg-black/60 text-sm text-white">
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" /> Apro la fotocamera…
                  </span>
                </div>
              )}
              {phase === 'countdown' && (
                <div className="absolute inset-0 grid place-items-center bg-black/50">
                  <span key={count} className="text-7xl font-bold text-white motion-safe:animate-pop-in">
                    {count}
                  </span>
                </div>
              )}
              {phase === 'recording' && (
                <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-red-600 px-2.5 py-1 text-xs font-medium text-white">
                  <Circle className="size-2.5 fill-white motion-safe:animate-pulse" /> REC {fmtTime(seconds)}
                </span>
              )}
            </>
          )}
          {phase === 'review' && result && (
            // eslint-disable-next-line jsx-a11y/media-has-caption -- anteprima della registrazione
            <video src={result.url} controls playsInline className="size-full object-contain" />
          )}
        </div>

        <aside className="space-y-2 text-xs text-muted-foreground">
          <p className="font-semibold uppercase tracking-wide">Prima di registrare</p>
          <ul className="list-disc space-y-1 pl-4">
            <li>Luce davanti a te, mai alle spalle.</li>
            <li>Sfondo semplice, solo tu in quadro.</li>
            <li>Leggi il testo vicino alla freccia: così guardi in camera.</li>
            <li>Parla con naturalezza, con le tue espressioni.</li>
            <li>Barra spaziatrice: pausa del testo.</li>
          </ul>
          <p>
            Il testo dura circa {fmtTime(readSec)} a questa velocità; ne servono {fmtTime(TARGET_SEC)}.
          </p>
        </aside>
      </div>

      {phase === 'recording' && (
        <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className={cn('h-full rounded-full transition-all', pct >= 100 ? 'bg-emerald-500' : 'bg-primary')} style={{ width: `${pct}%` }} />
        </div>
      )}

      {(phase === 'ready' || phase === 'starting') && devices.cams.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Fotocamera</span>
            <select
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={camId}
              onChange={(e) => {
                setCamId(e.target.value);
                void startStream(e.target.value, micId || undefined);
              }}
            >
              {devices.cams.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Fotocamera ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Microfono</span>
            <select
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={micId}
              onChange={(e) => {
                setMicId(e.target.value);
                void startStream(camId || undefined, e.target.value);
              }}
            >
              {devices.mics.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Microfono ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {phase === 'recording'
            ? seconds < MIN_SEC
              ? `Continua a leggere: servono almeno ${MIN_SEC} secondi, meglio ${fmtTime(TARGET_SEC)}.`
              : seconds < TARGET_SEC
                ? `Ottimo, ancora ${fmtTime(TARGET_SEC - seconds)} per un risultato migliore.`
                : 'Durata ideale raggiunta: puoi fermare la registrazione.'
            : phase === 'countdown'
              ? 'Guarda in camera: si parte…'
              : phase === 'review'
                ? `Registrazione di ${fmtTime(seconds)}. Riguardala prima di usarla.`
                : 'Metti il volto nell’ovale e premi «Inizia»: il testo scorre da solo.'}
        </p>
        <div className="flex gap-2">
          {phase === 'ready' && (
            <Button size="lg" onClick={start}>
              <Video className="size-4" /> Inizia a registrare
            </Button>
          )}
          {phase === 'recording' && (
            <Button size="lg" variant={seconds >= MIN_SEC ? 'default' : 'outline'} onClick={stop} disabled={seconds < MIN_SEC}>
              <Square className="size-4" /> Ferma
            </Button>
          )}
          {phase === 'review' && (
            <>
              <Button variant="outline" onClick={retake}>
                <RotateCcw className="size-4" /> Registra di nuovo
              </Button>
              <Button onClick={use}>
                <CheckCircle2 className="size-4" /> Usa questa registrazione
              </Button>
            </>
          )}
          {phase !== 'review' && phase !== 'recording' && (
            <Button variant="ghost" onClick={onCancel}>
              Annulla
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
