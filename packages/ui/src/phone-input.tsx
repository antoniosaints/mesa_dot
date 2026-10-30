import { MaskInput } from 'maska';
import { useId, useLayoutEffect, useRef, useState } from 'react';

/** Uses the same Maska engine as v-maska, adapted to the React application. */
export function PhoneInput({
  value,
  onChange,
  name = 'phone',
  required = false,
}: {
  value: string;
  onChange: (value: string) => void;
  name?: string;
  required?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null),
    mask = useRef<MaskInput | null>(null);
  const current = useRef({ onChange, required });
  current.current = { onChange, required };
  const emitted = useRef(value),
    [initial] = useState(value),
    [error, setError] = useState(''),
    errorId = useId();
  function validate(raw: string) {
    const message =
      (!raw && !current.current.required) || /^\d{10,11}$/.test(raw)
        ? ''
        : 'Informe o telefone com DDD (10 ou 11 dígitos).';
    input.current?.setCustomValidity(message);
    return message;
  }
  useLayoutEffect(() => {
    const field = input.current!;
    mask.current = new MaskInput(field, {
      mask: ['(##) ####-####', '(##) #####-####'],
      preProcess: (raw) => {
        const digits = raw.replace(/\D/g, '');
        // Accept pasted Brazilian numbers with country code, including autofill.
        return digits.startsWith('55') && [12, 13].includes(digits.length)
          ? digits.slice(2)
          : digits;
      },
      onMaska: ({ unmasked }) => {
        emitted.current = unmasked;
        const message = validate(unmasked);
        setError((previous) => (previous ? message : ''));
        current.current.onChange(unmasked);
      },
    });
    validate(emitted.current);
    return () => {
      mask.current?.destroy();
      mask.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    if (value !== emitted.current) {
      input.current!.value = value;
      mask.current?.updateValue(input.current!);
      emitted.current = input.current!.value.replace(/\D/g, '');
      setError('');
    }
    validate(emitted.current);
  }, [value, required]);
  return (
    <>
      <input
        ref={input}
        name={name}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        aria-label="Telefone"
        placeholder="(00) 00000-0000"
        required={required}
        maxLength={25}
        defaultValue={initial}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onBlur={() => setError(validate(emitted.current))}
        onInvalid={() => setError(validate(emitted.current))}
      />
      {error && (
        <span className="field-error" id={errorId} role="alert">
          {error}
        </span>
      )}
    </>
  );
}
