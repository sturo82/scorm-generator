import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}

/** Checkbox accessibile a toggle, con label cliccabile. */
export function Checkbox({ checked, onChange, label, disabled, className }: CheckboxProps) {
  return (
    <label
      className={cn('inline-flex cursor-pointer items-center gap-2 text-sm', disabled && 'opacity-50', className)}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'grid size-5 place-items-center rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background',
        )}
      >
        {checked && <Check className="size-3.5" />}
      </button>
      {label}
    </label>
  );
}
