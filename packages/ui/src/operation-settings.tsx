import {
  BusinessHoursBatch,
  BusinessHoursPeriods,
  businessWeekOrder as weekOrder,
} from './business-hours-editor.js';
import { useEffect, useState } from 'react';
import {
  businessAvailability,
  businessHoursSchema,
  dayHoursLabel,
  readBusinessHours,
  weekdayNames,
  type BusinessHours,
} from '../../shared/src/business-hours.js';
import { Icon } from './appearance.js';
import { api, type Data } from './client.js';
import { Modal, ModalCloseButton, useAction } from './common.js';
import { useToasts } from './toasts.js';
export function OperationSettings({
  settings,
  onChange,
}: {
  settings: Data;
  onChange: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [batchDirty, setBatchDirty] = useState(false);
  const [draft, setDraft] = useState({
    opening_hours: readBusinessHours(settings.opening_hours),
    is_open: Boolean(settings.is_open),
    show_out_of_stock: Boolean(settings.show_out_of_stock),
  });
  const [initial, setInitial] = useState(draft);
  const [now, setNow] = useState(() => new Date());
  const { busy, run } = useAction();
  const toast = useToasts();
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);
  const saved = readBusinessHours(settings.opening_hours);
  const availability = businessAvailability(
    { is_open: settings.is_open, opening_hours: settings.opening_hours },
    now,
  );
  function edit() {
    const next = {
      opening_hours: readBusinessHours(settings.opening_hours),
      is_open: Boolean(settings.is_open),
      show_out_of_stock: Boolean(settings.show_out_of_stock),
    };
    setDraft(next);
    setInitial(next);
    setBatchDirty(false);
    setEditing(true);
  }
  function updateDay(weekday: number, values: Partial<BusinessHours['days'][number]>) {
    setDraft((current) => ({
      ...current,
      opening_hours: {
        ...current.opening_hours,
        days: current.opening_hours.days.map((day) =>
          day.weekday === weekday ? { ...day, ...values } : day,
        ),
      },
    }));
  }
  return (
    <section className="panel operation-settings">
      <div className="section-head">
        <div>
          <h2>
            <Icon name="clock" size={21} />
            Funcionamento e cardápio
          </h2>
          <p className="muted small">
            Defina quando receber pedidos e quais produtos aparecem nos cardápios.
          </p>
        </div>
        <button className="primary" onClick={edit}>
          <Icon name="edit" size={16} />
          Editar funcionamento
        </button>
      </div>
      <div className="operation-settings-status">
        <span className={'badge ' + (availability.is_open ? 'available' : 'pending')}>
          {availability.is_open ? 'Recebendo pedidos' : 'Pedidos fechados'}
        </span>
        <p>{availability.message}</p>
      </div>
      <div className="operation-settings-grid">
        <div>
          <h3>
            <Icon name="clock" size={18} />
            Horários da semana
          </h3>
          <p className="muted small">
            {saved.enabled
              ? 'Agenda automática ativa · Horário de Brasília'
              : 'Agenda automática desativada · A abertura é controlada manualmente.'}
          </p>
          <dl className="business-hours-summary">
            {weekOrder.map((weekday) => (
              <div key={weekday}>
                <dt>{weekdayNames[weekday]}</dt>
                <dd>{dayHoursLabel(saved.days.find((day) => day.weekday === weekday)!)}</dd>
              </div>
            ))}
          </dl>
          {!saved.enabled && (
            <p className="field-hint">
              Os horários acima só bloqueiam novos pedidos quando a agenda automática estiver ativa.
            </p>
          )}
        </div>
        <div className="operation-catalog-summary">
          <h3>
            <Icon name="menu" size={18} />
            Exibição nos cardápios
          </h3>
          <strong>
            {settings.show_out_of_stock
              ? 'Produtos sem estoque visíveis'
              : 'Produtos sem estoque ocultos'}
          </strong>
          <p>
            Esta opção vale para o cliente e a seleção de produtos em novos pedidos. Os cadastros e
            os estoques permanecem completos.
          </p>
          <p className="field-hint">
            Produtos sem controle de estoque continuam visíveis. Se uma variação tiver saldo, o
            produto também permanece disponível.
          </p>
          <p className="field-hint">
            A exibição não libera a venda sem saldo: o estoque é conferido ao concluir o pedido.
          </p>
        </div>
      </div>
      {editing && (
        <Modal
          title="Funcionamento e cardápio"
          className="business-hours-modal"
          dirty={batchDirty || JSON.stringify(draft) !== JSON.stringify(initial)}
          closeDisabled={busy}
          onClose={() => setEditing(false)}
        >
          <form
            id="business-hours-form"
            className="business-hours-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (batchDirty) {
                toast.error(
                  'Aplique o horário aos dias selecionados antes de salvar o funcionamento.',
                );
                return;
              }
              const parsed = businessHoursSchema.safeParse({
                ...draft.opening_hours,
                days: draft.opening_hours.days.map((day) => ({
                  ...day,
                  periods: day.enabled && !day.all_day ? day.periods : [],
                })),
              });
              if (!parsed.success) {
                toast.error(parsed.error.issues[0].message);
                return;
              }
              void run(async () => {
                await api('/settings', { ...draft, opening_hours: parsed.data }, 'PATCH');
                await onChange();
                setEditing(false);
              }, 'Funcionamento e cardápio atualizados.');
            }}
          >
            <div className="business-hours-controls">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={draft.is_open}
                  onChange={(event) => setDraft({ ...draft, is_open: event.target.checked })}
                />
                Receber novos pedidos
              </label>
              <p className="field-hint">
                Desative para pausar os pedidos mesmo dentro do horário. Pagamentos e entregas já em
                andamento continuam disponíveis.
              </p>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={draft.opening_hours.enabled}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      opening_hours: { ...draft.opening_hours, enabled: event.target.checked },
                    })
                  }
                />
                Controlar abertura pelos horários da semana
              </label>
              <p className="field-hint">
                Horário de Brasília. Se o fechamento for antes da abertura, o período termina no dia
                seguinte.
              </p>
            </div>
            <BusinessHoursBatch
              hours={draft.opening_hours}
              disabled={busy}
              onDirtyChange={setBatchDirty}
              onApply={(opening_hours) => setDraft((current) => ({ ...current, opening_hours }))}
            />
            <fieldset className="business-hours-days" disabled={busy}>
              <legend>Horários por dia</legend>
              {weekOrder.map((weekday) => {
                const day = draft.opening_hours.days.find((entry) => entry.weekday === weekday)!;
                return (
                  <div
                    className={'business-hours-day' + (!day.enabled ? ' is-closed' : '')}
                    key={weekday}
                  >
                    <div className="business-hours-day-heading">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={day.enabled}
                          onChange={(event) =>
                            updateDay(weekday, {
                              enabled: event.target.checked,
                              periods: day.periods.length
                                ? day.periods
                                : [{ start: '09:00', end: '18:00' }],
                            })
                          }
                        />
                        {weekdayNames[weekday]}
                      </label>
                      {!day.enabled ? (
                        <span className="muted small">Fechado</span>
                      ) : (
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={day.all_day}
                            onChange={(event) =>
                              updateDay(weekday, { all_day: event.target.checked })
                            }
                          />
                          24 horas
                        </label>
                      )}
                    </div>
                    {day.enabled && !day.all_day && (
                      <BusinessHoursPeriods
                        label={weekdayNames[weekday]}
                        required
                        periods={day.periods}
                        onChange={(periods) => updateDay(weekday, { periods })}
                      />
                    )}
                  </div>
                );
              })}
            </fieldset>
            <div className="business-hours-controls">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={draft.show_out_of_stock}
                  onChange={(event) =>
                    setDraft({ ...draft, show_out_of_stock: event.target.checked })
                  }
                />
                Mostrar produtos sem estoque nos cardápios
              </label>
              <p className="field-hint">
                Desmarque para ocultar os esgotados. Produtos com variações disponíveis continuam
                aparecendo.
              </p>
            </div>
          </form>
          <div className="modal-footer">
            <ModalCloseButton disabled={busy}>Cancelar</ModalCloseButton>
            <button className="primary" type="submit" form="business-hours-form" disabled={busy}>
              <Icon name="check" size={17} />
              Salvar funcionamento
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
