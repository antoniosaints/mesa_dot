import type { Data } from './client.js';
export function canDeliverTicket(ticket: Data, staffId?: string) {
  return (
    ['AVAILABLE', 'REQUESTED', 'ASSIGNED'].includes(ticket.status) &&
    ticket.order_status === 'CONFIRMED' &&
    (!ticket.request_claimed_by || ticket.request_claimed_by === staffId)
  );
}
