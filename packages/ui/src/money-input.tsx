import { NumericInput } from './numeric-input.js';
export function MoneyInput({
  label,
  value,
  required,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  required?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <NumericInput
      label={label}
      value={value}
      required={required}
      placeholder={placeholder ?? '0,00'}
      onChange={onChange}
      precision={2}
      maxIntegerDigits={12}
      min="0"
      prefix="R$"
    />
  );
}
