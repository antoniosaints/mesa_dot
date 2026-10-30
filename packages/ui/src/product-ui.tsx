import type { ReactNode } from 'react';
import { Info } from 'lucide-react';

export function ProductHelp({ children }: { children: ReactNode }) {
  return (
    <div className="product-help">
      <Info size={16} aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}

export function ProductToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="product-setting-toggle">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
