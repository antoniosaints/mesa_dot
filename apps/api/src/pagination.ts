import { z } from 'zod';
import { rows, sql, type Executor } from '../../../packages/database/src/index.js';
import type { SQL } from 'drizzle-orm';
import { pageInfo } from '../../../packages/shared/src/pagination.js';
export const pageFields = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(10),
};
/** source and orderBy must be constructed from scoped SQL and fixed allowlists. */
export async function sqlPage(
  executor: Executor,
  source: SQL,
  where: SQL,
  orderBy: SQL,
  input: { page: number; page_size: number },
) {
  const count = await rows(
    executor,
    sql`SELECT COUNT(*) total FROM (${source}) paged WHERE ${where}`,
  );
  const info = pageInfo(Number(count[0].total), input.page, input.page_size);
  const data = await rows(
    executor,
    sql`SELECT * FROM (${source}) paged WHERE ${where} ORDER BY ${orderBy} LIMIT ${info.pageSize} OFFSET ${info.offset}`,
  );
  return { rows: data, total: info.total, page: info.page, page_size: info.pageSize };
}
