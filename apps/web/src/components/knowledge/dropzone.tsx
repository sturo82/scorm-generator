'use client';

import * as React from 'react';
import { UploadCloud } from 'lucide-react';
import { cn } from '@/lib/cn';

interface DropzoneProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  accept?: string;
}

/**
 * Zona di upload drag&drop accessibile, senza dipendenze esterne. Supporta
 * trascinamento, click e selezione da tastiera (il label avvolge un input file).
 */
export function Dropzone({ onFiles, disabled, accept }: DropzoneProps) {
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length) onFiles(files);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      role="button"
      tabIndex={0}
      aria-disabled={disabled}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition-colors',
        dragging ? 'border-primary bg-accent' : 'border-input hover:border-primary/50 hover:bg-accent/40',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <div className="grid size-12 place-items-center rounded-full bg-accent text-accent-foreground">
        <UploadCloud className="size-6" />
      </div>
      <div>
        <p className="font-medium">Trascina i file qui o clicca per selezionarli</p>
        <p className="text-sm text-muted-foreground">PDF, DOCX, PPTX, XLSX, TXT, MD, HTML, CSV</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
