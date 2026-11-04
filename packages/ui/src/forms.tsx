import { MoneyInput } from './money-input.js';
import { RecordColorInput } from './record-tags.js';
import { NumericInput } from './numeric-input.js';
import { normalizeInteger, normalizeNumericValue, type NumericRules } from './numeric.js';
import { normalizeMoney } from './money.js';
import { flushSync } from 'react-dom';
import { useId, useRef, useState } from 'react';
import { FormField, useFormValidation } from './form-field.js';
import { useManagementInterface } from './interface-scope.js';
import { ErrorState } from './data-display.js';
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
  const latest = useRef(values),
    rendered = useRef(values);
  if (rendered.current !== values) {
    latest.current = values;
    rendered.current = values;
  }
  const update = (key: string, value: unknown) => {
    const next = { ...latest.current, [key]: value };
    latest.current = next;
    onChange(next);
  };
  return (
    <>
      {fields.map((field) => (
        <ConfiguredField key={field.key} field={field} values={values} onChange={update} />
      ))}
    </>
  );
}
function ConfiguredField({
  field,
  values,
  onChange,
}: {
  field: Field;
  values: Data;
  onChange: (key: string, value: unknown) => void;
}) {
  const id = useId(),
    enhanced = useManagementInterface();
  const [problem, setProblem] = useState('');
  const numeric = ['number', 'quantity', 'currency'].includes(field.type ?? '');
  const hint = typeof field.hint === 'function' ? field.hint(values) : field.hint;
  const describedBy =
    [hint ? id + '-hint' : '', problem ? id + '-error' : ''].filter(Boolean).join(' ') || undefined;
  const change = (value: unknown) => {
    setProblem('');
    onChange(field.key, value);
  };
  if (field.type === 'color')
    return (
      <RecordColorInput label={field.label} value={values[field.key] ?? ''} onChange={change} />
    );
  return (
    <FormField
      id={id}
      label={field.label}
      required={field.required}
      hint={hint}
      error={problem}
      checkbox={field.type === 'checkbox'}
      onInvalid={(event) => {
        if (enhanced && !numeric) setProblem((event.target as HTMLInputElement).validationMessage);
      }}
      onBlur={(event) => {
        if (enhanced && !numeric && (event.target as HTMLInputElement).validity)
          setProblem((event.target as HTMLInputElement).validationMessage);
      }}
    >
      {field.type === 'number' || field.type === 'quantity' ? (
        <NumericInput
          id={id}
          describedBy={describedBy}
          label={field.label}
          value={String(values[field.key] ?? '')}
          required={field.required}
          placeholder={field.placeholder}
          precision={field.type === 'number' ? 0 : 3}
          maxIntegerDigits={field.maxIntegerDigits ?? (field.type === 'number' ? 16 : 11)}
          signed={
            field.signed ?? (field.type === 'number' && (field.min === undefined || field.min < 0))
          }
          positive={field.positive}
          min={field.min}
          max={field.max}
          {...field.numericOptions?.(values)}
          onChange={change}
        />
      ) : field.type === 'select' ? (
        <SearchSelect
          id={id}
          describedBy={describedBy}
          invalid={Boolean(problem)}
          label={field.label}
          options={field.options ?? []}
          value={String(values[field.key] ?? '')}
          required={field.required}
          placeholder={field.placeholder}
          onChange={change}
        />
      ) : field.type === 'currency' ? (
        <MoneyInput
          id={id}
          describedBy={describedBy}
          label={field.label}
          value={String(values[field.key] ?? '')}
          required={field.required}
          placeholder={field.placeholder}
          onChange={change}
        />
      ) : field.type === 'textarea' ? (
        <textarea
          id={id}
          aria-label={field.label}
          aria-describedby={describedBy}
          aria-invalid={problem ? true : undefined}
          required={field.required}
          minLength={field.minLength}
          maxLength={field.maxLength}
          placeholder={field.placeholder}
          rows={3}
          value={values[field.key] ?? ''}
          onChange={(event) => change(event.target.value)}
        />
      ) : (
        <input
          id={id}
          aria-label={field.label}
          aria-describedby={describedBy}
          aria-invalid={problem ? true : undefined}
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
            change(field.type === 'checkbox' ? event.target.checked : event.target.value)
          }
        />
      )}
    </FormField>
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
  const { run, busy, error } = useAction();
  const validation = useFormValidation();
  const [initialValues] = useState(values);
  return (
    <Modal
      title={config.title}
      size={config.submitVariant === 'danger' ? 'confirm' : 'form'}
      dirty={formValuesChanged(values, initialValues)}
      closeDisabled={busy}
      onClose={onClose}
    >
      <p className="modal-description">
        {config.description ?? 'Preencha os dados e confirme para continuar.'}
      </p>
      <form
        className="form-grid"
        onInvalidCapture={validation.onInvalidCapture}
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
        {validation.summary}
        {error && <ErrorState title="Não foi possível salvar" message={error} />}
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
