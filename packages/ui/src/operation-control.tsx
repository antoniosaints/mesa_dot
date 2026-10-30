import { useEffect, useRef, useState } from 'react';
import { api, brl, type Data } from './client.js';
import { Icon } from './appearance.js';
import { Modal, ModalCloseButton, useAction, useRefresh } from './common.js';
import { SearchSelect } from './controls.js';
import { NumericInput } from './numeric-input.js';
import { operationTime } from './operation-format.js';
import { useToasts } from './toasts.js';
export function OperationControl({
  scopeKey,
  onChange,
}: {
  scopeKey: string;
  onChange: () => Promise<void>;
}) {
  const [state, setState] = useState<Data | null>(null),
    [error, setError] = useState('');
  const [mode, setMode] = useState<'activate' | 'manage' | 'rotate' | null>(null);
  const [selected, setSelected] = useState(''),
    [register, setRegister] = useState(''),
    [registerName, setRegisterName] = useState('');
  const [opening, setOpening] = useState('0.00'),
    [counted, setCounted] = useState(''),
    [openNew, setOpenNew] = useState(true);
  const [initial, setInitial] = useState('');
  const [activateOnRotate, setActivateOnRotate] = useState(false);
  const { run, busy } = useAction(),
    toast = useToasts();
  const alive = useRef(true),
    warned = useRef(new Set<string>());
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function load() {
    try {
      const data = await api('/operation/control');
      if (alive.current) {
        setState(data);
        setError('');
      }
    } catch (err) {
      if (alive.current) setError((err as Error).message);
    }
  }
  useRefresh(load, [scopeKey]);
  useEffect(() => {
    for (const cash of state?.sessions ?? [])
      if (cash.overdue && !warned.current.has(cash.id)) {
        warned.current.add(cash.id);
        toast.info(
          `O caixa ${cash.register_name} está aberto há mais de 24 horas. Confira o fechamento e abra um novo turno.`,
        );
      }
  }, [state]);
  if (!state)
    return (
      <button className="operation-status-loading" onClick={() => void load()} disabled={!error}>
        <Icon name={error ? 'refresh' : 'clock'} size={16} />
        {error ? 'Recarregar pedidos e caixa' : 'Conferindo pedidos…'}
      </button>
    );
  const sessions: Data[] = state.sessions,
    overdue = sessions.filter((cash) => cash.overdue);
  const chosen = sessions.find((cash) => cash.id === selected),
    active = sessions.find((cash) => cash.id === state.order_cash_session_id);
  const values = JSON.stringify({ selected, register, registerName, opening, counted, openNew });
  function edit(
    nextMode: 'activate' | 'manage' | 'rotate',
    cashId = state!.order_cash_session_id ?? '',
  ) {
    if (nextMode !== 'rotate') setActivateOnRotate(nextMode === 'activate');
    const cash = sessions.find((item) => item.id === cashId);
    const nextRegister =
      nextMode === 'rotate'
        ? cash?.register_id
        : state!.registers.find(
            (item: Data) => !sessions.some((session) => session.register_id === item.id),
          )?.id;
    const next = {
      selected: cashId,
      register: nextRegister ?? 'new',
      registerName: '',
      opening: '0.00',
      counted: '',
      openNew: true,
    };
    setSelected(next.selected);
    setRegister(next.register);
    setRegisterName('');
    setOpening('0.00');
    setCounted('');
    setOpenNew(true);
    setInitial(JSON.stringify(next));
    setMode(nextMode);
  }
  async function apply(
    path: string,
    body: Data,
    method = 'POST',
    success = 'Pedidos e caixa atualizados.',
  ) {
    const result = await run(async () => {
      const next = await api(path, body, method);
      if (alive.current) setState(next);
      await onChange();
      return next;
    }, success);
    if (result) setMode(null);
  }
  function toggle() {
    if (state!.is_open) {
      void apply('/operation/control', { is_open: false }, 'PATCH', 'Novos pedidos pausados.');
      return;
    }
    if (sessions.length === 1 && !overdue.length) {
      void apply(
        '/operation/control',
        { is_open: true, cash_session_id: sessions[0].id },
        'PATCH',
        'Permissão para novos pedidos ativada. A agenda de funcionamento continua sendo respeitada.',
      );
      return;
    }
    edit('activate');
  }
  const willOpen = mode === 'rotate' || (!sessions.length && state.can_manage_cash && openNew);
  const available = state.registers.filter(
    (item: Data) =>
      !sessions.some((session) => session.register_id === item.id) ||
      (mode === 'rotate' && item.id === chosen?.register_id),
  );
  return (
    <>
      <div className="operation-header-control">
        {state.can_toggle && (
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(state.is_open)}
            aria-label="Receber novos pedidos"
            className={'operation-order-switch' + (state.is_open ? ' is-active' : '')}
            disabled={busy}
            title={state.availability.message}
            onClick={toggle}
          >
            <span>
              Novos pedidos
              <small>
                {!state.is_open
                  ? 'Pausados'
                  : state.availability.is_open
                    ? 'Ativos'
                    : 'Fora do horário'}
              </small>
            </span>
            <span className="operation-switch-track" aria-hidden="true">
              <i />
            </span>
          </button>
        )}
        <button
          className={'operation-cash-indicator' + (overdue.length ? ' is-overdue' : '')}
          aria-label={
            overdue.length
              ? 'Revisar caixa aberto há mais de 24 horas'
              : 'Gerenciar caixa dos pedidos'
          }
          disabled={busy}
          onClick={() => edit('manage', overdue[0]?.id ?? state.order_cash_session_id ?? '')}
        >
          <Icon name={overdue.length ? 'clock' : 'cash'} size={17} />
          <span>
            {overdue.length
              ? `Caixa > 24h${overdue.length > 1 ? ' · ' + overdue.length : ''}`
              : (active?.register_name ?? 'Sem caixa')}
          </span>
        </button>
      </div>
      {mode && (
        <Modal
          title={
            mode === 'rotate'
              ? 'Encerrar e abrir novo turno'
              : mode === 'activate'
                ? 'Ativar novos pedidos'
                : 'Pedidos e caixa'
          }
          className="operation-control-modal"
          dirty={values !== initial}
          closeDisabled={busy}
          onClose={() => setMode(null)}
        >
          <form
            id="operation-control-form"
            className="operation-control-form"
            onSubmit={(event) => {
              event.preventDefault();
              const open_cash =
                register === 'new'
                  ? { register_name: registerName.trim(), opening_amount: opening }
                  : { register_id: register, opening_amount: opening };
              if (mode === 'rotate') {
                void apply(
                  '/operation/cash/rotate',
                  {
                    cash_session_id: selected,
                    counted_amount: counted,
                    open_cash,
                    ...(state.can_toggle && activateOnRotate ? { activate_orders: true } : {}),
                  },
                  'POST',
                  'Turno anterior encerrado e novo turno aberto.',
                );
                return;
              }
              if (willOpen && !state.can_toggle) {
                void apply('/operation/cash/open', open_cash, 'POST', 'Caixa aberto.');
                return;
              }
              if (!state.can_toggle) {
                setMode(null);
                return;
              }
              void apply(
                '/operation/control',
                {
                  is_open: mode === 'activate' ? true : Boolean(state.is_open),
                  ...(willOpen ? { open_cash } : selected ? { cash_session_id: selected } : {}),
                },
                'PATCH',
                mode === 'activate'
                  ? 'Recebimento de novos pedidos atualizado.'
                  : 'Caixa dos novos pedidos atualizado.',
              );
            }}
          >
            {!state.availability.is_open && state.is_open && (
              <div className="flow-note">
                <Icon name="clock" size={19} />
                <p>
                  {state.availability.message} O switch controla a permissão manual e não altera os
                  horários configurados.
                </p>
              </div>
            )}
            {mode !== 'rotate' && sessions.length > 0 && (
              <label>
                Caixa para novos pedidos
                <SearchSelect
                  label="Caixa para novos pedidos"
                  value={selected}
                  onChange={setSelected}
                  allowClear={false}
                  options={sessions.map((cash) => ({
                    id: cash.id,
                    name: cash.register_name + (cash.overdue ? ' · Aberto há mais de 24h' : ''),
                  }))}
                />
              </label>
            )}
            {chosen && (
              <section className="operation-cash-summary">
                <h3>
                  <Icon name="cash" size={19} />
                  {chosen.register_name}
                </h3>
                <p>
                  Aberto em {operationTime(chosen.opened_at_iso)} ·{' '}
                  {chosen.opened_by_name ?? 'Equipe'}
                </p>
                {chosen.expected_amount !== undefined && (
                  <div>
                    Dinheiro esperado <strong>{brl(chosen.expected_amount)}</strong>
                  </div>
                )}
                {chosen.overdue && (
                  <div className="operation-overdue-note" role="status">
                    <Icon name="clock" size={20} />
                    <p>
                      <strong>Este caixa está aberto há mais de 24 horas.</strong> Confira o
                      dinheiro, encerre este turno e abra um novo para continuar o controle diário.
                    </p>
                  </div>
                )}
                {mode !== 'rotate' && state.can_manage_cash && (
                  <button
                    type="button"
                    className={chosen.overdue ? 'primary' : ''}
                    onClick={() => edit('rotate', chosen.id)}
                  >
                    <Icon name="refresh" size={16} />
                    Encerrar e abrir novo turno
                  </button>
                )}
              </section>
            )}
            {mode !== 'rotate' && !sessions.length && (
              <section className="operation-no-cash">
                <h3>Nenhum caixa aberto</h3>
                <p>Abra um turno para vincular os próximos pedidos ao caixa.</p>
                {state.can_manage_cash ? (
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={openNew}
                      onChange={(event) => setOpenNew(event.target.checked)}
                    />
                    Abrir caixa neste atendimento
                  </label>
                ) : (
                  <p className="field-hint">
                    Solicite a abertura a um usuário com permissão para gerenciar caixas.
                  </p>
                )}
                {!openNew && (
                  <p className="field-hint">
                    Enquanto não houver caixa aberto, os novos pedidos ficarão sem vínculo de turno.
                  </p>
                )}
              </section>
            )}
            {mode === 'rotate' && (
              <label>
                Dinheiro contado no fechamento
                <NumericInput
                  label="Dinheiro contado no fechamento"
                  value={counted}
                  onChange={setCounted}
                  precision={2}
                  maxIntegerDigits={12}
                  prefix="R$"
                  min={0}
                  required
                />
                <span className="field-hint">
                  A conferência e eventuais diferenças serão registradas no turno anterior.
                </span>
              </label>
            )}
            {willOpen && (
              <section className="operation-open-cash-fields">
                <h3>{mode === 'rotate' ? 'Novo turno de caixa' : 'Abrir caixa'}</h3>
                <label>
                  Caixa
                  <SearchSelect
                    label="Caixa do novo turno"
                    value={register}
                    onChange={setRegister}
                    allowClear={false}
                    options={[
                      ...available.map((item: Data) => ({ id: item.id, name: item.name })),
                      { id: 'new', name: 'Cadastrar novo caixa' },
                    ]}
                  />
                </label>
                {register === 'new' && (
                  <label>
                    Nome do caixa
                    <input
                      required
                      maxLength={100}
                      value={registerName}
                      onChange={(event) => setRegisterName(event.target.value)}
                      placeholder="Ex.: Caixa principal"
                    />
                  </label>
                )}
                <label>
                  Fundo de abertura
                  <NumericInput
                    label="Fundo de abertura do novo turno"
                    value={opening}
                    onChange={setOpening}
                    precision={2}
                    maxIntegerDigits={12}
                    prefix="R$"
                    min={0}
                    required
                  />
                  <span className="field-hint">
                    Informe apenas o dinheiro físico que inicia o novo turno.
                  </span>
                </label>
                {mode === 'rotate' && (
                  <p className="field-hint">
                    Os próximos pedidos usarão o novo turno. Os vínculos dos pedidos anteriores
                    serão preservados.
                    {state.can_toggle && activateOnRotate
                      ? ' Novos pedidos serão ativados após a abertura.'
                      : ''}
                  </p>
                )}
              </section>
            )}
            {mode === 'activate' && (
              <p className="field-hint">
                A agenda de funcionamento continua sendo respeitada. Pedidos e entregas já
                confirmados permanecem disponíveis ao pausar novos pedidos.
              </p>
            )}
          </form>
          <div className="modal-footer">
            <ModalCloseButton disabled={busy}>Voltar</ModalCloseButton>
            <button
              className="primary"
              form="operation-control-form"
              type="submit"
              disabled={busy || (mode === 'rotate' && !chosen)}
            >
              <Icon name="check" size={17} />
              {mode === 'rotate'
                ? 'Encerrar e abrir novo turno'
                : mode === 'activate'
                  ? willOpen
                    ? 'Abrir caixa e ativar pedidos'
                    : 'Ativar pedidos'
                  : willOpen
                    ? 'Abrir caixa'
                    : state.can_toggle
                      ? 'Usar este caixa'
                      : 'Concluído'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
