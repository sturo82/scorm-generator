'use client';

import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/**
 * Dialog di conferma per azioni distruttive (es. eliminazione). Mostra un
 * messaggio e due azioni; la conferma usa la variante distruttiva.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Elimina',
  cancelLabel = 'Annulla',
  loading,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <p className="text-sm text-muted-foreground">{message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={loading}>
          {cancelLabel}
        </Button>
        <Button variant="destructive" onClick={onConfirm} disabled={loading} data-testid="confirm-delete">
          {loading ? 'Elimino…' : confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
