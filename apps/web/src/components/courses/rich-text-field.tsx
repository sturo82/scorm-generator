'use client';

import * as React from 'react';
import { Bold, Italic, Underline, List, Link2, Heading } from 'lucide-react';

/**
 * Campo rich-text minimale e senza dipendenze: area contenteditable con una
 * toolbar essenziale (grassetto, corsivo, sottolineato, elenco, link, titolo).
 * Emette HTML (string). La sanificazione avviene lato server all'export, come
 * per il resto dei contenuti. Pensato per l'editor dei block.
 */
export function RichTextField({
  value,
  onChange,
  placeholder,
  minHeight = 72,
  ariaLabel,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  ariaLabel?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  // Allinea il contenuto solo quando cambia dall'esterno (non a ogni keystroke:
  // riscrivere innerHTML sposterebbe il cursore).
  React.useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== value) el.innerHTML = value || '';
  }, [value]);

  function emit() {
    if (ref.current) onChange(ref.current.innerHTML);
  }

  function cmd(command: string, arg?: string) {
    ref.current?.focus();
    // execCommand è deprecato ma resta il modo più semplice e senza dipendenze
    // per un rich-text basilare; l'output HTML è sanificato lato server.
    document.execCommand(command, false, arg);
    emit();
  }

  function addLink() {
    const url = window.prompt('URL del link (https://…)');
    if (url) cmd('createLink', url);
  }

  const btn =
    'grid size-7 place-items-center rounded hover:bg-accent/60 text-foreground/80';

  return (
    <div className="rounded-md border bg-background">
      <div className="flex items-center gap-0.5 border-b px-1 py-1" role="toolbar" aria-label="Formattazione">
        <button type="button" className={btn} title="Grassetto" aria-label="Grassetto" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('bold')}>
          <Bold className="size-3.5" />
        </button>
        <button type="button" className={btn} title="Corsivo" aria-label="Corsivo" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('italic')}>
          <Italic className="size-3.5" />
        </button>
        <button type="button" className={btn} title="Sottolineato" aria-label="Sottolineato" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('underline')}>
          <Underline className="size-3.5" />
        </button>
        <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
        <button type="button" className={btn} title="Elenco puntato" aria-label="Elenco puntato" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('insertUnorderedList')}>
          <List className="size-3.5" />
        </button>
        <button type="button" className={btn} title="Titolo" aria-label="Titolo" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('formatBlock', 'H3')}>
          <Heading className="size-3.5" />
        </button>
        <button type="button" className={btn} title="Link" aria-label="Inserisci link" onMouseDown={(e) => e.preventDefault()} onClick={addLink}>
          <Link2 className="size-3.5" />
        </button>
      </div>
      <div
        ref={ref}
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        onBlur={emit}
        data-placeholder={placeholder}
        className="rich-field px-3 py-2 text-sm outline-none [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:text-base [&_h3]:font-semibold [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5"
        style={{ minHeight }}
      />
    </div>
  );
}
