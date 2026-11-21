'use client';
import * as React from 'react';
import Link from 'next/link';
import { Info, Plus, Star, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { ROLE_RANK } from '@/components/app/nav-items';
import { getSession } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { apiErrorText } from '@/lib/api/error-message';
import { useBrands, useDeleteBrand, useSetDefaultBrand } from '@/lib/api/hooks';
import type { AppUserRole } from '@/lib/api/types';

export default function BrandsPage() {
  const brands = useBrands();
  const del = useDeleteBrand();
  const setDefault = useSetDefaultBrand();
  const toast = useToast();
  // Creare, modificare e scegliere il predefinito è riservato agli amministratori (come sul server).
  const [isAdmin, setIsAdmin] = React.useState(false);
  React.useEffect(() => {
    const role = getSession()?.user.role as AppUserRole | undefined;
    setIsAdmin((ROLE_RANK[role ?? 'VIEWER'] ?? 0) >= ROLE_RANK.ADMIN);
  }, []);

  async function handleDelete(id: string, name: string, isDefault: boolean) {
    const note = isDefault ? '\nÈ il brand predefinito: i corsi senza un brand useranno il tema di sistema.' : '';
    if (!confirm(`Eliminare il brand "${name}"?${note}`)) return;
    try {
      await del.mutateAsync(id);
      toast.show('Brand eliminato', 'success');
    } catch (err) {
      toast.show(apiErrorText(err, 'Eliminazione non riuscita'), 'error');
    }
  }
  async function handleDefault(id: string, name: string) {
    try {
      await setDefault.mutateAsync(id);
      toast.show(`"${name}" è ora il brand predefinito dei corsi`, 'success');
    } catch (err) {
      toast.show(apiErrorText(err, 'Operazione non riuscita'), 'error');
    }
  }

  return (
    <>
      <PageHeader
        title="Brand"
        description="L'identità visiva dei corsi. Il brand predefinito si applica ai corsi nuovi e a quelli senza un brand scelto."
        actions={
          isAdmin ? (
            <Button asChild>
              <Link href="/brands/new">
                <Plus className="size-4" /> Nuovo brand
              </Link>
            </Button>
          ) : undefined
        }
      />
      {!isAdmin && (
        <p className="mb-4 flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          Puoi usare i brand nei tuoi corsi. Per crearne o modificarne uno serve il ruolo di amministratore dell&apos;azienda.
        </p>
      )}
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
            Nessun brand ancora: i corsi usano il tema di sistema. {isAdmin ? 'Creane uno per usare i tuoi colori e il tuo logo.' : ''}
          </CardContent>
        </Card>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {brands.data?.map((b) => (
          <Card key={b.id} className={cn('group h-full transition-colors hover:border-primary/40', b.isDefault && 'ring-2 ring-primary/40')}>
            <Link href={`/brands/${b.id}`} className="block">
              <div
                className="relative flex h-20 items-center gap-2 rounded-t-xl px-5"
                style={{ background: b.colors.primary, color: b.colors.onPrimary }}
              >
                <div className="grid size-9 place-items-center rounded bg-white/20 text-sm font-bold">
                  {b.name.slice(0, 2).toUpperCase()}
                </div>
                <span className="font-semibold">{b.name}</span>
                {b.isDefault && (
                  <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-foreground">
                    <Star className="size-3 fill-amber-400 text-amber-400" /> Predefinito
                  </span>
                )}
              </div>
            </Link>
            <CardContent className="flex items-center justify-between gap-2 pt-4">
              <div className="flex gap-1.5">
                {['primary', 'surface', 'success', 'warning', 'error'].map((k) => (
                  <span key={k} className="size-5 rounded-full border" style={{ background: b.colors[k] }} title={k} />
                ))}
              </div>
              {isAdmin && (
                <div className="flex items-center gap-1">
                  {!b.isDefault && (
                    <Button variant="ghost" size="sm" onClick={() => void handleDefault(b.id, b.name)} disabled={setDefault.isPending}>
                      <Star className="size-4" /> Predefinito
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Elimina brand"
                    className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => void handleDelete(b.id, b.name, b.isDefault === true)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
