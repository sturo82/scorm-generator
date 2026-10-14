'use client';

import * as React from 'react';
import { Image as ImageIcon, Loader2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { ColorInput } from '@/components/ui/color-input';
import type { BrandView } from '@/lib/api/types';

export type BrandDraft = Omit<BrandView, 'id' | 'tenantId'>;

/** Prefisso che marca un logo come file caricato (chiave di storage) vs URL. */
const STORAGE_PREFIX = 'storage:';
const isUploadedLogo = (logo: string | undefined) => !!logo && logo.startsWith(STORAGE_PREFIX);

const EMPTY: BrandDraft = {
  name: '',
  assets: { logoPrimaryUrl: '' },
  colors: {
    primary: '#4F46E5',
    onPrimary: '#FFFFFF',
    secondary: '#EC4899',
    surface: '#FFFFFF',
    onSurface: '#111827',
    success: '#16A34A',
    warning: '#D97706',
    error: '#DC2626',
  },
  typography: { fontFamilyHeading: 'Inter', fontFamilyBody: 'Inter' },
  voice: { tone: '' },
};

const COLOR_FIELDS: Array<{ key: keyof BrandDraft['colors']; label: string }> = [
  { key: 'primary', label: 'Primario' },
  { key: 'onPrimary', label: 'Testo su primario' },
  { key: 'secondary', label: 'Accento (secondario)' },
  { key: 'surface', label: 'Superficie' },
  { key: 'onSurface', label: 'Testo su superficie' },
  { key: 'success', label: 'Successo' },
  { key: 'warning', label: 'Attenzione' },
  { key: 'error', label: 'Errore' },
];

interface BrandEditorProps {
  initial?: BrandView;
  onSubmit: (draft: BrandDraft) => Promise<void> | void;
  saving?: boolean;
  /**
   * Carica un file immagine come logo (disponibile solo per brand già salvati:
   * l'endpoint richiede un id). Ritorna il brand aggiornato (con logoDisplayUrl).
   */
  onUploadLogo?: (file: File) => Promise<BrandView>;
  uploadingLogo?: boolean;
}

/**
 * Editor del brand con anteprima tema LIVE: i colori selezionati vengono
 * applicati in tempo reale a una card dimostrativa che simula il tema del corso
 * esportato (Requisito 7). Form + preview affiancati su desktop, impilati su
 * mobile.
 */
export function BrandEditor({ initial, onSubmit, saving, onUploadLogo, uploadingLogo }: BrandEditorProps) {
  const [draft, setDraft] = React.useState<BrandDraft>(() =>
    initial ? stripIdentity(initial) : structuredClone(EMPTY),
  );
  // URL firmato per l'anteprima del logo caricato (dal server). Aggiornato dopo
  // ogni upload riuscito; l'URL esterno usa invece direttamente il campo testo.
  const [logoDisplayUrl, setLogoDisplayUrl] = React.useState<string | null>(
    initial?.logoDisplayUrl ?? null,
  );
  const logoInput = React.useRef<HTMLInputElement>(null);

  const logoVal = draft.assets.logoPrimaryUrl;
  const uploaded = isUploadedLogo(logoVal);
  // Anteprima: logo caricato → URL firmato; URL esterno → il valore stesso.
  const logoPreview = uploaded ? logoDisplayUrl : logoVal || null;

  async function handleLogoFile(file: File | undefined) {
    if (!file || !onUploadLogo) return;
    const updated = await onUploadLogo(file);
    setDraft((d) => ({
      ...d,
      assets: { ...d.assets, logoPrimaryUrl: updated.assets.logoPrimaryUrl },
    }));
    setLogoDisplayUrl(updated.logoDisplayUrl ?? null);
  }

  function clearLogo() {
    setDraft((d) => ({ ...d, assets: { ...d.assets, logoPrimaryUrl: '' } }));
    setLogoDisplayUrl(null);
  }

  const setColor = (key: keyof BrandDraft['colors'], value: string) =>
    setDraft((d) => ({ ...d, colors: { ...d.colors, [key]: value } }));

  const previewVars = {
    '--p': draft.colors.primary,
    '--op': draft.colors.onPrimary,
    '--acc': draft.colors.secondary ?? draft.colors.primary,
    '--s': draft.colors.surface,
    '--os': draft.colors.onSurface,
    '--ok': draft.colors.success,
  } as React.CSSProperties;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      {/* Form */}
      <Card>
        <CardContent className="pt-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void onSubmit(draft);
            }}
            className="flex flex-col gap-5"
          >
            <div className="space-y-2">
              <Label htmlFor="brand-name">Nome brand</Label>
              <Input
                id="brand-name"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Es. Acme"
                required
              />
            </div>

            <div className="space-y-2">
              <Label>Logo</Label>
              <div className="flex items-start gap-3">
                {/* Anteprima del logo (caricato o da URL) */}
                <div className="grid h-14 w-20 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted">
                  {logoPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoPreview} alt="Logo del brand" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <ImageIcon className="size-5 text-muted-foreground" aria-hidden />
                  )}
                </div>
                <div className="flex-1 space-y-2">
                  {uploaded ? (
                    // Logo caricato: mostra lo stato + rimozione, non la chiave tecnica.
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Immagine caricata</span>
                      <Button type="button" variant="ghost" size="sm" onClick={clearLogo}>
                        <X className="size-4" /> Rimuovi
                      </Button>
                    </div>
                  ) : (
                    <Input
                      id="brand-logo"
                      value={logoVal}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, assets: { ...d.assets, logoPrimaryUrl: e.target.value } }))
                      }
                      placeholder="https://…/logo.svg"
                      aria-label="URL del logo"
                    />
                  )}
                  <div className="flex items-center gap-2">
                    {onUploadLogo ? (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => logoInput.current?.click()}
                          disabled={uploadingLogo}
                        >
                          {uploadingLogo ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                          {uploaded ? 'Sostituisci' : 'Carica immagine'}
                        </Button>
                        <input
                          ref={logoInput}
                          type="file"
                          accept="image/png,image/svg+xml,image/webp,image/jpeg"
                          className="hidden"
                          onChange={(e) => {
                            void handleLogoFile(e.target.files?.[0]);
                            e.target.value = '';
                          }}
                        />
                        {!uploaded && <span className="text-xs text-muted-foreground">oppure incolla un URL</span>}
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Salva il brand per poter caricare un&apos;immagine, oppure incolla un URL.
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">PNG, SVG, WebP o JPG. Max 2MB.</p>
                </div>
              </div>
            </div>

            <div>
              <Label>Palette colori</Label>
              <div className="mt-2 grid gap-4 sm:grid-cols-2">
                {COLOR_FIELDS.map((f) => (
                  <ColorInput
                    key={f.key}
                    id={`color-${f.key}`}
                    label={f.label}
                    value={draft.colors[f.key] ?? '#000000'}
                    onChange={(v) => setColor(f.key, v)}
                  />
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="font-h">Font titoli</Label>
                <Input
                  id="font-h"
                  value={draft.typography.fontFamilyHeading}
                  onChange={(e) => setDraft((d) => ({ ...d, typography: { ...d.typography, fontFamilyHeading: e.target.value } }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="font-b">Font testo</Label>
                <Input
                  id="font-b"
                  value={draft.typography.fontFamilyBody}
                  onChange={(e) => setDraft((d) => ({ ...d, typography: { ...d.typography, fontFamilyBody: e.target.value } }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="voice">Tono di voce (opzionale)</Label>
              <Input
                id="voice"
                value={draft.voice?.tone ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, voice: { tone: e.target.value } }))}
                placeholder="Es. professionale e rassicurante"
              />
            </div>

            <div>
              <Button type="submit" disabled={saving || !draft.name.trim()}>
                {saving ? 'Salvataggio…' : initial ? 'Salva modifiche' : 'Crea brand'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Anteprima tema live */}
      <div className="lg:sticky lg:top-20 lg:self-start">
        <Label className="mb-2 block text-muted-foreground">Anteprima tema</Label>
        <div
          style={previewVars}
          className="overflow-hidden rounded-xl border shadow-sm"
        >
          <div style={{ background: 'var(--p)', color: 'var(--op)' }} className="flex items-center gap-2 p-4">
            <div className="grid size-8 place-items-center rounded bg-white/20 text-sm font-bold">
              {draft.name.slice(0, 2).toUpperCase() || 'BR'}
            </div>
            <span className="font-semibold" style={{ fontFamily: draft.typography.fontFamilyHeading }}>
              {draft.name || 'Nome brand'}
            </span>
          </div>
          <div style={{ background: 'var(--s)', color: 'var(--os)' }} className="space-y-3 p-5">
            <h3 className="text-lg font-bold" style={{ fontFamily: draft.typography.fontFamilyHeading }}>
              Titolo della lezione
            </h3>
            <p className="text-sm opacity-80" style={{ fontFamily: draft.typography.fontFamilyBody }}>
              Esempio di contenuto del corso con i colori e i font del brand applicati in tempo reale.{' '}
              <a href="#" onClick={(e) => e.preventDefault()} style={{ color: 'var(--acc)', fontWeight: 600 }}>
                un link d&apos;esempio
              </a>
              .
            </p>
            <div className="flex items-center gap-2">
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide"
                style={{ color: 'var(--acc)', background: 'color-mix(in srgb, var(--acc) 14%, transparent)' }}
              >
                Accento
              </span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: 'color-mix(in srgb, var(--os) 12%, transparent)' }}>
                <span className="block h-full w-2/3 rounded-full" style={{ background: 'linear-gradient(90deg, var(--p), var(--acc))' }} />
              </span>
            </div>
            <div className="flex gap-2 pt-1">
              <span
                className="rounded-md px-3 py-1.5 text-sm font-medium"
                style={{ background: 'var(--p)', color: 'var(--op)' }}
              >
                Avanti
              </span>
              <span
                className="rounded-md px-3 py-1.5 text-sm font-medium"
                style={{ background: 'var(--ok)', color: '#fff' }}
              >
                Completato
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function stripIdentity(b: BrandView): BrandDraft {
  // logoDisplayUrl è view-only (URL firmato risolto dal server): non fa parte
  // del draft modificabile né del payload di salvataggio.
  const { id: _id, tenantId: _t, logoDisplayUrl: _l, ...rest } = b;
  return structuredClone(rest);
}
