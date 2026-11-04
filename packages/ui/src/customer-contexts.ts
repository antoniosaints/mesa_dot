import { pwaContext, tenantStorageKey } from './pwa-context.js';
import { visitorApi, type Data } from './client.js';

export interface CustomerContext {
  code: string;
  label: string;
  storageKey: string;
  visitor: Data;
}

export interface CustomerTicketGroup {
  code: string;
  label: string;
  visitorId: string;
  tickets: Data[];
  error?: string;
}

/** Only sessions already identified in this unit and this browser tab are considered. */
export function savedCustomerContexts(scope: string): CustomerContext[] {
  const prefix = tenantStorageKey(scope + ':');
  const unit = pwaContext()?.establishment_id;
  const result: CustomerContext[] = [];
  try {
    for (let index = 0; index < sessionStorage.length; index++) {
      const key = sessionStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      try {
        const value = JSON.parse(sessionStorage.getItem(key) ?? 'null');
        const code = key.slice(prefix.length);
        if (
          !value?.visitor_id ||
          !value.token ||
          (unit && value.establishment_id !== unit) ||
          (code ? !value.table_id : Boolean(value.table_id))
        )
          continue;
        result.push({
          code,
          label: code ? 'Mesa ' + value.table_number : 'Retirada',
          storageKey: key,
          visitor: value,
        });
      } catch {
        // Ignore malformed or unrelated storage entries.
      }
    }
  } catch {
    // Storage access may be disabled by the browser.
  }
  return result.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR', { numeric: true }));
}

function unchanged(context: CustomerContext) {
  try {
    return (
      JSON.parse(sessionStorage.getItem(context.storageKey) ?? 'null')?.token ===
      context.visitor.token
    );
  } catch {
    return false;
  }
}

export function forgetCustomerContext(context: CustomerContext) {
  try {
    if (unchanged(context)) sessionStorage.removeItem(context.storageKey);
  } catch {
    // An inaccessible browser store must not keep an unauthorized group on screen.
  }
}

export async function customerTicketGroups(
  scope: string,
  previous: CustomerTicketGroup[],
): Promise<CustomerTicketGroup[]> {
  const groups = await Promise.all(
    savedCustomerContexts(scope).map(async (context) => {
      try {
        const tickets = await visitorApi('/my-tickets', context.visitor.token);
        if (!unchanged(context)) return null;
        return {
          code: context.code,
          label:
            context.code && tickets[0]?.table_number
              ? 'Mesa ' + tickets[0].table_number
              : context.label,
          visitorId: context.visitor.visitor_id,
          tickets,
        } as CustomerTicketGroup;
      } catch (error) {
        if (!unchanged(context)) return null;
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'UNAUTHORIZED'
        ) {
          forgetCustomerContext(context);
          return null;
        }
        return {
          code: context.code,
          label: context.label,
          visitorId: context.visitor.visitor_id,
          tickets:
            previous.find(
              (group) =>
                group.code === context.code && group.visitorId === context.visitor.visitor_id,
            )?.tickets ?? [],
          error: 'Não foi possível atualizar as fichas deste atendimento. Tente novamente.',
        } as CustomerTicketGroup;
      }
    }),
  );
  const seen = new Set<string>();
  return groups
    .filter((group): group is CustomerTicketGroup => group !== null)
    .map((group) => ({
      ...group,
      tickets: group.tickets.filter((ticket) => {
        if (seen.has(ticket.id)) return false;
        seen.add(ticket.id);
        return true;
      }),
    }));
}

export const pendingCustomerTickets = (tickets: Data[]) =>
  tickets.filter((ticket) => !['REDEEMED', 'CANCELLED'].includes(ticket.status));

export async function requestCustomerTicket(scope: string, code: string, ticketId: string) {
  const context = savedCustomerContexts(scope).find((context) => context.code === code);
  if (!context) throw new Error('Este atendimento expirou. Atualize suas fichas.');
  try {
    return await visitorApi(`/tickets/${ticketId}/request`, context.visitor.token, {});
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'UNAUTHORIZED')
      forgetCustomerContext(context);
    throw error;
  }
}
