'use client';
import * as React from 'react';
import { ArrowDown, ArrowUp, Download, FileText, Globe, Loader2, Pencil, Play, Trash2, Undo2 } from 'lucide-react';
import type { PodcastEpisodeView, PodcastView } from '@scorm/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { getApiClient } from '@/lib/api/client';
import { EPISODE_STATE, downloadText, errText, fmtDuration } from './podcast-labels';
import { ScriptEditor } from './script-editor';

interface Props {
  podcast: PodcastView;
  episode: PodcastEpisodeView;
  index: number;
  total: number;
  /** Un lavoro è in corso sulla serie: le azioni sono bloccate. */
  busy: boolean;
  /** Mostra le frecce per spostare la puntata (non con filtri o ricerca attivi). */
  reorder?: boolean;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onSaveTitle: (title: string, summary: string) => void;
  onSaveScript: (script: NonNullable<PodcastEpisodeView['script']>) => void;
  onWriteScript: () => void;
  onRecord: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  saving: boolean;
}

/** Una puntata: stato, titolo, copione, ascolto, trascritto e pubblicazione. */
export function EpisodeCard(p: Props) {
  const e = p.episode;
  const toast = useToast();
  const [editing, setEditing] = React.useState(false);
  const [title, setTitle] = React.useState(e.title);
  const [summary, setSummary] = React.useState(e.summary);
  const [scriptOpen, setScriptOpen] = React.useState(false);
  const [editScript, setEditScript] = React.useState(false);
  const [audio, setAudio] = React.useState<{ url: string; downloadUrl: string } | null>(null);
  const [loadingAudio, setLoadingAudio] = React.useState(false);
  const [now, setNow] = React.useState(0);
  const state = EPISODE_STATE[e.state];
  const working = e.state === 'WRITING' || e.state === 'VOICING';
  const names = new Map(p.podcast.hosts.map((h) => [h.key, h.name]));

  // Si riparte dall'audio nuovo quando viene rigenerato.
  React.useEffect(() => setAudio(null), [e.durationSec, e.sizeBytes]);
  React.useEffect(() => {
    setTitle(e.title);
    setSummary(e.summary);
  }, [e.title, e.summary]);

  async function loadAudio() {
    setLoadingAudio(true);
    try {
      setAudio(await getApiClient().getPodcastAudioUrl(p.podcast.id, e.id));
    } catch (err) {
      toast.show(errText(err, 'Audio non disponibile'), 'error');
    } finally {
      setLoadingAudio(false);
    }
  }

  async function downloadMp3() {
    try {
      const a = audio ?? (await getApiClient().getPodcastAudioUrl(p.podcast.id, e.id));
      window.open(a.downloadUrl, '_blank');
    } catch (err) {
      toast.show(errText(err, 'Audio non disponibile'), 'error');
    }
  }

  async function transcript(format: 'txt' | 'srt' | 'vtt') {
    try {
      const t = await getApiClient().getPodcastTranscript(p.podcast.id, e.id, format);
      downloadText(t.filename, t.contentType, t.body);
    } catch (err) {
      toast.show(errText(err, 'Trascritto non disponibile'), 'error');
    }
  }

  const currentTurn = e.turnTimings && !e.audioStale ? e.turnTimings.findIndex((t) => now * 1000 >= t.startMs && now * 1000 < t.endMs + 380) : -1;
  const canWrite = !p.busy && !working;
  const canRecord = !p.busy && !working && Boolean(e.script) && (!e.hasAudio || e.audioStale || e.state === 'FAILED');

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {editing ? (
              <div className="space-y-2">
                <Input aria-label="Titolo della puntata" value={title} maxLength={140} onChange={(ev) => setTitle(ev.target.value)} />
                <Textarea aria-label="Sintesi della puntata" rows={3} maxLength={1000} value={summary} onChange={(ev) => setSummary(ev.target.value)} />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={!title.trim() || p.saving}
                    onClick={() => {
                      p.onSaveTitle(title.trim(), summary.trim());
                      setEditing(false);
                    }}
                  >
                    Salva
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                    Annulla
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <h3 className="font-semibold leading-snug">
                  <span className="mr-1.5 text-muted-foreground">{e.position}.</span>
                  {e.title}
                </h3>
                {e.summary && <p className="mt-1 text-sm text-muted-foreground">{e.summary}</p>}
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {e.published && (
              <Badge variant="success">
                <Globe className="mr-1 size-3" /> Pubblicata
              </Badge>
            )}
            {e.audioStale && <Badge variant="warning">Audio da rifare</Badge>}
            <Badge variant={state.variant}>
              {working && <Loader2 className="mr-1 size-3 animate-spin" />}
              {state.label}
            </Badge>
          </div>
        </div>

        {e.state === 'FAILED' && e.error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{e.error}</p>}

        <p className="text-xs text-muted-foreground">
          {e.targetMinutes} min previsti
          {e.words > 0 ? ` · ${e.words} parole` : ''}
          {e.durationSec ? ` · audio ${fmtDuration(e.durationSec)}` : ''}
          {e.sources.length > 0
            ? ` · fonti usate: ${Array.from(new Set(e.sources.map((s) => s.title))).join(', ')}`
            : e.knowledgeDocIds.length + e.articles.length > 0
              ? ` · ${e.knowledgeDocIds.length + e.articles.length} ${e.knowledgeDocIds.length + e.articles.length === 1 ? 'fonte scelta' : 'fonti scelte'}`
              : ''}
        </p>

        {audio && (
          <div className="space-y-2">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption -- il trascritto è sotto, battuta per battuta */}
            <audio controls autoPlay src={audio.url} className="w-full" onTimeUpdate={(ev) => setNow(ev.currentTarget.currentTime)} />
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {canWrite && (
            <Button
              size="sm"
              variant={e.script ? 'outline' : 'default'}
              onClick={() => {
                // Riscrivere sostituisce il copione attuale e rende da rifare l'audio già registrato.
                if (e.script && !window.confirm('Riscrivere il copione? Sostituisce quello attuale e l\u2019audio andrà rifatto. Il costo è quello di una nuova scrittura.')) return;
                p.onWriteScript();
              }}
            >
              {e.script ? 'Riscrivi il copione' : 'Scrivi il copione'}
            </Button>
          )}
          {canRecord && (
            <Button size="sm" onClick={p.onRecord}>
              {e.hasAudio ? 'Rigenera l\u2019audio' : 'Registra l\u2019audio'}
            </Button>
          )}
          {e.hasAudio && !working && (
            <>
              <Button size="sm" variant="outline" onClick={() => void loadAudio()} disabled={loadingAudio}>
                {loadingAudio ? <Loader2 className="animate-spin" /> : <Play />} Ascolta
              </Button>
              <Button size="sm" variant="outline" onClick={() => void downloadMp3()}>
                <Download /> MP3
              </Button>
            </>
          )}
          {e.script && !working && (
            <Button size="sm" variant="ghost" onClick={() => setScriptOpen((o) => !o)}>
              <FileText /> {scriptOpen ? 'Nascondi il copione' : 'Copione'}
            </Button>
          )}
          {e.script && !working && (
            <>
              <Button size="sm" variant="ghost" onClick={() => void transcript('txt')}>
                Testo
              </Button>
              {e.hasAudio && !e.audioStale && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => void transcript('srt')}>
                    SRT
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void transcript('vtt')}>
                    VTT
                  </Button>
                </>
              )}
            </>
          )}
          {e.published && e.publicOutdated && !e.audioStale && !working && (
            <Button size="sm" disabled={p.busy} title="Il feed ha ancora il vecchio audio: sostituiscilo con quello nuovo, senza ritirare la puntata" onClick={p.onPublish}>
              <Globe /> Aggiorna nel feed
            </Button>
          )}
          {e.hasAudio && !working && !e.published && (
            <Button size="sm" variant="outline" disabled={e.audioStale || p.busy || !p.podcast.publishingEnabled} title={!p.podcast.publishingEnabled ? 'La pubblicazione non è ancora configurata su questo ambiente' : e.audioStale ? 'Rigenera prima l\u2019audio' : undefined} onClick={p.onPublish}>
              <Globe /> Pubblica
            </Button>
          )}
          {e.published && !working && (
            <Button size="sm" variant="outline" disabled={p.busy} title="Toglie la puntata dal feed: gli ascoltatori non la vedranno più" onClick={p.onUnpublish}>
              <Undo2 /> Ritira
            </Button>
          )}
          <span className="ml-auto flex gap-1">
            <Button size="icon" variant="ghost" aria-label="Modifica titolo e sintesi" disabled={p.busy || working} onClick={() => setEditing(true)}>
              <Pencil />
            </Button>
            {p.reorder !== false && (
              <>
            <Button size="icon" variant="ghost" aria-label="Sposta su" disabled={p.busy || p.index === 0} onClick={() => p.onMove(-1)}>
              <ArrowUp />
            </Button>
            <Button size="icon" variant="ghost" aria-label="Sposta giù" disabled={p.busy || p.index === p.total - 1} onClick={() => p.onMove(1)}>
              <ArrowDown />
            </Button>
              </>
            )}
            <Button size="icon" variant="ghost" aria-label="Togli la puntata" disabled={p.busy || working || p.total <= 1} onClick={p.onRemove}>
              <Trash2 />
            </Button>
          </span>
        </div>

        {scriptOpen && e.script && (
          <div className="border-t pt-3">
            {editScript ? (
              <ScriptEditor
                script={e.script}
                hosts={p.podcast.hosts}
                minutes={e.targetMinutes}
                saving={p.saving}
                onCancel={() => setEditScript(false)}
                onSave={(s) => {
                  p.onSaveScript(s);
                  setEditScript(false);
                }}
              />
            ) : (
              <div className="space-y-2">
                <ol className="space-y-1.5 text-sm">
                  {e.script.turns.map((t, i) => (
                    <li key={i} className={i === currentTurn ? 'rounded-md bg-primary/10 px-2 py-1' : 'px-2 py-1'}>
                      <span className="font-medium">{names.get(t.host) ?? t.host}:</span> {t.text}
                    </li>
                  ))}
                </ol>
                <Button size="sm" variant="outline" disabled={p.busy || working} onClick={() => setEditScript(true)}>
                  <Pencil /> Modifica il copione
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
