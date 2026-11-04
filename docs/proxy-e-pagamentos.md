# Proxies confiáveis e recuperação de pagamentos

## Proxy e limites de requisições

A API usa `TRUSTED_PROXIES`, uma lista de IPs/CIDRs separada por vírgulas. O padrão `loopback` atende Nginx/Vite na mesma máquina. `none` desativa encaminhamento. Não são aceitos `true`, `*`, redes `/0` nem contagem de saltos: clientes diretos não podem falsificar o IP usado pelo rate limit. Fastify percorre os cabeçalhos a partir do par conectado e para no primeiro endereço não confiável.

Na VM nativa com Nginx local, configure `TRUSTED_PROXIES=loopback` em `/etc/mesa/mesa.env`. Se houver outro proxy no caminho, acrescente somente seus endereços/CIDRs reais e mantenha a API privada. O Nginx deve preservar `X-Forwarded-For` conforme os exemplos existentes. O limite global continua 600/minuto e o login 10/minuto, agora separados pelo IP efetivo do cliente.

O Compose usa a rede privada `MESA_NETWORK_SUBNET` (padrão `172.30.50.0/24`) e a inclui entre os pares confiáveis da API. Verifique conflito com redes do host antes de publicar. `TRUSTED_PROXIES` no `.env.production` adiciona outros pares, como o proxy do EasyPanel. A rede/endereço do proxy externo depende da instalação: confira no servidor em vez de confiar em toda a faixa privada. Na atualização de uma stack antiga, a mudança da rede exige recriar os containers em janela de manutenção; preserve os volumes MySQL/Redis.

Referência: [Fastify — trustProxy](https://fastify.dev/docs/latest/Reference/Server/#trustproxy).

## Migração e fases dos pagamentos

A migration aditiva `0029_gateway_operations.sql` cria `gateway_operations` e `payment_reconciliation`. Não modifica os registros de pedidos, recebimentos, estornos, estoque ou sessões existentes. Intenções Mercado Pago dos últimos 180 dias recebem agenda de conciliação. Execute backup e migration antes de iniciar a nova API e o worker; as duas versões devem ser atualizadas juntas.

As URLs e os corpos de checkout, estorno, consulta e sincronização continuam iguais. Sandbox e recebimentos/estornos manuais mantêm o fluxo transacional anterior. Operações remotas têm três fases:

1. **Reservar no MySQL:** validar acesso, valor e estado; persistir intenção/operação, referência estável e autorização original em transação curta.
2. **Consultar/chamar o Mercado Pago:** fora da transação da filial. Um lease de 120 segundos impede envio concorrente da mesma operação.
3. **Confirmar no MySQL:** conferir o lease e aplicar o resultado uma única vez, com auditoria e eventos existentes.

Checkout persiste também o corpo enviado e a conta recebedora antes da chamada. Se a conexão cair após o envio, a recuperação pesquisa a preferência pela mesma `external_reference`, obtém seu documento e confere recebedor e valor antes de reutilizar a URL. Não é reenviado um POST de preferência com resultado desconhecido. Se a preferência não puder ser recuperada, a operação fica pendente/revisão; não é inventada uma URL ou confirmação. Veja [pesquisa de preferências](https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-pro-preferences/search-preferences/get).

Estornos preservam a chave idempotente de negócio e só entram no livro financeiro após confirmação do provedor. Timeout não libera a reserva da operação. Outro estorno com valor/alocação diferente é recusado enquanto o primeiro não for resolvido; um funcionário com `payment.refund` pode retomar a mesma operação, mantendo o motivo e a autoria originais e auditando a retomada. Entrega, produção, cancelamento e liberação da mesa aguardam a resolução. Webhook e resposta HTTP podem chegar em qualquer ordem sem duplicar a linha do estorno. Referência: [API de estornos e X-Idempotency-Key](https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-api-payments/create-refund/post).

Renovação de token, teste/ativação da conexão e troca OAuth também fazem I/O externo fora da transação. Tokens permanecem cifrados; permissão, conta e versão da credencial são conferidas antes de gravar. Uma interrupção após o provedor consumir um código OAuth/rotacionar uma credencial pode exigir nova autorização; não existe transação distribuída com o provedor.

## Conciliação automática

O worker despacha a fila BullMQ `mercado-payments`, com duas tarefas simultâneas, limite de 30 tarefas/minuto e retry exponencial. O MySQL conserva agenda, leases, tentativas e operação autorizada; reiniciar API/worker ou perder a fila Redis não elimina o trabalho persistido.

- Recupera checkouts e estornos pendentes. Após oito falhas da operação, marca `REVIEW` e mantém a proteção contra repetição. Corrija a conexão e retome pelo fluxo existente; não crie um segundo estorno para compensar um resultado desconhecido.
- No primeiro dia, consulta intenções pendentes aproximadamente a cada minuto e demais intenções a cada 15 minutos. Do segundo ao sétimo dia, consulta a cada hora; depois, a cada seis horas, até completar a janela de 180 dias. O lease de agendamento usa atualização condicional sem criar um registro de idempotência a cada consulta. Atrasos/backoff e volume da fila podem ampliar o intervalo. A sincronização manual continua disponível após essa janela.
- Pesquisa todas as páginas de pagamentos por referência (até 5.000 resultados por consulta) e confere também IDs de pagamentos já conhecidos. Obtém o ledger de estornos quando o provedor informa valor devolvido.
- Confere moeda, referência, valor e conta recebedora. Não libera fichas por retorno do navegador nem pela mera existência de um pagamento remoto.
- Reutiliza a confirmação existente: falta de estoque, checkout expirado ou pagamento excedente preserva o recebimento para revisão, sem duplicar fichas ou consumo.
- Webhooks continuam sendo o caminho imediato. A fila cobre eventos ausentes e restabelece consistência; não pressupõe entrega exatamente uma vez.

`GET /observability/metrics`, limitado à filial e à permissão existente, acrescenta `gateway_operations` e `payment_reconciliation` sem remover `outbox`/`printing`. Monitore operações `REVIEW`, erros de conciliação e horário da última consulta. O aviso de estorno pendente usa também o campo de revisão já exibido em Pagamentos.

API **e worker** precisam das mesmas variáveis `MERCADO_PAGO_*`, `DOCUMENT_KEY`, MySQL e Redis, além de saída HTTPS para `api.mercadopago.com`. Sem worker ativo, webhook e sincronização manual continuam funcionando, mas não há processamento automático da agenda.

## Verificações

Testes isolados cobrem proxies distintos, cabeçalho falsificado por origem não confiável, checkout lento sem lock de filial, perda de conexão após aceite, estorno/webhook concorrentes, bloqueio operacional durante estorno, recuperação sem webhook com retry BullMQ e compatibilidade dos fluxos financeiros existentes. Os provedores são simulados nos testes; publicação, cadeia real de proxies e pagamento/estorno reais exigem homologação com a conta e a infraestrutura do responsável.

Validação local em 03/11/2026: lint, TypeScript e build aprovados; 18 testes de integração de complementos e três testes de proxy aprovados. No navegador, passaram OAuth/checkout, formulários de caixa/cancelamento e recebimentos/estorno parcial. Um quarto cenário amplo de atendimento falhou na verificação de visibilidade da aba Entregas no celular (`tests/e2e/operation.spec.ts:217`); o layout dessa aba não foi modificado nesta entrega. A migration foi aplicada após backup local, com comparação de contagem e hash dos registros das 76 tabelas existentes, sem divergências. API e worker foram reiniciados e a readiness retornou HTTP 200.

Correção posterior em 03/11/2026: a barra de abas do atendimento passou a revelar a opção selecionada pelos atalhos, ao voltar ao painel Atendimento e ao redimensionar a tela. O cenário completo cliente → pagamento sandbox → solicitação → entrega → liberação passou, assim como a gestão da mesa em desktop e celular, incluindo visibilidade em 360 e 390 px. O teste também foi atualizado para o botão compacto **Entregar** e o histórico **Entregues** recolhido, conforme a interface atual.
