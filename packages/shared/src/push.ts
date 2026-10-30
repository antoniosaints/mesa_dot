import { z } from 'zod';
export const pushEvents = [
  {
    key: 'ticket.requested',
    label: 'Solicitações de entrega',
    description: 'Cliente pede para levar um item à mesa.',
    permission: 'ticket.redeem',
    roles: ['Administrador', 'Garçom'],
    title: 'Cliente solicitou uma entrega',
  },
  {
    key: 'table.occupied',
    label: 'Mesa ocupada',
    description: 'Um novo atendimento é iniciado na mesa.',
    permission: 'table.view',
    roles: ['Administrador', 'Garçom'],
    title: 'Novo atendimento na mesa',
  },
  {
    key: 'order.confirmed',
    label: 'Novos pedidos',
    description: 'Pedido confirmado na mesa ou no balcão.',
    permission: 'table.view',
    roles: ['Administrador', 'Garçom', 'Caixa'],
    title: 'Novo pedido confirmado',
  },
  {
    key: 'production.ready',
    label: 'Itens prontos',
    description: 'A cozinha ou o bar finaliza o preparo.',
    permission: 'ticket.redeem',
    roles: ['Administrador', 'Garçom'],
    title: 'Item pronto para entrega',
  },
  {
    key: 'order.cancelled',
    label: 'Pedidos cancelados',
    description: 'Cancelamento de um pedido da operação.',
    permission: 'table.view',
    roles: ['Administrador', 'Garçom', 'Caixa'],
    title: 'Pedido cancelado',
  },
  {
    key: 'table.closed',
    label: 'Mesa liberada',
    description: 'O atendimento é encerrado e a mesa fica livre.',
    permission: 'table.view',
    roles: ['Administrador', 'Garçom'],
    title: 'Mesa liberada',
  },
  {
    key: 'payment.approved',
    label: 'Pagamentos recebidos',
    description: 'Confirmação de um recebimento.',
    permission: 'payment.receive',
    roles: ['Administrador', 'Caixa'],
    title: 'Novo pagamento recebido',
  },
  {
    key: 'cash.opened',
    label: 'Abertura de caixa',
    description: 'Início de um turno de caixa.',
    permission: 'cash.manage',
    roles: ['Administrador', 'Caixa'],
    title: 'Caixa aberto',
  },
  {
    key: 'cash.closed',
    label: 'Fechamento de caixa',
    description: 'Encerramento de um turno de caixa.',
    permission: 'cash.manage',
    roles: ['Administrador', 'Caixa'],
    title: 'Caixa fechado',
  },
  {
    key: 'print.failed',
    label: 'Falhas de impressão',
    description: 'Uma impressão falhou e pode precisar de atenção.',
    permission: 'print.manage',
    roles: ['Administrador'],
    title: 'Impressão precisa de atenção',
  },
] as const;
export type PushEventKey = (typeof pushEvents)[number]['key'];
export const pushRuleSchema = z
  .object({
    event: z.enum(pushEvents.map((event) => event.key) as [PushEventKey, ...PushEventKey[]]),
    enabled: z.boolean(),
    role_ids: z
      .array(z.uuid())
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, 'Perfis repetidos.'),
  })
  .strict();
export const pushSettingsSchema = z
  .object({
    enabled: z.boolean(),
    rules: z
      .array(pushRuleSchema)
      .length(pushEvents.length)
      .refine(
        (rules) => new Set(rules.map((rule) => rule.event)).size === pushEvents.length,
        'Configure cada evento uma vez.',
      ),
  })
  .strict();
export type PushRule = z.infer<typeof pushRuleSchema>;
export const pushAttempts = 6;
export const pushTtlSeconds = 600;
export function pushFailure(status?: number) {
  return status === 404 || status === 410
    ? 'expired'
    : !status || status === 429 || status >= 500
      ? 'retry'
      : 'permanent';
}
export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
  unit_id: string;
  icon: string;
}
