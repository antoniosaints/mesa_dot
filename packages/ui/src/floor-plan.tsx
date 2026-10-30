import { useEffect, useRef, useState } from 'react';
import { api, brl, type Data } from './client.js';
import { Icon } from './appearance.js';
import { Badge, Empty, Modal, ModalCloseButton } from './common.js';
import { SearchSelect } from './controls.js';
import { NumericInput } from './numeric-input.js';
import { useToasts } from './toasts.js';

const NODE_WIDTH = 140,
  NODE_HEIGHT = 140;
type Position = { x: number; y: number };
const position = (table: Data): Position => ({
  x: Number(table.position_x) || 0,
  y: Number(table.position_y) || 0,
});
const ordered = (tables: Data[]) =>
  [...tables].sort((a, b) => a.number.localeCompare(b.number, 'pt-BR', { numeric: true }));
function useClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
function elapsed(start: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(start)) / 60_000));
  if (!Number.isFinite(minutes)) return '—';
  return minutes < 60
    ? `${minutes} min`
    : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}min`;
}
function TableContent({
  table,
  now,
  compact = false,
}: {
  table: Data;
  now: number;
  compact?: boolean;
}) {
  const attendance = table.attendance;
  return (
    <>
      <div className="table-card-heading">
        <span className="table-number">{table.number}</span>
        <Badge status={table.status} />
      </div>
      <span className="table-capacity">
        <Icon name="team" size={13} />
        {table.capacity} lugares
      </span>
      {table.status !== 'FREE' ? (
        <>
          <div className="table-attendance-time">
            <Icon name="clock" size={14} />
            {table.opened_at_iso ? elapsed(table.opened_at_iso, now) : 'Em atendimento'}
            {!compact && <span>na mesa</span>}
          </div>
          <div className="table-card-financial">
            <span>Total{!compact && ' das comandas'}</span>
            <strong>{attendance ? brl(attendance.total) : '—'}</strong>
          </div>
          <div className="table-card-balance">
            <span>{attendance?.tabs?.length ?? 0} comanda(s)</span>
            <span>{attendance ? brl(attendance.balance) : '—'} pendente</span>
          </div>
        </>
      ) : (
        <div className="table-ready-copy">
          <Icon name="plus" size={14} />
          Iniciar atendimento
        </div>
      )}
      {Number(table.service_request_count) > 0 && (
        <span className="table-request-indicator">
          <Icon name="bell" size={13} />
          {table.service_request_count} solicitação(ões)
        </span>
      )}
    </>
  );
}
export function Floor({ tables, onSelect }: { tables: Data[]; onSelect: (table: Data) => void }) {
  const now = useClock();
  return tables.length ? (
    <div className="floor-grid floor-cards">
      {ordered(tables).map((table) => (
        <button
          key={table.id}
          className={`table-card ${table.status === 'FREE' ? 'free' : 'occupied'} ${table.shape} ${Number(table.service_request_count) > 0 ? 'has-client-request' : ''}`}
          onClick={() => onSelect(table)}
        >
          <div className="table-dots" aria-hidden="true">
            <i />
            <i />
          </div>
          <TableContent table={table} now={now} />
          <div className="table-dots bottom" aria-hidden="true">
            <i />
            <i />
          </div>
        </button>
      ))}
    </div>
  ) : (
    <Empty>Nenhuma mesa encontrada.</Empty>
  );
}
function AreaFilter({
  areas,
  value,
  onChange,
}: {
  areas: Data[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      Área do salão
      <SearchSelect
        label="Área do salão"
        value={value}
        onChange={onChange}
        allowClear={false}
        options={[
          { id: '', name: 'Todas as áreas' },
          { id: 'none', name: 'Sem área' },
          ...areas.map((area) => ({ id: area.id, name: area.name })),
        ]}
      />
    </label>
  );
}
function inArea(table: Data, area: string) {
  return !area || (area === 'none' ? !table.area_id : table.area_id === area);
}
function FloorCanvas({
  tables,
  positions,
  zoom,
  selected,
  editing = false,
  busy = false,
  snap = false,
  onSelect,
  onMove,
}: {
  tables: Data[];
  positions?: Record<string, Position>;
  zoom: number;
  selected?: string;
  editing?: boolean;
  busy?: boolean;
  snap?: boolean;
  onSelect: (table: Data) => void;
  onMove?: (table: Data, next: Position) => void;
}) {
  const now = useClock();
  const [dragged, setDragged] = useState<{ id: string; position: Position } | null>(null);
  const drag = useRef<{
    id: string;
    startX: number;
    startY: number;
    origin: Position;
    current: Position;
  } | null>(null);
  const getPosition = (table: Data) =>
    dragged && dragged.id === table.id
      ? dragged.position
      : (positions?.[table.id] ?? position(table));
  // Keep the canvas size stable while dragging, so scrollbars cannot shift the pointer origin.
  const width = Math.max(
    1000,
    ...tables.map((table) => (positions?.[table.id] ?? position(table)).x + NODE_WIDTH + 80),
  );
  const height = Math.max(
    560,
    ...tables.map((table) => (positions?.[table.id] ?? position(table)).y + NODE_HEIGHT + 80),
  );
  const [dragExtent, setDragExtent] = useState<{ width: number; height: number } | null>(null);
  const w = dragExtent?.width ?? width,
    h = dragExtent?.height ?? height;
  return (
    <div
      className="floor-plan-viewport"
      tabIndex={0}
      aria-label={editing ? 'Canvas de posicionamento das mesas' : 'Planta do salão'}
    >
      <div className="floor-plan-sizer" style={{ width: w * zoom, height: h * zoom }}>
        <div
          className="floor-plan-canvas"
          style={{ width: w, height: h, transform: `scale(${zoom})` }}
        >
          <span className="floor-plan-origin">SALÃO</span>
          {ordered(tables).map((table) => {
            const p = getPosition(table);
            return (
              <button
                key={table.id}
                type="button"
                disabled={busy}
                data-table-id={table.id}
                className={`floor-plan-table ${editing ? 'is-editable' : ''} ${selected === table.id ? 'is-selected' : ''} ${dragged?.id === table.id ? 'is-dragging' : ''} ${table.shape} ${table.status === 'FREE' ? 'free' : 'occupied'} ${Number(table.service_request_count) > 0 ? 'has-client-request' : ''}`}
                style={{ left: p.x + 24, top: p.y + 36 }}
                aria-label={editing ? `Mover mesa ${table.number}` : undefined}
                aria-pressed={editing ? selected === table.id : undefined}
                onClick={() => onSelect(table)}
                onPointerDown={(event) => {
                  if (!editing || busy || event.button !== 0) return;
                  onSelect(table);
                  event.currentTarget.focus({ preventScroll: true });
                  event.currentTarget.setPointerCapture(event.pointerId);
                  drag.current = {
                    id: table.id,
                    startX: event.clientX,
                    startY: event.clientY,
                    origin: p,
                    current: p,
                  };
                  setDragExtent({ width: Math.max(width, 2240), height: Math.max(height, 2240) });
                }}
                onPointerMove={(event) => {
                  const d = drag.current;
                  if (!d || d.id !== table.id) return;
                  const next = {
                    x: Math.max(
                      0,
                      Math.min(2000, Math.round(d.origin.x + (event.clientX - d.startX) / zoom)),
                    ),
                    y: Math.max(
                      0,
                      Math.min(2000, Math.round(d.origin.y + (event.clientY - d.startY) / zoom)),
                    ),
                  };
                  d.current = next;
                  setDragged({ id: table.id, position: next });
                }}
                onPointerUp={(event) => {
                  const d = drag.current;
                  if (!d || d.id !== table.id) return;
                  drag.current = null;
                  setDragged(null);
                  setDragExtent(null);
                  if (event.currentTarget.hasPointerCapture(event.pointerId))
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  if (d.current.x !== d.origin.x || d.current.y !== d.origin.y)
                    onMove?.(
                      table,
                      snap
                        ? {
                            x: Math.round(d.current.x / 20) * 20,
                            y: Math.round(d.current.y / 20) * 20,
                          }
                        : d.current,
                    );
                }}
                onPointerCancel={() => {
                  drag.current = null;
                  setDragged(null);
                  setDragExtent(null);
                }}
                onLostPointerCapture={() => {
                  drag.current = null;
                  setDragged(null);
                  setDragExtent(null);
                }}
                onKeyDown={(event) => {
                  if (!editing || busy) return;
                  const directions: Record<string, Position> = {
                    ArrowUp: { x: 0, y: -1 },
                    ArrowDown: { x: 0, y: 1 },
                    ArrowLeft: { x: -1, y: 0 },
                    ArrowRight: { x: 1, y: 0 },
                  };
                  const direction = directions[event.key];
                  if (!direction || event.repeat) return;
                  event.preventDefault();
                  const step = event.shiftKey ? 1 : 20;
                  onMove?.(table, {
                    x: Math.max(0, Math.min(2000, p.x + direction.x * step)),
                    y: Math.max(0, Math.min(2000, p.y + direction.y * step)),
                  });
                }}
              >
                {editing ? (
                  <>
                    <Icon name="tables" size={22} />
                    <strong>Mesa {table.number}</strong>
                    <small>
                      {table.capacity} lugares · {p.x}, {p.y}
                    </small>
                  </>
                ) : (
                  <TableContent table={table} now={now} compact />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
function Zoom({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <div className="floor-plan-zoom">
      <button
        className="icon-button"
        aria-label="Diminuir zoom"
        disabled={value <= 0.5}
        onClick={() => onChange(Math.max(0.5, +(value - 0.1).toFixed(1)))}
      >
        <Icon name="minus" size={16} />
      </button>
      <button onClick={() => onChange(1)} title="Restaurar zoom para 100%">
        {Math.round(value * 100)}%
      </button>
      <button
        className="icon-button"
        aria-label="Aumentar zoom"
        disabled={value >= 1.5}
        onClick={() => onChange(Math.min(1.5, +(value + 0.1).toFixed(1)))}
      >
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}
export function FloorOverview({
  tables,
  areas,
  onSelect,
}: {
  tables: Data[];
  areas: Data[];
  onSelect: (table: Data) => void;
}) {
  const [area, setArea] = useState(''),
    [query, setQuery] = useState(''),
    [status, setStatus] = useState(''),
    [view, setView] = useState('cards'),
    [zoom, setZoom] = useState(1);
  const visible = tables.filter(
    (table) =>
      table.enabled &&
      inArea(table, area) &&
      table.number.toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
      (!status || (status === 'FREE' ? table.status === 'FREE' : table.status !== 'FREE')),
  );
  return (
    <section className="panel floor-overview">
      <div className="section-head">
        <div>
          <h2>Atendimento do salão</h2>
          <p className="muted small">Tempo e consumo do atendimento atual de cada mesa.</p>
        </div>
        <div className="floor-view-switch" aria-label="Visualização do salão">
          <button
            className={view === 'cards' ? 'active' : ''}
            aria-pressed={view === 'cards'}
            onClick={() => setView('cards')}
          >
            <Icon name="tables" size={16} />
            Cards
          </button>
          <button
            className={view === 'plan' ? 'active' : ''}
            aria-pressed={view === 'plan'}
            onClick={() => setView('plan')}
          >
            <Icon name="eye" size={16} />
            Planta
          </button>
        </div>
      </div>
      <div className="floor-plan-filters">
        <label>
          Buscar mesa
          <span className="input-icon">
            <Icon name="search" size={16} />
            <input
              aria-label="Buscar mesa no salão"
              placeholder="Número da mesa"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </span>
        </label>
        <AreaFilter areas={areas} value={area} onChange={setArea} />
        <label>
          Situação
          <SearchSelect
            label="Situação das mesas"
            value={status}
            onChange={setStatus}
            allowClear={false}
            options={[
              { id: '', name: 'Todas as situações' },
              { id: 'FREE', name: 'Livres' },
              { id: 'OCCUPIED', name: 'Em atendimento' },
            ]}
          />
        </label>
      </div>
      <div className="floor-plan-meta">
        <span>
          {visible.length} mesa(s) · {visible.filter((table) => table.status !== 'FREE').length} em
          atendimento
        </span>
        {view === 'plan' && <Zoom value={zoom} onChange={setZoom} />}
      </div>
      {view === 'cards' ? (
        <Floor tables={visible} onSelect={onSelect} />
      ) : visible.length ? (
        <>
          <p className="muted small">
            Posições definidas na aba Posicionar mesas. Clique em uma mesa para atender.
          </p>
          <FloorCanvas tables={visible} zoom={zoom} onSelect={onSelect} />
        </>
      ) : (
        <Empty>Nenhuma mesa encontrada.</Empty>
      )}
    </section>
  );
}
export function FloorEditor({
  tables,
  areas = [],
  onChange,
}: {
  tables: Data[];
  areas?: Data[];
  onChange: () => void | Promise<void>;
}) {
  const [area, setArea] = useState(''),
    [zoom, setZoom] = useState(1),
    [snap, setSnap] = useState(true),
    [selection, setSelection] = useState('');
  const [positions, setPositions] = useState<Record<string, Position>>({}),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(''),
    [error, setError] = useState('');
  const [adjusting, setAdjusting] = useState(false),
    [x, setX] = useState(''),
    [y, setY] = useState('');
  const lock = useRef(false),
    toast = useToasts();
  const visible = ordered(tables.filter((table) => table.enabled && inArea(table, area)));
  const selected = visible.find((table) => table.id === selection) ?? visible[0];
  useEffect(() => {
    if (!lock.current)
      setPositions(Object.fromEntries(tables.map((table) => [table.id, position(table)])));
  }, [tables]);
  const currentPosition = selected
    ? (positions[selected.id] ?? position(selected))
    : { x: 0, y: 0 };
  async function save(table: Data, next: Position, useSnap = snap) {
    if (lock.current) return;
    const clean = (value: number) =>
      Math.max(0, Math.min(2000, useSnap ? Math.round(value / 20) * 20 : Math.round(value)));
    next = { x: clean(next.x), y: clean(next.y) };
    const previous = positions[table.id] ?? position(table);
    if (next.x === previous.x && next.y === previous.y) {
      setAdjusting(false);
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    setSaved('');
    setPositions((state) => ({ ...state, [table.id]: next }));
    try {
      await api(`/tables/${table.id}`, { position_x: next.x, position_y: next.y }, 'PATCH');
      setSaved(`Posição da mesa ${table.number} salva.`);
      setAdjusting(false);
      // Release the local editing lock before accepting the refreshed server positions.
      lock.current = false;
      await onChange();
    } catch (failure) {
      const message =
        failure instanceof Error ? failure.message : 'Não foi possível salvar a posição.';
      setPositions((state) => ({ ...state, [table.id]: previous }));
      setError(message);
      toast.error(message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const collisions = visible.some((table, i) =>
    visible.slice(i + 1).some((other) => {
      const a = positions[table.id] ?? position(table),
        b = positions[other.id] ?? position(other);
      return (
        table.area_id === other.area_id &&
        Math.abs(a.x - b.x) < NODE_WIDTH &&
        Math.abs(a.y - b.y) < NODE_HEIGHT
      );
    }),
  );
  return (
    <section className="panel floor-layout-editor">
      <div className="section-head">
        <div>
          <h2>Posicionar mesas</h2>
          <p className="muted small">
            Organize a planta como no salão. Cada ajuste é salvo automaticamente.
          </p>
        </div>
        <span className="floor-save-state" role="status">
          <Icon name={error ? 'info' : busy ? 'refresh' : 'check'} size={15} />
          {error
            ? 'Posição não salva'
            : busy
              ? 'Salvando posição…'
              : saved || 'Posições sincronizadas'}
        </span>
      </div>
      <div className="floor-editor-toolbar">
        <AreaFilter areas={areas} value={area} onChange={setArea} />
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={snap}
            onChange={(event) => setSnap(event.target.checked)}
          />
          Alinhar à grade
        </label>
        <Zoom value={zoom} onChange={setZoom} />
      </div>
      <div className="floor-editor-workspace">
        <div>
          <p className="floor-editor-instructions">
            <Icon name="info" size={16} />
            Arraste para mover. Use as setas para ajustar; Shift + seta move 1 ponto. Deslize a
            planta para ver as demais mesas.
          </p>
          {visible.length ? (
            <FloorCanvas
              tables={visible}
              positions={positions}
              zoom={zoom}
              editing
              snap={snap}
              busy={busy}
              selected={selected?.id}
              onSelect={(table) => setSelection(table.id)}
              onMove={(table, next) => void save(table, next, false)}
            />
          ) : (
            <Empty>Nenhuma mesa ativa nesta área.</Empty>
          )}
        </div>
        <aside className="floor-editor-inspector">
          <h3>
            Mesas nesta área <span className="muted small">{visible.length}</span>
          </h3>
          <div className="floor-editor-table-list">
            {visible.map((table) => (
              <button
                key={table.id}
                className={table.id === selected?.id ? 'active' : ''}
                aria-pressed={table.id === selected?.id}
                onClick={() => {
                  setSelection(table.id);
                  document
                    .querySelector(`.floor-plan-table[data-table-id="${table.id}"]`)
                    ?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
                }}
              >
                <Icon name="tables" size={16} />
                <span>
                  Mesa {table.number}
                  <small>
                    {areas.find((item) => item.id === table.area_id)?.name ?? 'Sem área'} ·{' '}
                    {table.capacity} lugares
                  </small>
                </span>
              </button>
            ))}
          </div>
          {selected && (
            <div className="floor-editor-selection">
              <strong>Mesa {selected.number}</strong>
              <p className="muted small">
                {selected.shape === 'round' ? 'Redonda' : 'Quadrada'} · {selected.capacity} lugares
              </p>
              <dl>
                <div>
                  <dt>Horizontal (X)</dt>
                  <dd>{currentPosition.x}</dd>
                </div>
                <div>
                  <dt>Vertical (Y)</dt>
                  <dd>{currentPosition.y}</dd>
                </div>
              </dl>
              <button
                className="full"
                disabled={busy}
                onClick={() => {
                  setX(String(currentPosition.x));
                  setY(String(currentPosition.y));
                  setAdjusting(true);
                }}
              >
                <Icon name="edit" size={16} />
                Ajustar posição exata
              </button>
            </div>
          )}
          {collisions && (
            <p className="floor-overlap-warning">
              <Icon name="info" size={16} />
              Há mesas sobrepostas. Selecione pela lista e arraste para separá-las. Mesas em áreas
              diferentes podem usar a mesma posição.
            </p>
          )}
        </aside>
      </div>
      {adjusting && selected && (
        <Modal
          title={`Posição da mesa ${selected.number}`}
          onClose={() => setAdjusting(false)}
          dirty={x !== String(currentPosition.x) || y !== String(currentPosition.y)}
          closeDisabled={busy}
        >
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              if (x && y) void save(selected, { x: Number(x), y: Number(y) }, false);
            }}
          >
            <p className="muted small">
              Informe valores de 0 a 2000. O ajuste exato não usa o alinhamento à grade.
            </p>
            <label>
              Horizontal (X)
              <NumericInput
                label="Posição horizontal"
                value={x}
                onChange={setX}
                precision={0}
                min={0}
                max={2000}
                maxIntegerDigits={4}
                required
                disabled={busy}
              />
            </label>
            <label>
              Vertical (Y)
              <NumericInput
                label="Posição vertical"
                value={y}
                onChange={setY}
                precision={0}
                min={0}
                max={2000}
                maxIntegerDigits={4}
                required
                disabled={busy}
              />
            </label>
            <div className="modal-footer">
              <ModalCloseButton />
              <button className="primary" disabled={busy || !x || !y}>
                <Icon name="check" size={16} />
                Salvar posição
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
