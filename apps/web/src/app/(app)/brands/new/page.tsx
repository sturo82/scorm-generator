'use client';

import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/app/page-header';
import { BrandEditor, type BrandDraft } from '@/components/brands/brand-editor';
import { useToast } from '@/components/ui/toast';
import { useSaveBrand } from '@/lib/api/hooks';

export default function NewBrandPage() {
  const router = useRouter();
  const toast = useToast();
  const save = useSaveBrand();

  async function handleSubmit(draft: BrandDraft) {
    try {
      await save.mutateAsync({ def: draft });
      toast.show('Brand creato', 'success');
      router.push('/brands');
    } catch {
      toast.show('Creazione non riuscita', 'error');
    }
  }

  return (
    <>
      <PageHeader title="Nuovo brand" description="Imposta colori, logo e font. L'anteprima si aggiorna in tempo reale." />
      <BrandEditor onSubmit={handleSubmit} saving={save.isPending} />
    </>
  );
}
