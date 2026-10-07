'use client';

import * as React from 'react';
import { Upload, Image as ImageIcon, Loader2, Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { ColorInput } from '@/components/ui/color-input';
import { useToast } from '@/components/ui/toast';
import {
  useBranding,
  useUpdateBranding,
  useUploadBrandingAsset,
} from '@/lib/api/hooks';

/**
 * Impostazioni di branding white-label (per-tenant): nome dell'app, colore
 * primario, logo e favicon. Le modifiche si riflettono subito nella UI tramite
 * il BrandingProvider (titolo, favicon e tema). Richiede ruolo ADMIN/OWNER.
 */
export default function BrandingSettingsPage() {
  const toast = useToast();
  const { data, isLoading } = useBranding();
  const update = useUpdateBranding();
  const uploadLogo = useUploadBrandingAsset();
  const uploadFavicon = useUploadBrandingAsset();

  const [appName, setAppName] = React.useState('');
  const [primaryColor, setPrimaryColor] = React.useState('#4F46E5');
  const [accentColor, setAccentColor] = React.useState('');
  const [headerColor, setHeaderColor] = React.useState('');
  const logoInput = React.useRef<HTMLInputElement>(null);
  const faviconInput = React.useRef<HTMLInputElement>(null);

  // Sincronizza i campi quando arriva il branding dal server.
  React.useEffect(() => {
    if (!data) return;
    setAppName(data.appName);
    setPrimaryColor(data.primaryColor);
    setAccentColor(data.accentColor ?? '');
    setHeaderColor(data.headerColor ?? '');
  }, [data]);

  const dirty =
    !!data &&
    (appName !== data.appName ||
      primaryColor.toLowerCase() !== data.primaryColor.toLowerCase() ||
      (accentColor || null) !== (data.accentColor ?? null) ||
      (headerColor || null) !== (data.headerColor ?? null));
  const colorValid = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(primaryColor);
  const accentValid = !accentColor || /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(accentColor);
  const headerValid = !headerColor || /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(headerColor);
  const nameValid = appName.trim().length >= 1 && appName.trim().length <= 40;

  async function handleSave() {
    if (!nameValid || !colorValid || !accentValid || !headerValid) {
      toast.show('Controlla nome e colori', 'error');
      return;
    }
    try {
      await update.mutateAsync({
        appName: appName.trim(),
        primaryColor,
        accentColor: accentColor || null,
        headerColor: headerColor || null,
      });
      toast.show('Branding aggiornato', 'success');
    } catch {
      toast.show('Salvataggio non riuscito', 'error');
    }
  }

  async function handleUpload(kind: 'logo' | 'favicon', file: File | undefined) {
    if (!file) return;
    const mut = kind === 'logo' ? uploadLogo : uploadFavicon;
    try {
      await mut.mutateAsync({ kind, file });
      toast.show(kind === 'logo' ? 'Logo caricato' : 'Favicon caricata', 'success');
    } catch {
      toast.show('Upload non riuscito (max 2MB, PNG/SVG/WebP/ICO)', 'error');
    }
  }

  return (
    <>
      <PageHeader
        title="Branding"
        description="Personalizza nome, colore, logo e favicon della piattaforma per il tuo team."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {/* Identità */}
          <Card>
            <CardHeader>
              <CardTitle>Identità</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="appName">Nome dell&apos;applicazione</Label>
                <Input
                  id="appName"
                  value={appName}
                  maxLength={40}
                  placeholder="SCORM Generator"
                  onChange={(e) => setAppName(e.target.value)}
                  disabled={isLoading}
                />
                {!nameValid && appName.length > 0 && (
                  <p className="text-xs text-destructive">Da 1 a 40 caratteri.</p>
                )}
              </div>
              <ColorInput
                id="primaryColor"
                label="Colore primario"
                value={primaryColor}
                onChange={setPrimaryColor}
              />
              {!colorValid && (
                <p className="text-xs text-destructive">Colore esadecimale non valido (es. #4F46E5).</p>
              )}
              <ColorInput
                id="accentColor"
                label="Colore accent / highlight"
                value={accentColor}
                onChange={setAccentColor}
                placeholder="Opzionale — derivato dal primario"
              />
              {!accentValid && (
                <p className="text-xs text-destructive">Colore esadecimale non valido (es. #FF6900).</p>
              )}
              <ColorInput
                id="headerColor"
                label="Colore header"
                value={headerColor}
                onChange={setHeaderColor}
                placeholder="Opzionale — derivato dal primario"
              />
              {!headerValid && (
                <p className="text-xs text-destructive">Colore esadecimale non valido (es. #192A3D).</p>
              )}
              <div>
                <Button onClick={handleSave} disabled={!dirty || update.isPending}>
                  {update.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  Salva modifiche
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Logo e favicon */}
          <Card>
            <CardHeader>
              <CardTitle>Logo e favicon</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-6 sm:grid-cols-2">
              <AssetSlot
                title="Logo"
                hint="Mostrato in sidebar e header. PNG o SVG, max 2MB."
                previewUrl={data?.logoUrl ?? null}
                busy={uploadLogo.isPending}
                onPick={() => logoInput.current?.click()}
                variant="logo"
              />
              <AssetSlot
                title="Favicon"
                hint="Icona della scheda del browser. PNG/SVG/ICO, max 2MB."
                previewUrl={data?.faviconUrl ?? null}
                busy={uploadFavicon.isPending}
                onPick={() => faviconInput.current?.click()}
                variant="favicon"
              />
              <input
                ref={logoInput}
                type="file"
                accept="image/png,image/svg+xml,image/webp,image/jpeg,image/x-icon"
                className="hidden"
                onChange={(e) => {
                  void handleUpload('logo', e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <input
                ref={faviconInput}
                type="file"
                accept="image/png,image/svg+xml,image/webp,image/x-icon,image/vnd.microsoft.icon"
                className="hidden"
                onChange={(e) => {
                  void handleUpload('favicon', e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </CardContent>
          </Card>
        </div>

        {/* Anteprima live */}
        <div className="space-y-6">
          <Card className="sticky top-20 overflow-hidden">
            <CardHeader>
              <CardTitle>Anteprima</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Mini header brandizzato */}
              <div
                className="flex items-center gap-2.5 rounded-lg p-3 font-semibold text-white"
                style={{
                  background: (headerColor && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(headerColor))
                    ? `linear-gradient(100deg, ${headerColor}, ${primaryColor})`
                    : colorValid
                      ? primaryColor
                      : '#4F46E5',
                }}
              >
                {data?.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={data.logoUrl} alt="" className="size-8 rounded-lg object-contain" />
                ) : (
                  <span
                    className="grid size-8 place-items-center rounded-lg bg-white/20 text-white"
                  >
                    <Sparkles className="size-4" />
                  </span>
                )}
                <span className="truncate">{appName || 'SCORM Generator'}</span>
              </div>
              {/* Swatch dei colori */}
              <div className="flex gap-2">
                <ColorSwatch color={primaryColor} label="Primario" valid={colorValid} />
                <ColorSwatch color={accentColor} label="Accent" valid={accentValid} />
                <ColorSwatch color={headerColor} label="Header" valid={headerValid} />
              </div>
              {/* Bottoni con colori brand */}
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  style={colorValid ? { background: primaryColor } : undefined}
                >
                  Primario
                </Button>
                <Button
                  className="flex-1"
                  style={(accentColor && accentValid)
                    ? { background: accentColor, color: '#fff' }
                    : colorValid
                      ? { background: primaryColor, opacity: 0.7 }
                      : undefined
                  }
                >
                  Accent
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Le modifiche sono applicate all&apos;intera piattaforma per gli utenti del tuo tenant.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

/** Riquadro di un asset (logo/favicon) con anteprima e pulsante di upload. */
function AssetSlot({
  title,
  hint,
  previewUrl,
  busy,
  onPick,
  variant,
}: {
  title: string;
  hint: string;
  previewUrl: string | null;
  busy: boolean;
  onPick: () => void;
  variant: 'logo' | 'favicon';
}) {
  return (
    <div className="space-y-2">
      <Label>{title}</Label>
      <div className="flex items-center gap-3">
        <div
          className={
            variant === 'favicon'
              ? 'grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted'
              : 'grid h-12 w-20 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted'
          }
        >
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt={`${title} corrente`} className="max-h-full max-w-full object-contain" />
          ) : (
            <ImageIcon className="size-5 text-muted-foreground" aria-hidden />
          )}
        </div>
        <Button variant="outline" size="sm" onClick={onPick} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          Carica
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/** Swatch circolare di un colore con etichetta. */
function ColorSwatch({ color, label, valid }: { color: string; label: string; valid: boolean }) {
  const show = color && valid;
  return (
    <div className="flex flex-1 flex-col items-center gap-1">
      <div
        className="size-9 rounded-full border shadow-sm"
        style={show ? { background: color } : undefined}
      />
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}
