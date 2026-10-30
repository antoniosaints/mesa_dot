import { z } from 'zod';
import { rows, sql, type Scope, type Row } from '../../../packages/database/src/index.js';
import { ensure, permit } from '../../../packages/shared/src/index.js';
export const stationHeartbeatSchema = z.strictObject({
  printer_ids: z.array(z.uuid()).max(50),
  running: z.boolean(),
  connected: z.boolean(),
  name: z.string().trim().min(1).max(100).optional(),
});
function status(value: Row) {
  const state =
    typeof value.station_status === 'string'
      ? JSON.parse(value.station_status)
      : value.station_status;
  return {
    id: value.id,
    name: value.name,
    transport: value.transport,
    enabled: Boolean(value.enabled),
    last_seen_at: value.last_seen_at,
    online: Boolean(
      value.enabled &&
      state?.running &&
      state?.connected &&
      value.age_seconds !== null &&
      Number(value.age_seconds) <= 45,
    ),
    printer_ids: Array.isArray(state?.printer_ids) ? state.printer_ids : [],
  };
}
export async function stationDetails(s: Scope) {
  ensure(s.actor.kind === 'AGENT', 'FORBIDDEN', 'Credencial de estação necessária.', 403);
  const agent = await s.get('print_agents', s.actor.id);
  ensure(agent.transport === 'PRINTBRIDGE', 'FORBIDDEN', 'Estação PrintBridge necessária.', 403);
  const [unit] = await rows(
    s.tx,
    sql`SELECT name,slug FROM establishments WHERE tenant_id=${s.actor.tenantId} AND id=${s.actor.establishmentId}`,
  );
  const printers = await rows(
    s.tx,
    sql`SELECT id,name,sector,enabled FROM printers WHERE ${s.where(sql`enabled=TRUE`)} ORDER BY name,id`,
  );
  return {
    agent: { id: agent.id, name: agent.name },
    tenant_id: s.actor.tenantId,
    establishment_id: s.actor.establishmentId,
    unit,
    printers,
  };
}
export async function stationHeartbeat(s: Scope, input: z.infer<typeof stationHeartbeatSchema>) {
  await stationDetails(s);
  const printerIds = [...new Set(input.printer_ids)];
  for (const id of printerIds) {
    const printer = await s.get('printers', id);
    ensure(printer.enabled, 'BAD_REQUEST', 'Uma impressora vinculada está desativada.', 400);
  }
  ensure(
    !input.running || (input.connected && printerIds.length > 0),
    'BAD_REQUEST',
    'Conecte e vincule as impressoras antes de ativar.',
    400,
  );
  await s.update('print_agents', s.actor.id, {
    ...(input.name ? { name: input.name } : {}),
    last_seen_at: new Date(),
    station_status: { ...input, printer_ids: printerIds },
  });
  return { active: input.running && input.connected };
}
async function loadStations(s: Scope) {
  const agents = await rows(
    s.tx,
    sql`SELECT id,name,transport,enabled,last_seen_at,station_status,TIMESTAMPDIFF(SECOND,last_seen_at,UTC_TIMESTAMP(3)) age_seconds FROM print_agents WHERE ${s.where()} ORDER BY created_at DESC,id`,
  );
  return agents.map(status);
}
export async function printStations(s: Scope) {
  permit(s.actor, 'print.manage');
  return loadStations(s);
}
export async function printerAvailability(s: Scope) {
  const [printers, stations] = await Promise.all([
    s.list('printers', sql`enabled=TRUE`),
    loadStations(s),
  ]);
  return printers.map((printer) => ({
    id: printer.id,
    name: printer.name,
    sector: printer.sector,
    stations: stations
      .filter((station) => station.enabled && station.printer_ids.includes(printer.id))
      .map((station) => ({ id: station.id, name: station.name, online: station.online })),
  }));
}
export async function updatePrintAgent(s: Scope, id: string, input: { enabled: boolean }) {
  permit(s.actor, 'print.manage');
  ensure(s.actor.kind === 'STAFF', 'FORBIDDEN', 'Equipe autorizada necessária.', 403);
  await s.get('print_agents', id, true);
  await s.update('print_agents', id, {
    enabled: input.enabled,
    ...(!input.enabled ? { station_status: null } : {}),
  });
  await s.audit('print.agent_updated', id, { enabled: input.enabled });
  await s.event('print.agent_updated', id);
  return { id, enabled: input.enabled };
}
