'use client';

import { Label } from '@/components/ui/input';
import { cn } from '@/lib/cn';

interface ColorInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  id?: string;
  placeholder?: string;
}

/**
 * Selettore colore: color picker nativo + campo esadecimale sincronizzati.
 */
export function ColorInput({ label, value, onChange, id, placeholder }: ColorInputProps) {
  const safe = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value) ? value : '#000000';
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} selettore`}
          value={safe}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="size-10 shrink-0 cursor-pointer rounded-md border border-input bg-background p-1"
        />
        <input
          id={id}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            'h-10 w-full rounded-md border border-input bg-background px-3 font-mono text-sm uppercase shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        />
      </div>
    </div>
  );
}
