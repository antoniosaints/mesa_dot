import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useInterfaceSurface } from './interface-scope.js';
import { useLocation, useNavigate } from 'react-router';
import {
  Sparkles,
  MessageCircle,
  Minus,
  Send,
  Copy,
  Download,
  RotateCcw,
  Settings,
  ImagePlus,
  FileText,
  ChartNoAxesCombined,
  LoaderCircle,
} from 'lucide-react';
import { api, session, type Data } from './client.js';
import { useToasts } from './toasts.js';
import { copyText } from './clipboard.js';
type Mode = 'help' | 'summary' | 'description' | 'image';
type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  model?: string;
  image?: Data | null;
  hadImage?: boolean;
  mode?: Mode;
};
type Assistant = {
  allowed: boolean;
  connection: Data | null;
  openChat: (input?: Data) => void;
  generate: (input: Data, key?: string) => Promise<Data>;
};
const Context = createContext<Assistant>({
  allowed: false,
  connection: null,
  openChat: () => {},
  generate: async () => {
    throw new Error('Assistente indisponível.');
  },
});
export const useAiAssistant = () => useContext(Context);
export const notifyAiConnection = () =>
  window.dispatchEvent(new Event('mesa:ai-connection-changed'));
const modes = [
  ['help', 'Ajuda', MessageCircle],
  ['summary', 'Resumo', ChartNoAxesCombined],
  ['description', 'Texto', FileText],
  ['image', 'Imagem', ImagePlus],
] as const;
export function AiAssistantProvider({
  children,
  allowed,
  scopeKey,
}: {
  children: ReactNode;
  allowed: boolean;
  scopeKey: string;
}) {
  return allowed ? (
    <AssistantSession key={scopeKey} scopeKey={scopeKey}>
      {children}
    </AssistantSession>
  ) : (
    <>{children}</>
  );
}
function AssistantSession({ children, scopeKey }: { children: ReactNode; scopeKey: string }) {
  const interfaceSurface = useInterfaceSurface();
  const [connection, setConnection] = useState<Data | null>(null),
    [open, setOpen] = useState(false),
    [unread, setUnread] = useState(false);
  const [viewport, setViewport] = useState({ height: window.innerHeight, keyboard: 0 });
  const [mode, setMode] = useState<Mode>('help'),
    [days, setDays] = useState(1),
    [draft, setDraft] = useState('');
  const storageKey = 'mesa-ai-chat:' + scopeKey;
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]');
      return Array.isArray(value)
        ? value
            .filter(
              (m) =>
                m &&
                ['user', 'assistant'].includes(m.role) &&
                typeof m.text === 'string' &&
                m.text.length <= 40000,
            )
            .slice(-16)
            .map((m) => ({
              id: typeof m.id === 'string' ? m.id.slice(0, 80) : crypto.randomUUID(),
              role: m.role,
              text: m.text,
              model: typeof m.model === 'string' ? m.model.slice(0, 100) : undefined,
              hadImage: Boolean(m.hadImage),
            }))
        : [];
    } catch {
      return [];
    }
  });
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<{ message: string; input: Data; key: string } | null>(null);
  const active = useRef(true),
    busyRef = useRef(false),
    openRef = useRef(open),
    trigger = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null),
    listRef = useRef<HTMLDivElement>(null),
    launcher = useRef<HTMLButtonElement>(null);
  const toast = useToasts(),
    navigate = useNavigate(),
    location = useLocation();
  openRef.current = open;
  useEffect(() => {
    active.current = true;
    let sequence = 0;
    async function load() {
      const current = ++sequence;
      try {
        const items = await api('/complements');
        if (active.current && sequence === current)
          setConnection(items.find((item: Data) => item.provider === 'gemini') ?? null);
      } catch {
        if (active.current && sequence === current) setConnection(null);
      }
    }
    void load();
    window.addEventListener('mesa:ai-connection-changed', load);
    window.addEventListener('focus', load);
    return () => {
      active.current = false;
      window.removeEventListener('mesa:ai-connection-changed', load);
      window.removeEventListener('focus', load);
    };
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify(
          messages.slice(-16).map(({ image, ...message }) => ({
            ...message,
            text: message.text.slice(0, 40000),
            hadImage: Boolean(image || message.hadImage),
          })),
        ),
      );
    } catch {
      /* Storage quotas must never interrupt a conversation. */
    }
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);
  useEffect(() => {
    if (open) {
      setUnread(false);
      inputRef.current?.focus({ preventScroll: true });
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    }
  }, [open, connection?.enabled, connection?.configured]);
  useEffect(() => {
    if (!open || !window.visualViewport) return;
    const view = window.visualViewport;
    const update = () =>
      setViewport({
        height: view.height,
        keyboard: Math.max(0, window.innerHeight - view.height - view.offsetTop),
      });
    update();
    view.addEventListener('resize', update);
    view.addEventListener('scroll', update);
    return () => {
      view.removeEventListener('resize', update);
      view.removeEventListener('scroll', update);
    };
  }, [open]);
  async function generate(input: Data, key: string = crypto.randomUUID()) {
    if (!connection?.enabled || !connection.configured)
      throw new Error('Ative o Gemini em Complementos para utilizar a IA.');
    const identity = session()?.actor;
    if ([identity?.tenantId, identity?.establishmentId, identity?.id].join(':') !== scopeKey)
      throw new Error('A filial foi alterada. Reabra esta ação.');
    const result = await api('/complements/gemini/ask', input, 'POST', key);
    if (!active.current) throw new Error('A filial foi alterada. Reabra esta ação.');
    return result;
  }
  async function perform(input: Data, key: string) {
    setMode(input.mode);
    busyRef.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const result = await generate(input, key);
      setMessages(
        (current) =>
          [
            ...current,
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              text: result.answer,
              model: result.model,
              image: result.image,
              mode: input.mode,
            },
          ].slice(-24) as Message[],
      );
      if (!openRef.current) setUnread(true);
    } catch (error) {
      if (active.current) setFailure({ message: (error as Error).message, input, key });
    } finally {
      if (active.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  function send(options: Data = {}) {
    if (busyRef.current) {
      toast.info('Aguarde a resposta atual antes de enviar outra solicitação.');
      return;
    }
    if (!connection?.enabled || !connection.configured) return;
    const nextMode: Mode = options.mode ?? mode;
    const question =
      String(options.question ?? draft).trim() ||
      (nextMode === 'summary' ? 'Resuma a operação e indique as próximas ações.' : '');
    if (!question) return;
    const history = messages
      .filter((message) => !message.hadImage && !message.image)
      .slice(-8)
      .map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        text: message.text.slice(0, 3000),
      }));
    const input = { mode: nextMode, days, question, history, ...options };
    setMode(nextMode);
    setDraft('');
    setMessages(
      (current) =>
        [
          ...current,
          { id: crypto.randomUUID(), role: 'user', text: question, mode: nextMode },
        ].slice(-24) as Message[],
    );
    void perform(input, crypto.randomUUID());
  }
  function openChat(options?: Data) {
    trigger.current = document.activeElement as HTMLElement | null;
    setOpen(true);
    if (options) send(options);
  }
  function close() {
    setOpen(false);
    queueMicrotask(() =>
      (trigger.current?.isConnected ? trigger.current : launcher.current)?.focus({
        preventScroll: true,
      }),
    );
  }
  const ready = Boolean(connection?.enabled && connection.configured);
  const screen =
    (
      {
        dashboard: 'visão geral',
        salao: 'mesas',
        pedidos: 'pedidos',
        cardapio: 'cardápio',
        financeiro: 'financeiro',
        estoque: 'estoque',
        configuracoes: 'configurações',
      } as Record<string, string>
    )[location.pathname.split('/')[1]] ?? 'sistema';
  const panel = (
    <>
      <button
        ref={launcher}
        type="button"
        className={'ai-launcher' + (unread ? ' has-unread' : '')}
        aria-label={
          open
            ? 'Minimizar assistente IA'
            : unread
              ? 'Abrir assistente IA · nova resposta'
              : 'Abrir assistente IA'
        }
        aria-expanded={open}
        aria-controls="mesa-ai-chat"
        onClick={() => (open ? close() : openChat())}
      >
        <Sparkles size={23} />
        <span>Assistente IA</span>
        {unread && <i />}
      </button>
      {open && (
        <section
          id="mesa-ai-chat"
          className={['ai-chat-panel', interfaceSurface].filter(Boolean).join(' ')}
          style={{
            maxHeight: Math.max(120, viewport.height - 24),
            minHeight: Math.min(280, Math.max(120, viewport.height - 24)),
            ...(viewport.keyboard > 80 && window.matchMedia('(max-width: 760px)').matches
              ? { bottom: viewport.keyboard + 12 }
              : {}),
          }}
          role="dialog"
          aria-label="Assistente Gemini"
          aria-modal="false"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              close();
            }
          }}
        >
          <header className="ai-chat-header">
            <span className="ai-chat-symbol">
              <Sparkles size={22} />
            </span>
            <div>
              <strong>Assistente Mesa</strong>
              <small>{ready ? 'Gemini · ' + screen : 'Conecte sua inteligência artificial'}</small>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Nova conversa"
              disabled={busy || !messages.length}
              onClick={() => {
                setMessages([]);
                setFailure(null);
                setDraft('');
                setMode('help');
              }}
            >
              <RotateCcw size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Configurar Gemini"
              onClick={() => void navigate('/complementos')}
            >
              <Settings size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Minimizar conversa"
              onClick={close}
            >
              <Minus size={18} />
            </button>
          </header>
          {!ready ? (
            <div className="ai-chat-onboarding">
              <Sparkles size={36} />
              <h3>Sua operação com mais ajuda</h3>
              <p>
                Ative o Gemini nesta filial para conversar, criar textos e gerar resumos. Imagens
                ficam disponíveis com um modelo compatível.
              </p>
              <button
                className="primary"
                onClick={() => {
                  close();
                  void navigate('/complementos');
                }}
              >
                Configurar em Complementos
              </button>
            </div>
          ) : (
            <>
              <div className="ai-chat-modes" role="group" aria-label="Tipo de solicitação">
                {modes.map(([id, label, Icon]) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={mode === id}
                    disabled={busy || (id === 'image' && !connection?.supports_images)}
                    title={
                      id === 'image' && !connection?.supports_images
                        ? 'Selecione um modelo de imagens em Complementos → Gemini.'
                        : label
                    }
                    onClick={() => setMode(id)}
                  >
                    <Icon size={14} />
                    {label}
                  </button>
                ))}
              </div>
              <div
                className="ai-chat-messages"
                ref={listRef}
                aria-label="Histórico da conversa"
                role="log"
                aria-live="polite"
                aria-relevant="additions text"
              >
                {!messages.length && (
                  <div className="ai-chat-welcome">
                    <span>
                      <Sparkles size={26} />
                    </span>
                    <h3>Como posso ajudar?</h3>
                    <p>Peça ajuda no sistema ou crie um rascunho para revisar.</p>
                    <button
                      onClick={() =>
                        send({
                          mode: 'help',
                          question:
                            'Como funciona a tela de ' +
                            screen +
                            ' e quais são as principais ações?',
                        })
                      }
                    >
                      <MessageCircle size={16} />
                      Ajuda nesta tela
                    </button>
                    <button
                      onClick={() =>
                        send({
                          mode: 'summary',
                          question:
                            'Resuma a operação das últimas 24 horas e indique as prioridades.',
                          days: 1,
                        })
                      }
                    >
                      <ChartNoAxesCombined size={16} />
                      Resumo das últimas 24 horas
                    </button>
                    <button
                      onClick={() => {
                        setMode('description');
                        setDraft('Crie uma descrição para ');
                        inputRef.current?.focus();
                      }}
                    >
                      <FileText size={16} />
                      Criar um texto
                    </button>
                  </div>
                )}
                {messages.map((message) => (
                  <article key={message.id} className={'ai-message is-' + message.role}>
                    <small>{message.role === 'user' ? 'Você' : 'Assistente Mesa'}</small>
                    <div>{message.text}</div>
                    {message.image && (
                      <figure>
                        <img
                          src={message.image.data_url}
                          alt="Ilustração gerada por IA para revisão"
                        />
                        <figcaption>Ilustração gerada por IA</figcaption>
                      </figure>
                    )}
                    {message.hadImage && !message.image && (
                      <p className="field-hint">
                        O arquivo da imagem não é mantido após recarregar a página. Gere novamente
                        se não o baixou.
                      </p>
                    )}
                    {message.role === 'assistant' && (
                      <footer>
                        <span>{message.model}</span>
                        <button
                          type="button"
                          aria-label="Copiar resposta"
                          onClick={() =>
                            void copyText(message.text)
                              .then(() => toast.success('Resposta copiada.'))
                              .catch(() => toast.error('Não foi possível copiar.'))
                          }
                        >
                          <Copy size={13} />
                          Copiar
                        </button>
                        {message.image && (
                          <a
                            href={message.image.data_url}
                            download={
                              'mesa-ia-' +
                              message.id +
                              '.' +
                              (message.image.mime_type === 'image/jpeg'
                                ? 'jpg'
                                : message.image.mime_type === 'image/webp'
                                  ? 'webp'
                                  : 'png')
                            }
                          >
                            <Download size={13} />
                            Baixar imagem
                          </a>
                        )}
                      </footer>
                    )}
                  </article>
                ))}
                {busy && (
                  <div className="ai-chat-thinking" role="status">
                    <LoaderCircle size={17} />
                    {mode === 'image'
                      ? 'Criando sua imagem… Pode levar até 90 segundos.'
                      : 'Preparando sua resposta…'}
                  </div>
                )}
                {failure && (
                  <div className="ai-chat-failure" role="alert">
                    <p>{failure.message}</p>
                    <button
                      disabled={busy}
                      onClick={() => void perform(failure.input, failure.key)}
                    >
                      Tentar novamente
                    </button>
                  </div>
                )}
              </div>
              <form
                className="ai-chat-composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  send();
                }}
              >
                {mode === 'summary' && (
                  <div className="ai-chat-period" role="group" aria-label="Período do resumo">
                    {[
                      [1, '24 horas'],
                      [7, '7 dias'],
                      [30, '30 dias'],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        disabled={busy}
                        aria-pressed={days === value}
                        onClick={() => setDays(Number(value))}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                <div>
                  <textarea
                    ref={inputRef}
                    aria-label="Mensagem para o assistente"
                    placeholder={
                      mode === 'image'
                        ? 'Descreva a imagem que deseja criar…'
                        : mode === 'description'
                          ? 'Que texto você quer criar?'
                          : 'Digite sua mensagem…'
                    }
                    rows={2}
                    maxLength={1500}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    disabled={busy}
                    onKeyDown={(event) => {
                      if (
                        event.key === 'Enter' &&
                        !event.shiftKey &&
                        !event.nativeEvent.isComposing &&
                        window.matchMedia('(min-width: 761px)').matches
                      ) {
                        event.preventDefault();
                        send();
                      }
                    }}
                  />
                  <button
                    className="primary"
                    type="submit"
                    disabled={busy || (!draft.trim() && mode !== 'summary')}
                    aria-label="Enviar mensagem"
                  >
                    {busy ? <LoaderCircle size={19} /> : <Send size={19} />}
                  </button>
                </div>
                <small>
                  Conteúdo gerado por IA. Revise antes de usar. O consumo utiliza sua cota Google.
                </small>
              </form>
            </>
          )}
        </section>
      )}
    </>
  );
  return (
    <Context.Provider value={{ allowed: true, connection, openChat, generate }}>
      {children}
      {createPortal(panel, document.body)}
    </Context.Provider>
  );
}
export function AiSummaryButton({
  focus = 'operation',
  period,
  children = 'Resumo com IA',
  disabled = false,
  title,
}: {
  focus?: string;
  period?: Data;
  children?: ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  const assistant = useAiAssistant();
  if (!assistant.allowed) return null;
  return (
    <button
      type="button"
      className="ai-quick-button"
      disabled={disabled}
      title={title}
      onClick={() =>
        assistant.openChat({
          mode: 'summary',
          focus,
          ...(period ? { period } : {}),
          question:
            focus === 'stock'
              ? 'Analise os saldos sem disponibilidade e sugira prioridades de reposição.'
              : focus === 'finance'
                ? 'Resuma o faturamento, os recebimentos e os estornos deste período, destacando as pendências.'
                : 'Resuma a operação atual e indique as próximas ações.',
        })
      }
    >
      <Sparkles size={16} />
      {children}
    </button>
  );
}
