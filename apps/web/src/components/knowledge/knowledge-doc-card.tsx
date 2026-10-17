'use client';

import * as React from 'react';
import { Download, FileText, RefreshCw, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { IngestStatusBadge } from '@/components/status-badge';
import { useToast } from '@/components/ui/toast';
import { getApiClient } from '@/lib/api/client';
import { formatBytes } from '@/lib/format';
import type { KnowledgeDocView } from '@/lib/api/types';

interface KnowledgeDocCardProps {
  doc: KnowledgeDocView;
  /** Mostra l'azione di riprocessamento (solo documenti FALLITI). */
  onReprocess?: (id: string) => void;
  reprocessing?: boolean;
  /** Mostra l'azione di eliminazione. Riceve id e nome per la conferma a monte. */
  onDelete?: (id: string, name: string) => void;
  /** Badge/etichetta extra accanto al nome (es. "Fonte del corso"). */
  badge?: React.ReactNode;
}

/**
 * Riga/card di un documento knowledge, riusata dalla pagina Knowledge e dalla
 * pagina del corso. Il download (URL firmato dal backend) è sempre disponibile;
 * riprocessamento ed eliminazione sono opzionali a seconda del contesto.
 */
export function KnowledgeDocCard({
  doc,
  onReprocess,
  reprocessing,
  onDelete,
  badge,
}: KnowledgeDocCardProps) {
  const toast = useToast();
  const [downloading, setDownloading] = React.useState(false);

  async function handleDownload() {
    setDownloading(true);
    try {
      const url = await getApiClient().getKnowledgeDownloadUrl(doc.id);
      // Apre l'URL firmato: il browser scarica il file originale.
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.filename;
      a.rel = 'noopener';
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      toast.show(err instanceof Error ? err.message : 'Download non riuscito', 'error');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
          <FileText className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium">{doc.filename}</p>
            {badge}
          </div>
          <p className="text-sm text-muted-foreground">{formatBytes(doc.sizeBytes)}</p>
        </div>
        <IngestStatusBadge status={doc.status} />
        {doc.status === 'FAILED' && onReprocess && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Riprocessa documento"
            className="text-muted-foreground"
            disabled={reprocessing}
            onClick={() => onReprocess(doc.id)}
          >
            <RefreshCw className="size-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label="Scarica documento"
          className="text-muted-foreground"
          disabled={downloading}
          onClick={() => void handleDownload()}
        >
          <Download className="size-4" />
        </Button>
        {onDelete && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Elimina documento"
            className="text-muted-foreground"
            onClick={() => onDelete(doc.id, doc.filename)}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
