import { MoneyInput } from './money-input.js';
import { RecordColorInput } from './record-tags.js';
import { NumericInput } from './numeric-input.js';
import { normalizeInteger, normalizeNumericValue, type NumericRules } from './numeric.js';
import { normalizeMoney } from './money.js';
import { flushSync } from 'react-dom';
import { useState } from 'react';
import { Modal, ModalCloseButton, useAction } from './common.js';
import { SearchSelect, type SelectOption } from './controls.js';
import type { Data } from './client.js';
export interface Field {
  key: string;
  label: string;
  type?:
    | 'color'
    | 'currency'
    | 'text'
    | 'number'
    | 'quantity'
    | 'checkbox'
    | 'select'
    | 'password'
    | 'email'
    | 'textarea';
  options?: SelectOption[];
  required?: boolean;
  initial?: any;
  placeholder?: string;
  hint?: string | ((values: Data) => string);
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  step?: string;
  signed?: boolean;
  positive?: boolean;
  maxIntegerDigits?: number;
  numericOptions?: (values: Data) => Partial<NumericRules>;
}
export function serializeFormValues(fields: Field[], values: Data) {
  return Object.fromEntries(
    fields
      .filter(
        (field) =>
          values[field.key] !== '' ||
          field.required ||
          field.type === 'checkbox' ||
          field.type === 'color',
      )
      .map((field) => [
        field.key,
        field.type === 'color'
          ? values[field.key]
            ? String(values[field.key]).toLowerCase()
            : null
          : field.type === 'currency'
            ? normalizeMoney(values[field.key])
            : field.type === 'number'
              ? normalizeInteger(values[field.key], {
                  signed: field.signed ?? (field.min === undefined || field.min < 0),
                  min: field.min,
                  max: field.max,
                  ...field.numericOptions?.(values),
                })
              : field.type === 'quantity'
                ? normalizeNumericValue(values[field.key], {
                    precision: 3,
                    maxIntegerDigits: field.maxIntegerDigits ?? 11,
                    signed: field.signed,
                    positive: field.positive,
                    min: field.min,
                    max: field.max,
                    ...field.numericOptions?.(values),
                  })
                : field.type === 'checkbox'
                  ? Boolean(values[field.key])
                  : values[field.key],
      ]),
  );
}
export function formValuesChanged(values: Data, initial: Data) {
  return [...new Set([...Object.keys(values), ...Object.keys(initial)])].some(
    (key) => String(values[key] ?? '') !== String(initial[key] ?? ''),
  );
}
export function FormFields({
  fields,
  values,
  onChange,
}: {
  fields: Field[];
  values: Data;
  onChange: (values: Data) => void;
}) {
  return (
    <>
      {fields.map((field) =>
        field.type === 'color' ? (
          <RecordColorInput
            key={field.key}
            label={field.label}
            value={values[field.key] ?? ''}
            onChange={(value) => onChange({ ...values, [field.key]: value })}
          />
        ) : (
          <label key={field.key} className={field.type === 'checkbox' ? 'checkbox-label' : ''}>
            <span>
              {field.label}
              {field.required && (
                <span className="required-mark" aria-hidden="true">
                  {' '}
                  *
                </span>
              )}
            </span>
            {field.type === 'number' || field.type === 'quantity' ? (
              <NumericInput
                label={field.label}
                value={String(values[field.key] ?? '')}
                required={field.required}
                placeholder={field.placeholder}
                precision={field.type === 'number' ? 0 : 3}
                maxIntegerDigits={field.maxIntegerDigits ?? (field.type === 'number' ? 16 : 11)}
                signed={
                  field.signed ??
                  (field.type === 'number' && (field.min === undefined || field.min < 0))
                }
                positive={field.positive}
                min={field.min}
                max={field.max}
                {...field.numericOptions?.(values)}
                onChange={(value) => onChange({ ...values, [field.key]: value })}
              />
            ) : field.type === 'select' ? (
              <SearchSelect
                label={field.label}
                options={field.options ?? []}
                value={String(values[field.key] ?? '')}
                required={field.required}
                placeholder={field.placeholder}
                onChange={(value) => onChange({ ...values, [field.key]: value })}
              />
            ) : field.type === 'currency' ? (
              <MoneyInput
                label={field.label}
                value={String(values[field.key] ?? '')}
                required={field.required}
                placeholder={field.placeholder}
                onChange={(value) => onChange({ ...values, [field.key]: value })}
              />
            ) : field.type === 'textarea' ? (
              <textarea
                aria-label={field.label}
                required={field.required}
                minLength={field.minLength}
                maxLength={field.maxLength}
                placeholder={field.placeholder}
                rows={3}
                value={values[field.key] ?? ''}
                onChange={(event) => onChange({ ...values, [field.key]: event.target.value })}
              />
            ) : (
              <input
                aria-label={field.label}
                type={field.type ?? 'text'}
                required={field.required}
                minLength={field.minLength}
                maxLength={field.maxLength}
                min={field.min}
                max={field.max}
                step={field.step}
                placeholder={field.placeholder}
                checked={field.type === 'checkbox' ? Boolean(values[field.key]) : undefined}
                value={field.type === 'checkbox' ? undefined : (values[field.key] ?? '')}
                onChange={(event) =>
                  onChange({
                    ...values,
                    [field.key]:
                      field.type === 'checkbox' ? event.target.checked : event.target.value,
                  })
                }
              />
            )}
            {field.hint && (
              <small className="field-hint">
                {typeof field.hint === 'function' ? field.hint(values) : field.hint}
              </small>
            )}
          </label>
        ),
      )}
    </>
  );
}
interface FormDialogOptions {
  title: string;
  description?: string;
  fields: Field[];
  initial?: Data;
  submitLabel?: string;
  submitVariant?: 'danger';
  successMessage?: string;
  onSubmit: (values: Data) => Promise<any>;
  onSuccess?: (result: any) => void;
}
function FormDialog({ config, onClose }: { config: FormDialogOptions; onClose: () => void }) {
  const [values, setValues] = useState<Data>(() => ({
    ...Object.fromEntries(
      config.fields.map((field) => [
        field.key,
        field.initial ?? (field.type === 'checkbox' ? false : ''),
      ]),
    ),
    ...config.initial,
  }));
  const { run, busy } = useAction();
  const [initialValues] = useState(values);
  return (
    <Modal
      title={config.title}
      dirty={formValuesChanged(values, initialValues)}
      closeDisabled={busy}
      onClose={onClose}
    >
      <p className="modal-description">
        {config.description ?? 'Preencha os dados e confirme para continuar.'}
      </p>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          void (async () => {
            const result = await run(
              async () => ({
                data: await config.onSubmit(serializeFormValues(config.fields, values)),
              }),
              config.successMessage ?? 'Operação concluída.',
            );
            if (result) {
              flushSync(onClose);
              config.onSuccess?.(result.data);
            }
          })();
        }}
      >
        <FormFields fields={config.fields} values={values} onChange={setValues} />
        <div className="modal-footer">
          <ModalCloseButton disabled={busy} />
          <button className={config.submitVariant ?? 'primary'} disabled={busy}>
            {busy ? 'Salvando…' : (config.submitLabel ?? 'Salvar')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function useFormDialog() {
  const [config, setConfig] = useState<(FormDialogOptions & { key: string }) | null>(null);
  return {
    open: (options: FormDialogOptions) => setConfig({ ...options, key: crypto.randomUUID() }),
    dialog: config ? (
      <FormDialog key={config.key} config={config} onClose={() => setConfig(null)} />
    ) : null,
  };
}
