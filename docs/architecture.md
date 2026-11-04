# Arquitetura e decisões

## ADR 001 — MySQL 8.4 e Drizzle

MySQL/InnoDB é a única fonte de verdade. Redis não decide pagamentos, estoque, ocupação ou validade das fichas. Drizzle fornece SQL parametrizado e transações; migrations SQL são explícitas, versionadas e verificadas por checksum. Não há uma segunda definição de schema para divergir das migrations.

Adaptações do plano originalmente escrito para PostgreSQL:

- `NUMERIC(14,2)` torna-se `DECIMAL(14,2)`; quantidades usam `DECIMAL(14,3)`.
- Índices parciais são substituídos por colunas geradas anuláveis e índices únicos compostos. Sessão ativa, chamado ativo, caixa aberto e estoque padrão usam esse padrão.
- MySQL não oferece RLS equivalente. `Scope` injeta empresa/unidade em leituras e gravações; FKs e UNIQUE compostas impedem vínculos cruzados. A credencial SQL da aplicação não deve ser exposta a usuários. Essa proteção não fornece isolamento de linhas para um cliente com acesso SQL arbitrário; para isso seria necessária uma estratégia de bancos/credenciais separados.
- Transações usam `READ COMMITTED`, locks explícitos `FOR UPDATE` e restrições do banco. O dispatcher outbox usa `SKIP LOCKED`.
- DDL MySQL faz commit implícito. Não se anuncia rollback transacional de uma migration. O procedimento de recuperação está documentado em `operations.md`.

Referências técnicas: [MySQL — locking reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html), [índices em colunas geradas](https://dev.mysql.com/doc/refman/8.4/en/generated-column-index-optimizations.html).

## ADR 002 — Escopo e concorrência

A identidade do ator vem exclusivamente do token de sessão validado no backend. Login seleciona um membership já existente, por email e slug público da unidade. Tenant, unidade, preço e permissões enviados em um corpo de requisição não definem autorização.

Toda operação crítica serializa no registro da unidade, consulta idempotência e executa regras, movimentos, auditoria, outbox e resposta idempotente na mesma transação. O lock mais amplo é uma escolha conservadora para o MVP: reduz throughput dentro de uma unidade, enquanto empresas/unidades distintas continuam independentes. Não há I/O de gateway ou impressora dentro dessa transação. A evolução para locks por agregado deve preservar a ordem de locks e os testes de disputa.

`Idempotency-Key` é única por ator/unidade. O hash canônico inclui operação, parâmetros e corpo. Repetição devolve a resposta persistida; reutilizar a chave em outra operação ou com dados diferentes conflita. Chaves de negócio únicas protegem movimentos, cobranças, allocations e transições. Atores sem permissão são rejeitados antes da consulta idempotente.

## ADR 003 — Dinheiro, pagamento e saldo

Valores chegam como strings decimais, são calculados com `bigint` em centavos e persistidos como DECIMAL. Quantidades usam milésimos inteiros. Float no frontend serve apenas para apresentação/estimativa; o backend recalcula preços e adicionais.

Saldo da comanda = débitos − créditos/descontos − valores alocados + estornos aprovados da comanda. Um pagamento pode ser dividido entre comandas. Uma comanda aceita vários recebimentos parciais. Estorno valida o limite líquido do pagamento e a alocação específica. Captura e liquidação têm datas distintas. Não se apagam recebimentos nem débitos.

Há adaptador Mercado Pago por OAuth por filial e sandbox apenas para desenvolvimento sem conexão real. Checkout, estorno e renovação OAuth usam fases curtas no MySQL e chamadas externas sem o lock da filial; a fila BullMQ recupera operações e concilia pagamentos. Consulte [proxy e pagamentos](proxy-e-pagamentos.md). No sandbox, webhooks assinam os bytes UTF-8 originais usando HMAC SHA-256 de `timestamp.payload`; timestamps têm tolerância de cinco minutos. Retorno do navegador não prova pagamento. Conflito após captura é tratado dentro de savepoint: a confirmação operacional reverte, mas o recebimento aprovado e a pendência de conciliação permanecem. O operador pode confirmar novamente quando seguro ou estornar. No sandbox, o painel pode simular uma confirmação autenticada. A rota não existe em produção.

A política conservadora para estorno pré-pago bloqueia entregas até pagamento integral ou cancelamento. Cancelar pedido já entregue ou produzido exige tratamento operacional específico. Estorno após encerramento físico é bloqueado até existir fluxo administrativo de pós-venda. Essas decisões evitam restaurar ao estoque um produto que já saiu.

## ADR 004 — Mesa, comandas e transferência

Visitantes identificados têm sessão temporária, sem ocupar a mesa. A confirmação do primeiro pedido cria sessão e comanda em uma transação. Outra pessoa só entra na ocupação com o código de participação. Duas primeiras compras de grupos diferentes podem conflitar; um pagamento capturado nesse intervalo é preservado para revisão.

Comandas SHARED e INDIVIDUAL coexistem. O cliente só lê comandas de que participa e suas próprias fichas. Um membro de uma sessão pode entrar numa comanda compartilhada. As atribuições de itens permitem transferências dentro da mesma sessão sem mudar snapshots, emitir novas fichas ou apagar histórico. São transferidas linhas inteiras de pedido; para dividir unidades, lance-as como linhas separadas. Transferências com pagamento/desconto prévio na origem exigem resolução financeira antes da movimentação.

`OPEN → CLOSING → AWAITING_RELEASE → CLOSED`. Fechamento retorna pendências e mantém a mesa ocupada. Recebimentos e entregas podem resolver as pendências em CLOSING. Liberação exige nova conferência de saldo, fichas e pagamentos, além de permissão `table.release`. Um garçom pode liberar uma mesa somente quando o fechamento financeiro já foi autorizado.

## ADR 005 — Fichas e estoque

Cada unidade comprada recebe uma ficha. O token é HMAC-SHA256 de identificador e nonce CSPRNG de 256 bits, com separação de propósito e chave exclusiva fora do banco. A tabela armazena apenas hash para validação e nonce público, nunca o token. O segredo é reconstruído somente em documentos autorizados, permitindo segunda via com o mesmo token sem persistir tokens em print jobs, auditoria ou respostas idempotentes. Preserve `DOCUMENT_KEY` com os backups; substituí-la sem migração/versionamento de chaves invalidaria documentos existentes.

Estoque:

- Checkout pré-pago: reserva temporária de 10 minutos, com expiração pelo worker.
- ON_CONFIRMATION: reserva e consumo físico na confirmação; entrega não baixa novamente.
- ON_DELIVERY: reserva na confirmação, consumo na entrega.
- ON_PRODUCTION: reserva na confirmação, consumo ao marcar pronto; ficha só fica disponível após produção.
- RECIPE: componentes e quantidades congelados no item; ingredientes são reservados e consumidos na entrega.
- NO_CONTROL: não há movimentos.

Saldo físico e reserva nunca podem ser negativos nem a reserva ultrapassar o físico. Cada movimentação tem origem única. O cancelamento libera reserva ou cria compensação, preservando o movimento original. Ler QR/Code128 nunca baixa estoque: a entrega exige confirmação explícita online.

## ADR 006 — Outbox, tempo real e impressão

O dispatcher marca uma próxima tentativa dentro de transação e só enfileira no BullMQ após commit. Falha antes do enqueue deixa o evento elegível novamente após 60 segundos. Consumidor publica e marca o evento; uma queda entre os passos pode gerar repetição. `event_id` permite deduplicação no cliente. Não existe promessa de entrega exatamente uma vez para rede/impressora.

Socket.IO recebe notificações do canal Redis. Rooms são atribuídas pelo servidor conforme sessão e membership. O cliente não escolhe rooms. Clientes novos já têm room privada de customer; após ocupação também podem receber atualizações da sessão. O backend revalida credenciais periodicamente. Reconexão e polling ressincronizam por REST.

Print jobs persistem a referência da ficha. O agente obtém lease de 60 segundos, imprime QR e Code128 com o mesmo token e confirma envio ao subsistema local. Tentativas subsequentes indicam segunda via. Um envio seguido de falha antes do ACK pode imprimir papel novamente, mas conserva o mesmo direito de consumo. Há cinco tentativas por ciclo e retry administrativo auditado.

## Disponibilidade para venda

Os catálogos operacional e público incluem disponibilidade por produto e variação: saldo físico menos reservas, no local de baixa configurado. Variações compartilhadas e receitas referenciam as mesmas restrições opacas; variações com saldo próprio usam seu estoque específico. O frontend soma o consumo de todas as linhas do carrinho, incluindo personalizações e ingredientes compartilhados, sinaliza indisponibilidade e confere um catálogo atualizado antes de enviar. Consultas do cliente usam `cache: no-store`.

O backend é a autoridade: criação e confirmação conferem a demanda agregada com quantidades em milésimos e locks no banco. A confirmação considera a reserva de checkout do próprio pedido antes de convertê-la em reservas das fichas. O lock transacional da unidade impede que duas confirmações consumam a última unidade; a operação perdedora retorna `OUT_OF_STOCK`, sem fichas, pagamentos ou movimentações parciais. As reservas e baixas mantêm as políticas existentes de confirmação, produção, entrega e receita.
