import { useEffect, useState, type ReactNode } from 'react';
import { api, type Data } from './client.js';
import { Icon } from './appearance.js';
import { TableLoading } from './pagination.js';
import { Modal, ModalCloseButton, useAction, useRefresh } from './common.js';
export function PrintStationsPanel({
  transport = 'PRINTBRIDGE',
  action,
}: {
  transport?: 'PRINTBRIDGE' | 'TCP';
  action?: ReactNode;
}) {
  const tcp = transport === 'TCP',
    title = tcp ? 'Agentes TCP/IP' : 'Computadores de impressão';
  const [stations, setStations] = useState<Data[]>([]),
    [error, setError] = useState(''),
    [selected, setSelected] = useState<Data | null>(null),
    [loading, setLoading] = useState(true);
  const { run, busy } = useAction();
  async function load() {
    try {
      setStations(
        (await api('/print/stations')).filter((station: Data) => station.transport === transport),
      );
      setError('');
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useRefresh(load, [transport]);
  useEffect(() => {
    const timer = setInterval(() => void load(), 10000);
    return () => clearInterval(timer);
  }, [transport]);
  return (
    <section className="print-stations-panel" aria-label={title}>
      <div className="section-head">
        <div>
          <h3>
            <Icon name="printing" size={18} />
            {title}
          </h3>
          <p className="field-hint">
            {tcp
              ? 'Integração opcional com impressoras de rede via ESC/POS. Não é necessária para usar o PrintBridge.'
              : 'Computadores configurados pelo PrintBridge recebem a fila desta filial, inclusive os envios feitos pelo celular.'}
          </p>
        </div>
        <div className="button-row">
          {action}
          <button onClick={() => void load()}>
            <Icon name="refresh" size={16} />
            Atualizar estações
          </button>
        </div>
      </div>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <TableLoading
          label={tcp ? 'Carregando agentes TCP/IP…' : 'Carregando computadores de impressão…'}
        />
      ) : !stations.length ? (
        error ? null : (
          <p className="field-hint">
            {tcp
              ? 'Nenhum agente TCP/IP cadastrado. Crie uma credencial somente se for executar o programa agente na rede da impressora.'
              : 'Nenhum computador PrintBridge cadastrado. Conecte o PrintBridge, vincule as impressoras e ative a fila local; o cadastro é automático.'}
          </p>
        )
      ) : (
        stations.map((station) => (
          <article key={station.id} className="print-station-row">
            <div>
              <strong>{station.name}</strong>
              <span
                className={
                  'badge ' +
                  (!station.enabled ? 'cancelled' : station.online ? 'available' : 'pending')
                }
              >
                {!station.enabled
                  ? 'Desativado'
                  : station.online
                    ? 'Online'
                    : !station.last_seen_at
                      ? 'Aguardando conexão'
                      : 'Offline'}
              </span>
              <small>
                {tcp ? 'TCP/IP · ESC/POS' : 'PrintBridge'} · {station.printer_ids.length}{' '}
                impressora(s) vinculada(s)
              </small>
              <small>
                {station.last_seen_at
                  ? 'Última comunicação: ' +
                    new Date(
                      String(station.last_seen_at).replace(' ', 'T') +
                        (/Z$|[+-]\d{2}:\d{2}$/.test(String(station.last_seen_at)) ? '' : 'Z'),
                    ).toLocaleString('pt-BR')
                  : 'O programa ainda não se conectou à fila.'}
              </small>
            </div>
            <button
              className={station.enabled ? 'danger' : ''}
              onClick={() => setSelected(station)}
            >
              {station.enabled ? 'Desativar agente' : 'Reativar agente'}
            </button>
          </article>
        ))
      )}
      {selected && (
        <Modal
          title={
            selected.enabled ? 'Desativar agente de impressão?' : 'Reativar agente de impressão?'
          }
          closeDisabled={busy}
          onClose={() => setSelected(null)}
        >
          <p>
            {selected.name}.{' '}
            {selected.enabled
              ? 'O computador deixará de receber novos trabalhos. A fila pendente será preservada; envios já aceitos pela impressora podem terminar.'
              : 'O agente poderá voltar a se conectar usando sua credencial existente.'}
          </p>
          <div className="modal-footer">
            <ModalCloseButton disabled={busy}>Voltar</ModalCloseButton>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api(
                    '/print/agents/' + selected.id,
                    { enabled: !selected.enabled },
                    'PATCH',
                  );
                  setSelected(null);
                  await load();
                }, 'Agente atualizado.')
              }
            >
              Confirmar
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
export function RemotePrintHint({ printer }: { printer: string }) {
  const [printers, setPrinters] = useState<Data[] | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const values = await api('/receipts/printers');
        if (live) {
          setPrinters(values);
          setError('');
        }
      } catch {
        if (live)
          setError(
            'Não foi possível consultar as estações agora. O envio será registrado na fila.',
          );
      }
    };
    void load();
    const timer = setInterval(() => void load(), 10000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  const selected = printers?.find((value) => value.id === printer),
    online = (selected?.stations ?? []).filter((station: Data) => station.online);
  return (
    <p className={'remote-print-hint ' + (online.length ? 'is-online' : '')} role="status">
      <Icon name="printing" size={16} />
      <span>
        {error ||
          (!printers
            ? 'Consultando computadores de impressão…'
            : !printer
              ? 'Escolha a impressora de destino.'
              : online.length
                ? 'Destino online: ' +
                  online.map((station: Data) => station.name).join(', ') +
                  '. Você pode enviar deste dispositivo.'
                : 'Nenhum agente online para esta impressora. O trabalho aguardará na fila até o computador reconectar.')}
        <small>
          Não é necessário conectar o PrintBridge neste celular. A impressão acontece no computador
          vinculado à impressora.
        </small>
      </span>
    </p>
  );
}
