# Variações dos produtos

Todo produto possui uma **variação padrão obrigatória**, vinculada ao preço e ao estoque base. Em **Cardápio → Produto → Preços e variações**, o nome dessa opção pode ser alterado desde o cadastro inicial, por exemplo para “Unidade”, “Garrafa 600 ml” ou “Porção individual”. O nome e o preço padrão são salvos junto com o produto.

As **variações adicionais** continuam com seus próprios formulários, preços, disponibilidade e opção de estoque compartilhado ou próprio. O botão **Remover** pede confirmação e retira a adicional das novas vendas. É possível remover todas as adicionais; a padrão permanece, garantindo ao menos uma opção para cada produto. Inativar uma adicional continua sendo diferente de removê-la: a inativa permanece na gestão para voltar a ser ativada.

Se uma adicional possuir saldo ou reservas no seu estoque, a remoção é bloqueada. Conclua as entregas e regularize o saldo antes de tentar novamente. Não são permitidas novas vinculações, compras ou reposições para uma variação removida.

Pedidos, fichas, saldos zerados e movimentações anteriores permanecem vinculados aos mesmos registros. A remoção é lógica: a linha da variação continua no banco, desativada e com `deleted_at`. A gestão de estoque mantém os nomes antigos disponíveis para consultar o histórico.

## Contratos e compatibilidade

- `products.default_variant_name`: obrigatório no banco, padrão `Padrão`, até 100 caracteres. A API aceita o campo no cadastro e edição, elimina espaços externos e rejeita nome vazio ou nulo. Há também restrição de integridade no MySQL.
- A variação padrão é parte do próprio produto; não cria uma segunda origem de estoque nem uma nova linha duplicada em `product_variants`. Pedidos que a utilizam continuam com `variant_id=null`, preservando as regras existentes de preço, estoque, receitas e reservas.
- `GET /products/:id/management` expõe `default_variant` e `variant_count` (padrão + adicionais não removidas). `variants` contém as adicionais disponíveis na gestão; `archived_variants` fornece nomes históricos somente a quem pode consultar estoque.
- `DELETE /product-variants/:id`: exige `catalog.manage`, `Idempotency-Key` e escopo da filial. Faz remoção lógica, auditoria e evento de atualização; bloqueia saldo/reserva diferente de zero. Não existe ação para remover a padrão.
- Adicionais removidas são excluídas de catálogos e buscas de venda, não aceitam edição ou reativação pela API e não podem ser usadas em novos pedidos. Fichas de pedidos já confirmados continuam seguindo seu histórico de entrega e estoque.
- Nomes personalizados da padrão aparecem nas opções de pedido. Novos pedidos registram esse nome em seu snapshot; os nomes e valores de pedidos anteriores não são reescritos.
- Migração `0027_product_default_variant.sql`: adiciona o nome padrão e o marcador de remoção, sem criar novos saldos nem modificar preços ou quantidades existentes.

Arquivos principais: `packages/ui/src/product-management.tsx`, `apps/api/src/catalog-management.ts` e a migração acima. Os testes de integração cobrem exclusões concorrentes, permissões, preservação de fichas e bloqueios de estoque; os testes de navegador cobrem cadastro, edição, remoção e layouts em celular e modo escuro.
