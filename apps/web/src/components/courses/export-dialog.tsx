'use client';

import * as React from 'react';
import { Download, Package } from 'lucide-react';
import type { ScormProfile } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Label } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/toast';
import { useBrands, useCourse, useExportCourse } from '@/lib/api/hooks';
import { formatBytes } from '@/lib/format';

/**
 * Dialog di export SCORM (Requisito 9.3). Selezione brand + profilo SCORM,
 * opzione per forzare l'export anche con elementi non approvati, e link di
 * download del pacchetto generato.
 */
export function ExportDialog({ courseId }: { courseId: string }) {
  const [open, setOpen] = React.useState(false);
  const brands = useBrands();
  const course = useCourse(courseId);
  const exportCourse = useExportCourse(courseId);
  const toast = useToast();

  const [brandId, setBrandId] = React.useState('');
  const [profile, setProfile] = React.useState<ScormProfile>('SCORM_2004_4TH');
  const [allowUnapproved, setAllowUnapproved] = React.useState(false);
  const [includeSemanticSearch, setIncludeSemanticSearch] = React.useState(false);
  const [result, setResult] = React.useState<{ url: string; size: number; warnings: string[] } | null>(null);

  // Default: il brand primario del corso, altrimenti il primo disponibile.
  React.useEffect(() => {
    if (brandId) return;
    const primary = course.data?.primaryBrandId;
    if (primary) setBrandId(primary);
    else if (brands.data && brands.data.length > 0) setBrandId(brands.data[0]!.id);
  }, [brands.data, course.data?.primaryBrandId, brandId]);

  async function handleExport() {
    if (!brandId) return;
    try {
      const res = await exportCourse.mutateAsync({ brandId, profile, allowUnapproved, includeSemanticSearch });
      setResult({ url: res.downloadUrl, size: res.sizeBytes, warnings: res.warnings });
      toast.show('Pacchetto SCORM generato', 'success');
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Export non riuscito', 'error');
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Package className="size-4" /> Esporta SCORM
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} title="Esporta pacchetto SCORM">
        <div className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label htmlFor="exp-brand">Brand</Label>
            <Select id="exp-brand" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
              {brands.data?.length ? (
                brands.data.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))
              ) : (
                <option value="">Nessun brand disponibile</option>
              )}
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="exp-profile">Profilo SCORM</Label>
            <Select id="exp-profile" value={profile} onChange={(e) => setProfile(e.target.value as ScormProfile)}>
              <option value="SCORM_2004_4TH">SCORM 2004 4th Edition</option>
              <option value="SCORM_12">SCORM 1.2</option>
            </Select>
          </div>

          <Checkbox
            checked={allowUnapproved}
            onChange={setAllowUnapproved}
            label="Consenti export con elementi non approvati"
          />

          <div className="space-y-1">
            <Checkbox
              checked={includeSemanticSearch}
              onChange={setIncludeSemanticSearch}
              label="Ricerca semantica nel widget «Chiedi al corso»"
            />
            <p className="pl-7 text-xs text-muted-foreground">
              Migliora i risultati con un indice semantico (cosine similarity) incluso nel pacchetto. Funziona offline, pochi KB in più.
            </p>
          </div>

          <Button onClick={handleExport} disabled={exportCourse.isPending || !brandId}>
            {exportCourse.isPending ? 'Generazione…' : 'Genera pacchetto'}
          </Button>

          {result && (
            <div className="rounded-lg border bg-accent/40 p-4">
              <p className="text-sm font-medium">Pacchetto pronto ({formatBytes(result.size)})</p>
              {result.warnings.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-xs text-warning">
                  {result.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
              <Button asChild variant="outline" size="sm" className="mt-3">
                <a href={result.url} download>
                  <Download className="size-4" /> Scarica .zip
                </a>
              </Button>
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
}
