import type { CSSProperties, ReactNode } from 'react';
import { Check } from 'lucide-react';
import { recordColorStyle, validRecordColor } from './record-colors.js';

export function ColorDot({ color }: { color?: unknown }) {
  return validRecordColor(color) ? (
    <span className="record-color-dot" style={{ backgroundColor: color }} aria-hidden="true" />
  ) : null;
}
export function RecordTag({ color, children }: { color?: unknown; children: ReactNode }) {
  const light = recordColorStyle(color),
    dark = recordColorStyle(color, 'dark');
  const style =
    light && dark
      ? ({
          '--record-tag-light-bg': light.backgroundColor,
          '--record-tag-light-ink': light.color,
          '--record-tag-light-border': light.borderColor,
          '--record-tag-dark-bg': dark.backgroundColor,
          '--record-tag-dark-ink': dark.color,
          '--record-tag-dark-border': dark.borderColor,
        } as CSSProperties)
      : undefined;
  return (
    <span className="record-tag" style={style}>
      <ColorDot color={color} />
      <span className="record-tag-label">{children}</span>
    </span>
  );
}
const presets = [
  ['Azul', '#2563eb'],
  ['Verde', '#059669'],
  ['Laranja', '#ea580c'],
  ['Roxo', '#7c3aed'],
  ['Rosa', '#db2777'],
  ['Vermelho', '#dc2626'],
  ['Amarelo', '#ca8a04'],
  ['Cinza', '#64748b'],
] as const;
export const recordColorField = { key: 'color', label: 'Cor', type: 'color' as const };
export function RecordColorInput({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <div className="record-color-field" role="group" aria-label={label}>
      <span>{label}</span>
      <div className="record-color-presets">
        {presets.map(([name, hex]) => (
          <button
            key={hex}
            type="button"
            aria-label={'Cor ' + name.toLowerCase()}
            aria-pressed={value.toLowerCase() === hex}
            title={name}
            style={{ backgroundColor: hex }}
            onClick={() => onChange(hex)}
          >
            {value.toLowerCase() === hex && <Check size={16} aria-hidden="true" />}
          </button>
        ))}
      </div>
      <div className="record-color-custom">
        <input
          type="color"
          aria-label="Escolher cor personalizada"
          value={validRecordColor(value) ? value : '#2563eb'}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          aria-label="Cor hexadecimal"
          placeholder="#2563eb"
          pattern="#[0-9a-fA-F]{6}"
          maxLength={7}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" disabled={!value} onClick={() => onChange('')}>
          Remover cor
        </button>
      </div>
      <RecordTag color={value}>Prévia da identificação</RecordTag>
      <small className="field-hint">
        Opcional. A cor identifica esta categoria ou local nas listagens.
      </small>
    </div>
  );
}
