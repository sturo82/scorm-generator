'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Coins,
  Database,
  ImageIcon,
  Loader2,
  Mic,
  Palette,
  Plus,
  Sparkles,
  UserSquare2,
  Video,
  Wallet,
} from 'lucide-react';
import type { DashboardCourse } from '@scorm/contracts';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EditorialStatusBadge } from '@/components/status-badge';
import { getSession } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { useDashboardSummary, useWallet } from '@/lib/api/hooks';

const fmt = (n: number) => n.toLocaleString('it-IT');

function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return 'Buonanotte';
  if (h < 13) return 'Buongiorno';
  if (h < 18) return 'Buon pomeriggio';
  return 'Buonasera';
}

export default function DashboardPage() {
  const summary = useDashboardSummary();
  const wallet = useWallet();
  const [name, setName] = React.useState('');
  React.useEffect(() => {
    const n = getSession()?.user.displayName ?? '';
    setName(n.includes('@') ? '' : n.split(' ')[0] ?? '');
  }, []);

  const data = summary.data;
  const loading = summary.isLoading;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="I tuoi corsi, i contenuti creati e i crediti a colpo d'occhio."
        actions={
          <Button asChild className="brand-glow">
            <Link href="/courses/new">
              <Plus className="size-4" /> Nuovo corso
            </Link>
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Hero name={name} generating={data?.recentCourses.filter((c) => c.generating).length ?? 0} className="lg:col-span-2" />
        <WalletCard
          loading={wallet.isLoading}
          enabled={wallet.data?.enabled === true}
          available={wallet.data?.available ?? wallet.data?.balance}
          payer={wallet.data?.personalSpace || wallet.data?.payer === 'PERSONAL' ? 'personale' : 'azienda'}
          canTopup={wallet.data?.canTopup === true}
          spentMonth={data?.credits.spentThisMonth}
          spentTotal={data?.credits.spentTotal}
        />
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat
          loading={loading}
          icon={BookOpen}
          label="Corsi"
          value={data?.totals.courses}
          hint={data ? `${data.totals.byStatus.approved} approvati · ${data.totals.byStatus.inReview} in revisione · ${data.totals.byStatus.draft} bozze` : ''}
          href="/courses"
        />
        <Stat
          loading={loading}
          icon={Sparkles}
          label="Lezioni pronte"
          value={data?.totals.lessonsReady}
          hint={data ? `su ${fmt(data.totals.lessons)} lezioni` : ''}
          href="/courses"
        />
        <Stat
          loading={loading}
          icon={Video}
          label="Video"
          value={data ? data.media.lessonVideos + data.media.library.total : undefined}
          hint={
            data
              ? `${fmt(data.media.lessonVideos)} nelle lezioni · ${fmt(data.media.library.uploaded)} caricati · ${fmt(data.media.library.fromSlides)} da slide · ${fmt(data.media.library.external)} esterni`
              : ''
          }
          href="/videos"
        />
        <Stat loading={loading} icon={ImageIcon} label="Immagini" value={data?.media.images} hint="nelle lezioni" href="/courses" />
        <Stat loading={loading} icon={Mic} label="Narrazioni" value={data?.media.narrations} hint="voce generata" href="/courses" />
        <Stat
          loading={loading}
          icon={Database}
          label="Knowledge e brand"
          value={data ? data.totals.knowledgeDocs + data.totals.brands : undefined}
          hint={data ? `${fmt(data.totals.knowledgeDocs)} documenti · ${fmt(data.totals.brands)} brand` : ''}
          href="/knowledge"
        />
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Ultimi corsi</h2>
        {data && data.recentCourses.length > 0 && (
          <Link href="/courses" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            Tutti i corsi <ArrowRight className="size-3.5" />
          </Link>
        )}
      </div>

      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="overflow-hidden">
              <Skeleton className="h-32 w-full rounded-none" />
              <CardContent className="space-y-2 p-4">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {summary.isError && !data && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <AlertTriangle className="size-6 text-amber-500" />
            <p className="text-sm text-muted-foreground">Non riesco a leggere il riepilogo in questo momento.</p>
            <Button variant="outline" size="sm" onClick={() => summary.refetch()}>
              Riprova
            </Button>
          </CardContent>
        </Card>
      )}

      {data && data.recentCourses.length === 0 && <EmptyCourses />}

      {data && data.recentCourses.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.recentCourses.map((c) => (
            <CourseTile key={c.id} course={c} showCredits={wallet.data?.enabled === true} />
          ))}
        </div>
      )}

      {data && data.recentCourses.length > 0 && data.media.lessonVideos + data.media.library.total === 0 && <EmptyVideos />}

      <h2 className="mb-3 mt-8 text-lg font-semibold">Scorciatoie</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Quick href="/videos" icon={Video} title="Video" text="Carica e gestisci i video" />
        <Quick href="/settings/avatars" icon={UserSquare2} title="Avatar" text="Crea il tuo digital twin" />
        <Quick href="/knowledge" icon={Database} title="Knowledge" text="Documenti per i corsi" />
        <Quick href="/brands" icon={Palette} title="Brand" text="Colori e logo" />
      </div>
    </>
  );
}

function Hero({ name, generating, className }: { name: string; generating: number; className?: string }) {
  return (
    <div className={cn('brand-surface relative overflow-hidden p-6', className)}>
      <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 size-48 rounded-full bg-primary/10 blur-3xl motion-safe:animate-pulse" />
      <div className="relative flex h-full flex-col justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-bold tracking-tight">
            {greeting()}
            {name ? `, ${name}` : ''}
          </h2>
          <p className="text-sm text-muted-foreground">
            {generating > 0
              ? `${generating === 1 ? 'Un corso è' : `${generating} corsi sono`} in generazione: puoi lasciare la pagina, continua da solo.`
              : 'Descrivi il corso che ti serve: struttura, lezioni, test e copertina si generano in un clic.'}
          </p>
        </div>
        <div>
          <Button asChild size="sm">
            <Link href="/courses/new">
              <Sparkles className="size-4" /> Crea e genera un corso <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function WalletCard(props: {
  loading: boolean;
  enabled: boolean;
  available?: number;
  payer: string;
  canTopup: boolean;
  spentMonth?: number;
  spentTotal?: number;
}) {
  if (props.loading) return <Skeleton className="h-full min-h-40 w-full rounded-xl" />;
  if (!props.enabled) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex h-full flex-col items-start justify-center gap-2 p-6">
          <div className="grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground">
            <Wallet className="size-5" />
          </div>
          <p className="font-semibold">Wallet non attivo</p>
          <p className="text-sm text-muted-foreground">
            Con i crediti vedi il prezzo di ogni generazione prima di avviarla e tieni sotto controllo la spesa.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/wallet">Scopri il wallet</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }
  const empty = (props.available ?? 0) <= 0;
  return (
    <Card className="relative overflow-hidden">
      <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-400 to-primary/50" />
      <CardContent className="flex h-full flex-col gap-3 p-6">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">Wallet {props.payer}</span>
          <Coins className="size-4 text-amber-500" />
        </div>
        <div>
          <div className="text-3xl font-bold tracking-tight tabular-nums">{fmt(props.available ?? 0)}</div>
          <div className="text-xs text-muted-foreground">crediti disponibili</div>
        </div>
        {empty ? (
          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            Saldo esaurito: ricarica per generare nuovi contenuti.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-muted/60 px-3 py-2">
              <div className="font-semibold tabular-nums">{fmt(props.spentMonth ?? 0)}</div>
              <div className="text-muted-foreground">spesi questo mese</div>
            </div>
            <div className="rounded-lg bg-muted/60 px-3 py-2">
              <div className="font-semibold tabular-nums">{fmt(props.spentTotal ?? 0)}</div>
              <div className="text-muted-foreground">spesi in totale</div>
            </div>
          </div>
        )}
        <Button asChild variant={empty ? 'default' : 'outline'} size="sm" className="mt-auto">
          <Link href="/wallet">{props.canTopup || empty ? 'Ricarica e movimenti' : 'Movimenti'}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function Stat(props: {
  loading: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: number;
  hint: string;
  href: string;
}) {
  const Icon = props.icon;
  return (
    <Link href={props.href}>
      <Card className="group relative h-full overflow-hidden transition-all hover:border-primary/40 hover:shadow-elevate">
        <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-primary to-primary/30" />
        <CardContent className="space-y-1 p-4">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wide">{props.label}</span>
            <Icon className="size-4 transition-colors group-hover:text-primary" />
          </div>
          <div className="text-2xl font-bold tabular-nums tracking-tight">
            {props.loading || props.value === undefined ? <Skeleton className="h-8 w-12" /> : fmt(props.value)}
          </div>
          <div className="line-clamp-2 min-h-8 text-[11px] leading-4 text-muted-foreground">{props.hint}</div>
        </CardContent>
      </Card>
    </Link>
  );
}

function CourseTile({ course: c, showCredits }: { course: DashboardCourse; showCredits: boolean }) {
  const pct = c.lessons > 0 ? Math.round((c.lessonsReady / c.lessons) * 100) : 0;
  return (
    <Link href={`/courses/${c.id}`}>
      <Card className="group h-full overflow-hidden transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-elevate motion-reduce:transform-none">
        <div className="relative h-32 w-full overflow-hidden bg-gradient-to-br from-primary/20 via-accent to-primary/5">
          {c.coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={c.coverImageUrl}
              alt=""
              loading="lazy"
              className="size-full object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transform-none"
              style={{ objectPosition: `50% ${c.coverPosition ?? 50}%` }}
            />
          ) : (
            <div className="grid size-full place-items-center text-primary/40">
              <BookOpen className="size-10" />
            </div>
          )}
          <div className="absolute left-2 top-2 flex gap-1.5">
            {c.generating && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground shadow">
                <Loader2 className="size-3 motion-safe:animate-spin" /> In generazione
              </span>
            )}
            {!c.generating && c.needsAttention && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-medium text-white shadow">
                <AlertTriangle className="size-3" /> Da completare
              </span>
            )}
          </div>
          <div className="absolute right-2 top-2">
            <EditorialStatusBadge status={c.status} />
          </div>
        </div>
        <CardContent className="space-y-3 p-4">
          <div>
            <h3 className="line-clamp-2 font-semibold leading-snug">{c.title}</h3>
            <p className="line-clamp-1 text-xs text-muted-foreground">{c.description || 'Nessuna descrizione'}</p>
          </div>
          <div>
            <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
              <span>
                {c.lessonsReady} di {c.lessons} lezioni pronte
              </span>
              <span className="tabular-nums">{pct}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Video className="size-3" /> {c.videos} video
            </span>
            <span>{c.modules} moduli</span>
            {showCredits && c.credits > 0 && (
              <span className="ml-auto inline-flex items-center gap-1 font-medium text-foreground">
                <Coins className="size-3 text-amber-500" /> {fmt(c.credits)}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function EmptyCourses() {
  return (
    <Card className="relative overflow-hidden border-dashed">
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 size-64 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
      <CardContent className="relative flex flex-col items-center gap-4 py-16 text-center">
        <div className="brand-glow grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground motion-safe:animate-pulse">
          <Sparkles className="size-8" />
        </div>
        <div className="max-w-md space-y-1">
          <p className="text-lg font-semibold">Il tuo primo corso è a un clic</p>
          <p className="text-sm text-muted-foreground">
            Racconta l&apos;argomento e il pubblico: struttura, lezioni, test e copertina arrivano senza altri passaggi.
          </p>
        </div>
        <Button asChild className="brand-glow">
          <Link href="/courses/new">
            <Plus className="size-4" /> Crea il primo corso
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function EmptyVideos() {
  return (
    <Card className="mt-4 border-dashed">
      <CardContent className="flex flex-col items-center gap-3 py-8 text-center sm:flex-row sm:text-left">
        <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
          <Video className="size-6" />
        </div>
        <div className="flex-1">
          <p className="font-semibold">Nessun video ancora</p>
          <p className="text-sm text-muted-foreground">
            Carica un video o crea un avatar per aggiungere lezioni video ai tuoi corsi.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/videos">Carica un video</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/settings/avatars">Crea un avatar</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Quick({ href, icon: Icon, title, text }: { href: string; icon: React.ComponentType<{ className?: string }>; title: string; text: string }) {
  return (
    <Link href={href}>
      <Card className="group transition-all hover:border-primary/40 hover:shadow-elevate">
        <CardContent className="flex items-center gap-3 p-4">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
            <Icon className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold">{title}</div>
            <div className="truncate text-xs text-muted-foreground">{text}</div>
          </div>
          <ArrowRight className="ml-auto size-4 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
        </CardContent>
      </Card>
    </Link>
  );
}
