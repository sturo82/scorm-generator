'use client';

import * as React from 'react';
import { AlertTriangle, Camera, CheckCircle2, Circle, Loader2, RotateCcw, Square, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/** Durata consigliata per addestrare un digital twin e limiti di registrazione. */
const TARGET_SEC = 120;
const MIN_SEC = 20; // il fornitore accetta da 15 s: un margine per il taglio iniziale
const MAX_SEC = 300; // a 2,5 Mbit/s sono circa 95 MB, sotto il limite di caricamento

/** Testo da leggere ad alta voce: frasi varie, con domande ed enfasi, per un parlato naturale. */
const SCRIPT = [
  'Ciao, sono io e oggi voglio raccontarti come lavoriamo ogni giorno.',
  'Quando iniziamo un progetto, la prima cosa che facciamo è ascoltare: capire cosa serve davvero, a chi serve e perché.',
  'Hai mai avuto la sensazione che le informazioni importanti si perdano tra mille email? Succede a tutti, e per questo cerchiamo di essere chiari e concreti.',
  'Spieghiamo le cose passo dopo passo, con esempi semplici, e ci fermiamo ogni volta che serve per verificare che sia tutto comprensibile.',
  'Ci sono tre idee che guidano il nostro lavoro: la sicurezza prima di tutto, il rispetto delle persone e la cura per i dettagli.',
  'A volte le cose non vanno come previsto, ed è normale. Quello che conta è reagire con calma, imparare e migliorare.',
  'Se qualcosa non ti è chiaro, chiedi pure: nessuna domanda è fuori luogo. Meglio un dubbio chiarito oggi che un problema domani.',
  'Grazie per l’attenzione. Ci vediamo nella prossima lezione, e intanto ti auguro una splendida giornata.',
].join(' ');

const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

type Phase = 'starting' | 'ready' | 'recording' | 'review' | 'error';

/**
 * Registrazione dal browser del video di addestramento di un digital twin: anteprima con guida
 * per l'inquadratura, testo da leggere, timer verso i 2 minuti consigliati e revisione prima di
 * usarla. Il file prodotto è identico a un video caricato.
 */
export function VideoRecorder({ onDone, onCancel }: { onDone: (file: File) => void; onCancel: () => void }) {
  const [phase, setPhase] = React.useState<Phase>('starting');
  const [error, setError] = React.useState<string | null>(null);
  const [seconds, setSeconds] = React.useState(0);
  const [devices, setDevices] = React.useState<{ cams: MediaDeviceInfo[]; mics: MediaDeviceInfo[] }>({ cams: [], mics: [] });
  const [camId, setCamId] = React.useState('');
  const [micId, setMicId] = React.useState('');
  const [result, setResult] = React.useState<{ blob: Blob; url: string; mime: string } | null>(null);
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
    return () => {
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

  function start() {
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
      setPhase('review');
    };
    recRef.current = rec;
    rec.start(1000);
    setSeconds(0);
    setPhase('recording');
    const t0 = Date.now();
    timerRef.current = window.setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      setSeconds(s);
      if (s >= MAX_SEC) stop();
    }, 250);
  }

  function stop() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
  }

  function retake() {
    setResult(null);
    void startStream(camId || undefined, micId || undefined);
  }

  function use() {
    if (!result) return;
    const ext = result.mime.includes('mp4') ? 'mp4' : 'webm';
    onDone(new File([result.blob], `registrazione.${ext}`, { type: result.mime }));
  }

  const pct = Math.min(100, Math.round((seconds / TARGET_SEC) * 100));

  return (
    <div className="space-y-4">
      {phase === 'error' && (
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
      )}

      {phase !== 'error' && (
        <div className="grid gap-4 md:grid-cols-[1fr_280px]">
          <div className="space-y-2">
            <div className="relative aspect-video overflow-hidden rounded-xl border bg-black">
              {phase !== 'review' && (
                <>
                  <video ref={liveRef} muted playsInline className="size-full -scale-x-100 object-cover" />
                  {/* Guida: ovale per il volto e linea degli occhi. */}
                  <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
                    <div className="h-[78%] w-[34%] rounded-[50%] border-2 border-dashed border-white/50" />
                  </div>
                  {phase === 'starting' && (
                    <div className="absolute inset-0 grid place-items-center bg-black/60 text-sm text-white">
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="size-4 animate-spin" /> Apro la fotocamera…
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
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {phase === 'recording'
                  ? seconds < MIN_SEC
                    ? `Continua a leggere: servono almeno ${MIN_SEC} secondi, meglio ${fmtTime(TARGET_SEC)}.`
                    : seconds < TARGET_SEC
                      ? `Ottimo, ancora ${fmtTime(TARGET_SEC - seconds)} per un risultato migliore.`
                      : 'Durata ideale raggiunta: puoi fermare la registrazione.'
                  : phase === 'review'
                    ? `Registrazione di ${fmtTime(seconds)}. Riguardala prima di usarla.`
                    : 'Metti il volto nell’ovale, con la luce davanti a te.'}
              </p>
              <div className="flex gap-2">
                {phase === 'ready' && (
                  <Button onClick={start}>
                    <Video className="size-4" /> Inizia a registrare
                  </Button>
                )}
                {phase === 'recording' && (
                  <Button variant={seconds >= MIN_SEC ? 'default' : 'outline'} onClick={stop} disabled={seconds < MIN_SEC}>
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
                {phase !== 'review' && (
                  <Button variant="ghost" onClick={onCancel}>
                    Annulla
                  </Button>
                )}
              </div>
            </div>
          </div>

          <aside className="space-y-3 text-sm">
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Camera className="size-3.5" /> Prima di registrare
              </p>
              <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                <li>Luce naturale o lampada davanti a te, mai alle spalle.</li>
                <li>Sfondo semplice, una sola persona in quadro.</li>
                <li>Guarda l&apos;obiettivo, busto e spalle inquadrati.</li>
                <li>Parla in modo naturale, con le tue espressioni.</li>
                <li>Circa 2 minuti (da 20 secondi a 5 minuti).</li>
              </ul>
            </div>
            <div className="max-h-60 overflow-y-auto rounded-lg border p-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Testo da leggere</p>
              <p className="text-sm leading-relaxed">{SCRIPT}</p>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
