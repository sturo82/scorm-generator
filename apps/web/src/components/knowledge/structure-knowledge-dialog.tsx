'use client';
import { knowledgeStructureUnits } from '@scorm/contracts';
import { CreditCost } from '@/components/ui/credit-cost';

import * as React from 'react';
import { Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { AiWorkingInline } from '@/components/courses/ai-working';
import { useStructureKnowledge } from '@/lib/api/hooks';
import type { KnowledgeDocView, KnowledgeScope } from '@/lib/api/types';

/**
 * Crea una knowledge strutturata dai documenti scelti (ad esempio trascrizioni di
 * registrazioni): sintesi, argomenti, glossario e punti da chiarire, salvati come
 * nuova fonte. Il documento compare nell'elenco quando l'elaborazione termina.
 */
export function StructureKnowledgeDialog({
  open,
  onClose,
  docs,
  scope,
  courseId,
}: {
  open: boolean;
  onClose: () => void;
  docs: KnowledgeDocView[];
  scope: KnowledgeScope;
  courseId?: string;
}) {
  const toast = useToast();
  const structure = useStructureKnowledge();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [title, setTitle] = React.useState('Knowledge strutturata');

  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else if (next.size < 10) next.add(id);
      return next;
    });
  }

  async function handleCreate() {
    try {
      await structure.mutateAsync({ documentIds: [...selected], title: title.trim(), scope, courseId });
      toast.show('Elaborazione avviata: il documento comparirà tra le fonti quando è pronto', 'success');
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      toast.show(
        /non ancora pronti/i.test(msg)
          ? 'Alcuni documenti non sono ancora pronti'
          : 'Avvio dell’elaborazione non riuscito',
        'error',
      );
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Crea knowledge strutturata" size="lg">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Scegli i documenti (anche trascrizioni lunghe): l&apos;AI li riorganizza in un unico documento con
          sintesi, argomenti, concetti chiave e punti da chiarire, usando <strong>solo</strong> ciò che c&apos;è nel
          testo. Il risultato è salvato come nuova fonte e va controllato prima dell&apos;uso.
        </p>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Titolo del documento</span>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
        </label>
        <div className="space-y-1">
          <p className="text-sm font-medium">Documenti sorgente ({selected.size}/10)</p>
          <ul className="max-h-60 space-y-1 overflow-y-auto rounded-lg border p-2">
            {docs.map((d) => (
              <li key={d.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent/30">
                  <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
                  <span className="truncate">{d.filename}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Annulla
          </Button>
          <Button onClick={handleCreate} disabled={structure.isPending || selected.size === 0 || !title.trim()}>
            {structure.isPending ? <AiWorkingInline label="Avvio…" /> : (<><Wand2 className="size-4" /> Crea</>)}
            {!structure.isPending && selected.size > 0 && (
              <CreditCost
                prefix=" · fino a "
                items={[
                  {
                    feature: 'text_standard',
                    units: knowledgeStructureUnits(docs.filter((d) => selected.has(d.id)).reduce((n, d) => n + d.sizeBytes, 0)),
                  },
                ]}
              />
            )}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
