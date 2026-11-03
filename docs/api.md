# API v1

Prefixo `/api/v1`. Swagger em `/docs` e contrato JSON em `/api/v1/openapi.json`. Operações retornam JSON. Erros usam `{ "error": { "code": "...", "message": "...", "correlation_id": "..." } }`. Falha de validação é 400; autenticação 401; permissão 403; ausência no escopo 404; conflito/regra de estado 409; pagamento necessário 402.

## Autenticação

```http
POST /api/v1/auth/login
Content-Type: application/json

{"email":"admin@boteco.local","password":"<senha-configurada>","establishment_slug":"boteco-da-esquina"}
```

Retorna `token`, `refresh_token`, `expires_in`, `actor` e `name`. Use `Authorization: Bearer <token>`. `GET /me` devolve o ator autenticado. `POST /auth/refresh` recebe `refresh_token`, rotaciona ambas as credenciais e rejeita reutilização. `POST /auth/logout` revoga a sessão atual. Visitantes e agentes também usam Bearer, com capacidades distintas.

## Visão geral da operação

`GET /dashboard/overview?start=YYYY-MM-DD&end=YYYY-MM-DD` exige `reports.view`, com datas opcionais (padrão: hoje em Brasília) e intervalo de até 90 dias. Retorna `scope`, `period`, `access`, `availability`, `tables`, `orders`, `deliveries`, `requests`, `production`, `inventory`, `printing`, `cash`, `financial` e `generated_at`. Conta e filial são fixadas pela autenticação; não aceita filtros de conta/filial por query. Cada seção respeita a permissão da área e retorna `null` quando não autorizada. Financeiro exige administrador geral validado no banco, mesmo que o papel possua todas as permissões. O endpoint legado `/dashboard` também restringe o saldo agregado. Veja [semântica dos indicadores e matriz de acesso](visao-geral.md).

## Idempotência nas mutações

Envie `Idempotency-Key: <UUID>` em cada mutação autenticada. A mesma chave deve ser reutilizada em retries da mesma requisição. Nova ação exige nova chave. O hash inclui rota, parâmetros e corpo. Consulta por POST `/tickets/resolve` é somente leitura e não altera a ficha. Login, identificação pública e webhook possuem regras próprias de autenticação/idempotência.

## Primeiro pedido pré-pago

1. `GET /public/:slug/menu` obtém catálogo, variações e adicionais.
2. `POST /public/:slug/visitor-sessions` recebe `table_code`, `name`, `phone` e `join_code` se a mesa estiver ocupada. Retorna Bearer temporário, mesa e TTL.
3. `POST /public/orders`, com Bearer e chave, cria o pedido sem ocupar a mesa:

```json
{
  "table_id": "<uuid-da-mesa>",
  "source": "CUSTOMER",
  "payment_policy": "PREPAID",
  "items": [{ "product_id": "<uuid>", "quantity": 2, "modifiers": [], "notes": "Bem gelada" }]
}
```

4. `POST /payments/intents` recebe `order_id`, reserva temporariamente o estoque e retorna `provider=mercadopago` e `checkout_url` quando há conexão ativa na filial. Sem integração real, o sandbox interno só está disponível em desenvolvimento/teste e sem credenciais Mercado Pago anteriores.
5. `GET /payments/intents/:id` consulta o status autorizado; `POST /payments/intents/:id/sync` consulta o Mercado Pago no servidor. O checkout real só confirma por notificação verificada ou essa consulta. `POST /sandbox/pay` simula aprovação apenas de intenções sandbox em desenvolvimento/teste; rejeita intenções reais.
6. `GET /my-tickets`, `/my-tabs`, `/my-consumption` ressincroniza o estado. Pedidos e fichas ficam associados ao customer autenticado.

O backend recalcula cada valor e valida a disponibilidade. Uma intenção não é pagamento. A confirmação abre a sessão operacional, gera uma ficha por unidade, lança o financeiro e persiste eventos. Não tente confirmar pré-pago pela página de retorno do gateway.

## Pedido por funcionário

`POST /orders` aceita o mesmo contrato, com `source=WAITER|POS` e `payment_policy=POSTPAID|PREPAID`. Pós-pago exige `order.postpaid`, política compatível e limite. `POST /orders/:id/confirm` ocupa e emite fichas. `GET /orders/:id` inclui itens. `POST /orders/:id/cancel` exige `reason`, permissão e ausência de produto entregue/em preparo ou produzido. O cancelamento compensa estoque/financeiro sem apagar histórico.

## Mesas e comandas

| Operação                        | Rota                                                            |
| ------------------------------- | --------------------------------------------------------------- |
| Listar mesas com ocupação       | `GET /tables`                                                   |
| Criar/editar mesa               | `POST /tables`, `PATCH /tables/:id`                             |
| Ver sessão e comandas           | `GET /tables/:id/session`                                       |
| Preparar atendimento sem ocupar | `POST /tables/:id/open`                                         |
| Iniciar/conferir fechamento     | `POST /tables/:id/checkout`                                     |
| Reabrir atendimento             | `POST /tables/:id/reopen`                                       |
| Confirmar liberação física      | `POST /tables/:id/release`                                      |
| Criar comanda                   | `POST /tabs` com `session_id`, `mode`, `label`                  |
| Entrar em compartilhada         | `POST /tabs/:id/join`                                           |
| Saldo e itens da comanda        | `GET /tabs/:id`                                                 |
| Desconto auditado               | `POST /tabs/:id/discount` com `amount`, `reason`                |
| Transferir linhas               | `POST /tabs/:id/transfer-items` com `item_ids`, `target_tab_id` |

A transferência também aceita `order_id` para todas as linhas daquele pedido na origem. Linhas inteiras são movidas sem alterar o pedido original nem gerar novas fichas. Não envie `order_id` e `item_ids` juntos. Transferências são permitidas somente na mesma sessão, com comandas abertas, itens pós-pagos e sem pagamento/desconto prévio na origem.

Checkout devolve `status` e `issues`. Havendo pendências fica em CLOSING; resolvidas as pendências, uma nova conferência alcança AWAITING_RELEASE. A mesa continua ocupada até `release`.

## Fichas e atendimento

| Operação                    | Rota / corpo                                                |
| --------------------------- | ----------------------------------------------------------- |
| Consultar código            | `POST /tickets/resolve` — `token`                           |
| Exibir documento autorizado | `GET /tickets/:id`                                          |
| Confirmar entrega           | `POST /tickets/:id/redeem` — `token`                        |
| Cliente solicitar entrega   | `POST /tickets/:id/request`                                 |
| Segunda via                 | `POST /tickets/:id/reprint` — `reason`                      |
| Fila de chamados            | `GET /service-requests`                                     |
| Assumir chamado             | `POST /service-requests/:id/claim`                          |
| Cancelar chamado            | `POST /service-requests/:id/cancel`                         |
| Fila de produção            | `GET /production/jobs`                                      |
| Produção                    | `POST /production/jobs/:id/status` — `PREPARING` ou `READY` |

A consulta não modifica estoque. A entrega verifica token, estado, autorização, pagamento e responsável pelo chamado; a alteração de status, baixa, evento e auditoria são atômicas. Concorrência produz uma única utilização. Ficha já entregue informa o horário no erro.

## Pagamento, caixa e estorno

```http
POST /api/v1/payments/manual
Authorization: Bearer <staff>
Idempotency-Key: <uuid>
Content-Type: application/json

{"method":"PIX_MANUAL","allocations":[{"tab_id":"<uuid>","amount":"10.00"}]}
```

Métodos: `PIX_MANUAL`, `CARD_MANUAL` e `CASH`. Dinheiro exige `cash_session_id` aberto. O funcionário registra um recebimento já conferido; esses métodos não acionam gateway.

`GET /payments` lista recebimentos e `GET /payments/:id` inclui allocations/refunds. `POST /payments/:id/refund` recebe `amount`, `reason`, `tab_id` quando alocado e `cash_session_id` para dinheiro. Não permite valor superior à captura líquida ou à alocação da comanda. O fluxo administrativo de estorno após encerramento da comanda está bloqueado nesta versão.

Caixa: `POST /cash/sessions` recebe `register_id`, `opening_amount`; `POST /cash/movements` recebe sessão, `WITHDRAWAL|SUPPLY`, `amount`, `reason`; `POST /cash/sessions/:id/close` recebe `counted_amount` e retorna valor esperado e diferença. Cartão/Pix não entram no dinheiro físico esperado do caixa.

## Webhook sandbox

`POST /webhooks/payments/sandbox` é exclusivo do provedor sandbox. Para integrações reais, consulte a seção Complementos abaixo.

## Variações dos produtos

Para cadastro, edição do nome padrão e remoção lógica das variações adicionais de produtos, veja [Variações dos produtos](variacoes-produtos.md). Todo produto mantém uma opção padrão obrigatória; `DELETE /product-variants/:id` remove somente adicionais e preserva seu histórico.

## Complementos e pagamento Mercado Pago

Somente staff com `isAccountAdmin=true` pode usar `/complements` e suas ações. A autorização é conferida novamente no servidor, inclusive no retorno OAuth. Conexões são isoladas por tenant e estabelecimento.

- `GET /complements`: catálogo com instalação, ativação e estado da conexão; nunca devolve chaves ou tokens.
- `POST /complements/:provider/install`, `/enable`, `/disable`: `provider=mercadopago|gemini`, corpo `{}` e `Idempotency-Key`.
- `POST /complements/mercadopago/connect`: retorna `authorization_url` e envia cookie HttpOnly. O navegador segue para o provedor. `GET /complements/mercadopago/callback` valida cookie/state/PKCE e redireciona para a gestão; não aceita confirmação de pagamento.
- `POST /complements/mercadopago/test`: verifica a conta vinculada.
- `POST /complements/gemini/configure`: `{api_key?,model,image_model?:string|null}`; omitir a chave preserva a existente. `image_model` omitido preserva a configuração anterior, e `null` remove o modelo separado. Valida disponibilidade e compatibilidade antes de ativar.
- `POST /complements/gemini/models`: `{api_key?}`; retorna modelos de geração acessíveis à chave nova ou cadastrada. `/test` verifica a conexão existente; `/remove-key` apaga a chave e desativa.
- `POST /complements/gemini/ask`: `mode=help|summary|description|image`, `question` até 1.500 caracteres (obrigatória exceto resumo), `days=1|7|30`, `focus=operation|finance|stock`, `period?:{start,end}` com datas ISO e até 366 dias, `history?:[{role:user|model,text}]` limitado a oito mensagens/24 mil caracteres, `context?:{kind:product|business,name,description?,category?}` e `aspect_ratio=1:1|4:3|16:9`. Dez solicitações/minuto por sessão. Retorna `answer`, `model`, `generated_at`, `period` e `image:null|{data_url,mime_type}`. O servidor valida saída PNG/JPEG/WebP até 4 MB; não aceita URLs remotas fornecidas como imagem. Não executa alterações. Veja [Assistente IA](assistente-ia.md).
- `POST /webhooks/payments/mercadopago`: verifica `X-Signature`, `X-Request-Id` e `data.id`, consulta pagamento e estornos na API do provedor e concilia de forma idempotente. Notificações inválidas são rejeitadas; redirecionamentos do cliente nunca aprovam pagamentos. A assinatura é própria do Mercado Pago, diferente do HMAC do sandbox.

`GET /payments/intents/:id` e `POST /payments/intents/:id/sync` exigem acesso ao pedido. O segundo consulta pagamentos e estornos no provedor. `/payments/:id/refund` exige `payment.refund` e confirma o estorno real antes de registrá-lo. Instruções de ambiente e homologação em [Complementos](complementos.md).

## Assinatura do webhook sandbox

`POST /webhooks/payments/sandbox` recebe `event_id`, `reference` da intenção, `amount` string, `status=APPROVED|FAILED` e `settled` boolean. Headers `X-Timestamp` em segundos Unix e `X-Signature` hexadecimal HMAC-SHA256 com `PAYMENT_WEBHOOK_SECRET`, calculado sobre `timestamp + '.' + bytes_originais_do_corpo`.

Eventos repetidos não recapturam nem reemitem fichas. Divergência de valor e conteúdo conflitante são rejeitados. Aprovação com conflito operacional fica em `payments.review_reason`; não se perde o pagamento.

## Cadastro, estoque e configuração

Recursos administrativos usam GET/POST/PATCH: `/areas`, `/categories`, `/products`, `/product-variants`, `/modifier-groups`, `/modifiers`, `/product-modifiers`, `/availability-rules`, `/recipes`, `/recipe-items`, `/stock-locations`, `/printers`, `/cash-registers`, `/floor-layouts`. O OpenAPI descreve os campos. Saldo novo é cadastrado em `POST /stock-balances` com produto e local; mudanças físicas passam exclusivamente por `/inventory/adjustments`.

`POST /products` e `PATCH /products/:id` aceitam `photo_base64` opcional: PNG RGB/RGBA de 8 bits sem entrelaçamento, até 1024 × 1024 pixels e 1,5 MB (base64 até 2 milhões de caracteres). `null` remove; omitir preserva. A foto e os dados são salvos na mesma transação com `catalog.manage` e `Idempotency-Key`. A resposta e os catálogos contêm apenas `photo_revision`, sem binário. `GET /api/v1/product-photos/:unit/:product/:revision/:file` serve `thumbnail.png` ou `photo.png`, com escopo da filial e cache por revisão. A imagem é pública, como parte do cardápio. Veja [Fotos dos produtos](fotos-produtos.md).

`GET /inventory/balances`, `/inventory/movements`. Ajustes recebem `balance_id`, `quantity` em milésimos (ex. `-1.000`), `type=PURCHASE|LOSS|ADJUSTMENT|COUNT`, `reason`. COUNT representa o físico contado; os demais são variações. Ajuste não pode consumir reserva existente.

`GET/PATCH /settings`, `GET/POST /roles`, `GET/POST /staff`, `PATCH /staff/:id`. Perfil só pode conceder permissões que o operador possui; autoalteração do próprio membership é bloqueada. `/audit-logs` e `/observability/metrics` exigem acesso a relatórios.

`GET /appearance` retorna `primary_color` da unidade para funcionários e visitantes autenticados. `PATCH /settings` aceita `primary_color` no formato hexadecimal `#RRGGBB`, exige permissão de configuração e publica `settings.updated`. O catálogo público também inclui a cor em `establishment.primary_color`; nenhuma outra configuração administrativa é exposta por essas consultas de aparência.

Listagens operacionais usam respostas completas neste MVP para garantir ressincronização. Antes de grande volume, adicionar paginação explícita às listas de apresentação, mantendo agregações e verificações financeiras completas no backend.

## Impressão

- `POST /print/agents` cria credencial exibida uma vez; a resposta idempotente persistida não contém o segredo.
- Agente chama `POST /print/jobs/claim`, envia opcionalmente `printer_ids` e recebe lease e referência do documento. O agente fornecido exige mapeamento local e filtra seus dispositivos.
- `GET /print/jobs/:id/document` fornece o documento somente ao agente que possui o lease.
- `POST /print/jobs/:id/finish` recebe `success` e `error` opcional.
- Operador usa `POST /print/jobs/:id/retry` para retomar falhas.

## SaaS e unidades

`GET/POST /establishments` opera unidades da própria empresa. A nova unidade recebe o proprietário autenticado e permissões que ele já detém. `/saas/tenants`, `/saas/plans`, `/saas/subscriptions` e `/saas/audit-logs` exigem flag superadmin na identidade global, verificada no banco. O provisionamento e a alteração de status são auditados. Planos e assinaturas são registros administrativos; cobrança recorrente automática depende de provedor externo.

## Contexto operacional

`GET /orders` inclui `table_number`, `tab_label`, `tab_labels`, `items_summary`, `item_count`, `ticket_count` e `created_at_iso`. `GET /orders/:id` inclui os itens e, para atores autorizados, as fichas daquele pedido. `GET /tickets` inclui produto, mesa, pedido, comanda atual e horário; não fornece tokens ou hashes de validação. O documento autorizado `GET /tickets/:id` acrescenta `order_id`, `table_id` e `tab_label` aos campos existentes. A comanda acompanha a atribuição atual do item após transferência.

`GET /catalog/operational`, com permissão `order.create`, retorna produtos ativos, categorias, variações, grupos de adicionais, adicionais, vínculos e regime de pagamento para montagem do pedido. `GET /service-requests` inclui o contexto da ficha para identificar mesa, produto e comanda antes de assumir o chamado. Todas as consultas respeitam a empresa e a unidade autenticadas.

`created_at_iso` é calculado a partir do epoch do MySQL, respeitando o fuso da sessão do banco inclusive em instalações existentes com DATETIME local; a interface apresenta os horários em America/Sao_Paulo.

## Agrupamento e solicitações de clientes

As fichas em `GET /tickets` incluem `tab_id`, `tab_mode`, `session_id`, `session_status` e `session_started_at_iso`, permitindo separar ocupações sucessivas da mesma mesa. Incluem também `service_request_id`, `service_request_status` e `request_claimed_by` para indicar solicitações e o responsável, sem expor o token de entrega. O documento autorizado da ficha fornece os mesmos identificadores de atendimento e solicitação.

`GET /tables` acrescenta `service_request_count` e `unclaimed_request_count`. Os contadores incluem somente solicitações abertas ou assumidas, ligadas a fichas solicitadas/atribuídas de pedidos confirmados em atendimentos ativos da unidade autenticada. Assumir não remove o alerta; concluir a entrega ou cancelar remove a solicitação do contador. A entrega continua usando `POST /tickets/:id/redeem` com o token do documento autorizado, validando responsável, pagamento, estado e uso único.

## Prévia do cancelamento

`GET /orders/:id/cancellation-context` exige `order.cancel` e respeita o escopo da unidade. Retorna `refund_required_amount`, `can_cancel`, `cancellation_blockers` e `can_refund`. Quem possui `payment.refund` também recebe os pagamentos associados aos intents do pedido, valores restantes e alocações estornáveis em `refund_targets`, sem segredos do provedor. O cálculo usa centavos inteiros e desconta estornos aprovados; comandas encerradas são identificadas como bloqueadas.

O atalho da interface continua usando `POST /payments/:id/refund` e `POST /orders/:id/cancel`, com confirmações separadas e chaves de idempotência por operação. As regras de autorização, valor, caixa, entrega, produção e auditoria permanecem validadas no servidor.

### Estoque inicial após cadastrar produto

`POST /api/v1/products/:id/initial-stock` exige `inventory.adjust` e `catalog.manage`. Recebe `location_id`, `quantity` opcional (decimal não negativo com três casas; padrão `0.000`) e `use_for_consumption` opcional (padrão falso). Cria o saldo compartilhado no local e registra a quantidade como inventário inicial, na mesma transação, com auditoria e idempotência. Não altera a política de baixa; quando solicitado, configura o local de baixa do produto. Produtos com ficha técnica mantêm as origens dos ingredientes. Estoques já movimentados exigem o fluxo normal de movimentação.

A interface oferece essa etapa somente após criar um produto, com local pesquisável, quantidade opcional e **Agora não**. Salvar alterações de um produto existente não abre a etapa novamente.

### Reposição em massa e histórico

`POST /api/v1/inventory/replenishments` exige `inventory.adjust` e `Idempotency-Key`. Recebe de 1 a 100 itens distintos `{balance_id, quantity, unit_cost?}`. `quantity` é positiva com três casas decimais; custo unitário, frete e desconto usam strings monetárias com duas casas. São opcionais `supplier_name`, `invoice_number`, `freight`, `discount` e `notes`.

Uma transação grava o cabeçalho e os itens, acrescenta as quantidades aos saldos atuais sem alterar reservas e cria movimentos `PURCHASE` com chave `replenishment:<registro>:<saldo>`. FKs compostas e o escopo autenticado isolam conta e unidade. Erros revertem o lote inteiro. A mesma chave e payload devolvem o registro original.

Os itens guardam nomes de produto, variação e local e os saldos antes/depois da entrada. Custo de compra é informação desta reposição: não altera preço de venda e não movimenta caixa ou lança contas a pagar. O total é calculado somente quando todos os custos foram informados, arredondando cada item em centavos e somando frete menos desconto. Se algum custo faltar, subtotal/total ficam nulos; frete e desconto ainda podem ser registrados. Com todos os custos, desconto maior que subtotal + frete é rejeitado.

`GET /api/v1/inventory/replenishments?page=1&page_size=10&search=...` e `GET /api/v1/inventory/replenishments/:id` exigem `inventory.view`. A busca cobre fornecedor, nota, produto, variação e local. A listagem usa COUNT e LIMIT no servidor; o detalhe conserva os valores históricos mesmo se os nomes ou saldos atuais mudarem.

A migration `0011_stock_replenishments.sql` cria apenas `stock_replenishments` e `stock_replenishment_items`, sem alterar saldos ou movimentos existentes. Faça backup antes da implantação e mantenha os registros históricos em um rollback de aplicação.

### Cores de categorias e locais

`POST /categories`, `PATCH /categories/:id`, `POST /stock-locations` e `PATCH /stock-locations/:id` aceitam `color` opcional, no formato hexadecimal completo `#RRGGBB`. A API normaliza para minúsculas; `null` remove a personalização. Omitir `color` preserva a cor existente no PATCH. A migração `0012_catalog_colors.sql` adiciona apenas as colunas opcionais e suas validações; os registros existentes continuam sem cor personalizada.

As cores aparecem nas tags de categorias/produtos, filtros do cardápio, seletores de categorias e locais, estoques, movimentações e reposições. O detalhe histórico da reposição mantém os nomes originais e usa a cor atual do local. Permissões e isolamento por unidade permanecem iguais: `catalog.manage` para categorias e `inventory.adjust` para locais. A cor é visual; não altera saldos, políticas de baixa nem status.

### Cancelamento de impressões

`POST /api/v1/print/jobs/:id/cancel` cancela um trabalho e `POST /api/v1/print/jobs/cancel` cancela todos os trabalhos `PENDING`, `PROCESSING` e `FAILED` da unidade autenticada. Ambos exigem funcionário com `print.manage`, `Idempotency-Key` e aceitam `{reason?: string}` (até 255 caracteres). O lote abrange todas as páginas e filtros da interface; transação e lock da unidade serializam o cancelamento com novos claims. A resposta do lote informa `cancelled` e `processing`. Repetir a chave devolve o resultado original e não cancela novos trabalhos criados depois. `COMPLETED` é preservado, e tentar cancelar individualmente um trabalho concluído é rejeitado.

A migração `0013_print_cancellation.sql` adiciona o estado `CANCELLED`, data, responsável e motivo do cancelamento. Não remove documentos nem altera fichas, pedidos, estoque ou pagamentos. Trabalhos cancelados não são selecionados pelos agentes nem podem ser retomados pelo endpoint de retry. O histórico e os eventos de auditoria permanecem disponíveis.

`GET /api/v1/print/jobs/:id/state` é exclusivo do agente dono do claim e retorna somente identificação, estado e geração local. O agente TCP verifica o estado antes de enviar; o cliente PrintBridge verifica antes e depois de baixar o documento e descarta dados de trabalhos cancelados, inclusive ao recuperar envios interrompidos. Respostas tardias dos agentes podem registrar o resultado do envio sem restaurar o trabalho cancelado. Documentos já transmitidos ao PrintBridge ou ao spooler/dispositivo podem terminar a impressão: o SDK atual não oferece cancelamento da fila nativa e o cancelamento no sistema não declara remoção física.

### Pedido avulso no balcão

`POST /api/v1/orders/counter` recebe `items` com os mesmos produtos, variações, adicionais, quantidades e observações de `/orders`, `expected_total` monetário, `method` (`CASH`, `PIX_MANUAL`, `CARD_MANUAL`), `cash_session_id` opcional, `customer_name` opcional (até 80 caracteres) e `deliver_available` booleano. Exige `order.create`, `payment.receive` e `Idempotency-Key`; entrega imediata também exige `ticket.redeem`. Dinheiro exige caixa aberto da mesma unidade. `GET /api/v1/orders/counter/cash-sessions` fornece os caixas abertos para funcionários com as permissões de venda e recebimento.

Uma transação valida os preços no servidor, cria o pedido `COUNTER` com política `IMMEDIATE`, registra o consumo e o recebimento integral e emite as fichas. Se o preço mudou, o estoque não estiver disponível ou o recebimento falhar, tudo é revertido. Não cria mesa nem sessão de ocupação. Uma comanda financeira exclusiva `COUNTER`, sem sessão de mesa, mantém alocações, cupom e estornos no livro financeiro existente. A migração `0014_counter_orders.sql` torna essas referências opcionais com CHECKs que mantêm obrigatória a mesa nos pedidos normais e a sessão nas comandas normais. O endpoint `/orders` continua exigindo mesa e não aceita a política `IMMEDIATE` pelo cliente.

Com `deliver_available`, somente fichas disponíveis são entregues e baixadas; itens que exigem preparo seguem para a cozinha. Fichas já entregues no ato não permanecem na fila de impressão. A comanda avulsa encerra automaticamente quando estiver quitada e todas as fichas forem entregues ou canceladas. Estorno e cancelamento antes da retirada usam as regras existentes; produto entregue, em preparo ou já produzido mantém os bloqueios e o tratamento administrativo já aplicados às mesas. Transferência entre comandas de balcão é bloqueada para preservar a relação exclusiva entre pedido e recebimento.

Listagens, agrupamento de fichas (cada pedido avulso em seu próprio atendimento), produção, pagamentos, financeiro e cupom PDF/térmico identificam o atendimento como Balcão. O cupom do pedido avulso informa também recebido, saldo e forma de pagamento, sem ratear pagamentos de mesas.

### Máscaras numéricas e serialização da interface

A interface React utiliza `MaskInput` da biblioteca Maska (o mesmo núcleo da diretiva `v-maska`). O componente compartilhado `NumericInput` trata inteiros, quantidades e dinheiro, bloqueia letras/notação científica e valida antes do envio. Durante edição, ponto ou vírgula indicam decimal; a tela usa vírgula. Valores com milhares colados devem usar formato completo, como `1.234,500` ou `R$ 1.234,56`. A edição evita pontos de agrupamento ambíguos; valores monetários voltam ao formato agrupado ao sair do campo.

Reposição, estoque inicial e movimentações usam até 11 dígitos inteiros e três decimais. Receitas usam oito dígitos inteiros e três decimais. Dinheiro usa 12 dígitos inteiros e dois decimais. Casas ou dígitos excedentes são recusados antes da máscara, sem truncamento silencioso. Somente perda e ajuste permitem quantidades negativas; perda exige valor negativo, compra/reposição exigem positivo e inventário permite zero. Campo inicial vazio continua opcional.

O payload conserva strings canônicas com ponto e precisão fixa (`1.500`, `14.50`). Lugares (1–100), posição (0–2000), escolhas (0–20), quantidade por item (1–100) e ordenação (inteiro MySQL de -2147483648 a 2147483647) são validados e enviados como números JSON. Identificadores como número de mesa, nota fiscal e códigos de ficha permanecem textos, conforme seus contratos.

### Presets de aparência e menu lateral

`GET /api/v1/appearance` informa `primary_color` e `sidebar_color` da unidade autenticada. `PATCH /api/v1/settings` aceita ambos como hexadecimal completo `#RRGGBB`, normaliza para minúsculas e mantém as permissões `settings.update`. Alterar somente uma cor preserva a outra. Presets da interface salvam as duas cores em uma única transação; não modificam políticas, tema do navegador, nome nem slug da unidade. A migração `0015_sidebar_appearance.sql` adiciona `sidebar_color` com fundo marinho padrão `#0d1b2a`. O contexto público da PWA inclui a cor para renderização inicial, sem alterar sua identidade ou endereço estável.

A cor primária continua nas ações; o fundo do sidebar é independente do tema e de outros painéis. Texto, ícones, bordas e hover são derivados do fundo com contraste legível. Os presets também podem ser substituídos pela edição individual com prévia e confirmação de descarte de rascunhos.

No computador, o botão no cabeçalho recolhe o menu para uma barra de ícones com rótulos acessíveis e títulos ao passar o mouse; o mesmo botão expande. Essa preferência é local, separada por conta, unidade e usuário, e não interfere no menu móvel, que abre e fecha como drawer completo.

### Cardápio público e retirada pelo cliente

O cardápio `/public/:slug/menu` pode ser consultado sem mesa ou sessão. `POST /public/:slug/tables/resolve` recebe `{table_code}` e verifica uma mesa ativa da própria unidade, sem cadastrar cliente nem ocupar a mesa. O leitor extrai apenas o código do QR; não abre a URL escaneada. O fluxo de mesa existente continua exigindo identificação e código de participação quando ocupada.

`POST /public/:slug/counter-sessions` recebe nome (2–80 caracteres) e telefone e cria uma sessão de cliente `COUNTER`, sem mesa ou ocupação. Com esse token, `POST /public/counter/orders` recebe somente `{items}` e exige `Idempotency-Key`: origem `CUSTOMER`, política `PREPAID`, nome e unidade são definidos no servidor. Funcionários e visitantes de mesa não podem usar esse endpoint. Não se permite injetar mesa, comanda, cliente, origem ou política no corpo.

O pagamento segue `/payments/intents` e o provedor já configurado (sandbox no ambiente local). A confirmação cria uma comanda financeira `COUNTER` vinculada ao cliente, aloca o pagamento e emite fichas. Estoque, preços, reservas, receitas, estornos e impressão usam os mesmos controles transacionais dos demais pedidos. Os endpoints `/my-tabs`, `/my-consumption` e `/my-tickets` exibem apenas o consumo autorizado. As fichas de retirada não permitem solicitar entrega na mesa; a equipe registra a retirada pelo leitor ou pela baixa existente. A migração `0016_customer_counter.sql` preserva os visitantes de mesa e permite sessões sem mesa exclusivamente no modo `COUNTER`.

### Compartilhamento de acesso da equipe

`GET /staff` e `GET /roles` acrescentam `access_surface` (`admin`, `waiter`, `kitchen`), calculado pelas permissões do perfil: caixa/gestão usa admin, produção usa cozinha e atendimento usa garçom. Administradores gerais usam gestão. A listagem nunca devolve senha ou hash. `POST /staff` também devolve `membership_id`, permitindo abrir a cópia do acesso recém-cadastrado na interface.

`POST /staff/:id/password` recebe `{password}` (12–200 caracteres) e exige `staff.manage`, administração geral vigente da conta e `Idempotency-Key`. O ID é o vínculo da própria unidade. Não permite alterar o próprio acesso, usuário desativado, perfil superior ou usuário associado a outra conta. Substitui o hash e revoga as sessões do funcionário na conta, com auditoria `staff.password_reset`. A resposta e o registro idempotente não incluem a senha. A interface só executa essa operação se o admin escolher explicitamente definir uma nova senha; copiar uma senha conhecida não altera o cadastro.

### Entregar todas as fichas de um pedido

`POST /orders/:id/deliver-tickets` recebe `{}` e exige `ticket.redeem` e `Idempotency-Key`. Seleciona no servidor todas as fichas do pedido confirmado, ignorando as já entregues e canceladas. Para trabalhos de cozinha ainda pendentes/em preparo, também exige `production.manage`, executando as transições normais até `READY` antes de registrar a entrega. A resposta informa `delivered_count`, `completed_production_count`, `already_delivered_count` e `cancelled_count`.

Toda a operação ocorre na mesma transação e usa as validações existentes de pagamento, posse de chamados, versão da ficha e estoque. Qualquer falha reverte o lote inteiro. Repetições e chamadas concorrentes não duplicam baixa ou eventos de entrega. O preparo e a entrega conservam seus registros individuais e o lote gera auditoria/evento `order.tickets_delivered`. O balcão encerra sua comanda se estiver integralmente pago e entregue; a mesa mantém o fluxo de fechamento separado.

### QR de mesa e impressão de etiquetas

`GET /tables/:id/qr?format=A4|LABEL|80|58` devolve o documento `TABLE_QR` com nome do estabelecimento, mesa e URL pública. `GET /tables/:id/qr.pdf` usa os mesmos formatos: A4 com marca de recorte, etiqueta 80 × 100 mm, térmica 80 ou 58 mm. Exige `table.view`, mesa ativa e escopo da unidade. O servidor monta o link a partir de `CUSTOMER_PUBLIC_URL` (ou `VITE_CUSTOMER_URL`), slug atual e código público da mesa; o cliente não pode enviar uma URL arbitrária. Em produção, configure o endereço público do cardápio. Não incorpora tokens nem código de participação e não cria atendimento.

`POST /tables/:id/qr/print` recebe `{printer_id,paper_width:58|80}`, exige `table.view` e `Idempotency-Key` e cria um trabalho `TABLE_QR` na fila existente. `GET /tables/qr/jobs/:id` acompanha o resultado. A migração `0017_table_qr_printing.sql` adiciona snapshot e referência com FK composta, mantendo exclusivos os campos de ficha, cupom e QR. O agente TCP imprime QR ESC/POS; o PrintBridge aceita PDF e ESC/POS. O snapshot é imutável, inclusive após renomear a mesa; retomada, novas vias, cancelamento e resultado incerto usam os controles existentes. Emitir novamente preserva o código público e os pedidos da mesa.

## Perfil comercial da filial

`GET /api/v1/settings` e `PATCH /api/v1/settings` mantêm a autorização `settings.update`. A propriedade opcional `business_profile` contém `description`, `phone`, `email`, `postal_code`, `street`, `number`, `complement`, `neighborhood`, `city` e `state`. São strings; descrição aceita até 1.000 caracteres, telefone exige 10 ou 11 dígitos com DDD e CEP exige 8 dígitos. Campos vazios são aceitos para remover informações opcionais. UF deve ser uma sigla brasileira válida, normalizada para maiúsculas. E-mail é normalizado para minúsculas. Campos inesperados são rejeitados.

O PATCH aceita parte do perfil e preserva os campos omitidos. O merge acontece sob lock da filial autenticada e na mesma transação da auditoria/evento de configuração. Não é aceito um tenant/unidade arbitrário dentro do perfil.

```json
{
  "business_profile": {
    "description": "Cozinha da casa e pratos preparados na hora.",
    "phone": "11999998888",
    "email": "contato@example.com",
    "postal_code": "01001000",
    "street": "Rua do Restaurante",
    "number": "S/N",
    "city": "São Paulo",
    "state": "SP"
  }
}
```

`GET /api/v1/public/:slug/menu` expõe esse perfil em `establishment.business_profile`, com uma lista explícita dos campos comerciais, sem configurações internas ou dados de autenticação. Registros legados retornam o perfil vazio. Cada filial mantém seus próprios valores. Veja [Configurações](configuracoes.md).

## Unidades de medida dos produtos

`GET /api/v1/measurement-units` retorna o catálogo padrão para usuários autenticados: `code`, `name` e `symbol`. As 13 medidas já vêm cadastradas pela migration `0025_product_measurement_units.sql`: UN (unidade), KG, G, MG, L, ML, DZ (dúzia), CX (caixa), PCT (pacote), FD (fardo), GRF (garrafa), LT (lata) e PR (porção).

`POST /products` e `PATCH /products/:id` aceitam `unit_code`, com a permissão existente `catalog.manage` e escopo da filial. O padrão na criação e nos produtos anteriores é `UN`. Omitir o campo em um PATCH preserva a unidade atual. Códigos desconhecidos, vazios, nulos ou com caixa incorreta são rejeitados pela API; a FK de produtos também restringe o valor ao catálogo de medidas.

A unidade é exibida no cadastro, nos estoques e na reposição. As variações herdam a unidade do produto. Na ficha técnica, a quantidade é informada na medida do ingrediente, para cada item vendido do produto final: por exemplo, `0.050` de um ingrediente em KG representa 0,050 kg por item. Pedidos e fichas continuam contados por item; não foi introduzida venda fracionada nem conversão automática entre kg/g, L/ml ou embalagens.

Alterar a unidade não converte os números existentes. Revise saldos, reservas e receitas antes de salvar. Cada nova movimentação e item de reposição guarda `unit_code` no momento do registro; o histórico mantém essa medida após alterar o produto. Registros anteriores à migration começam em `UN`. Aplique a migration antes de iniciar a API atualizada.
