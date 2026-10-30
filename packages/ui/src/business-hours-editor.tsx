import { useEffect, useState } from 'react';
import {
  applyBusinessHoursDays,
  weekdayNames,
  type BusinessHours,
} from '../../shared/src/business-hours.js';
import { Icon } from './appearance.js';
import { SearchSelect } from './controls.js';
import { useToasts } from './toasts.js';
export const businessWeekOrder = [1, 2, 3, 4, 5, 6, 0];
type Period = BusinessHours['days'][number]['periods'][number];
export function BusinessHoursPeriods({
  periods,
  onChange,
  label,
  required = false,
}: {
  periods: Period[];
  onChange: (periods: Period[]) => void;
  label: string;
  required?: boolean;
}) {
  return (
    <div className="business-hours-periods">
      {periods.map((period, index) => (
        <div className="business-hours-period" key={index}>
          <label>
            Abre às
            <input
              type="time"
              step={60}
              required={required}
              aria-label={`Abertura de ${label}, período ${index + 1}`}
              value={period.start}
              onChange={(event) =>
                onChange(
                  periods.map((entry, position) =>
                    position === index ? { ...entry, start: event.target.value } : entry,
                  ),
                )
              }
            />
          </label>
          <label>
            Fecha às
            <input
              type="time"
              step={60}
              required={required}
              aria-label={`Fechamento de ${label}, período ${index + 1}`}
              value={period.end}
              onChange={(event) =>
                onChange(
                  periods.map((entry, position) =>
                    position === index ? { ...entry, end: event.target.value } : entry,
                  ),
                )
              }
            />
          </label>
          <button
            type="button"
            className="icon-button"
            disabled={periods.length === 1}
            aria-label={`Remover período ${index + 1} de ${label}`}
            onClick={() => onChange(periods.filter((_, position) => position !== index))}
          >
            <Icon name="trash" size={17} />
          </button>
          {period.end && period.start && period.end < period.start && (
            <small className="field-hint">Fecha no dia seguinte.</small>
          )}
        </div>
      ))}
      <button
        type="button"
        className="business-hours-add"
        disabled={periods.length >= 4}
        onClick={() => onChange([...periods, { start: '18:00', end: '23:00' }])}
      >
        <Icon name="plus" size={15} />
        Adicionar período em {label}
      </button>
    </div>
  );
}
export function BusinessHoursBatch({
  hours,
  disabled,
  onApply,
  onDirtyChange,
}: {
  hours: BusinessHours;
  disabled: boolean;
  onApply: (hours: BusinessHours) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [initial] = useState(() => {
    const source = hours.days.find((day) => day.enabled) ?? hours.days[0];
    return {
      mode: source.enabled ? (source.all_day ? 'all-day' : 'periods') : 'closed',
      days: [1, 2, 3, 4, 5],
      periods: source.periods.length
        ? source.periods.map((period) => ({ ...period }))
        : [{ start: '09:00', end: '18:00' }],
    };
  });
  const [values, setValues] = useState(initial),
    [baseline, setBaseline] = useState(JSON.stringify(initial)),
    [message, setMessage] = useState('');
  const toast = useToasts();
  const pending = JSON.stringify(values) !== baseline;
  useEffect(
    () => onDirtyChange(JSON.stringify(values) !== baseline),
    [values, baseline, onDirtyChange],
  );
  function apply() {
    try {
      const next = applyBusinessHoursDays(hours, values.days, {
        enabled: values.mode !== 'closed',
        all_day: values.mode === 'all-day',
        periods: values.periods,
      });
      onApply(next);
      setBaseline(JSON.stringify(values));
      onDirtyChange(false);
      setMessage(
        `Horário aplicado a ${values.days.length} dia(s). Confira a agenda abaixo e salve para concluir.`,
      );
      toast.success('Horários aplicados aos dias selecionados.');
    } catch (error) {
      const issue = error as Error & { issues?: { message: string }[] };
      setMessage('');
      toast.error(issue.issues?.[0]?.message ?? issue.message);
    }
  }
  return (
    <fieldset className="business-hours-batch" disabled={disabled}>
      <legend>
        <Icon name="copy" size={17} />
        Aplicar o mesmo horário em vários dias
      </legend>
      <p className="field-hint">
        Defina o horário uma vez e escolha os dias. A aplicação substitui apenas os dias
        selecionados; salve o funcionamento para confirmar.
      </p>
      <label>
        Como esses dias funcionam?
        <SearchSelect
          label="Funcionamento dos dias selecionados"
          allowClear={false}
          value={values.mode}
          disabled={disabled}
          options={[
            { id: 'periods', name: 'Horários definidos' },
            { id: 'all-day', name: '24 horas' },
            { id: 'closed', name: 'Fechado' },
          ]}
          onChange={(mode) => setValues({ ...values, mode })}
        />
      </label>
      {values.mode === 'periods' && (
        <BusinessHoursPeriods
          label="horário compartilhado"
          periods={values.periods}
          onChange={(periods) => setValues({ ...values, periods })}
        />
      )}
      <div className="business-hours-day-presets">
        <span>Dias que receberão o horário</span>
        <div className="button-row">
          <button
            type="button"
            onClick={() => setValues({ ...values, days: [...businessWeekOrder] })}
          >
            Todos os dias
          </button>
          <button type="button" onClick={() => setValues({ ...values, days: [1, 2, 3, 4, 5] })}>
            Segunda a sexta
          </button>
          <button type="button" onClick={() => setValues({ ...values, days: [] })}>
            Limpar seleção
          </button>
        </div>
      </div>
      <div
        className="business-hours-day-picker"
        role="group"
        aria-label="Dias para aplicar o horário"
      >
        {businessWeekOrder.map((weekday) => (
          <label key={weekday} className="checkbox-label">
            <input
              type="checkbox"
              aria-label={`Aplicar em ${weekdayNames[weekday]}`}
              checked={values.days.includes(weekday)}
              onChange={(event) =>
                setValues({
                  ...values,
                  days: event.target.checked
                    ? [...values.days, weekday]
                    : values.days.filter((day) => day !== weekday),
                })
              }
            />
            {weekdayNames[weekday]}
          </label>
        ))}
      </div>
      <div className="business-hours-batch-footer">
        <span className="field-hint">{values.days.length} dia(s) selecionado(s)</span>
        <div className="button-row">
          {pending && (
            <button
              type="button"
              onClick={() => {
                setValues(JSON.parse(baseline));
                setMessage('');
              }}
            >
              Reverter preenchimento
            </button>
          )}
          <button type="button" className="primary" onClick={apply}>
            <Icon name="check" size={16} />
            Aplicar aos dias selecionados
          </button>
        </div>
      </div>
      {pending && <p className="field-hint">Este preenchimento ainda não foi aplicado à agenda.</p>}
      {message && !pending && (
        <p className="business-hours-batch-message" role="status">
          <Icon name="check" size={16} />
          {message}
        </p>
      )}
    </fieldset>
  );
}
