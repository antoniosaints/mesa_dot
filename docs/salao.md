# Salão e posicionamento das mesas

Em **Salão e mesas → Mapa do salão**, os cards mostram situação, capacidade, tempo desde a abertura do atendimento, quantidade de comandas, total consumido e saldo pendente. O relógio atualiza a cada 30 segundos. Os valores vêm do razão financeiro das comandas da ocupação atual, considerando créditos, descontos e estornos, sem somar ocupações encerradas. O retorno de `GET /tables` inclui `opened_at_iso` e `attendance` (total, pago, saldo e comandas), sempre limitado à unidade autenticada.

A visualização **Planta** usa as posições salvas. A visualização **Cards** facilita a leitura dos valores. Ambas permitem abrir o gerenciamento da mesa e mantêm o destaque das solicitações dos clientes. É possível filtrar por número, área e situação.

A aba **Posicionar mesas**, disponível para quem tem `table.manage`, reúne o canvas e a lista de mesas ativas. Arraste uma mesa para mover; o zoom não altera as coordenadas gravadas. O alinhamento à grade aproxima o fim do arraste ao múltiplo de 20 mais próximo. As setas movem 20 pontos e Shift + seta move um ponto. **Ajustar posição exata** abre um modal com campos numéricos de 0 a 2000 e confirmação ao descartar alterações.

Cada ajuste usa o `PATCH /tables/:id` existente, com escopo, validação e auditoria preservados. Enquanto salva, o editor bloqueia novas movimentações. Em caso de falha, restaura a posição anterior e informa o erro. Cancelar um gesto de arraste não grava uma posição parcial. A lista permite selecionar mesas sobrepostas; um aviso indica sobreposições dentro da mesma área. O canvas tem rolagem própria e zoom de 50% a 150%.

## Excluir uma mesa

Na aba **Mesas**, o ícone de lixeira abre uma confirmação de exclusão. O servidor realiza exclusão lógica: mantém o registro e os vínculos históricos, marca `enabled=false` e preenche `deleted_at`. A mesa deixa de aparecer no cadastro, no salão, na planta, nos indicadores e na seleção pública; seu QR antigo não permite novos atendimentos.

Pedidos, comandas, pagamentos, fichas, movimentações de estoque e impressões anteriores permanecem intactos e consultáveis. O número pode ser reutilizado em uma nova mesa, com outro ID e outro QR. O índice único usa `active_number`, calculado somente para registros não excluídos; o número histórico não é alterado.

`DELETE /tables/:id` exige `table.manage`, escopo da filial e `Idempotency-Key`. A operação bloqueia atendimento em aberto (inclusive fechamento/aguardando liberação) e pedidos aguardando pré-pagamento. A exclusão e a confirmação do primeiro pedido usam o bloqueio transacional da unidade, impedindo que uma mesa seja excluída durante uma abertura concorrente. Mesas excluídas não podem ser reativadas por `PATCH` comum. A ação é auditada e publicada no evento `tables.updated`.
