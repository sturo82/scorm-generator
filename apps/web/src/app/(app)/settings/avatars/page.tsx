'use client';

import * as React from 'react';
import { Loader2, Upload, Trash2, Sparkles, Image as ImageIcon, Info } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import {
  heygenAvatarCreationCustomerPriceUsd,
  heygenAvatarTypeLabel,
  HEYGEN_CREATABLE_AVATAR_TYPES,
} from '@scorm/contracts';
import {
  useMyAvatars,
  useCreatePhotoAvatar,
  useCreatePromptAvatar,
  useDeleteAvatar,
} from '@/lib/api/hooks';
import type { AvatarOption } from '@/lib/api/types';

/**
 * Prezzo AL CLIENTE della creazione di un avatar (costo provider markuppato).
 * Oggi la piattaforma crea solo avatar "da foto" e "da prompt": entrambi sono
 * photo_avatar, quindi il prezzo è quello del tipo 'photo'. Derivato dal listino
 * condiviso (non hardcodato) così resta allineato se il listino cambia.
 */
const AVATAR_CREATION_PRICE = heygenAvatarCreationCustomerPriceUsd('photo');
const AVATAR_CREATION_PRICE_LABEL = `$${AVATAR_CREATION_PRICE.toFixed(2)}`;

type CreateMode = 'photo' | 'prompt';

/**
 * Impostazioni → Avatar: gestione degli avatar HeyGen del tenant. Elenca gli
 * avatar dell'account, permette di crearne di nuovi (da foto o da descrizione
 * testuale) e di eliminarli. La creazione è a pagamento una tantum (prezzo al
 * cliente derivato dal listino). Gli avatar creati sono poi selezionabili nella
 * generazione dei video dei concetti, con qualsiasi engine (III/IV/V).
 */
export default function AvatarsSettingsPage() {
  const toast = useToast();
  const { data, isLoading, isError } = useMyAvatars();
  const createPhoto = useCreatePhotoAvatar();
  const createPrompt = useCreatePromptAvatar();
  const del = useDeleteAvatar();

  const [mode, setMode] = React.useState<CreateMode>('photo');
  const [name, setName] = React.useState('');
  const [prompt, setPrompt] = React.useState('');
  const [file, setFile] = React.useState<File | null>(null);
  const [filePreview, setFilePreview] = React.useState<string | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);

  const [toDelete, setToDelete] = React.useState<AvatarOption | null>(null);

  const avatars = data?.items ?? [];
  const creating = createPhoto.isPending || createPrompt.isPending;

  function onPickFile(f: File | undefined) {
    if (!f) return;
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
    // Pulisce l'URL oggetto dell'anteprima allo smontaggio.
    return () => {
      if (filePreview) URL.revokeObjectURL(filePreview);
    };
  }, [filePreview]);

  const nameValid = name.trim().length > 0 && name.trim().length <= 120;
  const canCreate =
    nameValid &&
    !creating &&
    (mode === 'photo' ? !!file : prompt.trim().length > 0);

  function resetForm() {
    setName('');
    setPrompt('');
    setFile(null);
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
          ? await createPhoto.mutateAsync({ name: name.trim(), file: file! })
          : await createPrompt.mutateAsync({ name: name.trim(), prompt: prompt.trim() });
      toast.show(`Avatar "${res.name}" in creazione`, 'success');
      resetForm();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      toast.show(msg.replace(/^API \d+:\s*/, '') || 'Creazione avatar non riuscita', 'error');
    }
  }

  async function handleDelete() {
    if (!toDelete) return;
    try {
      await del.mutateAsync(toDelete.id);
      toast.show('Avatar eliminato', 'success');
      setToDelete(null);
    } catch {
      toast.show('Eliminazione non riuscita', 'error');
    }
  }

  return (
    <>
      <PageHeader
        title="Avatar"
        description="Crea e gestisci i tuoi avatar parlanti. Usali per generare i video dei concetti al posto del testo."
      />

      {/* Nota costo + engine */}
      <div className="mb-6 flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <p className="text-muted-foreground">
          La creazione di un avatar ha un costo una tantum di{' '}
          <span className="font-medium text-foreground">{AVATAR_CREATION_PRICE_LABEL}</span> (prezzo
          al cliente, markup incluso). Gli avatar creati sono riutilizzabili in tutti i corsi del team.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* Elenco avatar del tenant */}
        <Card>
          <CardHeader>
            <CardTitle>I tuoi avatar</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Caricamento…
              </div>
            ) : isError ? (
              <p className="text-sm text-destructive">
                Impossibile caricare gli avatar. Verifica che la generazione video sia configurata
                (HeyGen).
              </p>
            ) : avatars.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <Sparkles className="mx-auto mb-2 size-6 text-muted-foreground" aria-hidden />
                <p className="text-sm text-muted-foreground">
                  Nessun avatar ancora. Creane uno dal pannello a destra.
                </p>
              </div>
            ) : (
              <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {avatars.map((a) => (
                  <li key={a.id} className="group overflow-hidden rounded-lg border bg-card">
                    <div className="relative aspect-square bg-muted">
                      {a.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={a.previewUrl}
                          alt={a.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="grid h-full place-items-center">
                          <ImageIcon className="size-7 text-muted-foreground" aria-hidden />
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => setToDelete(a)}
                        aria-label={`Elimina ${a.name}`}
                        className="absolute right-2 top-2 grid size-8 place-items-center rounded-md bg-black/55 text-white opacity-0 transition-opacity hover:bg-destructive focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                    <div className="space-y-1 p-2.5">
                      <p className="truncate text-sm font-medium" title={a.name}>
                        {a.name}
                      </p>
                      <Badge variant="secondary" className="text-[10px]">
                        {heygenAvatarTypeLabel({ source: a.source, groupType: a.groupType })}
                      </Badge>
                    </div>
                  </li>
                ))}
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
            {/* Scelta tipo di avatar da creare, con descrizione di cosa si
                ottiene (così l'autore sceglie in modo informato). */}
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
                    onClick={() => setMode(t.type)}
                    className={
                      'flex w-full flex-col gap-0.5 rounded-lg border p-3 text-left transition-colors ' +
                      (selected
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'border-input hover:bg-accent/50')
                    }
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      {t.label}
                      <span className="font-normal text-xs text-muted-foreground">· {t.tagline}</span>
                    </span>
                    <span className="text-xs leading-snug text-muted-foreground">{t.description}</span>
                  </button>
                );
              })}
            </div>

            <form className="space-y-4" onSubmit={handleCreate}>
              <div className="space-y-1.5">
                <Label htmlFor="av-name">Nome</Label>
                <Input
                  id="av-name"
                  value={name}
                  maxLength={120}
                  placeholder="Es. Relatore corso sicurezza"
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              {mode === 'photo' ? (
                <div className="space-y-1.5">
                  <Label>Foto (volto frontale)</Label>
                  <div className="flex items-center gap-3">
                    <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted">
                      {filePreview ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={filePreview} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <ImageIcon className="size-5 text-muted-foreground" aria-hidden />
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => fileInput.current?.click()}
                    >
                      <Upload className="size-4" /> Scegli foto
                    </Button>
                    <input
                      ref={fileInput}
                      type="file"
                      accept="image/png,image/jpeg"
                      className="hidden"
                      onChange={(e) => {
                        onPickFile(e.target.files?.[0]);
                      }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    JPG o PNG, volto ben visibile e illuminato. Max 32MB.
                  </p>
                </div>
              ) : (
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
                  <p className="text-xs text-muted-foreground">
                    L&apos;avatar viene generato dall&apos;IA a partire dalla descrizione.
                  </p>
                </div>
              )}

              <Button type="submit" disabled={!canCreate} className="w-full">
                {creating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                Crea avatar ({AVATAR_CREATION_PRICE_LABEL})
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

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
