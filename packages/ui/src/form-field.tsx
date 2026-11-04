import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Icon } from './appearance.js';
import { useManagementInterface } from './interface-scope.js';

export function FormField({
  id,
  label,
  required,
  hint,
  error,
  checkbox = false,
  children,
  onInvalid,
  onBlur,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string;
  checkbox?: boolean;
  children: ReactNode;
  onInvalid?: (event: FormEvent<HTMLLabelElement>) => void;
  onBlur?: (event: FormEvent<HTMLLabelElement>) => void;
}) {
  return (
    <label
      htmlFor={id}
      className={['form-field', checkbox ? 'checkbox-label' : '', error ? 'has-error' : '']
        .filter(Boolean)
        .join(' ')}
      onInvalidCapture={onInvalid}
      onBlurCapture={onBlur}
    >
      <span>
        {label}
        {required && (
          <span className="required-mark" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </span>
      {children}
      {hint && (
        <small className="field-hint" id={id + '-hint'}>
          {hint}
        </small>
      )}
      {error && (
        <small className="field-error" id={id + '-error'} role="alert">
          {error}
        </small>
      )}
    </label>
  );
}

/** Native and masked controls retain their validity rules; ERP adds a focusable
 * summary. The legacy interface keeps native validation behavior. */
export function useFormValidation(resetKey?: unknown) {
  const enhanced = useManagementInterface();
  const [errors, setErrors] = useState<Record<string, { label: string; message: string }>>({});
  const summary = useRef<HTMLDivElement>(null);
  const shouldFocus = useRef(false);
  const id = useId();
  useEffect(() => {
    setErrors((previous) => (Object.keys(previous).length ? {} : previous));
  }, [resetKey]);
  // Controlled comboboxes can become valid without emitting a native input event.
  useEffect(() => {
    if (!enhanced || !Object.keys(errors).length) return;
    setErrors((previous) => {
      const next = Object.fromEntries(
        Object.entries(previous).filter(
          ([key]) => !(document.getElementById(key) as HTMLInputElement | null)?.validity?.valid,
        ),
      );
      return Object.keys(next).length === Object.keys(previous).length ? previous : next;
    });
  });
  useEffect(() => {
    if (shouldFocus.current && Object.keys(errors).length) {
      summary.current?.focus();
      shouldFocus.current = false;
    }
  }, [errors]);
  function invalid(event: FormEvent<HTMLFormElement>) {
    if (!enhanced) return;
    const field = event.target as HTMLInputElement;
    if (!field.validationMessage || !field.id) return;
    event.preventDefault();
    shouldFocus.current = true;
    setErrors((previous) => ({
      ...previous,
      [field.id]: {
        label:
          field.getAttribute('aria-label') ?? field.labels?.[0]?.textContent?.trim() ?? 'Campo',
        message: field.validationMessage,
      },
    }));
  }
  return {
    onInvalidCapture: invalid,
    summary:
      enhanced && Object.keys(errors).length ? (
        <div
          ref={summary}
          className="form-error-summary"
          tabIndex={-1}
          role="alert"
          aria-labelledby={id}
        >
          <strong id={id}>
            <Icon name="info" size={18} />
            Revise os campos para continuar
          </strong>
          <ul>
            {Object.entries(errors).map(([key, error]) => (
              <li key={key}>
                <a
                  href={'#' + key}
                  onClick={(event) => {
                    event.preventDefault();
                    document.getElementById(key)?.focus();
                  }}
                >
                  {error.label}: {error.message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null,
  };
}
