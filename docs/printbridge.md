# Impressão local com PrintBridge

Integração com [PrintBridge Userp](https://printbridge.userp.com.br/) usando o SDK oficial `@antoniosantos1999/printbridge@0.1.1`. Os contratos foram conferidos nos guias oficiais de [integração](https://printbridge.userp.com.br/downloads/guias/integracao.md) e [aplicação web](https://printbridge.userp.com.br/downloads/guias/aplicacao-web.md).

## Configurar a estação

1. Instale e abra o PrintBridge oficial no computador que tem acesso à impressora. Instale o driver da impressora no sistema operacional e siga a configuração de certificado do aplicativo.
2. Entre no administrador do Mesa com a permissão `print.manage`. Em **Impressão → Impressoras**, cadastre as impressoras/setores que receberão as fichas e os cupons.
3. Abra **Impressão → PrintBridge** e pressione **Conectar PrintBridge**. Autorize a origem exata mostrada na tela no aplicativo nativo e selecione as impressoras permitidas. No ambiente local, `http://localhost:5173` e `http://127.0.0.1:5173` são origens diferentes. A permissão de acesso local do navegador é independente da autorização no aplicativo.
4. Vincule cada impressora do sistema ao dispositivo instalado retornado pelo PrintBridge. Escolha PDF para usar o driver ou ESC/POS para uma térmica compatível. Escolha 58 ou 80 mm para fichas; cupons usam a largura selecionada na emissão. Em PDF, configure o papel correspondente no driver: o envio utiliza uma cópia, retrato e nenhum ajuste de escala.
5. Pressione **Ativar fila local**. Os jobs pendentes das impressoras vinculadas serão processados, incluindo os já existentes. A conexão autorizada, a credencial da estação, os vínculos e a ativação ficam salvos neste navegador por unidade. Recarregar ou reabrir restaura a conexão e retoma a mesma fila automaticamente. Uma pausa ou desconexão feita pelo usuário permanece salva. Falhas transitórias reconectam com espera progressiva; autorização revogada exige nova aprovação explícita.

As impressoras autorizadas vêm do aplicativo local. `status: unknown` do driver não comprova que o equipamento esteja pronto. O indicador do cabeçalho abre a configuração e mostra se a fila está ativa. Pausar ou fechar a página não cancela trabalhos que o aplicativo nativo já aceitou.

## Fichas e cupons

A confirmação de pedido conserva a fila de fichas por setor. Cupons de pedido/comanda continuam sendo emitidos nos respectivos modais por **Enviar para térmica**. PDF, impressão pelo diálogo do navegador e o agente TCP existente continuam disponíveis.

O modo PDF de ficha inclui identificação, mesa, comanda, produto, observações, QR Code e Code 128. A impressão conserva o direito de consumo existente e não registra entrega. O cupom é não fiscal e conserva o conteúdo da emissão. `submitted` do PrintBridge é apresentado como envio concluído à fila de impressão do sistema operacional; não comprova saída física de papel.

## Falhas e recuperação

A API congela por emissão a chave de idempotência, origem, dispositivo, formato, largura, conteúdo e hash. O token da ficha é reconstruído somente no download autenticado, não salvo no job. O job nativo é registrado e consultado até seu estado final. Uma resposta perdida usa a mesma chave e os mesmos bytes na retomada, evitando outra via. A credencial de impressão da estação e seus vínculos ficam em `localStorage`, separados por unidade neste computador/origem. Não é uma sessão administrativa. A credencial antiga da aba é migrada sem trocar o agente que possui as emissões em andamento. Um lock do navegador e a idempotência nativa coordenam múltiplas abas para que apenas uma processe a estação. A credencial nativa é gerenciada pelo SDK para a origem autorizada.

O PrintBridge guarda idempotência por sete dias após o estado terminal. Um envio sem identificador e com mais de seis dias não é reenviado automaticamente. `unknown` e `failed` ficam como falha para conferência, sem gerar outra chave automaticamente. Confira o papel e a fila do sistema; em **Fila de impressão → Tentar novamente**, informe o motivo e solicite uma nova via. Essa ação cria outra emissão marcada como cópia e é auditada. Não limpe os dados da estação durante uma recuperação: trabalhos preparados ficam vinculados ao agente que os iniciou.

Outros agentes e o agente TCP não podem assumir uma emissão já preparada por uma estação PrintBridge. Se a sessão do navegador foi perdida definitivamente, preserve o job e seu identificador nativo para conferência administrativa; não resete o job diretamente no banco nem invente confirmação de impressão.

## Implantação

A migração aditiva `0009_printbridge.sql` acrescenta o transporte do agente e os metadados de entrega. Aplique com o runner após backup, sem alterar migrations existentes. Não há migração de dados de consumo ou de estoque.

O SDK conecta via TLS em `wss://localhost:17861/v1`, com alternativas 17862 e 17863. A aplicação em produção exige HTTPS; HTTP é permitido pelo aplicativo somente para loopback. Se o servidor do frontend define CSP, acrescente `wss://localhost:17861 wss://localhost:17862 wss://localhost:17863` ao `connect-src` existente, preservando seus destinos autorizados. Não desative CSP, TLS, validação de certificado ou a aprovação do aplicativo para estabelecer conexão.

As rotas `/print/jobs/:id/bridge/prepare`, `/bridge/document` e `/bridge/status` exigem agente PrintBridge autenticado, unidade correta e posse do job. O documento exige lease válido e usa `Cache-Control: private, no-store`. O resultado informado precisa corresponder à mesma geração e ao mesmo identificador nativo. A configuração administrativa continua sujeita a `print.manage`.

## Verificação

Os testes incluem bytes PDF estáveis, ESC/POS, resposta perdida, retomada por identificador nativo, isolamento entre agentes/unidades, ausência de tokens na persistência, emissão antiga, conferência de resultado incerto e segunda via. O teste do navegador utiliza o SDK real com o WebSocket do aplicativo simulado; não imprime em equipamento real. A regressão conserva o teste do agente TCP. A saída física e o papel do driver devem ser conferidos na impressora escolhida.

## Impressão remota pelo celular

O celular envia a solicitação à fila central do Mesa. O computador consulta essa mesma API pela internet e entrega os documentos ao PrintBridge local. Não é necessário que celular e impressora estejam na mesma rede, nem abrir portas do PrintBridge para a internet. Os dois dispositivos precisam acessar a mesma instalação do Mesa; um endereço `localhost` no celular aponta para o próprio celular. Para uso fora da rede local, publique o Mesa/API em HTTPS com endereço acessível aos dois.

O modal de cupom e de QR da mesa mostra os computadores online vinculados à impressora selecionada. Sem agente online, o pedido pode ser colocado na fila e aguarda a reconexão. A lista **Computadores de impressão** indica disponibilidade e permite desativar um agente sem apagar os documentos pendentes. O estado expira após 45 segundos sem comunicação. Drivers podem informar estado desconhecido; online não comprova saída física do papel.

## Modo estação dedicado

Depois de ativar o computador, abra **Abrir modo estação** e mantenha essa aba aberta. A rota `/{slug}/estacao-impressao` usa somente a credencial própria do agente, sem exigir sessão de funcionário. Ela não permite acesso ao financeiro, clientes ou gestão. A estação pode continuar mesmo após o administrador sair da gestão em outra aba. Ao abrir o modo dedicado enquanto a gestão está processando, ele aguarda; ao fechar a aba que liderava, assume automaticamente.

O computador deve estar ligado, com o PrintBridge em execução e uma aba do Mesa/modo estação aberta. Fechar todas as abas ou suspender o computador interrompe o processamento; os trabalhos ficam preservados no servidor até a retomada. Revogar o agente bloqueia novas consultas. Reativá-lo permite reutilizar a credencial existente, mas a estação pausada precisa ser ativada novamente.

A migração aditiva `0021_print_stations.sql` acrescenta apenas o estado de disponibilidade ao cadastro de agentes. As rotas exclusivas do agente são `GET /print/station` e `POST /print/station/heartbeat`; elas continuam limitadas à unidade do token. `GET /print/stations` e a ativação/desativação administrativa exigem `print.manage`. A consulta de destinos de cupom usa `table.view`, retornando somente nome e disponibilidade dos agentes vinculados.

## Domínio público informado

A gestão e a estação usarão `https://mesa.userp.com.br`. Os valores públicos estão em `infra/mesa.userp.com.br.env.example`; o template `infra/nginx/default.conf.template` identifica os hosts configurados e encaminha API e Socket.IO pela mesma origem. Para publicação completa por Docker, VM ou EasyPanel, siga o [README](../README.md#deploy-em-produção). Injete os segredos do servidor separadamente e configure as origens dos outros aplicativos antes do build de produção.

Para publicar, o DNS desse nome precisa apontar para o servidor que hospeda o Mesa e ter certificado TLS válido. No PrintBridge do computador, autorize exatamente `https://mesa.userp.com.br`, vincule as impressoras e ative a estação nessa origem. A autorização e o armazenamento de `localhost` não são compartilhados com o domínio público. A conexão é de saída do navegador para o serviço local em `wss://localhost`; mantenha as portas nativas do PrintBridge restritas ao computador.
