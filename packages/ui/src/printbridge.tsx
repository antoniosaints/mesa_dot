import { TcpAgentSettings } from './tcp-agent-settings.js';
import { useToasts } from './toasts.js';
import { printDocumentLabel } from '../../shared/src/table-qr-print.js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Printer } from '@antoniosantos1999/printbridge';
import { api, session, type Data } from './client.js';
import { pwaContext } from './pwa-context.js';
import { Icon } from './appearance.js';
import { SearchSelect } from './controls.js';
import type { BridgeBinding, BridgeActivity } from './printbridge-queue.js';
import { PrintStationRuntime, readStationProfile, stationPrefix } from './print-station-runtime.js';
import { PrintStationsPanel } from './print-stations.js';
interface Station {
  connected: boolean;
  connecting: boolean;
  running: boolean;
  waiting: boolean;
  active: boolean;
  name: string;
  error: string;
  printers: Printer[];
  bindings: Record<string, BridgeBinding>;
  activities: BridgeActivity[];
  connect: () => Promise<void>;
  disconnect: () => void;
  refreshPrinters: () => Promise<void>;
  bind: (id: string, value: BridgeBinding | null) => void;
  start: () => Promise<void>;
  pause: () => void;
  rename: (name: string) => void;
}
const Context = createContext<Station | null>(null);
export function PrintBridgeProvider({
  scope,
  allowed,
  independent = false,
  children,
}: {
  scope: string;
  allowed: boolean;
  independent?: boolean;
  children: ReactNode;
}) {
  const toast = useToasts();
  const unit = pwaContext()?.establishment_id ?? session()?.actor?.establishmentId ?? '';
  const [runtime, setRuntime] = useState<PrintStationRuntime | null>(null);
  const [state, setState] = useState(() => ({
    ...readStationProfile(unit, scope),
    connected: false,
    connecting: false,
    running: false,
    waiting: false,
    error: '',
    printers: [] as Printer[],
    activities: [] as BridgeActivity[],
  }));
  useEffect(() => {
    if (!allowed || !unit) return;
    const station = new PrintStationRuntime({
      unit,
      profile: readStationProfile(unit, scope),
      change: setState,
      ...(!independent
        ? { issue: (name: string) => api('/print/agents', { name, transport: 'PRINTBRIDGE' }) }
        : {}),
    });
    setRuntime(station);
    setState(station.state);
    station.restore();
    const sync = (event: StorageEvent) => {
      if (event.key?.startsWith(stationPrefix(unit))) station.sync(readStationProfile(unit));
    };
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('storage', sync);
      station.dispose();
    };
  }, [unit, scope, allowed, independent]);
  return (
    <Context.Provider
      value={{
        ...state,
        active: state.config.active,
        name: state.config.name,
        connect: async () => {
          if (!runtime) return;
          await runtime.connect();
          if (runtime.state.connected)
            toast.success('PrintBridge conectado. Confira os vínculos e ative a fila.');
        },
        disconnect: () => runtime?.disconnect(),
        refreshPrinters: () => runtime?.refreshPrinters() ?? Promise.resolve(),
        bind: (id, value) => runtime?.bind(id, value),
        start: () => runtime?.start() ?? Promise.resolve(),
        pause: () => runtime?.pause(),
        rename: (name) => runtime?.name(name),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function PrintBridgeIndicator({ onOpen }: { onOpen: () => void }) {
  const station = useContext(Context);
  if (!station) return null;
  return (
    <button
      className={'printbridge-indicator ' + (station.running ? 'is-active' : '')}
      onClick={onOpen}
      title="Configurar impressoras locais"
    >
      <Icon name="printing" size={16} />
      <span>
        {station.running
          ? 'Fila local ativa'
          : station.waiting
            ? 'Agente em outra aba'
            : station.connected
              ? 'PrintBridge conectado'
              : 'PrintBridge'}
      </span>
    </button>
  );
}
export function PrintBridgePanel({
  printers,
  independent = false,
}: {
  printers: Data[];
  independent?: boolean;
}) {
  const station = useContext(Context);
  if (!station) return null;
  const logical = printers.filter((p) => p.enabled),
    nativeOptions = station.printers.map((p) => ({
      id: p.id,
      name: p.name + (p.isDefault ? ' · Padrão' : ''),
    }));
  return (
    <section className="panel printbridge-panel">
      <div className="section-head">
        <div>
          <h2>
            <Icon name="printing" size={20} />
            Impressoras locais · PrintBridge
          </h2>
          <p className="muted small">
            Use este computador como agente para receber fichas e cupons enviados por qualquer
            dispositivo, inclusive celulares fora do local.
          </p>
        </div>
        <span className={'printbridge-status ' + (station.running ? 'is-active' : '')}>
          {station.waiting
            ? 'Ativa em outra aba'
            : station.running
              ? 'Agente ativo'
              : station.active
                ? 'Reconectando'
                : station.connected
                  ? 'Conectado'
                  : 'Desconectado'}
        </span>
      </div>
      <div className="printbridge-steps">
        <div>
          <strong>1. Abrir o PrintBridge</strong>
          <p>
            Use o aplicativo instalado no computador com a impressora.{' '}
            <a href="https://printbridge.userp.com.br/#downloads" target="_blank" rel="noreferrer">
              Download e documentação
            </a>
          </p>
        </div>
        <div>
          <strong>2. Conectar e autorizar</strong>
          <p>
            Autorize esta origem no aplicativo local: <code>{location.origin}</code>. Selecione as
            impressoras que o sistema poderá usar.
          </p>
        </div>
        <div>
          <strong>3. Vincular e ativar</strong>
          <p>
            Associe as impressoras e ative o agente. A conexão e a fila são retomadas
            automaticamente ao recarregar. Use o modo estação para trabalhar sem a sessão de gestão.
          </p>
        </div>
      </div>
      <div className="print-station-settings">
        <label>
          Nome deste computador
          <input
            maxLength={100}
            value={station.name}
            disabled={station.active}
            onChange={(event) => station.rename(event.target.value)}
          />
        </label>
        {!independent && (
          <a
            className="pwa-launch-link"
            target="_blank"
            rel="noreferrer"
            href={(pwaContext()?.base_path ?? '/' + session()?.slug + '/') + 'estacao-impressao'}
          >
            <Icon name="next" size={16} />
            Abrir modo estação
          </a>
        )}
        <p className="field-hint">
          Os outros dispositivos enviam para a fila do Mesa. Somente este computador se conecta ao
          PrintBridge local. Ambos precisam acessar o mesmo servidor Mesa.
        </p>
      </div>
      <div className="button-row">
        <button
          className="primary"
          disabled={station.connecting || station.active}
          onClick={() => void station.connect()}
        >
          <Icon name="printing" size={16} />
          {station.connecting
            ? 'Aguardando autorização…'
            : station.connected
              ? 'Reconectar PrintBridge'
              : 'Conectar PrintBridge'}
        </button>
        {!station.connected && station.active && (
          <>
            <button onClick={station.pause}>
              <Icon name="close" size={16} />
              Pausar novos envios
            </button>
            <button onClick={station.disconnect}>
              <Icon name="close" size={16} />
              Desconectar
            </button>
          </>
        )}
        {station.connected && (
          <>
            <button onClick={() => void station.refreshPrinters()} disabled={station.active}>
              <Icon name="refresh" size={16} />
              Atualizar impressoras
            </button>
            <button onClick={station.disconnect}>
              <Icon name="close" size={16} />
              Desconectar
            </button>
          </>
        )}
      </div>
      {station.error && (
        <div className="alert error" role="alert">
          {station.error}
        </div>
      )}
      {station.connected && (
        <>
          {!station.printers.length && (
            <div className="alert warning">
              Nenhuma impressora autorizada foi encontrada. Confira os drivers e as permissões no
              PrintBridge e atualize a lista.
            </div>
          )}
          {!logical.length ? (
            <p className="field-hint">
              Cadastre as impressoras por setor na aba Impressoras para configurar os vínculos.
            </p>
          ) : (
            <div className="printbridge-bindings">
              {logical.map((p) => {
                const binding = station.bindings[p.id];
                return (
                  <article key={p.id}>
                    <div>
                      <strong>{p.name}</strong>
                      <small>Setor: {p.sector}</small>
                    </div>
                    <label>
                      Impressora instalada
                      <SearchSelect
                        label={'Impressora local para ' + p.name}
                        options={nativeOptions}
                        value={binding?.printerId ?? ''}
                        disabled={station.active}
                        placeholder="Selecionar impressora local…"
                        onChange={(printerId) =>
                          station.bind(
                            p.id,
                            printerId
                              ? {
                                  printerId,
                                  format: binding?.format ?? 'pdf',
                                  paperWidth: binding?.paperWidth ?? 80,
                                }
                              : null,
                          )
                        }
                      />
                    </label>
                    <label>
                      Formato
                      <select
                        aria-label={'Formato de ' + p.name}
                        value={binding?.format ?? 'pdf'}
                        disabled={station.active || !binding}
                        onChange={(e) =>
                          station.bind(p.id, {
                            ...binding!,
                            format: e.target.value as 'pdf' | 'escpos',
                          })
                        }
                      >
                        <option value="pdf">PDF · Driver do sistema</option>
                        <option value="escpos">ESC/POS · Térmica compatível</option>
                      </select>
                    </label>
                    <label>
                      Papel da ficha
                      <select
                        aria-label={'Papel de ' + p.name}
                        value={binding?.paperWidth ?? 80}
                        disabled={station.active || !binding}
                        onChange={(e) =>
                          station.bind(p.id, {
                            ...binding!,
                            paperWidth: Number(e.target.value) as 58 | 80,
                          })
                        }
                      >
                        <option value="80">80 mm</option>
                        <option value="58">58 mm</option>
                      </select>
                    </label>
                  </article>
                );
              })}
            </div>
          )}
          <p className="field-hint">
            Cupons usam a largura escolhida na emissão. No modo PDF, configure o papel
            correspondente no driver; o documento é enviado sem ajuste de escala. ESC/POS exige uma
            térmica compatível. Os vínculos ficam neste navegador.
          </p>
          <div className="printbridge-activation">
            {station.active ? (
              <button onClick={station.pause}>
                <Icon name="close" size={16} />
                Pausar novos envios
              </button>
            ) : (
              <button
                className="primary"
                onClick={() => void station.start()}
                disabled={!station.printers.length || !Object.keys(station.bindings).length}
              >
                <Icon name="ready" size={16} />
                Ativar fila local
              </button>
            )}
            <p>
              O computador deve permanecer ligado, com PrintBridge e uma aba do Mesa ou do modo
              estação aberta. A fila volta automaticamente após recarregar. Pausar ou fechar não
              cancela documentos que o PrintBridge já aceitou. “Enviado” confirma entrega ao
              spooler, sem comprovar saída do papel.
            </p>
          </div>
        </>
      )}
      {!independent && (
        <>
          <PrintStationsPanel />
          <TcpAgentSettings printers={printers} />
        </>
      )}
      {station.activities.length > 0 && (
        <div className="printbridge-activity">
          <h3>Atividade desta estação</h3>
          {station.activities.map((a) => (
            <div key={a.id}>
              <strong>
                {printDocumentLabel(a.kind)} · {a.id.slice(0, 8)}
              </strong>
              <span>{a.message}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
