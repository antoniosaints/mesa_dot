import { NumericInput } from './numeric-input.js';
import { useEffect, useRef, useState } from 'react';
import { api, type Data } from './client.js';
import { Modal, ModalCloseButton, useAction } from './common.js';
import { Icon } from './appearance.js';
import { SearchSelect } from './controls.js';
import { TableLoading } from './pagination.js';
import { StockLocations } from './product-configuration.js';
import { normalizeStockQuantity } from './stock-quantity.js';
export function ProductInitialStockModal({
  product,
  onDone,
}: {
  product: Data;
  onDone: (created: boolean, sourceLocation?: string) => void;
}) {
  const [locations, setLocations] = useState<Data[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [location, setLocation] = useState(''),
    [initialLocation, setInitialLocation] = useState(''),
    [amount, setAmount] = useState('');
  const [useForConsumption, setUseForConsumption] = useState(product.stock_policy !== 'RECIPE'),
    [placesOpen, setPlacesOpen] = useState(false);
  const { run, busy, feedback } = useAction();
  const attempt = useRef({ signature: '', key: crypto.randomUUID() });
  const alive = useRef(true);
  async function load() {
    setLoading(true);
    try {
      const list: Data[] = await api('/stock-locations');
      if (!alive.current) return;
      setLocations(list);
      setError('');
      const preferred =
        list.find((l) => l.id === product.stock_location_id) ??
        list.find((l) => l.is_default) ??
        list[0];
      setLocation((current) => current || preferred?.id || '');
      setInitialLocation((current) => current || preferred?.id || '');
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setLoading(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, []);
  return (
    <Modal
      title="Criar estoque do novo produto?"
      onClose={() => onDone(false)}
      closeDisabled={busy}
      dirty={
        Boolean(amount.trim()) ||
        location !== initialLocation ||
        useForConsumption !== (product.stock_policy !== 'RECIPE')
      }
    >
      <p className="modal-description">
        <strong>{product.name}</strong> foi cadastrado. Quer vincular um local e informar o saldo
        inicial agora?
      </p>
      <p className="field-hint">
        Esta etapa é opcional. Você também pode configurar o estoque depois, na aba Estoques e
        locais.
      </p>
      {feedback}
      {error && (
        <div className="alert error" role="alert">
          {error}
          <button onClick={() => void load()} disabled={loading}>
            Tentar novamente
          </button>
        </div>
      )}
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            if (!location) throw new Error('Selecione um local de estoque.');
            const data = {
              location_id: location,
              ...(amount.trim() ? { quantity: normalizeStockQuantity(amount) } : {}),
              use_for_consumption: useForConsumption,
            };
            const signature = JSON.stringify(data);
            if (attempt.current.signature !== signature)
              attempt.current = { signature, key: crypto.randomUUID() };
            await api(
              '/products/' + product.id + '/initial-stock',
              data,
              'POST',
              attempt.current.key,
            );
            onDone(true, useForConsumption ? location : undefined);
          }, 'Estoque inicial cadastrado.');
        }}
      >
        {loading ? (
          <TableLoading label="Carregando locais de estoque…" compact />
        ) : (
          <>
            <label>
              <span>
                Local de estoque{' '}
                <span className="required-mark" aria-hidden="true">
                  *
                </span>
              </span>
              <SearchSelect
                label="Local do estoque inicial"
                disabled={busy}
                required
                value={location}
                onChange={setLocation}
                options={locations.map((l) => ({
                  id: l.id,
                  color: l.color,
                  name: l.name + (l.is_default ? ' · padrão' : ''),
                }))}
                placeholder="Selecione o local"
              />
            </label>
            <button type="button" onClick={() => setPlacesOpen(true)} disabled={busy}>
              <Icon name="folder" size={16} />
              Gerenciar locais
            </button>
            <label>
              Quantidade inicial (opcional)
              <NumericInput
                label="Quantidade inicial"
                min="0"
                placeholder="Ex.: 12 ou 12,500"
                value={amount}
                onChange={setAmount}
                disabled={busy}
              />
              <small className="field-hint">
                Deixe em branco para iniciar com zero. Aceita até três casas decimais.
              </small>
            </label>
            {product.stock_policy !== 'RECIPE' && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={useForConsumption}
                  onChange={(e) => setUseForConsumption(e.target.checked)}
                  disabled={busy}
                />
                Usar este local na baixa do produto
              </label>
            )}
            {product.stock_policy === 'NO_CONTROL' && (
              <p className="product-management-note">
                O produto continua sem baixa automática. Para consumir esse saldo nos pedidos,
                configure a política em Estoque e produção.
              </p>
            )}
            {product.stock_policy === 'RECIPE' && (
              <p className="product-management-note">
                A ficha técnica continua consumindo os estoques dos ingredientes.
              </p>
            )}
          </>
        )}
        <div className="modal-footer">
          <ModalCloseButton disabled={busy}>Agora não</ModalCloseButton>
          <button className="primary" disabled={busy || loading || !location || Boolean(error)}>
            <Icon name="plus" size={16} />
            {busy ? 'Criando estoque…' : 'Criar estoque'}
          </button>
        </div>
      </form>
      {placesOpen && (
        <StockLocations
          locations={locations}
          canAdjust
          refresh={load}
          onClose={() => setPlacesOpen(false)}
        />
      )}
    </Modal>
  );
}
