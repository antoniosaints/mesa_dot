import mysql from 'mysql2/promise';
import { drizzle } from 'drizzle-orm/mysql2';
import { sql, type SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { env } from '../../shared/src/config.js';
import { canonical, hash, ensure, type Actor } from '../../shared/src/index.js';
import { scopedTables, type TableName } from './tables.js';
export { sql };
export type Row = Record<string, any>;
export interface Executor {
  execute(query: SQL): Promise<any>;
}
export const pool = mysql.createPool({
  uri: env.DATABASE_URL,
  connectionLimit: 12,
  decimalNumbers: false,
  timezone: 'Z',
  dateStrings: true,
});
export const db = drizzle(pool);
export async function rows<T extends Row = Row>(executor: Executor, statement: SQL): Promise<T[]> {
  return (await executor.execute(statement))[0] as T[];
}
const identifier = (name: string) => {
  ensure(/^[a-z_]+$/.test(name), 'INTERNAL_ERROR', 'Identificador SQL inválido.', 500);
  return sql.identifier(name);
};
export class Scope {
  constructor(
    public readonly tx: Executor,
    public readonly actor: Actor,
  ) {}
  where(extra?: SQL): SQL {
    return sql`tenant_id = ${this.actor.tenantId} AND establishment_id = ${this.actor.establishmentId}${extra ? sql` AND (${extra})` : sql``}`;
  }
  private table(name: TableName) {
    ensure(scopedTables.includes(name), 'INTERNAL_ERROR', 'Tabela inválida.', 500);
    return identifier(name);
  }
  async list<T extends Row = Row>(table: TableName, extra?: SQL, limit?: number): Promise<T[]> {
    return rows<T>(
      this.tx,
      sql`SELECT * FROM ${this.table(table)} WHERE ${this.where(extra)} ORDER BY created_at DESC, id ${limit ? sql`LIMIT ${limit}` : sql``}`,
    );
  }
  async get<T extends Row = Row>(table: TableName, id: string, lock = false): Promise<T> {
    const result = await rows<T>(
      this.tx,
      sql`SELECT * FROM ${this.table(table)} WHERE ${this.where(sql`id = ${id}`)} ${lock ? sql`FOR UPDATE` : sql``}`,
    );
    ensure(result.length, 'NOT_FOUND', 'Registro não encontrado nesta unidade.', 404);
    return result[0];
  }
  async insert(table: TableName, data: Row): Promise<Row> {
    ensure(
      !('tenant_id' in data) && !('establishment_id' in data),
      'INTERNAL_ERROR',
      'Escopo deve vir da autenticação.',
      500,
    );
    const row: Row = {
      id: randomUUID(),
      ...data,
      tenant_id: this.actor.tenantId,
      establishment_id: this.actor.establishmentId,
    };
    const keys = Object.keys(row);
    await this.tx.execute(
      sql`INSERT INTO ${this.table(table)} (${sql.join(keys.map(identifier), sql`, `)}) VALUES (${sql.join(
        Object.values(row).map(
          (v) =>
            sql`${typeof v === 'object' && v !== null && !(v instanceof Date) ? JSON.stringify(v) : v}`,
        ),
        sql`, `,
      )})`,
    );
    return row;
  }
  async update(table: TableName, id: string, data: Row, extra?: SQL): Promise<number> {
    ensure(
      !['tenant_id', 'establishment_id', 'id'].some((k) => k in data),
      'INTERNAL_ERROR',
      'Escopo imutável.',
      500,
    );
    const assignments = Object.entries(data).map(
      ([k, v]) =>
        sql`${identifier(k)} = ${typeof v === 'object' && v !== null && !(v instanceof Date) ? JSON.stringify(v) : v}`,
    );
    const result = await this.tx.execute(
      sql`UPDATE ${this.table(table)} SET ${sql.join(assignments, sql`, `)} WHERE ${this.where(sql`id = ${id}${extra ? sql` AND ${extra}` : sql``}`)}`,
    );
    return result[0].affectedRows;
  }
  async audit(action: string, id: string, metadata: Row = {}) {
    await this.insert('audit_logs', {
      actor_id: this.actor.id,
      action,
      aggregate_id: id,
      metadata,
    });
  }
  async event(event: string, id: string, payload: Row = {}, version = 1) {
    await this.insert('outbox_events', { event, aggregate_id: id, version, payload });
  }
}
export function view(actor: Actor) {
  return new Scope(db, actor);
}
export async function atomic<T>(
  actor: Actor,
  key: string,
  operation: string,
  input: unknown,
  work: (scope: Scope) => Promise<T>,
  serialization: 'unit' | 'tenant' = 'unit',
): Promise<T> {
  ensure(
    key.length >= 8 && key.length <= 128,
    'BAD_REQUEST',
    'Envie Idempotency-Key de 8 a 128 caracteres.',
    400,
  );
  const requestHash = hash(canonical(input));
  return db.transaction(
    async (tx) => {
      // Lock order is tenant -> unit -> membership. Account-wide access changes take an
      // exclusive tenant lock; ordinary unit operations share it and remain independent.
      const tenants = await rows(
        tx,
        sql`SELECT id FROM tenants WHERE id=${actor.tenantId} AND enabled=TRUE ${serialization === 'tenant' ? sql`FOR UPDATE` : sql`FOR SHARE`}`,
      );
      ensure(tenants.length, 'FORBIDDEN', 'Conta indisponível.', 403);
      // Coarse unit lock makes first occupancy, money and inventory transitions serializable per venue.
      const units = await rows(
        tx,
        sql`SELECT e.* FROM establishments e WHERE e.tenant_id=${actor.tenantId} AND e.id=${actor.establishmentId} FOR UPDATE`,
      );
      ensure(units.length, 'FORBIDDEN', 'Unidade indisponível.', 403);
      let effectiveActor = actor;
      if (actor.kind === 'STAFF') {
        const members = await rows(
          tx,
          sql`SELECT sm.role_id,tm.is_account_admin FROM staff_memberships sm JOIN users u ON u.id=sm.user_id JOIN tenant_memberships tm ON tm.tenant_id=sm.tenant_id AND tm.user_id=sm.user_id WHERE sm.tenant_id=${actor.tenantId} AND sm.establishment_id=${actor.establishmentId} AND sm.user_id=${actor.id} AND sm.enabled=TRUE AND tm.enabled=TRUE AND u.enabled=TRUE`,
        );
        ensure(members.length, 'FORBIDDEN', 'Vínculo desativado.', 403);
        const grants = await rows(
          tx,
          sql`SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.tenant_id=${actor.tenantId} AND rp.establishment_id=${actor.establishmentId} AND rp.role_id=${members[0].role_id}`,
        );
        effectiveActor = {
          ...actor,
          isAccountAdmin: Boolean(members[0].is_account_admin),
          permissions: grants.map((p) => p.code),
        };
      }
      const scope = new Scope(tx, effectiveActor);
      const previous = await scope.list(
        'idempotency_records',
        sql`actor_id=${actor.id} AND idempotency_key=${key}`,
      );
      if (previous.length) {
        ensure(
          previous[0].operation === operation && previous[0].request_hash === requestHash,
          'CONFLICT',
          'Idempotency-Key reutilizada com outra operação ou conteúdo.',
        );
        return previous[0].response_json as T;
      }
      const response = await work(scope);
      await scope.insert('idempotency_records', {
        actor_id: actor.id,
        idempotency_key: key,
        operation,
        request_hash: requestHash,
        response_json: response,
      });
      return response;
    },
    { isolationLevel: 'read committed' },
  );
}
