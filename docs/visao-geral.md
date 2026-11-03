# Visão geral da operação

A página `/dashboard` resume a **filial selecionada**, dentro da conta autenticada. Trocar a filial pelo seletor do sistema troca a sessão e recarrega os indicadores; não há consolidação automática entre contas ou filiais.

O filtro oferece hoje, ontem, 7 dias, 30 dias e datas personalizadas de até 90 dias, no fuso `America/Sao_Paulo`. Pedidos confirmados, cancelados, barras por hora/dia, origens e produtos mais pedidos seguem esse período. Pedidos confirmados são contados uma vez, independentemente do número de itens; produtos mais pedidos somam quantidades dos pedidos ainda confirmados, excluindo cancelados.

Ocupação, atendimentos em andamento, solicitações, fila de preparo, unidades a entregar, caixas e fila de impressão mostram **a situação atual**, inclusive pendências anteriores ao período. O total de unidades já entregues considera a data da entrega no período. Os oito atendimentos mais antigos oferecem acesso direto à gestão da mesa; pedidos recentes abrem o detalhe do pedido.

Os valores financeiros seguem o mesmo razão do painel financeiro: faturamento líquido considera lançamentos, cancelamentos e descontos do período; recebido líquido considera recebimentos e estornos do período. O saldo em aberto abrange todas as comandas abertas da filial, inclusive balcão e períodos anteriores. Faturamento e recebido podem divergir, pois venda e pagamento podem ocorrer em datas diferentes.

## Permissões

`reports.view` permite abrir a visão geral. Os papéis combinam essa permissão com as áreas necessárias; o cadastro de papéis pela API (`POST /roles`, com `staff.manage`) aceita a lista de permissões, e a gestão da equipe permite atribuir o perfil a cada funcionário. As permissões são conferidas a cada requisição, não apenas no menu.

| Área                                                 | Permissão adicional                             |
| ---------------------------------------------------- | ----------------------------------------------- |
| Mesas, ocupação e atendimentos                       | `table.view`                                    |
| Indicadores de pedidos e produtos mais pedidos       | `table.view` ou `order.create`                  |
| Atalhos para detalhes de pedidos                     | `table.view`                                    |
| Entregas                                             | `ticket.view`                                   |
| Solicitações de clientes                             | `ticket.redeem`                                 |
| Preparo                                              | `production.manage`                             |
| Estoques sem saldo                                   | `inventory.view`                                |
| Impressão                                            | `print.manage`                                  |
| Caixas abertos e com mais de 24 horas                | `cash.manage`                                   |
| Faturamento, recebido, ticket médio e saldo agregado | Administrador geral da conta, validado no banco |

Um papel com todas as permissões operacionais continua sem acesso aos indicadores financeiros se não for administrador geral da conta. Seções não autorizadas são retornadas como `null` pela API, e suas consultas não são executadas. O endpoint legado `/dashboard` também não expõe saldo agregado a papéis operacionais.

## API e atualização

`GET /api/v1/dashboard/overview?start=YYYY-MM-DD&end=YYYY-MM-DD` retorna escopo, período, capacidades, indicadores e horário da geração. Conta e filial vêm da autenticação: parâmetros como `tenant_id` ou `establishment_id` são rejeitados; o cabeçalho de filial divergente recebe 403. Os joins e agregações usam conta e filial em conjunto.

O painel atualiza por eventos e a cada 15 segundos, com atualização manual. Respostas atrasadas de filtros anteriores são descartadas e o escopo da resposta é conferido antes de apresentar os dados. Estados vazios, erro com nova tentativa e carregamento são explícitos. Os gráficos permitem consultar valores por clique, toque e teclado; o tema escuro e a visualização mobile usam os mesmos indicadores.
