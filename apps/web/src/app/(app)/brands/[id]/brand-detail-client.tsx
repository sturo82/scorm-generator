'use client';

import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/app/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { BrandEditor, type BrandDraft } from '@/components/brands/brand-editor';
import { useToast } from '@/components/ui/toast';
import { useDynamicRouteId } from '@/lib/use-dynamic-route-id';
import { useBrand, useSaveBrand } from '@/lib/api/hooks';

/** Editor di dettaglio brand: shell client, dati risolti a runtime via API. */
export function BrandDetailClient() {
  // Export statico: id reale letto dall'URL (lo shell è "placeholder").
  const brandId = useDynamicRouteId('brands');
  const router = useRouter();
  const toast = useToast();
  const brand = useBrand(brandId);
  const save = useSaveBrand();

  async function handleSubmit(draft: BrandDraft) {
    try {
      await save.mutateAsync({ id: brandId, def: draft });
      toast.show('Brand aggiornato', 'success');
      router.push('/brands');
    } catch {
      toast.show('Aggiornamento non riuscito', 'error');
    }
  }

  if (!brandId || brand.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-1/3" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (!brand.data) return <p className="text-muted-foreground">Brand non trovato.</p>;

  return (
    <>
      <PageHeader title={`Modifica: ${brand.data.name}`} description="Aggiorna l'identità visiva del brand." />
      <BrandEditor initial={brand.data} onSubmit={handleSubmit} saving={save.isPending} />
    </>
  );
}
