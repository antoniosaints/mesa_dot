import { useEffect, useState } from 'react';
import { api, type Data } from './client.js';
import { Icon } from './appearance.js';
import { Modal, ModalCloseButton, Empty, useAction, useRefresh } from './common.js';
import { Pagination, TableLoading } from './pagination.js';
import type { PushRule } from '../../shared/src/push.js';
export function PushSettings() {
  const [config, setConfig] = useState<Data | null>(null),
    [editing, setEditing] = useState(false),
    [draft, setDraft] = useState<{ enabled: boolean; rules: PushRule[] }>({
      enabled: false,
      rules: [],
    });
  const [devices, setDevices] = useState<Data | null>(null),
    [page, setPage] = useState(1),
    [size, setSize] = useState(10),
    [search, setSearch] = useState(''),
    [loading, setLoading] = useState(false),
    [disabling, setDisabling] = useState<Data | null>(null);
  const { busy, run, refresh } = useAction();
  async function loadConfig() {
    await refresh(async () => {
      setConfig(await api('/push/settings'));
    });
  }
  async function loadDevices() {
    setLoading(true);
    try {
      await refresh(async () => {
        setDevices(
          await api(
            '/push/devices?' +
              new URLSearchParams({ page: String(page), page_size: String(size), search }),
          ),
        );
      });
    } finally {
      setLoading(false);
    }
  }
  useRefresh(loadConfig, []);
  useEffect(() => {
    const timer = setTimeout(() => void loadDevices(), 200);
    return () => clearTimeout(timer);
  }, [page, size, search]);
  const initial = config
    ? { enabled: Boolean(config.enabled), rules: config.rules }
    : { enabled: false, rules: [] };
  function changeRule(event: string, values: Partial<PushRule>) {
    setDraft((value) => ({
      ...value,
      rules: value.rules.map((rule) => (rule.event === event ? { ...rule, ...values } : rule)),
    }));
  }
  return (
    <div className="push-settings-workspace">
      <section className="panel">
        <div className="section-head">
          <div>
            <h2>Notificações push da filial</h2>
            <p className="muted small">
              Defina os avisos da operação e quais perfis devem recebê-los.
            </p>
          </div>
          <button
            className="primary"
            disabled={!config}
            onClick={() => {
              setDraft({
                ...initial,
                rules: initial.rules.map((rule: PushRule) => ({
                  ...rule,
                  role_ids: [...rule.role_ids],
                })),
              });
              setEditing(true);
            }}
          >
            <Icon name="settings" size={16} />
            Configurar notificações
          </button>
        </div>
        {!config ? (
          <TableLoading />
        ) : (
          <>
            <div className="push-settings-summary">
              <span>
                <i className={config.enabled ? 'online-dot' : ''} />
                {config.enabled ? 'Envio ativado' : 'Envio pausado'}
              </span>
              <span>
                {
                  config.rules.filter((rule: PushRule) => rule.enabled && rule.role_ids.length)
                    .length
                }{' '}
                tipos de aviso configurados
              </span>
              <span className={config.configured ? 'success-text' : 'muted'}>
                <Icon name={config.configured ? 'ready' : 'info'} size={16} />
                {config.configured
                  ? 'Servidor pronto para Web Push'
                  : 'Chaves de push pendentes no servidor'}
              </span>
            </div>
            <p className="field-hint">
              Cada funcionário ativa as notificações no próprio navegador pelo botão Push do
              cabeçalho. A permissão do aparelho é individual. Somente o admin geral da conta altera
              estas regras.
            </p>
          </>
        )}
      </section>
      <section className="panel resource-panel">
        <div className="section-head">
          <div>
            <h2>Dispositivos cadastrados</h2>
            <p className="muted small">
              Assinaturas expiradas ou recusadas como inativas são removidas automaticamente.
            </p>
          </div>
          <button disabled={loading} onClick={() => void loadDevices()}>
            <Icon name="refresh" size={16} />
            Atualizar dispositivos
          </button>
        </div>
        <label className="input-icon push-device-search">
          <Icon name="search" size={17} />
          <input
            aria-label="Buscar dispositivo push"
            type="search"
            placeholder="Buscar por dispositivo ou funcionário…"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <div className="data-table" aria-busy={loading}>
          <table className="push-devices-table">
            <thead>
              <tr>
                <th>Dispositivo</th>
                <th>Funcionário / perfil</th>
                <th>Aplicativo</th>
                <th>Situação</th>
                <th>Última sincronização</th>
                <th className="align-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {devices?.rows.map((device: Data) => (
                <tr key={device.id}>
                  <td>
                    <strong>{device.device_name}</strong>
                    <small className="muted">{device.origin}</small>
                  </td>
                  <td>
                    {device.user_name}
                    <small className="muted">{device.role_name}</small>
                  </td>
                  <td>
                    {
                      { admin: 'Gestão', waiter: 'Garçom', kitchen: 'Cozinha' }[
                        device.surface as 'admin' | 'waiter' | 'kitchen'
                      ]
                    }
                  </td>
                  <td>
                    <span className={`badge ${device.enabled ? 'approved' : 'closed'}`}>
                      {device.enabled ? 'Ativo' : 'Desativado'}
                    </span>
                  </td>
                  <td>
                    {new Date(device.last_seen_at.replace(' ', 'T') + 'Z').toLocaleString('pt-BR', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </td>
                  <td className="align-right">
                    <button
                      className="danger"
                      disabled={!device.enabled || busy}
                      onClick={() => setDisabling(device)}
                    >
                      <Icon name="close" size={14} />
                      Desativar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && <TableLoading label="Carregando dispositivos…" />}
          {!loading && devices && !devices.rows.length && (
            <Empty>Nenhum dispositivo encontrado nesta filial.</Empty>
          )}
        </div>
        <Pagination
          label="Dispositivos push"
          page={devices?.page ?? page}
          pageSize={size}
          total={devices?.total ?? 0}
          onPageChange={setPage}
          onPageSizeChange={(next) => {
            setSize(next);
            setPage(1);
          }}
          loading={loading}
        />
        <p className="field-hint">
          Falhas temporárias são reenviadas automaticamente, com até 6 tentativas. Avisos vencem
          após 10 minutos. Dispositivos sem sessão válida ou com acesso revogado deixam de receber
          notificações.
        </p>
      </section>
      {editing && config && (
        <Modal
          title="Configurar notificações push"
          className="push-rules-modal"
          onClose={() => setEditing(false)}
          closeDisabled={busy}
          dirty={JSON.stringify(draft) !== JSON.stringify(initial)}
        >
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                setConfig(await api('/push/settings', draft, 'PATCH'));
                setEditing(false);
              }, 'Preferências de notificações salvas.');
            }}
          >
            <label className="checkbox-label push-enable-label">
              <input
                type="checkbox"
                checked={draft.enabled}
                disabled={!config.configured}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, enabled: event.target.checked }))
                }
              />
              Ativar envio de notificações nesta filial
            </label>
            {!config.configured && (
              <p className="alert">
                A configuração das chaves VAPID no servidor precisa ser concluída antes de ativar os
                envios.
              </p>
            )}
            <p className="muted small">
              Escolha os eventos e os perfis. Um perfil só pode receber informações que já tem
              permissão para acessar no sistema.
            </p>
            <div className="push-event-rules">
              {config.events.map((event: Data) => {
                const rule = draft.rules.find((item) => item.event === event.key)!;
                return (
                  <fieldset key={event.key} className="push-event-rule">
                    <legend>{event.label}</legend>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={(input) =>
                          changeRule(event.key, { enabled: input.target.checked })
                        }
                      />
                      Enviar este aviso
                    </label>
                    <p className="muted small">{event.description}</p>
                    <div className="push-role-choices">
                      {config.roles.map((role: Data) => {
                        const allowed = role.permissions.includes(event.permission);
                        return (
                          <label
                            key={role.id}
                            className={`checkbox-label ${!allowed ? 'muted' : ''}`}
                            title={!allowed ? 'Este perfil não tem acesso à operação.' : undefined}
                          >
                            <input
                              type="checkbox"
                              aria-label={event.label + ' para ' + role.name}
                              checked={rule.role_ids.includes(role.id)}
                              disabled={
                                !rule.enabled || (!allowed && !rule.role_ids.includes(role.id))
                              }
                              onChange={(input) =>
                                changeRule(event.key, {
                                  role_ids: input.target.checked
                                    ? [...rule.role_ids, role.id]
                                    : rule.role_ids.filter((id) => id !== role.id),
                                })
                              }
                            />
                            {role.name}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                );
              })}
            </div>
            <div className="modal-footer">
              <ModalCloseButton disabled={busy} />
              <button className="primary" disabled={busy}>
                <Icon name="check" size={16} />
                {busy ? 'Salvando…' : 'Salvar configurações'}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {disabling && (
        <Modal
          title="Desativar dispositivo push?"
          onClose={() => setDisabling(null)}
          closeDisabled={busy}
        >
          <p>
            O dispositivo <strong>{disabling.device_name}</strong> deixará de receber avisos desta
            filial. O funcionário poderá ativá-lo novamente no próprio aparelho.
          </p>
          <div className="modal-footer">
            <ModalCloseButton disabled={busy} />
            <button
              className="danger"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api('/push/devices/' + disabling.id + '/disable', {});
                  setDisabling(null);
                  await loadDevices();
                }, 'Dispositivo desativado.')
              }
            >
              <Icon name="close" size={16} />
              Confirmar desativação
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
