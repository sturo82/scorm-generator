'use client';

import Link from 'next/link';
import { BookOpen, Database, Palette, Plus, Sparkles, ArrowRight } from 'lucide-react';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EditorialStatusBadge } from '@/components/status-badge';
import { useBrands, useCourses, useKnowledge } from '@/lib/api/hooks';

export default function DashboardPage() {
  const courses = useCourses();
  const brands = useBrands();
  const knowledge = useKnowledge();

  const stats = [
    { label: 'Corsi', value: courses.data?.length, icon: BookOpen, href: '/courses' },
    { label: 'Brand', value: brands.data?.length, icon: Palette, href: '/brands' },
    { label: 'Documenti knowledge', value: knowledge.data?.length, icon: Database, href: '/knowledge' },
  ];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Panoramica dei tuoi corsi, brand e knowledge base."
        actions={
          <Button asChild className="brand-glow">
            <Link href="/courses/new">
              <Plus className="size-4" /> Nuovo corso
            </Link>
          </Button>
        }
      />

      {/* Hero banner brand: velo colorato che lega la dashboard al brand. */}
      <div className="brand-surface mb-8 flex items-center justify-between gap-4 p-6">
        <div className="space-y-1">
          <h2 className="text-lg font-bold">Benvenuto</h2>
          <p className="text-sm text-muted-foreground">
            Crea corsi e-learning professionali con AI, gestisci brand e knowledge base da qui.
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link href="/courses/new">
            <Sparkles className="size-4" /> Inizia un corso <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </div>

      {/* Stat card — icone su sfondo accent colorato, bordo brand sull'hover. */}
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <Card className="group relative overflow-hidden transition-all hover:border-primary/40 hover:shadow-elevate">
              {/* Striscia accent in alto */}
              <span
                aria-hidden
                className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary to-primary/40"
              />
              <CardContent className="flex items-center gap-4 p-5 pt-6">
                <div className="grid size-12 place-items-center rounded-xl bg-accent text-accent-foreground shadow-sm ring-1 ring-primary/10">
                  <s.icon className="size-5" />
                </div>
                <div>
                  <div className="text-3xl font-bold tracking-tight">
                    {s.value ?? <Skeleton className="h-8 w-10" />}
                  </div>
                  <div className="text-sm font-medium text-muted-foreground">{s.label}</div>
                </div>
                <ArrowRight className="ml-auto size-4 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <h2 className="mb-3 text-lg font-semibold">Corsi recenti</h2>

      {courses.isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      {courses.data && courses.data.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="brand-glow grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground">
              <Sparkles className="size-7" />
            </div>
            <div>
              <p className="font-semibold">Nessun corso ancora</p>
              <p className="text-sm text-muted-foreground">Crea il tuo primo corso partendo da un brief.</p>
            </div>
            <Button asChild>
              <Link href="/courses/new">
                <Plus className="size-4" /> Crea corso
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {courses.data && courses.data.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.data.map((c) => (
            <Link key={c.id} href={`/courses/${c.id}`}>
              <Card className="group h-full overflow-hidden transition-all hover:border-primary/40 hover:shadow-elevate">
                {/* Bordo accent superiore sottile */}
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-primary/60 to-transparent opacity-0 transition-opacity group-hover:opacity-100"
                />
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="line-clamp-2">{c.title}</CardTitle>
                    <EditorialStatusBadge status={c.status} />
                  </div>
                  <CardDescription className="line-clamp-2">
                    {c.description || 'Nessuna descrizione'}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    Lingua: {c.language}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
