'use client';
import * as React from 'react';
import {
  BadgeCheck,
  Check,
  ClipboardCopy,
  ExternalLink,
  Film,
  Image as ImageIcon,
  Info,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  X,
} from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label, Textarea } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { CreditCost } from '@/components/ui/credit-cost';
import { Skeleton } from '@/components/ui/skeleton';
import { heygenAvatarCreationCustomerPriceUsd, HEYGEN_CREATABLE_AVATAR_TYPES } from '@scorm/contracts';
import {
  useAvatarGroups,
  useCreateDigitalTwin,
  useCreatePhotoAvatar,
  useCreatePromptAvatar,
  useDeleteAvatar,
  useRefreshMyAvatars,
  useRequestAvatarConsent,
  useWallet,
} from '@/lib/api/hooks';
import type { AvatarConsentRequest, AvatarGroupView } from '@/lib/api/types';
import { cn } from '@/lib/cn';

const AVATAR_CREATION_PRICE_LABEL = `$${heygenAvatarCreationCustomerPriceUsd('photo').toFixed(2)}`;
const TWIN_CREATION_PRICE_LABEL = `$${heygenAvatarCreationCustomerPriceUsd('digital_twin').toFixed(2)}`;

type CreateMode = 'photo' | 'prompt' | 'digital_twin';
type Filter = 'all' | 'digital_twin' | 'photo' | 'prompt';

const KIND_LABEL: Record<AvatarGroupView['kind'], string> = {
  digital_twin: 'Digital twin',
  photo: 'Da foto',
  prompt: 'Da descrizione',
  unknown: 'Avatar',
};
const MAX_VIDEO_MB = 150;

/** Stato leggibile di un avatar: etichetta, colore e se è utilizzabile nei video. */
function statusInfo(g: AvatarGroupView): { label: string; tone: 'ok' | 'wait' | 'bad'; usable: boolean } {
  if (g.status === 'failed') return { label: g.consentStatus === 'rejected' ? 'Consenso rifiutato' : 'Non riuscito', tone: 'bad', usable: false };
  if (g.status === 'pending_consent') return { label: 'In attesa del consenso', tone: 'wait', usable: false };
  if (g.status === 'processing') return { label: 'In addestramento', tone: 'wait', usable: false };
  if (g.kind === 'digital_twin' && g.consentStatus !== 'accepted') return { label: 'Consenso da verificare', tone: 'wait', usable: false };
  return { label: 'Pronto', tone: 'ok', usable: true };
}

const TONE: Record<'ok' | 'wait' | 'bad', string> = {
  ok: 'bg-emerald-600/90 text-white',
  wait: 'bg-amber-500/95 text-amber-950',
  bad: 'bg-red-600/90 text-white',
};

/**
 * Impostazioni → Avatar: gestione degli avatar HeyGen del tenant. Elenca i personaggi dell'account
 * (con ricerca e filtri), permette di crearne di nuovi (da foto, da video come digital twin, da
 * descrizione) e mostra lo stato di addestramento e di consenso. Un digital twin si può usare nei
 * video solo dopo il consenso della persona ritratta, che qui si avvia e si controlla.
 */
export default function AvatarsSettingsPage() {
  const toast = useToast();
  const groups = useAvatarGroups();
  const refreshAvatars = useRefreshMyAvatars();
  const createPhoto = useCreatePhotoAvatar();
  const createTwin = useCreateDigitalTwin();
  const createPrompt = useCreatePromptAvatar();
  const requestConsent = useRequestAvatarConsent();
  const billed = useWallet().data?.enabled === true;
  const del = useDeleteAvatar();

  const [mode, setMode] = React.useState<CreateMode>('photo');
  const [name, setName] = React.useState('');
  const [prompt, setPrompt] = React.useState('');
  const [file, setFile] = React.useState<File | null>(null);
  const [filePreview, setFilePreview] = React.useState<string | null>(null);
  const [consent, setConsent] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);

  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState<Filter>('all');
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [toDelete, setToDelete] = React.useState<AvatarGroupView | null>(null);
  const [consentLink, setConsentLink] = React.useState<(AvatarConsentRequest & { groupId: string }) | null>(null);

  const all = React.useMemo(() => groups.data ?? [], [groups.data]);
  const creating = createPhoto.isPending || createPrompt.isPending || createTwin.isPending;
  const open = all.find((g) => g.groupId === openId) ?? null;

  // Ritorno dalla pagina del consenso: si rilegge subito lo stato.
  React.useEffect(() => {
    if (new URLSearchParams(window.location.search).get('consent') === 'done') {
      toast.show('Consenso inviato: lo stato si aggiorna a breve', 'success');
      void groups.refetch();
      window.history.replaceState(null, '', window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((g) => (filter === 'all' || g.kind === filter) && (!q || g.name.toLowerCase().includes(q)));
  }, [all, query, filter]);
  const counts = React.useMemo(
    () => ({
      all: all.length,
      digital_twin: all.filter((g) => g.kind === 'digital_twin').length,
      photo: all.filter((g) => g.kind === 'photo').length,
      prompt: all.filter((g) => g.kind === 'prompt').length,
    }),
    [all],
  );

  function onPickFile(f: File | undefined) {
    if (!f) return;
    if (mode === 'digital_twin') {
      if (!['video/mp4', 'video/webm', 'video/quicktime'].includes(f.type)) {
        toast.show('Usa un video MP4, WebM o MOV', 'error');
        return;
      }
      if (f.size > MAX_VIDEO_MB * 1024 * 1024) {
        toast.show(`Video troppo grande (max ${MAX_VIDEO_MB} MB): bastano circa 2 minuti`, 'error');
        return;
      }
      setFile(f);
      setFilePreview(null);
      return;
    }
    if (!['image/jpeg', 'image/jpg', 'image/png'].includes(f.type)) {
      toast.show('Usa un file JPG o PNG', 'error');
      return;
    }
    setFile(f);
    setFilePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(f);
    });
  }

  React.useEffect(() => {
    return () => {
      if (filePreview) URL.revokeObjectURL(filePreview);
    };
  }, [filePreview]);

  function switchMode(next: CreateMode) {
    setMode(next);
    setFile(null);
    setFilePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    if (fileInput.current) fileInput.current.value = '';
  }

  const nameValid = name.trim().length > 0 && name.trim().length <= 120;
  const needsConsent = mode !== 'prompt';
  const canCreate = nameValid && !creating && (mode === 'prompt' ? prompt.trim().length > 0 : !!file) && (!needsConsent || consent);

  function resetForm() {
    setName('');
    setPrompt('');
    setFile(null);
    setConsent(false);
    setFilePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    if (fileInput.current) fileInput.current.value = '';
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate) return;
    try {
      const res =
        mode === 'photo'
          ? await createPhoto.mutateAsync({ name: name.trim(), file: file!, consentConfirmed: consent })
          : mode === 'digital_twin'
            ? await createTwin.mutateAsync({ name: name.trim(), file: file!, consentConfirmed: consent })
            : await createPrompt.mutateAsync({ name: name.trim(), prompt: prompt.trim() });
      toast.show(mode === 'digital_twin' ? `Digital twin "${res.name}" in addestramento` : `Avatar "${res.name}" in creazione`, 'success');
      resetForm();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      toast.show(msg.replace(/^API \d+:\s*/, '') || 'Creazione avatar non riuscita', 'error');
    }
  }

  async function handleDelete() {
    if (!toDelete) return;
    try {
      await del.mutateAsync(toDelete.groupId);
      toast.show('Avatar eliminato', 'success');
      setToDelete(null);
      setOpenId(null);
    } catch {
      toast.show('Eliminazione non riuscita', 'error');
    }
  }

  async function handleConsent(g: AvatarGroupView) {
    try {
      const res = await requestConsent.mutateAsync(g.groupId);
      setConsentLink({ ...res, groupId: g.groupId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      toast.show(msg.replace(/^API \d+:\s*/, '') || 'Richiesta di consenso non riuscita', 'error');
    }
  }

  const priceNote = (feature: 'avatar_creation_photo' | 'avatar_creation_twin', usd: string) =>
    billed ? <CreditCost prefix="" items={[{ feature }]} /> : usd;

  return (
    <>
      <PageHeader
        title="Avatar"
        description="Crea e gestisci i tuoi avatar parlanti, controlla l'addestramento e il consenso dei digital twin."
      />

      <div className="mb-6 flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <p className="text-muted-foreground">
          La creazione di un avatar ha un costo una tantum: da foto o descrizione{' '}
          <span className="font-medium text-foreground">{priceNote('avatar_creation_photo', AVATAR_CREATION_PRICE_LABEL)}</span>, digital
          twin da video <span className="font-medium text-foreground">{priceNote('avatar_creation_twin', TWIN_CREATION_PRICE_LABEL)}</span>. Gli
          avatar sono riutilizzabili in tutti i corsi del team.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* Elenco avatar */}
        <Card>
          <CardHeader className="space-y-3">
            <div className="flex flex-row items-center justify-between gap-3">
              <CardTitle>I tuoi avatar {all.length > 0 && <span className="ml-1 text-sm font-normal text-muted-foreground">({all.length})</span>}</CardTitle>
              <Button
                variant="outline"
                size="sm"
                disabled={refreshAvatars.isPending}
                onClick={async () => {
                  try {
                    await refreshAvatars.mutateAsync(undefined);
                    toast.show('Elenco avatar aggiornato', 'success');
                  } catch {
                    toast.show('Aggiornamento non riuscito', 'error');
                  }
                }}
              >
                <RefreshCw className={cn('size-4', refreshAvatars.isPending && 'animate-spin')} /> Aggiorna
              </Button>
            </div>
            {all.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[200px] flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Cerca un avatar per nome…"
                    aria-label="Cerca un avatar"
                    className="h-9 pl-8 pr-8"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => setQuery('')}
                      aria-label="Cancella la ricerca"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1" role="group" aria-label="Filtra per tipo">
                  {(
                    [
                      ['all', 'Tutti'],
                      ['digital_twin', 'Digital twin'],
                      ['photo', 'Da foto'],
                      ['prompt', 'Da descrizione'],
                    ] as const
                  )
                    .filter(([f]) => f === 'all' || counts[f] > 0)
                    .map(([f, label]) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setFilter(f)}
                        aria-pressed={filter === f}
                        className={cn(
                          'rounded-full border px-2.5 py-1 text-xs transition-colors',
                          filter === f ? 'border-primary bg-primary/10 font-medium text-primary' : 'hover:bg-accent/60',
                        )}
                      >
                        {label} <span className="text-muted-foreground">{counts[f]}</span>
                      </button>
                    ))}
                </div>
              </div>
            )}
          </CardHeader>
          <CardContent>
            {groups.isLoading ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="aspect-[4/5] w-full" />
                ))}
              </div>
            ) : groups.isError ? (
              <p className="text-sm text-destructive">Impossibile caricare gli avatar. Verifica che la generazione video sia configurata (HeyGen).</p>
            ) : all.length === 0 ? (
              <div className="rounded-xl border border-dashed p-10 text-center">
                <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
                  <UserRound className="size-6" aria-hidden />
                </div>
                <p className="font-medium">Nessun avatar ancora</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                  Parti da una foto, da un breve video (digital twin) o da una descrizione: con il pannello a destra ci vogliono pochi minuti.
                </p>
              </div>
            ) : shown.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                Nessun avatar corrisponde alla ricerca.{' '}
                <button
                  type="button"
                  className="text-primary underline"
                  onClick={() => {
                    setQuery('');
                    setFilter('all');
                  }}
                >
                  Mostra tutti
                </button>
              </div>
            ) : (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-3">
                {shown.map((g) => {
                  const st = statusInfo(g);
                  return (
                    <li key={g.groupId}>
                      <button
                        type="button"
                        onClick={() => setOpenId(g.groupId)}
                        className="group block w-full overflow-hidden rounded-lg border bg-card text-left transition-shadow hover:shadow-elevate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`${g.name}: ${st.label}`}
                      >
                        <div className="relative aspect-[4/5] bg-muted">
                          {g.previewUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={g.previewUrl} alt="" loading="lazy" className="h-full w-full object-cover object-top" />
                          ) : (
                            <div className="grid h-full place-items-center">
                              <ImageIcon className="size-6 text-muted-foreground" aria-hidden />
                            </div>
                          )}
                          {(!st.usable || g.kind === 'digital_twin') && (
                            <span className={cn('absolute inset-x-0 bottom-0 truncate px-1.5 py-0.5 text-center text-[10px] font-medium', TONE[st.tone])}>
                              {st.label}
                            </span>
                          )}
                          {g.kind === 'digital_twin' && (
                            <span className="absolute left-1 top-1 grid size-5 place-items-center rounded-full bg-black/60 text-white" title="Digital twin">
                              <Film className="size-3" aria-hidden />
                            </span>
                          )}
                        </div>
                        <div className="px-2 py-1.5">
                          <p className="truncate text-xs font-medium" title={g.name}>
                            {g.name}
                          </p>
                          <p className="truncate text-[10px] text-muted-foreground">{KIND_LABEL[g.kind]}</p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Creazione nuovo avatar */}
        <Card className="h-max">
          <CardHeader>
            <CardTitle>Crea un avatar</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 space-y-2" role="radiogroup" aria-label="Tipo di avatar da creare">
              <span className="text-sm font-medium">Che tipo di avatar vuoi creare?</span>
              {HEYGEN_CREATABLE_AVATAR_TYPES.map((t) => {
                const selected = mode === t.type;
                return (
                  <button
                    key={t.type}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => switchMode(t.type)}
                    className={cn(
                      'flex w-full flex-col gap-0.5 rounded-lg border p-3 text-left transition-colors',
                      selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-input hover:bg-accent/50',
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      {t.label}
                      <span className="text-xs font-normal text-muted-foreground">· {t.tagline}</span>
                    </span>
                    <span className="text-xs leading-snug text-muted-foreground">{t.description}</span>
                  </button>
                );
              })}
            </div>

            <form className="space-y-4" onSubmit={handleCreate}>
              <div className="space-y-1.5">
                <Label htmlFor="av-name">Nome</Label>
                <Input id="av-name" value={name} maxLength={120} placeholder="Es. Relatore corso sicurezza" onChange={(e) => setName(e.target.value)} />
              </div>

              {mode === 'prompt' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="av-prompt">Descrizione</Label>
                  <Textarea
                    id="av-prompt"
                    value={prompt}
                    maxLength={2000}
                    rows={4}
                    placeholder="Descrivi l'aspetto del personaggio: età, genere, abbigliamento, stile…"
                    onChange={(e) => setPrompt(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">L&apos;avatar viene generato dall&apos;IA a partire dalla descrizione: non ritrae una persona reale.</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label>{mode === 'digital_twin' ? 'Video di addestramento' : 'Foto (volto frontale)'}</Label>
                  <div className="flex items-center gap-3">
                    <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted">
                      {filePreview ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={filePreview} alt="" className="h-full w-full object-cover" />
                      ) : file && mode === 'digital_twin' ? (
                        <Film className="size-5 text-primary" aria-hidden />
                      ) : (
                        <ImageIcon className="size-5 text-muted-foreground" aria-hidden />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                        <Upload className="size-4" /> {mode === 'digital_twin' ? 'Scegli video' : 'Scegli foto'}
                      </Button>
                      {file && (
                        <p className="mt-1 truncate text-xs text-muted-foreground" title={file.name}>
                          {file.name} · {(file.size / (1024 * 1024)).toFixed(1)} MB
                        </p>
                      )}
                    </div>
                    <input
                      key={mode}
                      ref={fileInput}
                      type="file"
                      accept={mode === 'digital_twin' ? 'video/mp4,video/webm,video/quicktime' : 'image/png,image/jpeg'}
                      className="hidden"
                      onChange={(e) => onPickFile(e.target.files?.[0])}
                    />
                  </div>
                  {mode === 'digital_twin' ? (
                    <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                      <li>Circa 2 minuti (da 15 secondi a 10 minuti), risoluzione almeno 640 px.</li>
                      <li>Una sola persona, in primo piano, che parla in camera, con il volto sempre in quadro.</li>
                      <li>Audio chiaro. MP4, WebM o MOV, max {MAX_VIDEO_MB} MB.</li>
                      <li>Si crea anche una voce clonata. Dopo l&apos;addestramento la persona deve dare il consenso.</li>
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">JPG o PNG, volto ben visibile e illuminato. Max 32MB.</p>
                  )}
                </div>
              )}

              {needsConsent && (
                <label className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 accent-[hsl(var(--primary))]"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  <span>
                    Dichiaro di avere il consenso della persona ritratta a creare e usare il suo avatar. Conserviamo questa dichiarazione
                    {mode === 'photo' ? ': per gli avatar da foto il fornitore non verifica nulla e la responsabilità è tua.' : '.'}
                  </span>
                </label>
              )}

              <Button type="submit" disabled={!canCreate} className="w-full">
                {creating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {mode === 'digital_twin' ? 'Crea digital twin' : 'Crea avatar'}
                {billed ? (
                  <CreditCost items={[{ feature: mode === 'digital_twin' ? 'avatar_creation_twin' : 'avatar_creation_photo' }]} />
                ) : (
                  ` (${mode === 'digital_twin' ? TWIN_CREATION_PRICE_LABEL : AVATAR_CREATION_PRICE_LABEL})`
                )}
              </Button>
              {createTwin.isPending && (
                <p className="text-xs text-muted-foreground">Carico il video e avvio l&apos;addestramento: può richiedere un minuto, non chiudere la pagina.</p>
              )}
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Come funziona il consenso */}
      <Card className="mt-6">
        <CardContent className="grid gap-4 p-5 text-sm sm:grid-cols-3">
          <div className="flex gap-3">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden />
            <div>
              <p className="font-medium">Digital twin</p>
              <p className="text-xs text-muted-foreground">
                Il fornitore verifica che la persona ritratta abbia accettato: registra una breve dichiarazione con la webcam da un link.
                Senza consenso il twin non genera video.
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden />
            <div>
              <p className="font-medium">Avatar da foto</p>
              <p className="text-xs text-muted-foreground">
                Nessuna verifica del fornitore: ottieni tu il consenso della persona e conserva la prova. Registriamo la tua dichiarazione
                (chi e quando).
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <BadgeCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <div>
              <p className="font-medium">Da descrizione</p>
              <p className="text-xs text-muted-foreground">Personaggio sintetico, non ritrae una persona reale: nessun consenso da raccogliere.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Dettaglio avatar: stato, consenso, eliminazione */}
      <Dialog open={!!open} onClose={() => setOpenId(null)} title={open?.name ?? 'Avatar'}>
        {open && (
          <AvatarDetail
            g={open}
            busy={requestConsent.isPending}
            onConsent={() => void handleConsent(open)}
            onRecheck={() => void groups.refetch()}
            onDelete={() => setToDelete(open)}
          />
        )}
      </Dialog>

      {/* Link per il consenso */}
      <Dialog open={!!consentLink} onClose={() => setConsentLink(null)} title="Consenso del digital twin">
        {consentLink && <ConsentLinkPanel link={consentLink} onClose={() => setConsentLink(null)} />}
      </Dialog>

      <ConfirmDialog
        open={!!toDelete}
        title="Elimina avatar"
        message={
          toDelete
            ? `Vuoi eliminare "${toDelete.name}"? I video già generati con questo avatar restano, ma non potrai più selezionarlo. Il costo di creazione non viene rimborsato.`
            : ''
        }
        loading={del.isPending}
        onConfirm={handleDelete}
        onClose={() => setToDelete(null)}
      />
    </>
  );
}

function AvatarDetail({
  g,
  busy,
  onConsent,
  onRecheck,
  onDelete,
}: {
  g: AvatarGroupView;
  busy: boolean;
  onConsent: () => void;
  onRecheck: () => void;
  onDelete: () => void;
}) {
  const st = statusInfo(g);
  const twin = g.kind === 'digital_twin';
  return (
    <div className="space-y-4">
      <div className="flex gap-4">
        <div className="h-40 w-32 shrink-0 overflow-hidden rounded-lg border bg-muted">
          {g.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={g.previewUrl} alt={g.name} className="h-full w-full object-cover object-top" />
          ) : (
            <div className="grid h-full place-items-center">
              <ImageIcon className="size-6 text-muted-foreground" aria-hidden />
            </div>
          )}
        </div>
        <dl className="min-w-0 flex-1 space-y-2 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Tipo</dt>
            <dd className="font-medium">{KIND_LABEL[g.kind]}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Stato</dt>
            <dd>
              <span className={cn('inline-block rounded-full px-2 py-0.5 text-xs font-medium', TONE[st.tone])}>{st.label}</span>
            </dd>
          </div>
          {twin && (
            <div>
              <dt className="text-xs text-muted-foreground">Consenso della persona</dt>
              <dd className="font-medium">
                {g.consentStatus === 'accepted' ? 'Accettato' : g.consentStatus === 'rejected' ? 'Rifiutato' : g.consentStatus === 'pending' ? 'In attesa' : 'Da avviare'}
              </dd>
            </div>
          )}
          {!twin && (
            <div>
              <dt className="text-xs text-muted-foreground">Dichiarazione di consenso</dt>
              <dd className="font-medium">{g.kind === 'prompt' ? 'Non necessaria' : g.attested ? 'Registrata' : 'Non registrata'}</dd>
            </div>
          )}
        </dl>
      </div>

      {g.error && <p className="rounded-lg border border-red-300/60 bg-red-50 p-3 text-xs text-red-900">{g.error}</p>}

      {twin && g.status === 'processing' && (
        <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
          L&apos;addestramento richiede di solito qualche minuto. Puoi avviare subito il consenso: lo stato si aggiorna da solo.
        </p>
      )}
      {twin && g.consentStatus !== 'accepted' && (
        <p className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-900">
          Finché la persona ritratta non ha dato il consenso questo avatar non può generare video. Il link per registrarlo dura 24 ore e si
          può rinnovare.
        </p>
      )}
      {twin && g.consentStatus === 'accepted' && g.status === 'completed' && (
        <p className="flex items-center gap-2 rounded-lg border border-emerald-300/60 bg-emerald-50 p-3 text-xs text-emerald-900">
          <Check className="size-4" /> Consenso accettato: l&apos;avatar è utilizzabile nei video.
        </p>
      )}

      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="outline" onClick={onDelete} className="text-destructive">
          <Trash2 className="size-4" /> Elimina
        </Button>
        <div className="flex flex-wrap gap-2">
          {twin && (
            <Button variant="outline" onClick={onRecheck}>
              <RefreshCw className="size-4" /> Ricontrolla
            </Button>
          )}
          {twin && g.consentStatus !== 'accepted' && (
            <Button onClick={onConsent} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
              {g.consentStatus === 'pending' ? 'Rinnova il link del consenso' : g.consentStatus === 'rejected' ? 'Riprova il consenso' : 'Avvia la verifica del consenso'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ConsentLinkPanel({ link, onClose }: { link: AvatarConsentRequest; onClose: () => void }) {
  const toast = useToast();
  const [copied, setCopied] = React.useState(false);
  async function copy() {
    if (!link.url) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.show('Copia non riuscita: seleziona il link e copialo a mano', 'error');
    }
  }
  return (
    <div className="space-y-4 text-sm">
      {link.url ? (
        <>
          <p>
            Manda questo link alla <strong>persona ritratta nel video</strong>: dal suo dispositivo registra una breve dichiarazione con la
            webcam. Il link vale 24 ore.
          </p>
          <div className="flex gap-2">
            <Input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} aria-label="Link del consenso" className="h-9 text-xs" />
            <Button variant="outline" onClick={() => void copy()} aria-label="Copia il link">
              {copied ? <Check className="size-4" /> : <ClipboardCopy className="size-4" />}
            </Button>
            <a
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1 rounded-md border px-3 text-sm hover:bg-accent/60"
            >
              <ExternalLink className="size-4" /> Apri
            </a>
          </div>
          <p className="text-xs text-muted-foreground">
            Appena la persona completa, lo stato dell&apos;avatar si aggiorna da solo in questa pagina (di solito entro pochi minuti).
          </p>
        </>
      ) : (
        <p>La verifica è stata avviata: lo stato si aggiorna da solo in questa pagina.</p>
      )}
      <div className="flex justify-end">
        <Button onClick={onClose}>Chiudi</Button>
      </div>
    </div>
  );
}
