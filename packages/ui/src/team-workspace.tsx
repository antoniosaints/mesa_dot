import { AccountUsers, UserBranches } from './account-users.js';
import { Building2 } from 'lucide-react';
import { StaffCredentials } from './staff-credentials.js';
import { Copy } from 'lucide-react';
import { Pagination, TableLoading } from './pagination.js';
import { useEffect, useRef, useState } from 'react';
import {
  Users,
  UserCheck,
  UserX,
  ShieldCheck,
  Shield,
  Mail,
  Eye,
  Power,
  AlertCircle,
  Check,
} from 'lucide-react';
import { api, session, type Data } from './client.js';
import { Icon } from './appearance.js';
import { Empty, Modal, ModalCloseButton, useRefresh } from './common.js';
import { SearchSelect } from './controls.js';
import { useFormDialog } from './forms.js';
import { useToasts } from './toasts.js';
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toLocaleUpperCase('pt-BR');
function MemberStatus({ member }: { member: Data }) {
  return (
    <span className={'team-status ' + (member.enabled ? 'is-active' : 'is-inactive')}>
      {member.enabled ? <UserCheck size={13} /> : <UserX size={13} />}
      {member.enabled ? 'Ativo' : 'Desativado'}
    </span>
  );
}
export function TeamWorkspace() {
  const [accountUsersOpen, setAccountUsersOpen] = useState(false),
    [branchUserId, setBranchUserId] = useState('');
  const accountAdmin = Boolean(session()?.actor?.isAccountAdmin);
  const [credentials, setCredentials] = useState<{ member: Data; password?: string } | null>(null);
  const [response, setResponse] = useState<Data | null>(null),
    [roles, setRoles] = useState<Data[]>([]);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [search, setSearch] = useState(''),
    [role, setRole] = useState(''),
    [status, setStatus] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const [sort, setSort] = useState('name'),
    [descending, setDescending] = useState(false);
  const [page, setPage] = useState(1),
    [size, setSize] = useState(10);
  const [detailId, setDetailId] = useState(''),
    [confirmId, setConfirmId] = useState('');
  const [saving, setSaving] = useState(false),
    [actionError, setActionError] = useState('');
  const alive = useRef(true),
    version = useRef(0),
    locked = useRef(false),
    pendingRequest = useRef<AbortController | null>(null);
  const forms = useFormDialog(),
    toast = useToasts(),
    actorId = session()?.actor?.id;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      version.current++;
      pendingRequest.current?.abort();
    };
  }, []);
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(size),
    search: debounced,
    sort,
    direction: descending ? 'desc' : 'asc',
    ...(role ? { role_id: role } : {}),
    ...(status ? { status } : {}),
  }).toString();
  const members: Data[] | null = response?._key === query ? response.rows : null;
  const summary = response?.summary;
  const queryBusy = loading || search.trim() !== debounced || (!members && !error);
  async function load() {
    const request = ++version.current;
    pendingRequest.current?.abort();
    const controller = new AbortController();
    pendingRequest.current = controller;
    setLoading(true);
    try {
      const [people, profiles] = await Promise.all([
        api('/staff?' + query, undefined, undefined, undefined, 'json', controller.signal),
        api('/roles', undefined, undefined, undefined, 'json', controller.signal),
      ]);
      if (alive.current && request === version.current) {
        setResponse({ ...people, _key: query });
        setRoles(profiles);
        setError('');
        if (people.page !== page) setPage(people.page);
      }
    } catch (e) {
      if (alive.current && request === version.current) setError((e as Error).message);
    } finally {
      if (alive.current && request === version.current) setLoading(false);
    }
  }
  useRefresh(load, [query]);
  const rows = members ?? [];
  const pagination = {
    rows,
    total: Number(response?.total ?? 0),
    page: members ? response!.page : page,
  };
  const detail = members?.find((m) => m.id === detailId),
    target = members?.find((m) => m.id === confirmId);
  const options = roles.map((r) => ({ id: r.id, name: r.name }));
  function addMember() {
    forms.open({
      title: 'Adicionar funcionário',
      description:
        'Cadastre o funcionário nesta filial. Para usar uma pessoa já cadastrada em outra filial, abra Usuários e filiais.',
      fields: [
        { key: 'name', label: 'Nome', required: true, maxLength: 160 },
        { key: 'email', label: 'E-mail', type: 'email', required: true, maxLength: 190 },
        {
          key: 'password',
          label: 'Senha inicial',
          type: 'password',
          required: true,
          minLength: 12,
          maxLength: 200,
          hint: 'Use pelo menos 12 caracteres.',
        },
        { key: 'role_id', label: 'Perfil', type: 'select', required: true, options },
      ],
      submitLabel: 'Cadastrar funcionário',
      successMessage: 'Funcionário cadastrado.',
      onSubmit: async (values) => {
        const created = await api('/staff', values);
        await load();
        return {
          member: {
            id: created.membership_id,
            user_id: created.id,
            name: created.name,
            email: created.email,
            role_name: roles.find((role) => role.id === values.role_id)?.name,
            access_surface: roles.find((role) => role.id === values.role_id)?.access_surface,
            enabled: true,
          },
          password: values.password,
        };
      },
      onSuccess: setCredentials,
    });
  }
  function editRole(member: Data) {
    if (member.user_id === actorId) return;
    forms.open({
      title: 'Alterar perfil de acesso',
      description: member.name + ' · ' + member.email,
      fields: [{ key: 'role_id', label: 'Perfil', type: 'select', required: true, options }],
      initial: { role_id: member.role_id },
      submitLabel: 'Salvar perfil',
      successMessage: 'Perfil atualizado.',
      onSubmit: async (values) => {
        await api(
          `/staff/${member.id}`,
          { enabled: Boolean(member.enabled), role_id: values.role_id },
          'PATCH',
        );
        await load();
      },
    });
  }
  async function changeStatus() {
    if (!target || locked.current || target.user_id === actorId) return;
    locked.current = true;
    setSaving(true);
    setActionError('');
    try {
      await api(`/staff/${target.id}`, { enabled: !target.enabled }, 'PATCH');
      toast.success(
        target.enabled ? 'Acesso desativado nesta unidade.' : 'Acesso ativado nesta unidade.',
      );
      if (alive.current) setConfirmId('');
      await load();
    } catch (e) {
      if (alive.current) {
        setActionError((e as Error).message);
        toast.error((e as Error).message);
      }
    } finally {
      locked.current = false;
      if (alive.current) setSaving(false);
    }
  }
  function orderBy(key: string) {
    setSort(key);
    setDescending(sort === key ? !descending : false);
    setPage(1);
  }
  const self = (m: Data) => m.user_id === actorId;
  return (
    <div className="team-workspace">
      <div className="cash-heading">
        <div>
          <span className="eyebrow">CADASTRO / PESSOAS E ACESSOS</span>
          <h1>Equipe</h1>
          <p className="muted">Gerencie os funcionários e os perfis de acesso desta unidade.</p>
        </div>
        <div className="button-row">
          {accountAdmin && (
            <button onClick={() => setAccountUsersOpen(true)}>
              <Building2 size={16} />
              Usuários e filiais
            </button>
          )}
          <button onClick={() => void load()} disabled={queryBusy}>
            <Icon name="refresh" size={16} />
            Recarregar
          </button>
          <button className="primary" onClick={addMember} disabled={!roles.length}>
            <Icon name="plus" size={16} />
            Adicionar funcionário
          </button>
        </div>
      </div>
      {error && (
        <div className="alert error" role="alert">
          <AlertCircle size={18} />
          <span>
            {error}
            {members ? ' Os últimos dados carregados estão sendo exibidos.' : ''}
          </span>
          <button onClick={() => void load()} disabled={queryBusy}>
            Tentar novamente
          </button>
        </div>
      )}
      <div className="team-kpis" aria-label="Resumo da equipe da unidade">
        {[
          {
            label: 'Funcionários',
            value: summary ? Number(summary.total) : undefined,
            icon: Users,
            hint: 'Vínculos nesta unidade',
            tone: 'blue',
          },
          {
            label: 'Ativos',
            value: summary ? Number(summary.active) : undefined,
            icon: UserCheck,
            hint: 'Vínculos habilitados',
            tone: 'green',
          },
          {
            label: 'Desativados',
            value: summary ? Number(summary.inactive) : undefined,
            icon: UserX,
            hint: 'Sem acesso por este vínculo',
            tone: 'gray',
          },
          {
            label: 'Perfis em uso',
            value: summary ? Number(summary.profiles) : undefined,
            icon: ShieldCheck,
            hint: 'Funções atribuídas à equipe',
            tone: 'blue',
          },
        ].map((k) => (
          <section className={'panel team-kpi ' + k.tone} key={k.label}>
            <span className="team-kpi-icon">
              <k.icon size={21} />
            </span>
            <div>
              <span>{k.label}</span>
              <strong>{k.value ?? '—'}</strong>
              <small>{k.hint}</small>
            </div>
          </section>
        ))}
      </div>
      <section className="panel team-directory" aria-busy={queryBusy}>
        <div className="team-list-heading">
          <div>
            <h2>Funcionários e acessos</h2>
            <p className="field-hint">
              Consulte os dados de contato, o perfil e a situação de cada funcionário.
            </p>
          </div>
          <span className="team-unit">
            <Users size={14} />
            {summary ? `${summary.total} funcionário(s)` : 'Carregando…'}
          </span>
        </div>
        <div className="team-filters">
          <label>
            Buscar funcionário
            <div className="search-input">
              <Icon name="search" size={17} />
              <input
                type="search"
                aria-label="Buscar funcionários"
                placeholder="Nome, e-mail ou perfil…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          </label>
          <label>
            Perfil de acesso
            <SearchSelect
              label="Filtrar por perfil"
              placeholder="Todos os perfis"
              options={options}
              value={role}
              onChange={(v) => {
                setRole(v);
                setPage(1);
              }}
            />
          </label>
          <label>
            Situação
            <select
              aria-label="Situação do funcionário"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Todas as situações</option>
              <option value="active">Ativos</option>
              <option value="inactive">Desativados</option>
            </select>
          </label>
        </div>
        <div className="team-results">
          <span role="status">
            {members ? `${pagination.total} funcionário(s) encontrado(s)` : 'Carregando equipe…'}
          </span>
          {(search || role || status) && (
            <button
              onClick={() => {
                setSearch('');
                setRole('');
                setStatus('');
                setPage(1);
              }}
            >
              Limpar filtros
            </button>
          )}
        </div>
        {!members && queryBusy ? (
          <TableLoading label="Carregando equipe…" />
        ) : !rows.length ? (
          <Empty>
            {error && !members
              ? 'Não foi possível carregar a equipe. Tente novamente.'
              : Number(summary?.total) > 0
                ? 'Nenhum funcionário corresponde aos filtros. Limpe a busca ou altere a seleção.'
                : 'A equipe desta unidade ainda não possui funcionários cadastrados.'}
          </Empty>
        ) : (
          <>
            <table className="team-table" aria-label="Funcionários da unidade">
              <thead>
                <tr>
                  {[
                    ['name', 'Funcionário'],
                    ['role_name', 'Perfil de acesso'],
                    ['enabled', 'Situação'],
                  ].map(([key, label]) => (
                    <th
                      key={key}
                      aria-sort={sort === key ? (descending ? 'descending' : 'ascending') : 'none'}
                    >
                      <button onClick={() => orderBy(key)}>
                        {label}
                        <Icon
                          name={sort === key ? (descending ? 'sort-down' : 'sort-up') : 'sort'}
                          size={13}
                        />
                      </button>
                    </th>
                  ))}
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {pagination.rows.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <div className="team-person">
                        <span className="team-avatar" aria-hidden="true">
                          {initials(m.name || 'Funcionário')}
                        </span>
                        <div>
                          <strong>
                            {m.name || 'Funcionário sem nome'}
                            {self(m) && <span className="team-self">Você</span>}
                          </strong>
                          <small>{m.email || 'E-mail não informado'}</small>
                        </div>
                      </div>
                    </td>
                    <td data-label="Perfil">
                      <div className="team-role">
                        <span>
                          <Shield size={14} />
                          {m.role_name}
                        </span>
                        {Boolean(m.is_account_admin) && <small>Admin geral da conta</small>}
                      </div>
                    </td>
                    <td data-label="Situação">
                      <MemberStatus member={m} />
                    </td>
                    <td>
                      <div className="team-row-actions">
                        {accountAdmin && (
                          <button
                            className="icon-button"
                            title="Definir filiais"
                            aria-label={'Definir filiais de ' + m.name}
                            onClick={() => setBranchUserId(m.user_id)}
                          >
                            <Building2 size={16} />
                          </button>
                        )}
                        <button
                          onClick={() => setDetailId(m.id)}
                          aria-label={'Ver funcionário ' + m.name}
                        >
                          <Eye size={15} />
                          <span>Ver</span>
                        </button>
                        <button
                          className="icon-button"
                          disabled={!m.enabled}
                          title="Copiar credenciais"
                          aria-label={'Copiar credenciais de ' + m.name}
                          onClick={() => setCredentials({ member: m })}
                        >
                          <Copy size={16} />
                        </button>
                        <button
                          className="icon-button"
                          disabled={self(m)}
                          title={
                            self(m)
                              ? 'Seu próprio vínculo não pode ser alterado.'
                              : 'Alterar perfil'
                          }
                          aria-label={'Alterar perfil de ' + m.name}
                          onClick={() => editRole(m)}
                        >
                          <Shield size={16} />
                        </button>
                        <button
                          className={'icon-button ' + (m.enabled ? 'team-disable' : 'team-enable')}
                          disabled={self(m)}
                          title={
                            self(m)
                              ? 'Seu próprio vínculo não pode ser alterado.'
                              : m.enabled
                                ? 'Desativar acesso'
                                : 'Ativar acesso'
                          }
                          aria-label={
                            (m.enabled ? 'Desativar acesso de ' : 'Ativar acesso de ') + m.name
                          }
                          onClick={() => {
                            setConfirmId(m.id);
                            setActionError('');
                          }}
                        >
                          <Power size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {(!error || members) && (
          <Pagination
            label="Equipe"
            total={pagination.total}
            page={pagination.page}
            pageSize={size}
            onPageChange={setPage}
            onPageSizeChange={setSize}
            loading={queryBusy}
            sizeLabel="Funcionários por página"
            pageSizeOptions={[10, 20, 50]}
            previousLabel="Página anterior da equipe"
            nextLabel="Próxima página da equipe"
          />
        )}
        <div className="team-security-note">
          <ShieldCheck size={16} />
          <p>
            As alterações valem para esta unidade. Seu próprio vínculo é protegido; o acesso ao
            financeiro da conta permanece exclusivo do admin geral.
          </p>
        </div>
      </section>
      {accountUsersOpen && (
        <AccountUsers onClose={() => setAccountUsersOpen(false)} onChanged={() => void load()} />
      )}
      {branchUserId && (
        <UserBranches
          userId={branchUserId}
          onClose={() => setBranchUserId('')}
          onSaved={() => {
            setBranchUserId('');
            void load();
          }}
        />
      )}
      {detail && (
        <Modal
          title={'Funcionário · ' + detail.name}
          className="team-detail-drawer"
          onClose={() => setDetailId('')}
        >
          <div className="team-detail-body">
            <div className="team-detail-identity">
              <span className="team-avatar" aria-hidden="true">
                {initials(detail.name)}
              </span>
              <h3>{detail.name}</h3>
              <MemberStatus member={detail} />
              {self(detail) && <span className="team-self">Este é o seu acesso</span>}
            </div>
            <dl className="team-detail-fields">
              <div>
                <dt>
                  <Mail size={15} />
                  E-mail de acesso
                </dt>
                <dd>{detail.email}</dd>
              </div>
              <div>
                <dt>
                  <Shield size={15} />
                  Perfil nesta unidade
                </dt>
                <dd>{detail.role_name}</dd>
              </div>
              <div>
                <dt>
                  <ShieldCheck size={15} />
                  Administração geral da conta
                </dt>
                <dd>
                  {detail.is_account_admin ? 'Admin geral da conta' : 'Sem acesso de admin geral'}
                </dd>
              </div>
            </dl>
            <div className="team-security-note">
              <ShieldCheck size={18} />
              <p>
                O perfil define as permissões operacionais. Alterar o perfil não concede
                administração geral da conta.
              </p>
            </div>
            {accountAdmin && (
              <button onClick={() => setBranchUserId(detail.user_id)}>
                <Building2 size={16} />
                Definir filiais e perfis
              </button>
            )}
            <button disabled={!detail.enabled} onClick={() => setCredentials({ member: detail })}>
              <Copy size={16} />
              Copiar credenciais
            </button>
            {!self(detail) && (
              <div className="team-detail-actions">
                <button onClick={() => editRole(detail)}>
                  <Shield size={16} />
                  Alterar perfil de acesso
                </button>
                <button
                  className={detail.enabled ? 'team-disable' : 'team-enable'}
                  onClick={() => {
                    setConfirmId(detail.id);
                    setActionError('');
                  }}
                >
                  <Power size={16} />
                  {detail.enabled ? 'Desativar acesso' : 'Ativar acesso'}
                </button>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <ModalCloseButton>Fechar detalhes</ModalCloseButton>
          </div>
        </Modal>
      )}
      {target && (
        <Modal
          title={
            target.enabled ? 'Desativar acesso do funcionário?' : 'Ativar acesso do funcionário?'
          }
          role="alertdialog"
          closeDisabled={saving}
          onClose={() => setConfirmId('')}
        >
          <div className="team-confirm-person">
            <span className="team-avatar" aria-hidden="true">
              {initials(target.name)}
            </span>
            <div>
              <strong>{target.name}</strong>
              <small>
                {target.email} · {target.role_name}
              </small>
            </div>
          </div>
          <p className="modal-description">
            {target.enabled
              ? 'O funcionário perderá o acesso a esta unidade. O histórico das operações será preservado. Você poderá reativar o vínculo depois.'
              : 'O funcionário voltará a acessar esta unidade com o perfil indicado acima.'}
          </p>
          {actionError && (
            <div className="alert error" role="alert">
              {actionError}
            </div>
          )}
          <div className="modal-footer">
            <ModalCloseButton disabled={saving}>Voltar</ModalCloseButton>
            <button
              className={target.enabled ? 'danger' : 'primary'}
              disabled={saving}
              onClick={() => void changeStatus()}
            >
              {target.enabled ? <UserX size={16} /> : <Check size={16} />}
              {saving
                ? 'Salvando…'
                : target.enabled
                  ? 'Confirmar desativação'
                  : 'Confirmar ativação'}
            </button>
          </div>
        </Modal>
      )}
      {credentials && (
        <StaffCredentials
          member={credentials.member}
          initialPassword={credentials.password}
          onClose={() => setCredentials(null)}
        />
      )}
      {forms.dialog}
    </div>
  );
}
