import { useEffect, useState } from 'react';
import { api, type Data } from './client.js';
import { Icon } from './appearance.js';
import { Modal, ModalCloseButton, useAction, useRefresh } from './common.js';
export function PrintStationsPanel() {
  const [stations, setStations] = useState<Data[]>([]),
    [error, setError] = useState(''),
    [selected, setSelected] = useState<Data | null>(null);
  const { run, busy } = useAction();
  async function load() {
    try {
      setStations(await api('/print/stations'));
      setError('');
    } catch (error) {
      setError((error as Error).message);
    }
  }
  useRefresh(load, []);
  useEffect(() => {
    const timer = setInterval(() => void load(), 10000);
    return () => clearInterval(timer);
  }, []);
  return (
    <section className="print-stations-panel" aria-label="Computadores de impressão">
      <div className="section-head">
        <div>
          <h3>
            <Icon name="printing" size={18} />
            Computadores de impressão
          </h3>
          <p className="field-hint">
            O celular envia pela internet para os computadores ativos desta unidade.
          </p>
        </div>
        <button onClick={() => void load()}>
          <Icon name="refresh" size={16} />
          Atualizar estações
        </button>
      </div>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {!stations.length ? (
        <p className="field-hint">
          Nenhum agente cadastrado. Conecte e ative este computador para começar.
        </p>
      ) : (
        stations.map((station) => (
          <article key={station.id} className="print-station-row">
            <div>
              <strong>{station.name}</strong>
              <span className={'badge ' + (station.online ? 'available' : 'pending')}>
                {!station.enabled ? 'Desativado' : station.online ? 'Online' : 'Offline'}
              </span>
              <small>{station.printer_ids.length} impressora(s) vinculada(s)</small>
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
