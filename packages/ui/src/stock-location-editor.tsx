import { api, type Data } from './client.js';
import { useFormDialog } from './forms.js';
import { stockQuantity } from './stock-quantity.js';

export function useStockLocationEditor(
  locations: Data[],
  balances: Data[],
  refresh: () => Promise<void>,
) {
  const forms = useFormDialog();
  return {
    dialog: forms.dialog,
    open(balance: Data, name: string) {
      const origin =
        locations.find((location) => location.id === balance.location_id)?.name ?? 'Local atual';
      forms.open({
        title: 'Alterar depósito do estoque',
        description: `${name} · ${origin}. Físico ${stockQuantity(balance.physical_quantity)} · reservado ${stockQuantity(balance.reserved_quantity)}. As quantidades, reservas e o histórico serão mantidos.`,
        fields: [
          {
            key: 'location_id',
            label: 'Novo depósito',
            type: 'select',
            required: true,
            options: locations
              .filter((location) => location.id !== balance.location_id)
              .map((location) => ({
                id: location.id,
                name: location.name,
                color: location.color,
                disabled: balances.some(
                  (other) =>
                    other.id !== balance.id &&
                    other.location_id === location.id &&
                    other.product_id === balance.product_id &&
                    (other.variant_id ?? null) === (balance.variant_id ?? null),
                ),
              })),
            hint: 'Destinos que já possuem este estoque ficam indisponíveis para não misturar saldos. Se este for o estoque de consumo, a origem dos próximos pedidos também será atualizada.',
          },
        ],
        submitLabel: 'Alterar depósito',
        successMessage: 'Depósito atualizado. Quantidades e reservas mantidas.',
        onSubmit: async (values) => {
          await api(
            `/stock-balances/${balance.id}/location`,
            { location_id: values.location_id, version: balance.version },
            'PATCH',
          );
          await refresh();
        },
      });
    },
  };
}
