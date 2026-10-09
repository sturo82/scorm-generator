'use client';

import * as React from 'react';
import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import type { Block as BlockType } from '@scorm/contracts';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { RichTextField } from '@/components/courses/rich-text-field';

/** Tipi di block coperti dal form visuale (Fase 1). Gli altri usano il JSON. */
export const FORM_EDITABLE_TYPES = [
  'rich_text',
  'flashcard',
  'accordion_tabs',
  'timeline',
  'carousel_steps',
  'click_reveal',
  'dragdrop_match',
  'dragdrop_order',
  'sorting_categories',
  'branching_scenario',
] as const;

export function isFormEditable(type: string): boolean {
  return (FORM_EDITABLE_TYPES as readonly string[]).includes(type);
}

type Payload = Record<string, unknown>;
const rt = (html = ''): { format: 'html'; html: string } => ({ format: 'html', html });
const uid = (): string => crypto.randomUUID();

/** Sposta un elemento dell'array da `from` a `to` (ritorna nuovo array). */
function move<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const copy = arr.slice();
  const [it] = copy.splice(from, 1);
  copy.splice(to, 0, it!);
  return copy;
}

/**
 * Editor visuale per-tipo dei block (Fase 1). Lavora su una copia del payload e
 * notifica onChange a ogni modifica; il dialog valida con lo schema Zod e salva.
 */
export function BlockFormEditor({
  block,
  onChange,
}: {
  block: BlockType;
  onChange: (payload: Payload) => void;
}) {
  const [payload, setPayload] = React.useState<Payload>(() => structuredClone(block.payload as Payload));

  // Riallinea se cambia il block (apertura su un altro elemento).
  React.useEffect(() => {
    setPayload(structuredClone(block.payload as Payload));
  }, [block]);

  const update = React.useCallback(
    (next: Payload) => {
      setPayload(next);
      onChange(next);
    },
    [onChange],
  );

  switch (block.type) {
    case 'rich_text':
      return <RichTextForm payload={payload} update={update} />;
    case 'flashcard':
      return <FlashcardForm payload={payload} update={update} />;
    case 'accordion_tabs':
      return <AccordionTabsForm payload={payload} update={update} />;
    case 'timeline':
      return <TimelineForm payload={payload} update={update} />;
    case 'carousel_steps':
      return <CarouselForm payload={payload} update={update} />;
    case 'click_reveal':
      return <ClickRevealForm payload={payload} update={update} />;
    case 'dragdrop_match':
      return <MatchForm payload={payload} update={update} />;
    case 'dragdrop_order':
      return <OrderForm payload={payload} update={update} />;
    case 'sorting_categories':
      return <SortingForm payload={payload} update={update} />;
    case 'branching_scenario':
      return <ScenarioForm payload={payload} update={update} />;
    default:
      return null;
  }
}

/** Campo "consegna" (prompt) comune ai block valutabili. */
function PromptField({ payload, update }: { payload: Payload; update: (p: Payload) => void }) {
  return (
    <div className="space-y-1">
      <Label>Consegna</Label>
      <Input
        value={(payload.prompt as string) ?? ''}
        placeholder="Istruzione per lo studente (es. «Abbina ogni voce…»)"
        onChange={(e) => update({ ...payload, prompt: e.target.value })}
      />
    </div>
  );
}

/* --- Riquadro riusabile di un elemento di lista (header + frecce + elimina) -- */
function ItemCard({
  title,
  index,
  total,
  onUp,
  onDown,
  onRemove,
  children,
}: {
  title: string;
  index: number;
  total: number;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
        <div className="flex items-center gap-0.5">
          <Button size="icon" variant="ghost" aria-label="Sposta su" disabled={index === 0} onClick={onUp}>
            <ChevronUp className="size-4" />
          </Button>
          <Button size="icon" variant="ghost" aria-label="Sposta giù" disabled={index === total - 1} onClick={onDown}>
            <ChevronDown className="size-4" />
          </Button>
          <Button size="icon" variant="ghost" aria-label="Elimina" onClick={onRemove}>
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      </div>
      {children}
    </div>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="outline" size="sm" className="w-full border-dashed" onClick={onClick}>
      <Plus className="size-4" /> {label}
    </Button>
  );
}

/* ----------------------------- rich_text ---------------------------------- */
function RichTextForm({ payload, update }: { payload: Payload; update: (p: Payload) => void }) {
  const content = (payload.content as { html?: string }) ?? {};
  return (
    <div className="space-y-2">
      <Label>Testo</Label>
      <RichTextField
        value={content.html ?? ''}
        ariaLabel="Contenuto testo"
        minHeight={160}
        onChange={(html) => update({ ...payload, content: rt(html) })}
      />
      <p className="text-xs text-muted-foreground">
        Le immagini di questo blocco si impostano con «Immagini stock» o la generazione AI.
      </p>
    </div>
  );
}

/* ------------------------------ flashcard --------------------------------- */
interface Card { id: string; front: { html: string }; back: { html: string } }
function FlashcardForm({ payload, update }: { payload: Payload; update: (p: Payload) => void }) {
  const cards = (payload.cards as Card[]) ?? [];
  const set = (next: Card[]) => update({ ...payload, cards: next });
  return (
    <div className="space-y-3">
      {cards.map((c, i) => (
        <ItemCard
          key={c.id}
          title={`Carta ${i + 1}`}
          index={i}
          total={cards.length}
          onUp={() => set(move(cards, i, i - 1))}
          onDown={() => set(move(cards, i, i + 1))}
          onRemove={() => set(cards.filter((_, j) => j !== i))}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Fronte (domanda)</Label>
              <RichTextField value={c.front?.html ?? ''} ariaLabel={`Fronte carta ${i + 1}`} onChange={(html) => set(cards.map((x, j) => (j === i ? { ...x, front: rt(html) } : x)))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Retro (risposta)</Label>
              <RichTextField value={c.back?.html ?? ''} ariaLabel={`Retro carta ${i + 1}`} onChange={(html) => set(cards.map((x, j) => (j === i ? { ...x, back: rt(html) } : x)))} />
            </div>
          </div>
        </ItemCard>
      ))}
      <AddButton label="Aggiungi carta" onClick={() => set([...cards, { id: uid(), front: rt(), back: rt() }])} />
    </div>
  );
}

/* --------------------------- accordion_tabs ------------------------------- */
interface Panel { id: string; title: string; content: { html: string } }
function AccordionTabsForm({ payload, update }: { payload: Payload; update: (p: Payload) => void }) {
  const panels = (payload.panels as Panel[]) ?? [];
  const variant = (payload.variant as string) === 'tabs' ? 'tabs' : 'accordion';
  const set = (next: Panel[]) => update({ ...payload, panels: next });
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Tipo:</span>
        <select
          value={variant}
          onChange={(e) => update({ ...payload, variant: e.target.value })}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="accordion">Accordion</option>
          <option value="tabs">Tab</option>
        </select>
      </label>
      {panels.map((p, i) => (
        <ItemCard
          key={p.id}
          title={`Pannello ${i + 1}`}
          index={i}
          total={panels.length}
          onUp={() => set(move(panels, i, i - 1))}
          onDown={() => set(move(panels, i, i + 1))}
          onRemove={() => set(panels.filter((_, j) => j !== i))}
        >
          <div className="space-y-2">
            <Input value={p.title} placeholder="Titolo del pannello" onChange={(e) => set(panels.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
            <RichTextField value={p.content?.html ?? ''} ariaLabel={`Contenuto pannello ${i + 1}`} onChange={(html) => set(panels.map((x, j) => (j === i ? { ...x, content: rt(html) } : x)))} />
          </div>
        </ItemCard>
      ))}
      <AddButton label="Aggiungi pannello" onClick={() => set([...panels, { id: uid(), title: '', content: rt() }])} />
    </div>
  );
}

/* ------------------------------- timeline --------------------------------- */
interface Ev { id: string; date: string; title: string; content: { html: string } }
function TimelineForm({ payload, update }: { payload: Payload; update: (p: Payload) => void }) {
  const events = (payload.events as Ev[]) ?? [];
  const set = (next: Ev[]) => update({ ...payload, events: next });
  return (
    <div className="space-y-3">
      {events.map((ev, i) => (
        <ItemCard
          key={ev.id}
          title={`Tappa ${i + 1}`}
          index={i}
          total={events.length}
          onUp={() => set(move(events, i, i - 1))}
          onDown={() => set(move(events, i, i + 1))}
          onRemove={() => set(events.filter((_, j) => j !== i))}
        >
          <div className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-[140px_1fr]">
              <Input value={ev.date} placeholder="Data / periodo" onChange={(e) => set(events.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} />
              <Input value={ev.title} placeholder="Titolo della tappa" onChange={(e) => set(events.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
            </div>
            <RichTextField value={ev.content?.html ?? ''} ariaLabel={`Contenuto tappa ${i + 1}`} onChange={(html) => set(events.map((x, j) => (j === i ? { ...x, content: rt(html) } : x)))} />
          </div>
        </ItemCard>
      ))}
      <AddButton label="Aggiungi tappa" onClick={() => set([...events, { id: uid(), date: '', title: '', content: rt() }])} />
    </div>
  );
}

/* --------------------------- carousel_steps ------------------------------- */
interface Step { id: string; title: string; content: { html: string } }
function CarouselForm({ payload, update }: { payload: Payload; update: (p: Payload) => void }) {
  const steps = (payload.steps as Step[]) ?? [];
  const set = (next: Step[]) => update({ ...payload, steps: next });
  return (
    <div className="space-y-3">
      {steps.map((s, i) => (
        <ItemCard
          key={s.id}
          title={`Passo ${i + 1}`}
          index={i}
          total={steps.length}
          onUp={() => set(move(steps, i, i - 1))}
          onDown={() => set(move(steps, i, i + 1))}
          onRemove={() => set(steps.filter((_, j) => j !== i))}
        >
          <div className="space-y-2">
            <Input value={s.title} placeholder="Titolo del passo" onChange={(e) => set(steps.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
            <RichTextField value={s.content?.html ?? ''} ariaLabel={`Contenuto passo ${i + 1}`} onChange={(html) => set(steps.map((x, j) => (j === i ? { ...x, content: rt(html) } : x)))} />
          </div>
        </ItemCard>
      ))}
      <AddButton label="Aggiungi passo" onClick={() => set([...steps, { id: uid(), title: '', content: rt() }])} />
    </div>
  );
}

/* ---------------------------- click_reveal -------------------------------- */
interface Reveal { id: string; trigger: string; content: { html: string } }
function ClickRevealForm({ payload, update }: { payload: Payload; update: (p: Payload) => void }) {
  const items = (payload.items as Reveal[]) ?? [];
  const set = (next: Reveal[]) => update({ ...payload, items: next });
  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <ItemCard
          key={it.id}
          title={`Elemento ${i + 1}`}
          index={i}
          total={items.length}
          onUp={() => set(move(items, i, i - 1))}
          onDown={() => set(move(items, i, i + 1))}
          onRemove={() => set(items.filter((_, j) => j !== i))}
        >
          <div className="space-y-2">
            <Input value={it.trigger} placeholder="Testo del trigger (ciò che si clicca)" onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, trigger: e.target.value } : x)))} />
            <RichTextField value={it.content?.html ?? ''} ariaLabel={`Contenuto rivelato ${i + 1}`} onChange={(html) => set(items.map((x, j) => (j === i ? { ...x, content: rt(html) } : x)))} />
          </div>
        </ItemCard>
      ))}
      <AddButton label="Aggiungi elemento" onClick={() => set([...items, { id: uid(), trigger: '', content: rt() }])} />
    </div>
  );
}

/* --------------------------- dragdrop_match ------------------------------- */
interface Pair { id: string; left: string; right: string }
function MatchForm({ payload, update }: { payload: Payload; update: (p: Payload) => void }) {
  const pairs = (payload.pairs as Pair[]) ?? [];
  const set = (next: Pair[]) => update({ ...payload, pairs: next });
  return (
    <div className="space-y-3">
      <PromptField payload={payload} update={update} />
      <Label className="pt-1">Coppie da abbinare</Label>
      {pairs.map((p, i) => (
        <ItemCard
          key={p.id}
          title={`Coppia ${i + 1}`}
          index={i}
          total={pairs.length}
          onUp={() => set(move(pairs, i, i - 1))}
          onDown={() => set(move(pairs, i, i + 1))}
          onRemove={() => set(pairs.filter((_, j) => j !== i))}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <Input value={p.left} placeholder="Voce (sinistra)" onChange={(e) => set(pairs.map((x, j) => (j === i ? { ...x, left: e.target.value } : x)))} />
            <Input value={p.right} placeholder="Corrispondenza (destra)" onChange={(e) => set(pairs.map((x, j) => (j === i ? { ...x, right: e.target.value } : x)))} />
          </div>
        </ItemCard>
      ))}
      <AddButton label="Aggiungi coppia" onClick={() => set([...pairs, { id: uid(), left: '', right: '' }])} />
      <p className="text-xs text-muted-foreground">Servono almeno 2 coppie.</p>
    </div>
  );
}

/* --------------------------- dragdrop_order ------------------------------- */
interface OrderItem { id: string; label: string; correctPosition: number }
function OrderForm({ payload, update }: { payload: Payload; update: (p: Payload) => void }) {
  const items = (payload.items as OrderItem[]) ?? [];
  // L'ordine corretto è l'ordine in cui compaiono: correctPosition = indice+1.
  const set = (next: OrderItem[]) =>
    update({ ...payload, items: next.map((it, i) => ({ ...it, correctPosition: i + 1 })) });
  return (
    <div className="space-y-3">
      <PromptField payload={payload} update={update} />
      <Label className="pt-1">Elementi (nell&apos;ordine CORRETTO)</Label>
      <p className="text-xs text-muted-foreground">
        Disponi gli elementi nella sequenza giusta con le frecce: il player li mescola allo studente.
      </p>
      {items.map((it, i) => (
        <ItemCard
          key={it.id}
          title={`Posizione ${i + 1}`}
          index={i}
          total={items.length}
          onUp={() => set(move(items, i, i - 1))}
          onDown={() => set(move(items, i, i + 1))}
          onRemove={() => set(items.filter((_, j) => j !== i))}
        >
          <Input value={it.label} placeholder="Testo dell'elemento" onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
        </ItemCard>
      ))}
      <AddButton label="Aggiungi elemento" onClick={() => set([...items, { id: uid(), label: '', correctPosition: items.length + 1 }])} />
      <p className="text-xs text-muted-foreground">Servono almeno 2 elementi.</p>
    </div>
  );
}

/* -------------------------- sorting_categories ---------------------------- */
interface SCat { id: string; label: string }
interface SItem { id: string; label: string; categoryId: string }
function SortingForm({ payload, update }: { payload: Payload; update: (p: Payload) => void }) {
  const categories = (payload.categories as SCat[]) ?? [];
  const items = (payload.items as SItem[]) ?? [];
  const setCats = (next: SCat[]) => update({ ...payload, categories: next });
  const setItems = (next: SItem[]) => update({ ...payload, items: next });
  return (
    <div className="space-y-4">
      <PromptField payload={payload} update={update} />

      <div className="space-y-2">
        <Label>Categorie</Label>
        {categories.map((c, i) => (
          <div key={c.id} className="flex items-center gap-2">
            <Input value={c.label} placeholder={`Categoria ${i + 1}`} onChange={(e) => setCats(categories.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <Button size="icon" variant="ghost" aria-label="Elimina categoria" onClick={() => setCats(categories.filter((_, j) => j !== i))}>
              <Trash2 className="size-4 text-destructive" />
            </Button>
          </div>
        ))}
        <AddButton label="Aggiungi categoria" onClick={() => setCats([...categories, { id: uid(), label: '' }])} />
        <p className="text-xs text-muted-foreground">Servono almeno 2 categorie.</p>
      </div>

      <div className="space-y-2">
        <Label>Elementi da classificare</Label>
        {items.map((it, i) => (
          <ItemCard
            key={it.id}
            title={`Elemento ${i + 1}`}
            index={i}
            total={items.length}
            onUp={() => setItems(move(items, i, i - 1))}
            onDown={() => setItems(move(items, i, i + 1))}
            onRemove={() => setItems(items.filter((_, j) => j !== i))}
          >
            <div className="grid gap-2 sm:grid-cols-[1fr_180px]">
              <Input value={it.label} placeholder="Testo dell'elemento" onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <select
                value={it.categoryId}
                onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, categoryId: e.target.value } : x)))}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="">— categoria —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.label || 'senza nome'}</option>
                ))}
              </select>
            </div>
          </ItemCard>
        ))}
        <AddButton label="Aggiungi elemento" onClick={() => setItems([...items, { id: uid(), label: '', categoryId: categories[0]?.id ?? '' }])} />
        <p className="text-xs text-muted-foreground">Servono almeno 2 elementi, ciascuno assegnato a una categoria.</p>
      </div>
    </div>
  );
}

/* -------------------------- branching_scenario ---------------------------- */
interface Choice { id: string; label: string; nextNodeId?: string; feedback?: string }
interface Node { id: string; content: { html: string }; choices: Choice[] }
function ScenarioForm({ payload, update }: { payload: Payload; update: (p: Payload) => void }) {
  const nodes = (payload.nodes as Node[]) ?? [];
  const startNodeId = (payload.startNodeId as string) ?? nodes[0]?.id ?? '';
  const setNodes = (next: Node[]) => update({ ...payload, nodes: next });

  const nodeLabel = (n: Node, i: number): string => {
    const txt = (n.content?.html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return `Nodo ${i + 1}${txt ? ` — ${txt.slice(0, 24)}` : ''}`;
  };

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Nodo iniziale:</span>
        <select
          value={startNodeId}
          onChange={(e) => update({ ...payload, startNodeId: e.target.value })}
          className="h-9 flex-1 rounded-md border bg-background px-2 text-sm"
        >
          {nodes.map((n, i) => (
            <option key={n.id} value={n.id}>{nodeLabel(n, i)}</option>
          ))}
        </select>
      </label>

      {nodes.map((n, i) => (
        <ItemCard
          key={n.id}
          title={`Nodo ${i + 1}${n.id === startNodeId ? ' · iniziale' : ''}`}
          index={i}
          total={nodes.length}
          onUp={() => setNodes(move(nodes, i, i - 1))}
          onDown={() => setNodes(move(nodes, i, i + 1))}
          onRemove={() => setNodes(nodes.filter((_, j) => j !== i))}
        >
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Contenuto / domanda</Label>
            <RichTextField value={n.content?.html ?? ''} ariaLabel={`Contenuto nodo ${i + 1}`} onChange={(html) => setNodes(nodes.map((x, j) => (j === i ? { ...x, content: rt(html) } : x)))} />
            <Label className="text-xs text-muted-foreground">Scelte</Label>
            {(n.choices ?? []).map((ch, ci) => (
              <div key={ch.id} className="rounded-md border p-2">
                <div className="mb-1 flex items-center gap-2">
                  <Input value={ch.label} placeholder={`Scelta ${ci + 1}`} onChange={(e) => setNodes(nodes.map((x, j) => (j === i ? { ...x, choices: x.choices.map((y, k) => (k === ci ? { ...y, label: e.target.value } : y)) } : x)))} />
                  <Button size="icon" variant="ghost" aria-label="Elimina scelta" onClick={() => setNodes(nodes.map((x, j) => (j === i ? { ...x, choices: x.choices.filter((_, k) => k !== ci) } : x)))}>
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Porta a:
                  <select
                    value={ch.nextNodeId ?? ''}
                    onChange={(e) => setNodes(nodes.map((x, j) => (j === i ? { ...x, choices: x.choices.map((y, k) => (k === ci ? { ...y, nextNodeId: e.target.value || undefined } : y)) } : x)))}
                    className="h-8 flex-1 rounded-md border bg-background px-2 text-sm"
                  >
                    <option value="">Fine (esito terminale)</option>
                    {nodes.map((nn, ni) => (
                      <option key={nn.id} value={nn.id}>{nodeLabel(nn, ni)}</option>
                    ))}
                  </select>
                </label>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setNodes(nodes.map((x, j) => (j === i ? { ...x, choices: [...(x.choices ?? []), { id: uid(), label: '' }] } : x)))}
            >
              <Plus className="size-4" /> Scelta
            </Button>
          </div>
        </ItemCard>
      ))}
      <AddButton label="Aggiungi nodo" onClick={() => setNodes([...nodes, { id: uid(), content: rt(), choices: [] }])} />
    </div>
  );
}
