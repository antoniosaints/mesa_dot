# Web Push da equipe

Em **Gestão → Configurações → Notificações push**, o admin geral da conta configura as regras da filial. É possível pausar os envios, escolher os eventos, selecionar os perfis e desativar dispositivos. As configurações e listagens são limitadas à filial autenticada; usuários e dispositivos de outra filial não aparecem.

Os eventos disponíveis são solicitações de entrega, nova ocupação de mesa, pedido confirmado, item pronto, pedido cancelado, mesa liberada, pagamento recebido, abertura/fechamento de caixa e falha de impressão. A ocupação é emitida uma vez ao criar o atendimento, e não a cada pedido adicional. Rascunhos de pedidos não geram aviso de novo pedido.

Cada funcionário ativa o aparelho no botão **Push** do cabeçalho dos ambientes Gestão, Garçom e Cozinha. A permissão nunca é solicitada automaticamente ao abrir o sistema. O dispositivo pode ser nomeado, testado e desativado para a filial. A ativação usa `userVisibleOnly` e a chave pública VAPID, conforme a [API PushManager](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe). No celular, use um endereço HTTPS; no iPhone/iPad, abra o aplicativo instalado na Tela de Início.

A inscrição pode continuar recebendo enquanto o aplicativo estiver em segundo plano, conforme as restrições do navegador e do sistema operacional. O clique abre o chamado, a mesa, o pedido ou a tela operacional correspondente na filial correta. Links externos não são aceitos pelo service worker. Nenhum token de login é incluído na notificação.

## Servidor

1. Configure `DOCUMENT_KEY` e as origens dos frontends em `CORS_ORIGINS`.
2. Execute `pnpm push:keys` uma vez. O script gera um par VAPID e salva no `.env` protegido; um par existente não é substituído. Um par incompleto exige correção manual.
3. Configure `WEB_PUSH_SUBJECT` com o endereço HTTPS ou contato `mailto:` do responsável. O padrão deste projeto é `https://mesa.userp.com.br`.
4. Compile com `pnpm build`, aplique a migration com `pnpm db:migrate` e reinicie API e worker.
5. Disponibilize os frontends por HTTPS e ative os envios e os aparelhos pela interface.

`WEB_PUSH_PRIVATE_KEY` permanece no servidor. Somente a chave pública é disponibilizada ao navegador. Preserve as chaves VAPID e `DOCUMENT_KEY` entre reinicializações e deploys; trocar as chaves exige reativar os dispositivos afetados. As credenciais dos dispositivos são criptografadas no MySQL com AES-256-GCM usando `DOCUMENT_KEY`, e não são expostas na listagem administrativa.

A saída HTTPS do worker deve alcançar os serviços de push dos navegadores. `WEB_PUSH_ALLOWED_HOSTS` permite por padrão os serviços Google/FCM, Mozilla, Apple e Windows. Endpoints privados, domínios não permitidos, URLs com credenciais e portas alternativas são rejeitados antes de qualquer envio. A biblioteca usada é a [web-push oficial para Node](https://github.com/web-push-libs/web-push).

## Fila, tentativas e limpeza

Os eventos de negócio continuam sendo gravados na outbox na mesma transação da operação. O worker prepara entregas persistentes antes de marcar o evento como publicado. A combinação única evento/dispositivo evita um novo envio depois de uma repetição do fanout ou da remoção do job no Redis.

A fila **`web-push`** é separada da fila `outbox` e da impressão. Cada job contém apenas os identificadores da entrega e do escopo; endpoints e chaves não ficam no job. São até seis tentativas, com backoff exponencial iniciado em dois segundos, oito processamentos concorrentes e limite de 50 envios por segundo. São usados os mecanismos de [retry do BullMQ](https://docs.bullmq.io/guide/retrying-failing-jobs) e [remoção automática de jobs](https://docs.bullmq.io/guide/queues/auto-removal-of-jobs).

Avisos expiram em dez minutos. As permissões atuais, a vinculação do funcionário, a validade da sessão, as regras e a situação da operação são verificadas novamente antes do envio. Uma solicitação já atendida não gera um aviso atrasado. Ativar o envio não dispara eventos históricos anteriores à ativação.

- **404/410:** a assinatura é removida automaticamente e a entrega termina como expirada.
- **429, 5xx ou erro de rede:** retry progressivo. A assinatura não é excluída por uma indisponibilidade temporária.
- **400/401/403/413:** a entrega é encerrada como falha; a assinatura é preservada, pois erros de configuração ou credenciais do servidor não significam dispositivo inativo.
- **Logout, sessão de renovação expirada, conta/vínculo desativado ou expiração informada pelo navegador:** a assinatura deixa de receber e é removida pela manutenção. Apenas deixar uma aba em segundo plano não é motivo para remoção.

A sessão de renovação da equipe tem a validade já adotada pelo sistema (sete dias). Depois disso, é necessário entrar novamente. Dispositivos desativados pelo admin não são reativados por uma sincronização automática; a ativação explícita no aparelho é necessária.

O histórico de entregas no MySQL é mantido por 30 dias. Jobs concluídos ficam por até um dia e jobs falhos por até sete dias, ambos limitados a mil registros no Redis. Logs de retry registram apenas identificador e tentativa, sem endpoint, chave ou corpo devolvido pelo provedor.

Web Push tem entrega pelo menos uma vez: uma interrupção após o provedor aceitar o envio pode exigir retry. A tag por evento permite ao navegador consolidar o aviso repetido, sem prometer confirmação de leitura pelo funcionário.

## Endpoints

- `GET /push/context`: disponibilidade, chave pública e dispositivos do usuário atual.
- `GET/PATCH /push/settings`: regras da filial, exclusivo do admin geral.
- `POST /push/subscriptions`: cadastro/sincronização do próprio dispositivo.
- `DELETE /push/subscriptions/:id`: desativação pelo proprietário.
- `POST /push/subscriptions/:id/test`: teste do próprio dispositivo pela outbox.
- `GET /push/devices`: listagem administrativa com paginação no servidor.
- `POST /push/devices/:id/disable`: desativação administrativa.

## Validação

`tests/web-push.test.ts` cobre criptografia, endpoints permitidos, categorias de falha e os eventos do service worker. `tests/integration/web-push.test.ts` usa banco isolado, transporte controlado e retry real no BullMQ/Redis. `tests/e2e/web-push.spec.ts` valida a configuração e a ativação explícita no navegador, usando inscrições simuladas. O worker dos testes de navegador não envia requisições aos provedores externos.
