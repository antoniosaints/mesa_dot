import { MaskInput } from 'maska';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import {
  formatNumericInput,
  normalizeNumericValue,
  prepareNumericInput,
  type NumericRules,
} from './numeric.js';
export function NumericInput({
  label,
  value,
  onChange,
  required = false,
  disabled = false,
  placeholder,
  precision = 3,
  maxIntegerDigits = 11,
  signed = false,
  positive = false,
  min,
  max,
  prefix,
  id,
  describedBy,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  precision?: NumericRules['precision'];
  maxIntegerDigits?: number;
  signed?: boolean;
  positive?: boolean;
  min?: string | number;
  max?: string | number;
  prefix?: string;
  id?: string;
  describedBy?: string;
}) {
  const rules: NumericRules = {
    precision,
    maxIntegerDigits,
    signed,
    positive,
    min,
    max,
    currency: Boolean(prefix),
  };
  const current = useRef({ rules, required, disabled, onChange });
  current.current = { rules, required, disabled, onChange };
  const element = useRef<HTMLInputElement>(null),
    emitted = useRef(value),
    rejected = useRef(''),
    display = useRef('');
  const [initialDisplay] = useState(() => {
    try {
      return formatNumericInput(value, rules, Boolean(prefix));
    } catch {
      return value;
    }
  });
  const [error, setError] = useState(''),
    errorId = useId();
  function validate(raw: string) {
    const input = element.current!;
    let message = rejected.current;
    if (!current.current.disabled && !message) {
      if (!raw && current.current.required) message = 'Informe um valor numérico.';
      else if (raw)
        try {
          normalizeNumericValue(raw, current.current.rules);
        } catch (e) {
          message = (e as Error).message;
        }
    }
    if (current.current.disabled) message = '';
    input.setCustomValidity(message);
    return message;
  }
  useLayoutEffect(() => {
    const input = element.current!;
    display.current = input.value;
    const inspect = (event: Event) => {
      if (event instanceof CustomEvent) return;
      try {
        prepareNumericInput(input.value, current.current.rules);
        rejected.current = '';
      } catch (e) {
        rejected.current = (e as Error).message;
      }
    };
    inspect(new Event('input'));
    input.addEventListener('input', inspect, { capture: true });
    const mask = new MaskInput(input, {
      number: { locale: 'pt-BR', fraction: precision, unsigned: !signed },
      preProcess: (raw) => {
        try {
          return prepareNumericInput(raw, current.current.rules);
        } catch {
          return display.current;
        }
      },
      // Editable values never contain thousands dots: typing 1.250 always means 1,250.
      postProcess: (masked) =>
        current.current.rules.currency && document.activeElement !== input
          ? masked
          : masked.replace(/\./g, ''),
      onMaska: ({ unmasked, masked }) => {
        if (rejected.current) {
          input.value = display.current;
          setError(validate(emitted.current));
          return;
        }
        let next = unmasked;
        if (next && next !== '-')
          try {
            next = normalizeNumericValue(next, {
              ...current.current.rules,
              positive: false,
              min: undefined,
              max: undefined,
            });
          } catch {
            /* Incomplete values remain editable, but cannot be submitted. */
          }
        emitted.current = next;
        display.current = masked;
        const message = validate(next);
        setError((previous) => (previous ? message : ''));
        current.current.onChange(next);
      },
    });
    validate(emitted.current);
    return () => {
      input.removeEventListener('input', inspect, { capture: true });
      mask.destroy();
    };
  }, [precision, signed]);
  useLayoutEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    rejected.current = '';
    try {
      element.current!.value = formatNumericInput(
        value,
        current.current.rules,
        Boolean(prefix) && document.activeElement !== element.current,
      );
    } catch {
      element.current!.value = value;
    }
    display.current = element.current!.value;
    validate(value);
    setError('');
  }, [value]);
  useLayoutEffect(() => {
    const message = validate(emitted.current);
    setError((previous) => (previous ? message : ''));
  }, [required, disabled, positive, min, max, maxIntegerDigits]);
  const input = (
    <input
      ref={element}
      id={id}
      type="text"
      aria-label={label}
      inputMode={precision ? 'decimal' : 'numeric'}
      required={required}
      disabled={disabled}
      placeholder={placeholder ?? (precision ? '0,' + '0'.repeat(precision) : '0')}
      defaultValue={initialDisplay}
      aria-invalid={error ? true : undefined}
      aria-describedby={[describedBy, error ? errorId : ''].filter(Boolean).join(' ') || undefined}
      onInvalid={() => setError(element.current!.validationMessage)}
      onFocus={() => {
        if (!rejected.current) {
          try {
            element.current!.value = formatNumericInput(emitted.current, current.current.rules);
            display.current = element.current!.value;
          } catch {
            /* Keep incomplete values editable. */
          }
        }
      }}
      onBlur={() => {
        const message = validate(emitted.current);
        setError(message);
        if (!message) {
          element.current!.value = formatNumericInput(
            emitted.current,
            current.current.rules,
            Boolean(prefix),
          );
          display.current = element.current!.value;
        }
      }}
    />
  );
  return (
    <>
      {prefix ? (
        <span className="money-input-control">
          <span aria-hidden="true">{prefix}</span>
          {input}
        </span>
      ) : (
        input
      )}
      {error && (
        <span className="field-error" role="alert" id={errorId}>
          {error}
        </span>
      )}
    </>
  );
}
