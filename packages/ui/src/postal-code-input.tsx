import { MaskInput } from 'maska';
import { useId, useLayoutEffect, useRef, useState } from 'react';
export function PostalCodeInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null),
    callback = useRef(onChange),
    emitted = useRef(value);
  callback.current = onChange;
  const [initial] = useState(value),
    [error, setError] = useState(''),
    errorId = useId();
  function validate(raw: string) {
    const message = !raw || raw.length === 8 ? '' : 'Informe um CEP com 8 dígitos.';
    input.current?.setCustomValidity(message);
    return message;
  }
  useLayoutEffect(() => {
    const field = input.current!;
    const mask = new MaskInput(field, {
      mask: '#####-###',
      onMaska: ({ unmasked }) => {
        emitted.current = unmasked;
        const message = validate(unmasked);
        setError((previous) => (previous ? message : ''));
        callback.current(unmasked);
      },
    });
    return () => mask.destroy();
  }, []);
  useLayoutEffect(() => {
    if (value !== emitted.current) {
      input.current!.value = value;
      input.current!.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, [value]);
  return (
    <>
      <input
        ref={input}
        name="postal_code"
        aria-label="CEP"
        autoComplete="postal-code"
        inputMode="numeric"
        placeholder="00000-000"
        maxLength={32}
        pattern="[0-9]{5}-[0-9]{3}"
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
