import Link from 'next/link';
import { ArrowRight, Sparkles, ShieldCheck, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Landing premium. Punto di ingresso: presenta il prodotto e porta all'area di
 * lavoro. Il routing autenticato vero è nella sezione (app).
 */
export default function HomePage() {
  return (
    <main className="min-h-dvh">
      {/* Header d'ecosistema: barra sticky scura semi-trasparente con blur e
          bordo sottile (coerente con manager.knowkube.com). Accenti = verde K Scorm. */}
      <header className="sticky top-0 z-30 border-b border-border bg-card/72 backdrop-blur-md backdrop-saturate-150">
        <div className="container flex items-center justify-between py-4">
          <div className="flex items-center gap-2.5 font-semibold">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/kscorm-icon.png" alt="K Scorm" className="size-9 rounded-lg object-contain" />
            K Scorm
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard">Entra</Link>
          </Button>
        </div>
      </header>

      <section className="container flex flex-col items-center gap-6 py-20 text-center md:py-28">
        <span className="rounded-full border bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
          AI · Knowledge · Branding · SCORM
        </span>
        <h1 className="max-w-3xl text-balance text-4xl font-bold tracking-tight md:text-6xl">
          Corsi e-learning professionali, generati con l&apos;AI.
        </h1>
        <p className="max-w-xl text-pretty text-muted-foreground md:text-lg">
          Da un brief alla pubblicazione: lezioni interattive, test, branding multiplo e export SCORM
          importabile su qualsiasi LMS.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/dashboard">
              Inizia ora <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </section>

      <section className="container grid gap-4 pb-24 md:grid-cols-3">
        {[
          { icon: Sparkles, title: 'Generazione AI', desc: 'Outline, lezioni e test dal tuo brief, ancorati alla tua knowledge.' },
          { icon: Palette, title: 'Branding multiplo', desc: 'Lo stesso corso, N brand: colori, logo e font applicati in export.' },
          { icon: ShieldCheck, title: 'Enterprise & SCORM', desc: 'Multi-tenant sicuro, revisione umana, pacchetti SCORM 2004 e 1.2.' },
        ].map((f) => (
          <Card key={f.title}>
            <CardContent className="flex flex-col gap-3 p-6">
              <div className="grid size-10 place-items-center rounded-lg bg-accent text-accent-foreground">
                <f.icon className="size-5" />
              </div>
              <h3 className="font-semibold">{f.title}</h3>
              <p className="text-sm text-muted-foreground">{f.desc}</p>
            </CardContent>
          </Card>
        ))}
      </section>
    </main>
  );
}
