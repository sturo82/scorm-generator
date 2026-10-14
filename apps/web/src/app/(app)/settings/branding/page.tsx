'use client';

import * as React from 'react';
import { Upload, Image as ImageIcon, Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useBranding, useUpdateBranding, useUploadBrandingLogo } from '@/lib/api/hooks';
import { APP_NAME } from '@/lib/app-brand';

/**
 * Sotto-brand del tenant: nome visibile e logo che rendono il team
 * riconoscibile nell'intestazione dell'app. NON cambia l'aspetto generale
 * dell'applicazione (colori, tema, favicon restano quelli della piattaforma).
 * Richiede ruolo ADMIN/OWNER.
 */
export default function BrandingSettingsPage() {
  const toast = useToast();
  const { data, isLoading } = useBranding();
  const update = useUpdateBranding();
  const uploadLogo = useUploadBrandingLogo();

  const [name, setName] = React.useState('');
  const logoInput = React.useRef<HTMLInputElement>(null);

  // Sincronizza il campo quando arriva il branding dal server.
  React.useEffect(() => {
    if (!data) return;
    setName(data.appName ?? '');
  }, [data]);

  const trimmed = name.trim();
  const nameValid = trimmed.length === 0 || trimmed.length <= 40;
  const dirty = !!data && (trimmed || null) !== (data.appName ?? null);

  async function handleSave() {
    if (!nameValid) {
      toast.show('Il nome può avere al massimo 40 caratteri', 'error');
      return;
    }
    try {
      // Nome vuoto → null: ripiega sul nome dell'app di default.
      await update.mutateAsync({ appName: trimmed || null });
      toast.show('Nome aggiornato', 'success');
    } catch {
      toast.show('Salvataggio non riuscito', 'error');
    }
  }

  async function handleUpload(file: File | undefined) {
    if (!file) return;
    try {
      await uploadLogo.mutateAsync(file);
      toast.show('Logo caricato', 'success');
    } catch {
      toast.show('Upload non riuscito (max 2MB, PNG/SVG/WebP/JPG)', 'error');
    }
  }

  const displayName = trimmed || APP_NAME;

  return (
    <>
      <PageHeader
        title="Brand del team"
        description="Nome e logo del tuo team, mostrati nell’intestazione. Non modificano l’aspetto generale dell’app."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {/* Nome visibile del tenant */}
          <Card>
            <CardHeader>
              <CardTitle>Nome del team</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="appName">Nome visibile</Label>
                <Input
                  id="appName"
                  value={name}
                  maxLength={40}
                  placeholder={APP_NAME}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isLoading}
                />
                <p className="text-xs text-muted-foreground">
                  Mostrato accanto al logo e nel titolo della scheda. Lascialo vuoto per usare
                  il nome di default dell’applicazione.
                </p>
                {!nameValid && <p className="text-xs text-destructive">Massimo 40 caratteri.</p>}
              </div>
              <div>
                <Button onClick={handleSave} disabled={!dirty || !nameValid || update.isPending}>
                  {update.isPending ? 'Salvataggio…' : 'Salva'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Logo del tenant */}
          <Card>
            <CardHeader>
              <CardTitle>Logo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="grid h-12 w-20 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted">
                  {data?.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={data.logoUrl} alt="Logo del team" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <ImageIcon className="size-5 text-muted-foreground" aria-hidden />
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => logoInput.current?.click()}
                  disabled={uploadLogo.isPending}
                >
                  {uploadLogo.isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                  Carica
                </Button>
                <input
                  ref={logoInput}
                  type="file"
                  accept="image/png,image/svg+xml,image/webp,image/jpeg"
                  className="hidden"
                  onChange={(e) => {
                    void handleUpload(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Mostrato nell’intestazione e nella sidebar. PNG, SVG, WebP o JPG, max 2MB.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Anteprima dell'intestazione (non del tema) */}
        <div>
          <Card className="sticky top-20 overflow-hidden">
            <CardHeader>
              <CardTitle>Anteprima</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2.5 rounded-lg border bg-card p-3 font-semibold">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={data?.logoUrl ?? '/brand/kscorm-icon-white.png'}
                  alt=""
                  className="size-8 rounded-lg object-contain"
                />
                <span className="flex flex-col leading-tight">
                  <span className="truncate">{displayName}</span>
                  <span className="text-[10px] font-medium uppercase tracking-widest opacity-70">
                    by Knowkube
                  </span>
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Il nome e il logo del team compaiono qui. Colori e tema dell’app restano invariati.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
