import { PageLoading } from './page-loading.js';
import { useEffect, useLayoutEffect, useRef, useState, lazy, Suspense } from 'react';
import { Link, useLocation } from 'react-router';
import {
  ArrowRight,
  Check,
  ChevronRight,
  ChefHat,
  ClipboardList,
  CreditCard,
  LayoutDashboard,
  Menu,
  Package,
  Plus,
  QrCode,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Store,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { CompanySelection } from './company-selection.js';
import { api, useStorageKey } from './client.js';
import { pwaContext } from './pwa-context.js';
const PrintStationPage = lazy(async () => ({
  default: (await import('./print-station-page.js')).PrintStationPage,
}));
const AdminApp = lazy(async () => ({ default: (await import('./admin-app.js')).AdminApp }));
const SaasApp = lazy(async () => ({ default: (await import('./saas-app.js')).SaasApp }));
export function MesaLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="mesa-logo">
      <img src="/mesa-mark.svg" alt="" width="40" height="40" />
      {!compact && (
        <span>
          mesa<span className="mesa-logo-dot">.</span>
        </span>
      )}
    </span>
  );
}
export function AdminEntry() {
  const location = useLocation();
  const publicPage =
    !pwaContext() &&
    (['/', '/entrar', '/criar-conta'].includes(location.pathname.replace(/\/$/, '') || '/') ||
      location.pathname === '/gestor' ||
      location.pathname.startsWith('/gestor/'));
  useStorageKey(
    publicPage
      ? location.pathname.startsWith('/gestor')
        ? 'mesa-saas-root'
        : 'mesa-public'
      : 'bar-staff',
  );
  useLayoutEffect(() => {
    document.body.classList.toggle('mesa-portal-active', publicPage);
    return () => document.body.classList.remove('mesa-portal-active');
  }, [publicPage]);
  useEffect(() => {
    if (publicPage)
      document.title = location.pathname.startsWith('/gestor')
        ? 'Gestor SaaS · Mesa'
        : 'Mesa · Seu restaurante em sintonia';
    window.scrollTo(0, 0);
  }, [location.pathname, publicPage]);
  if (pwaContext() && location.pathname.replace(/\/$/, '') === '/estacao-impressao')
    return (
      <Suspense fallback={<PageLoading name={pwaContext()?.name} />}>
        <PrintStationPage />
      </Suspense>
    );
  if (!publicPage)
    return (
      <Suspense fallback={<PageLoading name={pwaContext()?.name} />}>
        <AdminApp />
      </Suspense>
    );
  if (location.pathname.startsWith('/gestor'))
    return (
      <Suspense fallback={<PageLoading name={pwaContext()?.name} />}>
        <SaasApp />
      </Suspense>
    );
  if (location.pathname.startsWith('/criar-conta')) return <PublicAuth signup />;
  if (
    location.pathname.startsWith('/entrar') ||
    new URLSearchParams(location.search).has('selecionar-empresa')
  )
    return <PublicAuth />;
  return <Landing />;
}
function Landing() {
  const [menu, setMenu] = useState(false);
  const features = [
    {
      icon: LayoutDashboard,
      title: 'Cada mesa, no seu lugar.',
      text: 'Veja o salão, abra comandas e acompanhe o consumo e o saldo de cada atendimento.',
      tag: 'SALÃO E COMANDAS',
    },
    {
      icon: ChefHat,
      title: 'Do pedido à primeira mordida.',
      text: 'Cozinha, bar e garçom acompanham o preparo e a entrega pelas fichas de cada item.',
      tag: 'OPERAÇÃO CONECTADA',
    },
    {
      icon: QrCode,
      title: 'O cardápio está na mão.',
      text: 'Seu cliente lê o QR da mesa, escolhe os itens e acompanha o pedido pelo celular.',
      tag: 'CARDÁPIO ONLINE',
    },
    {
      icon: Package,
      title: 'Estoque que acompanha o ritmo.',
      text: 'Controle produtos, variações e locais. Registre reposições e respeite o saldo disponível.',
      tag: 'ESTOQUE INTEGRADO',
    },
    {
      icon: CreditCard,
      title: 'Feche a conta com clareza.',
      text: 'Receba por comanda, confira pagamentos e acompanhe a abertura e o fechamento do caixa.',
      tag: 'CAIXA E FINANCEIRO',
    },
    {
      icon: ShieldCheck,
      title: 'A equipe certa, no acesso certo.',
      text: 'Ambientes para gestão, caixa, cozinha e garçom, com permissões para cada função.',
      tag: 'GESTÃO DA EQUIPE',
    },
  ];
  return (
    <div className="mesa-public">
      <a className="mesa-skip" href="#conteudo">
        Pular para o conteúdo
      </a>
      <header className="mesa-site-nav">
        <div className="mesa-container mesa-nav-inner">
          <Link to="/" aria-label="Mesa, início">
            <MesaLogo />
          </Link>
          <button
            className="mesa-mobile-menu"
            aria-label={menu ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            {menu ? <X /> : <Menu />}
          </button>
          <nav className={menu ? 'is-open' : ''} aria-label="Navegação principal">
            <a href="#recursos" onClick={() => setMenu(false)}>
              Recursos
            </a>
            <a href="#como-funciona" onClick={() => setMenu(false)}>
              Como funciona
            </a>
            <a href="#duvidas" onClick={() => setMenu(false)}>
              Dúvidas
            </a>
            <Link className="mesa-nav-login" to="/entrar">
              Entrar <ChevronRight size={16} />
            </Link>
            <Link className="mesa-btn mesa-btn-primary" to="/criar-conta">
              Criar minha conta <ArrowRight size={16} />
            </Link>
          </nav>
        </div>
      </header>
      <main id="conteudo">
        <section className="mesa-hero mesa-container">
          <div className="mesa-hero-copy">
            <span className="mesa-kicker">
              <span /> MAIS FLUIDEZ PARA A SUA CASA
            </span>
            <h1>
              Seu salão em sintonia.
              <br />
              <span>Seu negócio sob controle.</span>
            </h1>
            <p>
              Da primeira comanda ao último fechamento. Conecte mesas, pedidos, cozinha e caixa em
              um só lugar — e tenha mais tempo para receber bem.
            </p>
            <div className="mesa-hero-actions">
              <Link className="mesa-btn mesa-btn-primary" to="/criar-conta">
                Começar com o Mesa <ArrowRight size={18} />
              </Link>
              <a className="mesa-btn mesa-btn-secondary" href="#recursos">
                Conhecer os recursos
              </a>
            </div>
            <div className="mesa-hero-benefits">
              <span>
                <Check size={15} /> Acesse pelo navegador
              </span>
              <span>
                <Check size={15} /> Equipe conectada
              </span>
              <span>
                <Check size={15} /> Feito para o celular
              </span>
            </div>
          </div>
          <ProductPreview />
        </section>
        <div className="mesa-audience mesa-container">
          <span>PARA CADA JEITO DE RECEBER</span>
          <div>
            <UtensilsCrossed size={18} /> Restaurantes
          </div>
          <div>
            <Store size={18} /> Bares e botecos
          </div>
          <div>
            <ChefHat size={18} /> Lanchonetes
          </div>
          <div>
            <Smartphone size={18} /> Pedidos para retirada
          </div>
        </div>
        <section className="mesa-section mesa-container" id="recursos">
          <div className="mesa-section-heading">
            <span className="mesa-kicker">MENOS IDAS E VINDAS. MAIS CONTROLE.</span>
            <h2>
              Uma operação inteira.
              <br />
              Tudo conversa.
            </h2>
            <p>As informações acompanham o pedido. Sua equipe acompanha o que realmente importa.</p>
          </div>
          <div className="mesa-features">
            {features.map(({ icon: Icon, ...f }, i) => (
              <article className={'mesa-feature mesa-feature-' + i} key={f.title}>
                <span className="mesa-feature-icon">
                  <Icon size={24} />
                </span>
                <small>{f.tag}</small>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="mesa-workflow" id="como-funciona">
          <div className="mesa-container">
            <div className="mesa-section-heading">
              <span className="mesa-kicker">SIMPLES PARA COMEÇAR</span>
              <h2>Pronto para o próximo atendimento.</h2>
              <p>
                Organize sua casa no seu ritmo, com um ambiente próprio para o seu estabelecimento.
              </p>
            </div>
            <div className="mesa-steps">
              {[
                [
                  '01',
                  'Monte a sua casa',
                  'Crie sua conta, cadastre produtos, organize mesas e configure seus estoques.',
                ],
                [
                  '02',
                  'Conecte a equipe',
                  'Defina os acessos e compartilhe os links de trabalho com caixa, cozinha e garçons.',
                ],
                [
                  '03',
                  'Abra para bons momentos',
                  'Receba os pedidos, acompanhe as entregas e feche as comandas com tudo à vista.',
                ],
              ].map(([n, title, text]) => (
                <article key={n}>
                  <span>{n}</span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
        <section className="mesa-section mesa-container mesa-faq" id="duvidas">
          <div className="mesa-section-heading">
            <span className="mesa-kicker">ANTES DE ABRIR AS PORTAS</span>
            <h2>Ficou alguma dúvida?</h2>
            <p>Conheça um pouco mais sobre como o Mesa funciona.</p>
          </div>
          <div>
            {[
              [
                'Preciso instalar algum programa?',
                'A gestão funciona pelo navegador. O cliente, o garçom e a cozinha também têm seus próprios ambientes, que podem ser instalados como aplicativo pelo navegador.',
              ],
              [
                'Meus clientes conseguem pedir pelo celular?',
                'Sim. Você pode compartilhar o link do cardápio ou disponibilizar o QR Code da mesa. O cliente pode fazer pedidos na mesa ou para retirada, conforme o funcionamento da sua casa.',
              ],
              [
                'Posso usar uma impressora térmica?',
                'Sim. O Mesa permite visualizar e baixar cupons em PDF, imprimir pelo navegador e conectar impressoras locais com o PrintBridge, que precisa estar instalado na estação de impressão.',
              ],
              [
                'Cada funcionário tem seu próprio acesso?',
                'Sim. O administrador define o perfil e as permissões de cada funcionário, com ambientes específicos para garçom, cozinha e caixa.',
              ],
              [
                'Como acesso minha conta depois do cadastro?',
                'Use o botão Entrar, escolha seu restaurante ou bar e informe seu e-mail e senha. Você também pode salvar o endereço exclusivo do seu estabelecimento.',
              ],
            ].map(([q, a]) => (
              <details key={q}>
                <summary>
                  {q}
                  <Plus size={18} />
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="mesa-final-cta mesa-container">
          <span className="mesa-kicker">SUA PRÓXIMA FASE COMEÇA AQUI</span>
          <h2>
            Mais presença no salão.
            <br />
            Mais clareza na gestão.
          </h2>
          <p>Sua casa tem um jeito único de receber. O Mesa ajuda a cuidar do resto.</p>
          <Link className="mesa-btn" to="/criar-conta">
            Criar minha conta <ArrowRight size={18} />
          </Link>
          <span className="mesa-cta-or">
            Já faz parte? <Link to="/entrar">Entre na sua conta</Link>
          </span>
        </section>
      </main>
      <footer className="mesa-footer mesa-container">
        <div>
          <Link to="/" aria-label="Mesa, início">
            <MesaLogo />
          </Link>
          <p>Feito para bons momentos.</p>
        </div>
        <span>© {new Date().getFullYear()} Mesa.</span>
        <div>
          <Link to="/entrar">Entrar</Link>
          <Link to="/gestor">Área do gestor</Link>
        </div>
      </footer>
    </div>
  );
}
function ProductPreview() {
  const [tab, setTab] = useState('Salão');
  return (
    <div className="mesa-preview-wrap">
      <div className="mesa-preview-note">
        <Sparkles size={15} /> Uma casa bem conectada.
      </div>
      <div className="mesa-product-preview">
        <div className="mesa-preview-top">
          <MesaLogo compact />
          <div>
            <strong>Seu restaurante</strong>
            <span>Visão ilustrativa do sistema</span>
          </div>
          <span className="mesa-demo-live">
            <span /> Em operação
          </span>
        </div>
        <div
          className="mesa-preview-tabs system-tabs"
          role="tablist"
          aria-label="Conheça a operação"
        >
          {['Salão', 'Cozinha', 'Caixa'].map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              {t === 'Salão' ? (
                <LayoutDashboard size={16} aria-hidden="true" />
              ) : t === 'Cozinha' ? (
                <ChefHat size={16} aria-hidden="true" />
              ) : (
                <CreditCard size={16} aria-hidden="true" />
              )}
              {t}
            </button>
          ))}
        </div>
        <div className="mesa-preview-content" role="tabpanel" aria-label={tab}>
          {tab === 'Salão' ? (
            <>
              <div className="mesa-preview-title">
                <strong>Seu salão, num olhar.</strong>
                <span>8 mesas · exemplo</span>
              </div>
              <div className="mesa-demo-tables">
                {Array.from({ length: 8 }, (_, i) => (
                  <div
                    className={i === 1 || i === 4 ? 'occupied' : i === 6 ? 'closing' : ''}
                    key={i}
                  >
                    <LayoutDashboard size={22} />
                    <b>{String(i + 1).padStart(2, '0')}</b>
                    <small>
                      {i === 1 || i === 4 ? 'Em atendimento' : i === 6 ? 'Fechamento' : 'Livre'}
                    </small>
                  </div>
                ))}
              </div>
              <div className="mesa-demo-order">
                <span className="mesa-demo-icon">
                  <ClipboardList size={19} />
                </span>
                <div>
                  <strong>Novo pedido · Mesa 02</strong>
                  <span>2 itens enviados para a cozinha</span>
                </div>
                <span className="mesa-demo-status">Confirmado</span>
              </div>
            </>
          ) : tab === 'Cozinha' ? (
            <>
              <div className="mesa-preview-title">
                <strong>Cada pedido no seu tempo.</strong>
                <span>Fila ilustrativa</span>
              </div>
              <div className="mesa-demo-kitchen">
                {[
                  ['Mesa 02', '2× Porção de batata', 'Em preparo'],
                  ['Mesa 05', '1× Hambúrguer da casa', 'Pendente'],
                  ['Mesa 02', '2× Suco de laranja', 'Pronto'],
                ].map(([mesa, item, status]) => (
                  <article key={item}>
                    <small>{mesa}</small>
                    <strong>{item}</strong>
                    <span className="mesa-demo-status">{status}</span>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="mesa-preview-title">
                <strong>Fechamento sem surpresa.</strong>
                <span>Valores ilustrativos</span>
              </div>
              <div className="mesa-demo-cash">
                <span>
                  <CreditCard size={24} /> Resumo da comanda · Mesa 07
                </span>
                <div>
                  Consumo <b>R$ 128,00</b>
                </div>
                <div>
                  Recebido <b>R$ 100,00</b>
                </div>
                <div>
                  Saldo a receber <strong>R$ 28,00</strong>
                </div>
                <p>
                  <ShieldCheck size={16} /> Pagamentos e entregas conferidos no mesmo atendimento.
                </p>
              </div>
            </>
          )}
        </div>
        <div className="mesa-preview-bottom">
          <span>
            <ShieldCheck size={13} /> Informação de ponta a ponta
          </span>
          <span>Mesa · Gestão conectada</span>
        </div>
      </div>
      <div className="mesa-preview-float">
        <span>
          <Check size={18} />
        </span>
        <div>
          <strong>Pedido entregue.</strong>
          <small>Cozinha, garçom e cliente em sintonia.</small>
        </div>
      </div>
    </div>
  );
}
function PublicAuth({ signup = false }: { signup?: boolean }) {
  return (
    <div className="mesa-public mesa-auth">
      <header className="mesa-container">
        <Link to="/" aria-label="Voltar ao início">
          <MesaLogo />
        </Link>
        <Link to={signup ? '/entrar' : '/criar-conta'}>
          {signup ? 'Já tenho uma conta' : 'Criar uma conta'}
          <ArrowRight size={16} />
        </Link>
      </header>
      <main className="mesa-auth-grid mesa-container">
        <div className="mesa-auth-story">
          <span className="mesa-kicker">BEM-VINDO AO MESA</span>
          <h1>
            {signup ? (
              <>
                Sua casa merece
                <br />
                uma gestão à altura.
              </>
            ) : (
              <>
                Bom ter você
                <br />
                de volta à mesa.
              </>
            )}
          </h1>
          <p>
            {signup
              ? 'Crie seu ambiente e conecte o salão, a cozinha e o caixa em um só lugar.'
              : 'Escolha seu restaurante ou bar para acessar o ambiente da sua equipe.'}
          </p>
          <div>
            {[
              'Um endereço exclusivo para sua casa',
              'Equipe conectada por função',
              'Gestão do pedido ao fechamento',
            ].map((text) => (
              <span key={text}>
                <Check size={17} />
                {text}
              </span>
            ))}
          </div>
          <div className="mesa-auth-illustration">
            <MesaLogo />
            <span>
              <Store size={32} />
              <UtensilsCrossed size={32} />
              <ChefHat size={32} />
            </span>
          </div>
        </div>
        <div className="mesa-auth-panel">
          {signup ? (
            <Signup />
          ) : (
            <>
              <CompanySelection surface="admin" />
              <div className="mesa-auth-panel-footer">
                Primeira vez por aqui? <Link to="/criar-conta">Crie sua conta</Link>
              </div>
            </>
          )}
        </div>
      </main>
      <footer className="mesa-auth-footer">
        Mesa · Feito para bons momentos. <Link to="/">Voltar ao início</Link>
      </footer>
    </div>
  );
}
function Signup() {
  const [form, setForm] = useState({ name: '', owner_name: '', owner_email: '', password: '' });
  const [confirm, setConfirm] = useState(''),
    [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [created, setCreated] = useState<{ slug: string } | null>(null);
  const attempt = useRef({ body: '', key: crypto.randomUUID() });
  if (created)
    return (
      <section className="mesa-signup-success">
        <span>
          <Check size={32} />
        </span>
        <span className="mesa-kicker">TUDO PRONTO PARA COMEÇAR</span>
        <h2>Sua casa já tem um lugar no Mesa.</h2>
        <p>
          O ambiente de <strong>{form.name}</strong> foi criado. Entre com o e-mail e a senha que
          você acabou de cadastrar.
        </p>
        <div>
          <small>Seu endereço de acesso</small>
          <strong>
            {window.location.origin}/{created.slug}/
          </strong>
        </div>
        <a className="mesa-btn mesa-btn-primary" href={'/' + created.slug + '/'}>
          Acessar meu estabelecimento <ArrowRight size={18} />
        </a>
      </section>
    );
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (form.password !== confirm) {
      setError('As senhas precisam ser iguais.');
      return;
    }
    const body = JSON.stringify(form);
    if (attempt.current.body !== body) attempt.current = { body, key: crypto.randomUUID() };
    setBusy(true);
    try {
      setCreated(await api('/auth/register', form, 'POST', attempt.current.key));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="mesa-signup-form" onSubmit={submit}>
      <span className="mesa-kicker">COMECE POR AQUI</span>
      <h2>Crie sua conta</h2>
      <p>Você será o administrador do seu estabelecimento.</p>
      {[
        ['name', 'Nome do restaurante ou bar', 'Ex.: Boteco da Esquina'],
        ['owner_name', 'Seu nome', 'Como podemos chamar você?'],
        ['owner_email', 'Seu e-mail', 'voce@exemplo.com'],
      ].map(([key, label, placeholder]) => (
        <label key={key}>
          {label}
          <input
            required
            type={key === 'owner_email' ? 'email' : 'text'}
            autoComplete={
              key === 'owner_email' ? 'email' : key === 'owner_name' ? 'name' : 'organization'
            }
            minLength={key === 'owner_email' ? undefined : 2}
            maxLength={key === 'owner_email' ? 190 : 160}
            value={form[key as keyof typeof form]}
            placeholder={placeholder}
            disabled={busy}
            onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          />
        </label>
      ))}
      <label>
        Senha
        <div className="mesa-password">
          <input
            required
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            aria-label="Senha"
            aria-describedby="mesa-signup-password-hint"
            minLength={12}
            maxLength={200}
            value={form.password}
            disabled={busy}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <button
            type="button"
            aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
            onClick={() => setShow(!show)}
          >
            {show ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>
        <small id="mesa-signup-password-hint">Use pelo menos 12 caracteres.</small>
      </label>
      <label>
        Confirme a senha
        <input
          required
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          minLength={12}
          maxLength={200}
          value={confirm}
          disabled={busy}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </label>
      {error && (
        <p className="mesa-form-error" role="alert">
          {error}
        </p>
      )}
      <button disabled={busy} className="mesa-btn mesa-btn-primary" type="submit">
        {busy ? 'Criando seu ambiente…' : 'Criar meu estabelecimento'}{' '}
        {!busy && <ArrowRight size={18} />}
      </button>
      <p className="mesa-signup-note">
        <ShieldCheck size={15} />
        Seu ambiente e seus acessos são separados de outros estabelecimentos.
      </p>
      <div className="mesa-auth-panel-footer">
        Já usa o Mesa? <Link to="/entrar">Entrar na minha conta</Link>
      </div>
    </form>
  );
}
