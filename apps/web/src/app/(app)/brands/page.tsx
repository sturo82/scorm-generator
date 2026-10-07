'use client';

import Link from 'next/link';
import { Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useBrands, useDeleteBrand } from '@/lib/api/hooks';

export default function BrandsPage() {
  const brands = useBrands();
  const del = useDeleteBrand();
  const toast = useToast();

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Eliminare il brand "${name}"?`)) return;
    try {
      await del.mutateAsync(id);
      toast.show('Brand eliminato', 'success');
    } catch {
      toast.show('Eliminazione non riuscita', 'error');
    }
  }

  return (
    <>
      <PageHeader
        title="Brand"
        description="Definisci l'identità visiva applicata ai corsi in fase di export."
        actions={
          <Button asChild>
            <Link href="/brands/new">
              <Plus className="size-4" /> Nuovo brand
            </Link>
          </Button>
        }
      />

      {brands.isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      )}

      {brands.data && brands.data.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-muted-foreground">
            Nessun brand. Creane uno per personalizzare i tuoi corsi.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {brands.data?.map((b) => (
          <Card key={b.id} className="group h-full transition-colors hover:border-primary/40">
            <Link href={`/brands/${b.id}`} className="block">
              <div
                className="flex h-20 items-center gap-2 rounded-t-xl px-5"
                style={{ background: b.colors.primary, color: b.colors.onPrimary }}
              >
                <div className="grid size-9 place-items-center rounded bg-white/20 text-sm font-bold">
                  {b.name.slice(0, 2).toUpperCase()}
                </div>
                <span className="font-semibold">{b.name}</span>
              </div>
            </Link>
            <CardContent className="flex items-center justify-between pt-4">
              <div className="flex gap-1.5">
                {['primary', 'surface', 'success', 'warning', 'error'].map((k) => (
                  <span
                    key={k}
                    className="size-5 rounded-full border"
                    style={{ background: b.colors[k] }}
                    title={k}
                  />
                ))}
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Elimina brand"
                className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                onClick={() => handleDelete(b.id, b.name)}
              >
                <Trash2 className="size-4" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
