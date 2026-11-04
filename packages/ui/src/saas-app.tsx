import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CirclePause,
  CreditCard,
  ExternalLink,
  Eye,
  FileClock,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
  Store,
} from 'lucide-react';
import { api, brl, saveSession, type Data } from './client.js';
import { MesaLogo } from './mesa-site.js';
import { Modal, ModalCloseButton, useStaff } from './common.js';
import { Pagination, TableLoading, paginate } from './pagination.js';
import { MoneyInput } from './money-input.js';
import { useToasts } from './toasts.js';
const statusNames: Record<string, string> = {
  TRIAL: 'Em avaliação',
  ACTIVE: 'Ativa',
  PAST_DUE: 'Em atraso',
  CANCELLED: 'Cancelada',
};
const auditNames: Record<string, string> = {
  'tenant.provisioned': 'Conta criada pelo gestor',
  'tenant.status_updated': 'Situação da conta alterada',
  'plan.created': 'Plano criado',
  'subscription.created': 'Plano vinculado à conta',
  'subscription.updated': 'Assinatura atualizada',
};
const date = (value: string | null, full = false) =>
  value
    ? new Date(
        value.replace(' ', 'T') + (/Z$|[+-]\d\d:\d\d$/.test(value) ? '' : 'Z'),
      ).toLocaleString('pt-BR', full ? {} : { dateStyle: 'short' })
    : 'Não definido';
const nav = [
  { path: '/gestor', label: 'Contas', icon: Building2 },
  { path: '/gestor/planos', label: 'Planos', icon: CreditCard },
  { path: '/gestor/auditoria', label: 'Auditoria', icon: FileClock },
];
function useRequestKey() {
  const attempt = useRef({ body: '', key: crypto.randomUUID() });
  return (body: unknown) => {
    const value = JSON.stringify(body);
    if (attempt.current.body !== value) attempt.current = { body: value, key: crypto.randomUUID() };
    return attempt.current.key;
  };
}
export function SaasApp() {
  const { current, setCurrent, signOut } = useStaff();
  const [me, setMe] = useState<Data | null>(null),
    [verifying, setVerifying] = useState(Boolean(current)),
    [error, setError] = useState('');
  const location = useLocation();
  useEffect(() => {
    if (!current) {
      setMe(null);
      setVerifying(false);
      return;
    }
    const controller = new AbortController();
    setVerifying(true);
    void api('/saas/me', undefined, undefined, undefined, 'json', controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setMe(value);
          setError('');
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          saveSession(null);
          setCurrent(null);
          setError(e.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setVerifying(false);
      });
    return () => controller.abort();
  }, [current?.actor?.id]);
  if (verifying)
    return (
      <div className="mesa-root-login mesa-auth">
        <TableLoading label="Validando acesso do gestor…" />
      </div>
    );
  if (!me || !current)
    return (
      <RootLogin
        error={error}
        onLogin={(value) => {
          saveSession(value);
          setCurrent(value);
        }}
      />
    );
  const selected = location.pathname.replace(/\/$/, '');
  const active = nav.find((n) => n.path === selected)?.path;
  return (
    <div className="mesa-root">
      <aside className="mesa-root-sidebar">
        <Link to="/" aria-label="Mesa, início">
          <MesaLogo />
        </Link>
        <small>Gestor da plataforma</small>
        <nav aria-label="Gestão do SaaS">
          {nav.map(({ icon: Icon, path, label }) => (
            <Link key={path} to={path} className={active === path ? 'active' : ''}>
              <Icon size={18} />
              {label}
            </Link>
          ))}
        </nav>
        <footer>
          <strong>{me.name}</strong>
          <small>{me.email}</small>
          <button onClick={() => void signOut()}>
            <LogOut size={16} /> Sair do gestor
          </button>
        </footer>
      </aside>
      <div className="mesa-root-body">
        <header className="mesa-root-header">
          <span>
            <ShieldCheck size={18} /> AMBIENTE EXCLUSIVO DO GESTOR SAAS
          </span>
          <Link to="/">
            Ver site <ExternalLink size={14} />
          </Link>
        </header>
        <nav className="mesa-root-mobile-nav" aria-label="Gestão do SaaS no celular">
          {nav.map(({ path, label }) => (
            <Link key={path} to={path} className={active === path ? 'active' : ''}>
              {label}
            </Link>
          ))}
          <button aria-label="Sair do gestor" onClick={() => void signOut()}>
            <LogOut size={16} />
          </button>
        </nav>
        <main className="mesa-root-main">
          {selected === '/gestor' || selected === '/gestor/entrar' ? (
            <Accounts />
          ) : selected === '/gestor/planos' ? (
            <Plans />
          ) : selected === '/gestor/auditoria' ? (
            <Audit />
          ) : (
            <div className="mesa-root-card mesa-root-empty">
              <h1>Tela não encontrada</h1>
              <Link to="/gestor">Voltar para as contas</Link>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
function RootLogin({
  onLogin,
  error: initialError,
}: {
  onLogin: (value: Data) => void;
  error: string;
}) {
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(initialError);
  return (
    <div className="mesa-public mesa-auth mesa-root-login">
      <header className="mesa-container">
        <Link to="/" aria-label="Mesa, início">
          <MesaLogo />
        </Link>
        <Link to="/entrar">
          <ArrowLeft size={15} /> Acesso do restaurante
        </Link>
      </header>
      <main className="mesa-auth-panel">
        <span className="mesa-kicker">
          <ShieldCheck size={15} /> GESTÃO DA PLATAFORMA
        </span>
        <h2>Entrar no gestor SaaS</h2>
        <p>Acesso exclusivo para administrar as contas e os planos do Mesa.</p>
        <form
          className="mesa-signup-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError('');
            try {
              onLogin(await api('/auth/saas/login', { email, password }));
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            E-mail do gestor
            <input
              type="email"
              required
              autoComplete="username"
              maxLength={190}
              value={email}
              disabled={busy}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Senha do gestor
            <input
              type="password"
              required
              autoComplete="current-password"
              maxLength={200}
              value={password}
              disabled={busy}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="mesa-form-error">
              {error}
            </p>
          )}
          <button className="mesa-btn mesa-btn-primary" disabled={busy}>
            {busy ? 'Validando acesso…' : 'Entrar no gestor'}
            <ArrowRight size={17} />
          </button>
        </form>
        <div className="mesa-auth-panel-footer">
          Administra um restaurante? <Link to="/entrar">Encontre seu estabelecimento</Link>
        </div>
      </main>
      <footer className="mesa-auth-footer">Mesa · Gestão de contas da plataforma</footer>
    </div>
  );
}
function Accounts() {
  const [overview, setOverview] = useState<Data | null>(null),
    [data, setData] = useState<Data>({ items: [], total: 0 }),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState('all'),
    [page, setPage] = useState(1),
    [size, setSize] = useState(10),
    [version, setVersion] = useState(0);
  const [create, setCreate] = useState(false),
    [detail, setDetail] = useState<string | null>(null);
  function refresh() {
    setVersion((v) => v + 1);
  }
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const timer = setTimeout(() => {
      void Promise.all([
        api(
          '/saas/accounts?' +
            new URLSearchParams({ page: String(page), page_size: String(size), search, status }),
          undefined,
          undefined,
          undefined,
          'json',
          controller.signal,
        ),
        api('/saas/overview', undefined, undefined, undefined, 'json', controller.signal),
      ])
        .then(([list, stats]) => {
          if (!controller.signal.aborted) {
            setData(list);
            setOverview(stats);
            if (list.page !== page) setPage(list.page);
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, status, page, size, version]);
  return (
    <>
      <div className="mesa-root-title">
        <div>
          <span className="mesa-kicker">GESTÃO DO SAAS</span>
          <h1>Contas da plataforma</h1>
          <p>Acompanhe estabelecimentos, acessos e assinaturas.</p>
        </div>
        <button className="mesa-btn mesa-btn-primary" onClick={() => setCreate(true)}>
          <Plus size={17} />
          Nova conta
        </button>
      </div>
      <div className="mesa-root-kpis">
        {[
          [Building2, 'Contas cadastradas', overview?.total],
          [Check, 'Contas ativas', overview?.active],
          [CirclePause, 'Contas suspensas', overview?.suspended],
          [Store, 'Estabelecimentos', overview?.establishments],
        ].map(([Icon, title, value]) => {
          const KpiIcon = Icon as typeof Building2;
          return (
            <article key={String(title)}>
              <small>
                <KpiIcon size={16} />
                {String(title)}
              </small>
              <strong>{value === undefined ? '—' : String(value)}</strong>
            </article>
          );
        })}
      </div>
      <section className="mesa-root-card">
        <div className="mesa-root-card-header">
          <div>
            <h2>Seus clientes</h2>
            <p>Contas de restaurantes e bares, separadas da administração da plataforma.</p>
          </div>
          <button aria-label="Atualizar contas" onClick={refresh} disabled={loading}>
            <RefreshCw size={16} />
          </button>
        </div>
        <div className="mesa-root-filters">
          <label>
            Buscar conta
            <input
              type="search"
              placeholder="Nome, endereço ou e-mail do administrador…"
              maxLength={160}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            Situação
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">Todas as contas</option>
              <option value="active">Ativas</option>
              <option value="suspended">Suspensas</option>
            </select>
          </label>
        </div>
        {error ? (
          <div className="mesa-root-empty" role="alert">
            {error}
            <button onClick={refresh}>Tentar novamente</button>
          </div>
        ) : loading ? (
          <TableLoading label="Carregando contas…" />
        ) : (
          <div className="mesa-root-scroll">
            <table
              className="mesa-root-table mesa-root-account-table mobile-card-table"
              role="table"
            >
              <thead>
                <tr>
                  <th>Conta / administrador</th>
                  <th>Unidades</th>
                  <th>Situação</th>
                  <th>Plano / assinatura</th>
                  <th>Cadastro</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item: Data) => (
                  <tr key={item.id}>
                    <td data-label="Conta">
                      <strong>{item.name}</strong>
                      <small>{item.owner_email}</small>
                      <small>/{item.slug}</small>
                    </td>
                    <td data-label="Unidades">{item.establishments}</td>
                    <td data-label="Situação">
                      <span className={'mesa-root-badge' + (!item.enabled ? ' is-suspended' : '')}>
                        {item.enabled ? 'Ativa' : 'Suspensa'}
                      </span>
                    </td>
                    <td data-label="Plano / assinatura">
                      <strong>{item.plan_name ?? 'Sem plano'}</strong>
                      <small>
                        {statusNames[item.subscription_status] ?? 'Não vinculado'}
                        {item.valid_until ? ' · até ' + date(item.valid_until) : ''}
                      </small>
                    </td>
                    <td data-label="Cadastro">{date(item.created_at)}</td>
                    <td data-label="Ações">
                      <button onClick={() => setDetail(item.id)}>
                        <Eye size={14} />
                        Gerenciar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.items.length && (
              <div className="mesa-root-empty">Nenhuma conta encontrada com estes filtros.</div>
            )}
          </div>
        )}
        <Pagination
          total={data.total}
          page={page}
          pageSize={size}
          label="contas SaaS"
          loading={loading}
          onPageChange={setPage}
          onPageSizeChange={setSize}
        />
      </section>
      {create && (
        <CreateAccount
          onClose={() => setCreate(false)}
          onSaved={() => {
            setCreate(false);
            setPage(1);
            refresh();
          }}
        />
      )}
      {detail && <AccountDetail id={detail} onClose={() => setDetail(null)} onChanged={refresh} />}
    </>
  );
}
function CreateAccount({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: '', owner_name: '', owner_email: '', password: '' }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const key = useRef(crypto.randomUUID()),
    previous = useRef('');
  const toast = useToasts();
  return (
    <Modal
      className="mesa-root-modal"
      title="Criar conta de estabelecimento"
      onClose={onClose}
      dirty={Object.values(form).some(Boolean)}
      closeDisabled={busy}
    >
      <p className="muted">
        Crie uma conta independente. O responsável receberá acesso de administrador do
        estabelecimento.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          const body = JSON.stringify(form);
          if (previous.current !== body) {
            previous.current = body;
            key.current = crypto.randomUUID();
          }
          try {
            await api('/saas/tenants', form, 'POST', key.current);
            toast.success('Conta criada. O administrador já pode entrar com os dados informados.');
            onSaved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          {[
            ['name', 'Nome do estabelecimento', 'text'],
            ['owner_name', 'Nome do administrador', 'text'],
            ['owner_email', 'E-mail do administrador', 'email'],
            ['password', 'Senha inicial (mínimo 12 caracteres)', 'password'],
          ].map(([key, label, type]) => (
            <label key={key}>
              {label}
              <input
                type={type}
                required
                minLength={key === 'password' ? 12 : key === 'owner_email' ? undefined : 2}
                maxLength={key === 'password' ? 200 : key === 'owner_email' ? 190 : 160}
                autoComplete={key === 'password' ? 'new-password' : 'off'}
                disabled={busy}
                value={form[key as keyof typeof form]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </label>
          ))}
        </div>
        {error && (
          <p className="mesa-form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <ModalCloseButton disabled={busy} />
          <button className="primary" disabled={busy}>
            {busy ? 'Criando…' : 'Criar conta'}
            <Plus size={16} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
function AccountDetail({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<Data | null>(null),
    [plans, setPlans] = useState<Data[]>([]),
    [error, setError] = useState(''),
    [version, setVersion] = useState(0),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [subscription, setSubscription] = useState(false);
  const toast = useToasts();
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      api('/saas/accounts/' + id, undefined, undefined, undefined, 'json', controller.signal),
      api('/saas/plans', undefined, undefined, undefined, 'json', controller.signal),
    ])
      .then(([account, list]) => {
        if (!controller.signal.aborted) {
          setData(account);
          setPlans(list);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [id, version]);
  function changed() {
    setVersion((v) => v + 1);
    onChanged();
  }
  return (
    <Modal
      className="mesa-root-modal"
      title={data ? 'Gerenciar conta · ' + data.name : 'Gerenciar conta'}
      onClose={onClose}
      closeDisabled={busy}
    >
      {error && (
        <p className="mesa-form-error" role="alert">
          {error}
        </p>
      )}
      {!data ? (
        <TableLoading />
      ) : (
        <>
          <div className="section-head">
            <span className={'mesa-root-badge' + (!data.enabled ? ' is-suspended' : '')}>
              {data.enabled ? 'Conta ativa' : 'Conta suspensa'}
            </span>
            <small className="muted">Cadastrada em {date(data.created_at)}</small>
          </div>
          <h3>Administradores da conta</h3>
          <div className="mesa-detail-rows">
            {data.owners.map((owner: Data) => (
              <div key={owner.email}>
                <strong>{owner.name}</strong>
                <small>{owner.email}</small>
              </div>
            ))}
          </div>
          <h3>Estabelecimentos e acessos</h3>
          <div className="mesa-detail-rows">
            {data.units.map((unit: Data) => (
              <div key={unit.id}>
                <strong>{unit.name}</strong>
                <a href={'/' + unit.slug + '/'} target="_blank" rel="noreferrer">
                  /{unit.slug}/ <ExternalLink size={13} />
                </a>
              </div>
            ))}
          </div>
          <div className="section-head">
            <h3>Assinatura</h3>
            <button
              disabled={!plans.length}
              title={!plans.length ? 'Cadastre um plano na tela Planos.' : undefined}
              onClick={() => setSubscription(true)}
            >
              <CreditCard size={15} />
              {data.subscriptions.length ? 'Alterar assinatura' : 'Vincular plano'}
            </button>
          </div>
          {!plans.length && (
            <p className="muted">Cadastre um plano na tela Planos para vinculá-lo a esta conta.</p>
          )}
          {data.subscriptions.length ? (
            <div className="mesa-detail-rows">
              {data.subscriptions.map((sub: Data, i: number) => (
                <div key={sub.id}>
                  <strong>
                    {sub.plan_name} · {brl(sub.monthly_price)}/mês
                  </strong>
                  <small>
                    {statusNames[sub.status]} · validade {date(sub.valid_until)}
                    {i === 0 ? ' · assinatura atual' : ' · registro anterior'}
                  </small>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">Esta conta ainda não possui um plano vinculado.</p>
          )}
          <p className="mesa-root-info">
            A situação da assinatura é um registro de gestão. A suspensão do acesso é feita
            explicitamente no botão abaixo. Não há cobrança automática de cartão neste painel.
          </p>
          <div className="modal-footer">
            <ModalCloseButton>Fechar</ModalCloseButton>
            <button
              className={data.enabled ? 'danger' : 'primary'}
              onClick={() => setConfirm(true)}
            >
              {data.enabled ? <CirclePause size={16} /> : <Check size={16} />}
              {data.enabled ? 'Suspender conta' : 'Reativar conta'}
            </button>
          </div>
          {confirm && (
            <Modal
              className="mesa-root-modal"
              title={data.enabled ? 'Suspender acesso desta conta?' : 'Reativar esta conta?'}
              onClose={() => setConfirm(false)}
              closeDisabled={busy}
            >
              <p>
                {data.enabled
                  ? 'Os usuários de ' +
                    data.name +
                    ' ficarão sem acesso, inclusive os clientes no cardápio. Os dados continuarão preservados. Você poderá reativar a conta aqui.'
                  : 'Os usuários e clientes de ' +
                    data.name +
                    ' poderão voltar a acessar o sistema.'}
              </p>
              <div className="modal-footer">
                <ModalCloseButton disabled={busy} />
                <button
                  className={data.enabled ? 'danger' : 'primary'}
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    try {
                      await api('/saas/tenants/' + id, { enabled: !data.enabled }, 'PATCH');
                      toast.success(
                        data.enabled ? 'Acesso da conta suspenso.' : 'Conta reativada.',
                      );
                      setConfirm(false);
                      changed();
                    } catch (e) {
                      setError((e as Error).message);
                      setConfirm(false);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy
                    ? 'Salvando…'
                    : data.enabled
                      ? 'Confirmar suspensão'
                      : 'Confirmar reativação'}
                </button>
              </div>
            </Modal>
          )}
          {subscription && (
            <Subscription
              account={data}
              plans={plans}
              onClose={() => setSubscription(false)}
              onSaved={() => {
                setSubscription(false);
                changed();
              }}
            />
          )}
        </>
      )}
    </Modal>
  );
}
function Subscription({
  account,
  plans,
  onClose,
  onSaved,
}: {
  account: Data;
  plans: Data[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const current = account.subscriptions[0];
  const [plan, setPlan] = useState(current?.plan_id ?? plans[0]?.id ?? ''),
    [status, setStatus] = useState(current?.status ?? 'ACTIVE'),
    [until, setUntil] = useState(current?.valid_until?.slice(0, 10) ?? ''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const requestKey = useRequestKey(),
    toast = useToasts();
  return (
    <Modal
      className="mesa-root-modal"
      title="Configurar assinatura"
      onClose={onClose}
      dirty={
        plan !== (current?.plan_id ?? plans[0]?.id ?? '') ||
        status !== (current?.status ?? 'ACTIVE') ||
        until !== (current?.valid_until?.slice(0, 10) ?? '')
      }
      closeDisabled={busy}
    >
      <p>{account.name}</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            const body = {
              plan_id: plan,
              status,
              valid_until: new Date(until + 'T23:59:59.000Z').toISOString(),
            };
            await api(
              current ? '/saas/subscriptions/' + current.id : '/saas/subscriptions',
              current ? body : { ...body, tenant_id: account.id },
              current ? 'PATCH' : 'POST',
              requestKey(body),
            );
            toast.success('Assinatura atualizada.');
            onSaved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <label>
            Plano
            <select
              aria-label="Plano"
              required
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
            >
              {plans.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name} · {brl(p.monthly_price)}/mês
                </option>
              ))}
            </select>
          </label>
          <label>
            Situação da assinatura
            <select
              aria-label="Situação da assinatura"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {Object.entries(statusNames).map(([v, title]) => (
                <option key={v} value={v}>
                  {title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Válida até
            <input required type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          </label>
        </div>
        {error && (
          <p className="mesa-form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <ModalCloseButton disabled={busy} />
          <button className="primary" disabled={busy}>
            {busy ? 'Salvando…' : 'Salvar assinatura'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function Plans() {
  const [data, setData] = useState<Data[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [create, setCreate] = useState(false),
    [version, setVersion] = useState(0),
    [page, setPage] = useState(1),
    [size, setSize] = useState(10);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void api('/saas/plans', undefined, undefined, undefined, 'json', controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) {
          setData(list);
          setError('');
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [version]);
  return (
    <>
      <div className="mesa-root-title">
        <div>
          <span className="mesa-kicker">OFERTA DA PLATAFORMA</span>
          <h1>Planos</h1>
          <p>Organize os planos comerciais que serão vinculados às contas.</p>
        </div>
        <button className="mesa-btn mesa-btn-primary" onClick={() => setCreate(true)}>
          <Plus size={17} />
          Novo plano
        </button>
      </div>
      <p className="mesa-root-info">
        O valor mensal serve ao controle comercial. A cobrança financeira e a aplicação automática
        de limites não são executadas por este cadastro.
      </p>
      <section className="mesa-root-card">
        {error ? (
          <div className="mesa-root-empty" role="alert">
            {error}
            <button onClick={() => setVersion((v) => v + 1)}>Tentar novamente</button>
          </div>
        ) : loading ? (
          <TableLoading />
        ) : (
          <div className="mesa-root-scroll">
            <table className="mesa-root-table mobile-card-table" role="table">
              <thead>
                <tr>
                  <th>Plano</th>
                  <th>Mensalidade</th>
                  <th>Cadastro</th>
                </tr>
              </thead>
              <tbody>
                {paginate(data, page, size).rows.map((p) => (
                  <tr key={p.id}>
                    <td data-label="Plano">
                      <strong>{p.name}</strong>
                    </td>
                    <td data-label="Mensalidade">{brl(p.monthly_price)}</td>
                    <td data-label="Cadastro">{date(p.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.length && (
              <div className="mesa-root-empty">
                Nenhum plano cadastrado. Crie seu primeiro plano.
              </div>
            )}
          </div>
        )}
        <Pagination
          label="planos SaaS"
          total={data.length}
          page={page}
          pageSize={size}
          onPageChange={setPage}
          onPageSizeChange={setSize}
          loading={loading}
        />
      </section>
      {create && (
        <CreatePlan
          onClose={() => setCreate(false)}
          onSaved={() => {
            setCreate(false);
            setVersion((v) => v + 1);
          }}
        />
      )}
    </>
  );
}
function CreatePlan({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(''),
    [price, setPrice] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const requestKey = useRequestKey(),
    toast = useToasts();
  return (
    <Modal
      className="mesa-root-modal"
      title="Novo plano"
      onClose={onClose}
      dirty={Boolean(name || price)}
      closeDisabled={busy}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await api(
              '/saas/plans',
              { name, monthly_price: price, limits_json: {} },
              'POST',
              requestKey({ name, monthly_price: price, limits_json: {} }),
            );
            toast.success('Plano cadastrado.');
            onSaved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <label>
            Nome do plano
            <input
              required
              minLength={2}
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Mensalidade
            <MoneyInput label="Mensalidade" value={price} onChange={setPrice} required />
          </label>
        </div>
        {error && (
          <p className="mesa-form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <ModalCloseButton disabled={busy} />
          <button className="primary" disabled={busy}>
            {busy ? 'Salvando…' : 'Criar plano'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function Audit() {
  const [data, setData] = useState<Data[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [page, setPage] = useState(1),
    [size, setSize] = useState(10),
    [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void api('/saas/audit-logs', undefined, undefined, undefined, 'json', controller.signal)
      .then((list) => {
        if (!controller.signal.aborted) {
          setData(list);
          setError('');
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [version]);
  return (
    <>
      <div className="mesa-root-title">
        <div>
          <span className="mesa-kicker">HISTÓRICO DE GESTÃO</span>
          <h1>Auditoria</h1>
          <p>Últimas 200 alterações feitas pelo gestor da plataforma.</p>
        </div>
        <button onClick={() => setVersion((v) => v + 1)} disabled={loading}>
          <RefreshCw size={16} />
          Atualizar
        </button>
      </div>
      <section className="mesa-root-card">
        {error ? (
          <div className="mesa-root-empty" role="alert">
            {error}
          </div>
        ) : loading ? (
          <TableLoading />
        ) : (
          <div className="mesa-root-scroll">
            <table className="mesa-root-table mobile-card-table" role="table">
              <thead>
                <tr>
                  <th>Data e hora</th>
                  <th>Ação</th>
                  <th>Registro</th>
                  <th>Responsável</th>
                </tr>
              </thead>
              <tbody>
                {paginate(data, page, size).rows.map((row) => (
                  <tr key={row.id}>
                    <td data-label="Data e hora">{date(row.created_at, true)}</td>
                    <td data-label="Ação">
                      <strong>{auditNames[row.action] ?? row.action}</strong>
                      <small>{row.action}</small>
                    </td>
                    <td data-label="Registro">
                      <strong>{row.target_name ?? row.aggregate_id}</strong>
                    </td>
                    <td data-label="Responsável">
                      <strong>{row.actor_name ?? row.actor_id}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.length && (
              <div className="mesa-root-empty">Nenhuma alteração registrada pelo gestor.</div>
            )}
          </div>
        )}
        <Pagination
          total={data.length}
          label="auditoria SaaS"
          page={page}
          pageSize={size}
          loading={loading}
          onPageChange={setPage}
          onPageSizeChange={setSize}
        />
      </section>
    </>
  );
}
