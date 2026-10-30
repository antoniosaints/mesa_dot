import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  Puzzle,
  Sparkles,
  WalletCards,
  ShieldCheck,
  ExternalLink,
  Check,
  KeyRound,
  RefreshCw,
  Settings,
  Power,
  Download,
  Search,
} from 'lucide-react';
import { api, type Data } from './client.js';
import { Modal, ModalCloseButton, PageTitle, Empty, useAction } from './common.js';
import { Tabs, Tab, SearchSelect } from './controls.js';
import { TableLoading } from './pagination.js';
import { useToasts } from './toasts.js';
import { useFormDialog } from './forms.js';
import { operationTime } from './operation-format.js';
import { useAiAssistant, notifyAiConnection } from './ai-assistant.js';
const catalog = [
  {
    id: 'mercadopago',
    name: 'Mercado Pago',
    category: 'Pagamentos',
    description:
      'Receba pagamentos online na sua conta e acompanhe a confirmação dos pedidos no Mesa.',
    features: [
      'Vinculação segura por OAuth',
      'Checkout online para o cliente',
      'Conciliação e estornos integrados',
    ],
  },
  {
    id: 'gemini',
    name: 'Gemini',
    category: 'Inteligência artificial',
    description:
      'Tenha ajuda para usar o sistema e transforme os indicadores da filial em resumos e próximas ações.',
    features: [
      'Sua chave de API do Google',
      'Ajuda sobre os recursos do Mesa',
      'Resumos operacionais e financeiros',
    ],
  },
];
const Logo = ({ provider }: { provider: string }) => (
  <span className={'complement-logo is-' + provider}>
    {provider === 'gemini' ? <Sparkles size={27} /> : <WalletCards size={27} />}
  </span>
);
function Status({ record }: { record: Data }) {
  const text =
    record.enabled && record.configured
      ? 'Ativo'
      : record.configured
        ? 'Desativado'
        : record.installed
          ? 'Configurar'
          : 'Disponível';
  return (
    <span
      className={
        'badge ' +
        (record.enabled && record.configured ? 'available' : record.installed ? 'pending' : '')
      }
    >
      {text}
    </span>
  );
}
export function ComplementsWorkspace() {
  const [records, setRecords] = useState<Data[] | null>(null),
    [error, setError] = useState(''),
    [search, setSearch] = useState(''),
    [selected, setSelected] = useState('');
  const { run, busy } = useAction();
  const toast = useToasts();
  const assistant = useAiAssistant();
  const [params, setParams] = useSearchParams();
  async function load() {
    try {
      setRecords(await api('/complements'));
      notifyAiConnection();
      setError('');
    } catch (error) {
      setError((error as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  const oauth = params.get('oauth');
  useEffect(() => {
    if (!oauth) return;
    if (oauth === 'success')
      toast.success('Mercado Pago conectado. Pagamentos online ativados nesta filial.');
    else if (oauth === 'denied')
      toast.info('A autorização foi cancelada. Sua conexão anterior foi preservada.');
    else
      toast.error('Não foi possível concluir a conexão. Tente autorizar novamente a mesma conta.');
    setSelected('mercadopago');
    const next = new URLSearchParams(params);
    next.delete('oauth');
    setParams(next, { replace: true });
  }, [oauth]);
  const installed = records?.filter((record) => record.installed).length ?? 0;
  function cards(onlyInstalled: boolean) {
    const items = catalog.filter(
      (entry) =>
        (!onlyInstalled || records?.find((record) => record.provider === entry.id)?.installed) &&
        (entry.name + ' ' + entry.category + ' ' + entry.description)
          .toLocaleLowerCase('pt-BR')
          .includes(search.toLocaleLowerCase('pt-BR')),
    );
    if (!items.length)
      return (
        <Empty>
          {onlyInstalled
            ? 'Nenhum complemento instalado corresponde à busca. Explore o catálogo para começar.'
            : 'Nenhum complemento encontrado. Tente outro nome.'}
        </Empty>
      );
    return (
      <div className="complement-grid">
        {items.map((entry) => {
          const record = records!.find((record) => record.provider === entry.id)!;
          return (
            <article className="complement-card" key={entry.id}>
              <header>
                <Logo provider={entry.id} />
                <Status record={record} />
              </header>
              <span className="complement-category">{entry.category}</span>
              <h2>{entry.name}</h2>
              <p>{entry.description}</p>
              <ul>
                {entry.features.map((feature) => (
                  <li key={feature}>
                    <Check size={15} />
                    {feature}
                  </li>
                ))}
              </ul>
              <footer>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    record.installed
                      ? setSelected(entry.id)
                      : void run(async () => {
                          await api('/complements/' + entry.id + '/install', {});
                          await load();
                          setSelected(entry.id);
                        }, 'Complemento instalado. Configure a conexão para começar.')
                  }
                >
                  {record.installed ? <Settings size={16} /> : <Download size={16} />}
                  {record.installed ? 'Configurar' : 'Instalar complemento'}
                </button>
                {entry.id === 'gemini' && record.enabled && (
                  <button onClick={() => assistant.openChat()}>
                    <Sparkles size={16} />
                    Abrir assistente
                  </button>
                )}
              </footer>
            </article>
          );
        })}
      </div>
    );
  }
  const active = records?.find((record) => record.provider === selected);
  return (
    <section className="complements-workspace">
      <PageTitle
        title="Complementos"
        eyebrow="INTEGRAÇÕES"
        subtitle="Conecte serviços e adicione recursos ao Mesa."
        action={
          <button disabled={busy} onClick={() => void load()}>
            <RefreshCw size={16} />
            Atualizar
          </button>
        }
      />
      <div className="complement-store-intro">
        <span>
          <Puzzle size={26} />
        </span>
        <div>
          <h2>Mais recursos para sua operação</h2>
          <p>Instale, conecte e gerencie os serviços desta filial em um só lugar.</p>
        </div>
        <b>
          {installed} de {catalog.length} instalados
        </b>
      </div>
      <div className="complement-admin-note">
        <ShieldCheck size={16} />
        <span>
          Configuração exclusiva do admin geral. Cada filial mantém suas próprias conexões.
        </span>
      </div>
      <label className="complement-search">
        <Search size={17} />
        <input
          type="search"
          aria-label="Buscar complemento"
          placeholder="Buscar por nome ou recurso…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      {error && (
        <div className="alert error" role="alert">
          {error}
          <button onClick={() => void load()}>Tentar novamente</button>
        </div>
      )}
      {!records ? (
        !error && <TableLoading label="Carregando complementos…" />
      ) : (
        <Tabs label="Loja de complementos">
          <Tab id="catalog" label="Catálogo" icon="complements" count={catalog.length}>
            {cards(false)}
          </Tab>
          <Tab id="installed" label="Instalados" icon="check" count={installed}>
            {cards(true)}
          </Tab>
        </Tabs>
      )}
      {active && (
        <ComplementDialog
          record={active}
          onClose={() => setSelected('')}
          onChange={load}
          onAssistant={() => {
            setSelected('');
            assistant.openChat();
          }}
        />
      )}
    </section>
  );
}
function ComplementDialog({
  record,
  onClose,
  onChange,
  onAssistant,
}: {
  record: Data;
  onClose: () => void;
  onChange: () => Promise<void>;
  onAssistant: () => void;
}) {
  const provider = record.provider,
    entry = catalog.find((item) => item.id === provider)!;
  const [key, setKey] = useState(''),
    [model, setModel] = useState(record.model ?? 'gemini-3.8-flash'),
    [initialModel, setInitialModel] = useState(model),
    [imageModel, setImageModel] = useState(record.image_model ?? ''),
    [initialImageModel, setInitialImageModel] = useState(imageModel),
    [models, setModels] = useState<{ id: string; name: string; supports_images?: boolean }[]>([]);
  const { run, busy } = useAction();
  const forms = useFormDialog();
  const dirty =
    provider === 'gemini' &&
    (Boolean(key) || model !== initialModel || imageModel !== initialImageModel);
  async function toggle() {
    await api('/complements/' + provider + '/' + (record.enabled ? 'disable' : 'enable'), {});
    await onChange();
  }
  return (
    <Modal
      title={'Complemento · ' + entry.name}
      className="complement-detail-modal"
      heading={
        <>
          <Logo provider={provider} />
          <span>
            {entry.name}
            <small>{entry.category} · Conexão desta filial</small>
          </span>
        </>
      }
      dirty={dirty}
      closeDisabled={busy}
      onClose={onClose}
    >
      <div className="complement-detail-status">
        <Status record={record} />
        {record.last_checked_at && (
          <span>Verificado em {operationTime(record.last_checked_at)}</span>
        )}
      </div>
      <div className="complement-detail-layout">
        <div className="complement-configuration">
          {provider === 'mercadopago' ? (
            <>
              <h3>Receba na sua conta Mercado Pago</h3>
              <p>
                Autorize o Mesa no ambiente do Mercado Pago. A senha da sua conta é informada
                diretamente ao provedor.
              </p>
              {!record.platform_ready && (
                <div className="flow-note">
                  A vinculação OAuth ainda precisa ser habilitada pelo gestor do Mesa. Após essa
                  configuração, você poderá conectar sua conta aqui.
                </div>
              )}
              {record.configured && (
                <div className="complement-connected-account">
                  <WalletCards size={21} />
                  <div>
                    <strong>{record.nickname || 'Conta Mercado Pago'}</strong>
                    <small>
                      Conta {record.account_id}
                      {record.test_mode ? ' · Ambiente de teste' : ''}
                    </small>
                  </div>
                </div>
              )}
              <button
                className="primary"
                disabled={busy || !record.platform_ready}
                onClick={() =>
                  void run(async () => {
                    const result = await api('/complements/mercadopago/connect', {});
                    const destination = new URL(result.authorization_url);
                    if (
                      destination.protocol !== 'https:' ||
                      destination.hostname !== 'auth.mercadopago.com'
                    )
                      throw new Error('Endereço de autorização inválido.');
                    window.location.assign(destination.href);
                  })
                }
              >
                <ExternalLink size={16} />
                {record.configured ? 'Reconectar Mercado Pago' : 'Conectar Mercado Pago'}
              </button>
              <p className="field-hint">
                Você será direcionado para autorizar a conexão e retornará a esta filial.
              </p>
              {record.configured && (
                <p className="field-hint">
                  Desativar interrompe novos checkouts. A autorização é mantida para conciliar
                  pagamentos e estornos já existentes. Para revogar o acesso, use as autorizações da
                  sua conta no Mercado Pago.
                </p>
              )}
            </>
          ) : (
            <form
              id="gemini-complement-config"
              className="stack"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  const result = await api('/complements/gemini/configure', {
                    ...(key.trim() ? { api_key: key.trim() } : {}),
                    model,
                    image_model: imageModel || null,
                  });
                  setKey('');
                  setInitialModel(model);
                  setInitialImageModel(imageModel);
                  setModels(result.models);
                  await onChange();
                }, 'Gemini conectado e ativado nesta filial.');
              }}
            >
              <h3>Conecte sua chave de API</h3>
              <p>
                A chave é armazenada de forma criptografada no servidor e usada apenas nas
                solicitações desta filial.
              </p>
              <label>
                Chave de API do Gemini
                <input
                  type="password"
                  aria-label="Chave de API do Gemini"
                  autoComplete="new-password"
                  spellCheck={false}
                  maxLength={512}
                  value={key}
                  disabled={busy}
                  required={!record.configured}
                  onChange={(event) => setKey(event.target.value)}
                  placeholder={
                    record.configured
                      ? 'Chave cadastrada · preencha apenas para substituir'
                      : 'Cole a chave criada no Google AI Studio'
                  }
                />
                <small className="field-hint">
                  {record.configured
                    ? 'Deixe vazio para manter a chave atual.'
                    : 'Crie a chave no Google AI Studio e autorize o uso da Gemini API.'}
                </small>
              </label>
              <div className="complement-model-selector">
                <label>
                  Modelo
                  <SearchSelect
                    label="Modelo Gemini"
                    required
                    allowClear={false}
                    value={model}
                    disabled={busy}
                    options={models.length ? models : [{ id: model, name: model }]}
                    onChange={setModel}
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || (!key.trim() && !record.configured)}
                  onClick={() =>
                    void run(async () => {
                      const found = await api(
                        '/complements/gemini/models',
                        key.trim() ? { api_key: key.trim() } : {},
                      );
                      setModels(found);
                      if (!found.some((item: Data) => item.id === model))
                        setModel(
                          found.find(
                            (item: Data) =>
                              /flash/.test(item.id) && !/image|live|tts/.test(item.id),
                          )?.id ??
                            found[0]?.id ??
                            model,
                        );
                      if (!found.length)
                        throw new Error('Nenhum modelo de texto disponível para esta chave.');
                    }, 'Modelos disponíveis atualizados.')
                  }
                >
                  <RefreshCw size={15} />
                  Consultar modelos
                </button>
              </div>
              <p className="field-hint">
                O consumo utiliza a cota e o faturamento do seu projeto Google. Consulte os modelos
                disponíveis para a sua chave antes de salvar.
              </p>
              <label>
                Modelo para imagens (opcional)
                <SearchSelect
                  label="Modelo para imagens Gemini"
                  allowClear={false}
                  value={imageModel}
                  disabled={busy}
                  options={[
                    { id: '', name: 'Usar o modelo principal, se compatível' },
                    ...models.filter((item) => item.supports_images),
                    ...(!models.length && imageModel ? [{ id: imageModel, name: imageModel }] : []),
                  ]}
                  onChange={setImageModel}
                />
                <small className="field-hint">
                  Consulte os modelos para escolher um com saída de imagem. Modelos que apenas
                  analisam fotos não geram imagens.
                </small>
              </label>
              <a href="https://aistudio.google.com/api-keys" target="_blank" rel="noreferrer">
                <KeyRound size={15} />
                Abrir Google AI Studio
              </a>
            </form>
          )}
          {record.configured && (
            <div className="complement-maintenance">
              <h3>Gerenciar conexão</h3>
              <div className="button-row">
                <button
                  disabled={busy || dirty}
                  onClick={() =>
                    void run(async () => {
                      await api('/complements/' + provider + '/test', {});
                      await onChange();
                    }, 'Conexão verificada.')
                  }
                >
                  <ShieldCheck size={16} />
                  Testar conexão
                </button>
                <button
                  disabled={busy || dirty}
                  onClick={() =>
                    void run(
                      toggle,
                      record.enabled ? 'Complemento desativado.' : 'Complemento ativado.',
                    )
                  }
                >
                  <Power size={16} />
                  {record.enabled ? 'Desativar' : 'Ativar'}
                </button>
                {provider === 'gemini' && record.enabled && (
                  <button disabled={busy || dirty} onClick={onAssistant}>
                    <Sparkles size={16} />
                    Abrir assistente
                  </button>
                )}
                {provider === 'gemini' && (
                  <button
                    className="danger"
                    disabled={busy || dirty}
                    onClick={() =>
                      forms.open({
                        title: 'Remover chave do Gemini',
                        description:
                          'A chave será apagada desta filial e o assistente será desativado. Para usar novamente, configure uma chave válida.',
                        fields: [],
                        submitLabel: 'Remover chave',
                        onSubmit: async () => {
                          await api('/complements/gemini/remove-key', {});
                          await onChange();
                        },
                      })
                    }
                  >
                    <KeyRound size={16} /> Remover chave
                  </button>
                )}
              </div>
              {dirty && (
                <p className="field-hint">
                  Salve as alterações para usar a configuração atualizada.
                </p>
              )}
            </div>
          )}
        </div>
        <aside className="complement-guide">
          <h3>O que este complemento adiciona</h3>
          <ul>
            {entry.features.map((feature) => (
              <li key={feature}>
                <Check size={16} />
                {feature}
              </li>
            ))}
          </ul>
          <h4>{provider === 'mercadopago' ? 'Como funciona' : 'Ajuda e resumos'}</h4>
          <p>
            {provider === 'mercadopago'
              ? 'O cliente abre o checkout pelo pedido. O servidor confere o valor, a conta recebedora e o status antes de liberar as fichas. Estornos continuam disponíveis em Pagamentos.'
              : 'Faça perguntas sobre o Mesa ou gere um resumo de 24 horas, 7 ou 30 dias. Os resumos enviam ao Gemini indicadores agregados, sem nomes ou contatos de clientes.'}
          </p>
          <div className="complement-admin-note">
            <ShieldCheck size={17} />
            <span>
              As configurações ficam separadas por filial e protegidas pelo acesso do admin geral.
            </span>
          </div>
        </aside>
      </div>
      <div className="modal-footer">
        <ModalCloseButton disabled={busy}>Fechar</ModalCloseButton>
        {provider === 'gemini' && (
          <button
            className="primary"
            type="submit"
            form="gemini-complement-config"
            disabled={busy || !record.platform_ready}
          >
            <KeyRound size={16} />
            {busy ? 'Verificando…' : 'Salvar e ativar Gemini'}
          </button>
        )}
      </div>
    </Modal>
  );
}
