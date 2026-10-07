'use client';

import { useParams, useRouter } from 'next/navigation';
import { PageHeader } from '@/components/app/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { BrandEditor, type BrandDraft } from '@/components/brands/brand-editor';
import { useToast } from '@/components/ui/toast';
import { useBrand, useSaveBrand } from '@/lib/api/hooks';

export default function BrandDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const brand = useBrand(params.id);
  const save = useSaveBrand();

  async function handleSubmit(draft: BrandDraft) {
    try {
      await save.mutateAsync({ id: params.id, def: draft });
      toast.show('Brand aggiornato', 'success');
      router.push('/brands');
    } catch {
      toast.show('Aggiornamento non riuscito', 'error');
    }
  }

  if (brand.isLoading) {
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
