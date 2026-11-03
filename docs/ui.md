# Padrão visual do Mesa

A interface segue o padrão observado no [Hotspot CAS](https://hotspot.cas.net.br/dashboard): menu lateral agrupado, cabeçalho compacto, superfícies discretas, ações azuis, tabelas com busca/paginação e formulários em modal. A identidade e o conteúdo são próprios do Mesa.

## Tokens

| Elemento         | Tema escuro                    |
| ---------------- | ------------------------------ |
| Fundo            | `#090e1a`                      |
| Superfícies      | `#0e1525`                      |
| Menu lateral     | `#0f1626`                      |
| Bordas           | `#222f44`                      |
| Texto            | `#e2e8f0`                      |
| Texto secundário | `#94a3b8`                      |
| Ação principal   | `#2584f8`                      |
| Fonte            | Sora semibold (600), local     |
| Cantos           | 6–7 px nos controles e painéis |

Os tokens estão em `packages/ui/src/styles.css`. O tema claro redefine as mesmas variáveis. A seleção de tema é salva no navegador, por origem, e permanece após recarregar a página.

Em **Configurações → Aparência**, o administrador pode escolher uma das oito cores sugeridas ou informar uma cor hexadecimal. A cor primária é salva no MySQL por estabelecimento e aplicada à administração, cliente, garçom e cozinha. A interface calcula cores de texto com contraste adequado para os dois temas. O tema claro/escuro continua sendo uma preferência individual do navegador.

## Componentes e comportamento

- `appearance.tsx`: marca, ícones oficiais do Lucide React, alternância de tema, relógio e cabeçalho compartilhado.
- `common.tsx`: estados de ação, cartões de status e modais com Escape, contenção de foco, restauração de foco e suporte a diálogos sobrepostos. O clique externo só fecha quando começa e termina no fundo; arrastar a seleção de um campo para fora preserva o formulário.
- Ao fechar um modal com alterações não salvas, a confirmação oferece **Continuar editando** (foco inicial) e **Descartar alterações**. Vale para Cancelar, botão de fechar, Escape e clique externo; salvar com sucesso fecha diretamente. Retornar aos valores iniciais dispensa a confirmação. A proteção inclui formulários, aparência, identificação do cliente, personalização de produto, transferência e pedido em montagem na mesa.
- `forms.tsx`: formulários em modal, validação, estado de envio e preservação dos dados quando uma operação falha. Caixa, estorno, cancelamento, equipe, políticas e ações do PDV usam esses formulários.
- `controls.tsx`: selects com busca sem distinção de acentos, navegação por teclado e lista flutuante; abas com navegação pelas setas e apenas o painel selecionado visível.
- `toasts.tsx`: feedback de sucesso e erro em notificações acessíveis, com fechamento manual e pausa do temporizador ao receber foco ou passar o mouse.
- `preferences.ts` e `appearance-settings.tsx`: preferência de tema, sincronização da cor do estabelecimento e personalização em modal com prévia.
- `resource.tsx`: cadastro tabular, busca local, paginação e formulário. A busca e a paginação operam sobre a coleção já autorizada da unidade; não alteram cálculos financeiros.
- Administração: navegação agrupada por operação, gerenciamento e financeiro, respeitando permissões; no celular, o menu abre como gaveta.
- Salão, cardápio, estoque, caixa, impressão e configurações dividem as tabelas e opções em abas.
- Cliente, garçom e cozinha: mesmos tokens, fonte, botões e cabeçalho; os fluxos operacionais continuam independentes.
- QR e Code 128 conservam fundo branco para leitura, inclusive no tema escuro.

## Verificação

Os testes de navegador cobrem cadastro de produto, busca da tabela, operação móvel, gaveta, persistência do tema, navegação por abas, busca nos selects, fechamento de modais pelo teclado, feedback de erro preservando o formulário, cor salva no estabelecimento, operações de caixa e cancelamento em modal sobreposto. Também cobrem o fluxo cliente → pagamento sandbox → chamado → entrega → liberação e a produção. Os testes de integração verificam validação da cor, permissões e isolamento entre estabelecimentos. O ambiente local de demonstração é preservado; os testes usam banco e Redis separados.

A fonte Sora é distribuída sob SIL Open Font License. Sua licença acompanha o arquivo em `packages/ui/src/fonts/OFL.txt`.

## Rotas e atendimento guiado

Consulte [Rotas e operação](routes.md) para os endereços de cada tela, links diretos de pedidos e fichas, preservação de abas e o fluxo mesa → comanda → pedido → entrega → fechamento. Ícones de ações e de navegação usam o Lucide React. Os botões de consulta têm contorno e texto explícito; fichas mostram seu contexto e são carregadas automaticamente.

O atendimento da mesa segue o DESIGN_SYSTEM.md em modal amplo (até 1840 px), com cardápio à esquerda, gestão de pedidos/comandas/entregas ao centro e resumo financeiro com ações à direita. Mesas ocupadas abrem no resumo. A lateral soma todas as comandas do atendimento atual, com total líquido de créditos/descontos, recebimentos líquidos de estornos e saldo. O cabeçalho mantém a comanda selecionada e o acompanhamento das entregas. As entregas contam unidades de fichas de pedidos confirmados, excluindo canceladas. O resumo separa comandas e pedidos, mostra entrega parcial por produto e filtra itens entregues ou pendentes. Pedidos de ocupações anteriores não entram nessa visão.

As ações de cancelamento e estorno ficam no atendimento sem exigir sair da mesa. Uma nova comanda é selecionada após salvar e abre o lançamento de pedido; com itens no carrinho, a troca de comanda e a criação de outra ficam bloqueadas para preservar o destino do pedido. No computador, as três áreas têm rolagem independente. Até 1100 px, a navegação alterna entre Cardápio, Atendimento e Resumo e ações; total, pago e pendente permanecem visíveis. Essa navegação aceita setas, Home e End. A busca e os filtros do cardápio usam os produtos e categorias existentes. Os tokens do modal reutilizam a cor primária configurada e o tema claro/escuro, com os raios, hierarquia e superfícies do design system. O fechamento abre um modal próprio de revisão, mostra pendências por tipo, permite receber o saldo de cada comanda e finaliza a mesa em uma ação quando tudo estiver resolvido. Mesas em fechamento precisam ser reabertas antes de adicionar pedidos ou comandas.

Campos monetários usam o Maska (`MaskInput`, integração JavaScript para React) com separadores de pt-BR, prefixo R$ e duas casas decimais ao sair do campo. É possível informar `14`, `14,50`, `14.50` ou colar `R$ 1.234,56`. Os formulários serializam sempre strings decimais com ponto e duas casas (`14.00`, `1234.56`), preservando a validação financeira da API. Preços de produtos, variações e adicionais, recebimentos, estornos, abertura/sangria/fechamento de caixa e limite pós-pago compartilham o componente. Campos vazios obrigatórios, negativos e valores acima de 999.999.999.999,99 são bloqueados com mensagem no campo. A formatação visual de um cadastro existente não marca o formulário como alterado.

## Tela de pedidos

A página `/pedidos` usa o padrão do DESIGN_SYSTEM.md: cabeçalho com ações, indicadores reais da unidade, filtros e uma listagem com hierarquia de pedido, mesa/comanda, itens, situação, entregas e valor. Pedidos registrados representam o histórico da unidade; unidades a entregar, em preparo e solicitadas consideram pedidos confirmados em atendimentos abertos. Perfis sem acesso a fichas recebem indicadores baseados nas situações dos pedidos.

A consulta combina busca sem distinção de acentos, mesa, situação do pedido, origem e entrega. Códigos curtos com `#` e números de ficha encontram o pedido correspondente. Na aba de fichas, a busca mantém as fichas específicas encontradas dentro dos agrupamentos existentes. As colunas permitem ordenar por horário, mesa, situação, pendências de entrega e valor. A paginação de pedidos permite 10, 25 ou 50 registros; os filtros e a ordenação são aplicados antes de paginar. As fichas continuam agrupadas por atendimento completo.

Abaixo de 980 px de largura disponível para a listagem, cada pedido vira um card com as mesmas informações e ação de detalhe. No celular, os filtros adicionais abrem por um botão, e a ordenação fica disponível em um select. Indicadores, tabela, cards e ações reutilizam a fonte, a cor primária configurada, os temas e ícones Lucide do sistema. Os testes de navegador cobrem filtros, busca por ficha, ordenação, paginação, retorno dos detalhes preservando a consulta e ausência de rolagem horizontal no celular.

## Catálogo e gestão centralizada do produto

`/cardapio` possui três áreas: Produtos, Categorias e Adicionais. A listagem mantém categorias com contagem, busca, filtros, ordenação, paginação, duplicação e disponibilidade. Variações e vínculos de grupos saíram das tabelas globais: ficam no produto. Em Adicionais, os grupos e suas opções são gerenciados juntos, com aviso de que alterações são compartilhadas pelos produtos vinculados.

Novo produto e Editar abrem o mesmo modal, com Geral, Preços e variações, Estoque e produção, Estoques e locais, Movimentações, Ficha técnica e Adicionais. **Salvar** grava o cadastro e fecha; **Salvar e continuar** mantém o modal aberto e libera a configuração de entidades dependentes após a criação. Os formulários de estoque, variações, ingredientes e vínculos salvam suas operações individualmente; alterações ainda pendentes no cadastro principal permanecem protegidas por confirmação ao fechar ou navegar.

Estoques e locais permite vincular saldos do produto ou de uma variação em vários locais, cadastrar/editar locais, definir o padrão da unidade e movimentar quantidades por compra, perda, ajuste ou inventário contado. Não permite alterar nem apagar movimentos passados. As linhas mostram local, produto/variação, físico, reservado e disponível, com acesso ao histórico filtrado. Quantidades aceitam vírgula ou ponto e são serializadas com três casas, sem arredondamento implícito. A contagem física é calculada com o saldo bloqueado, preservando reservas concorrentes.

Variações existentes continuam com estoque compartilhado. **Saldo próprio por variação** é opcional e cria reservas independentes por produto, variação e local, inclusive quando produto e variação usam o mesmo local. A origem de baixa segue: origem explícita da variação com saldo próprio, origem do produto, padrão da unidade. Estoque próprio não usa o saldo compartilhado como fallback. Produtos com ficha técnica mantêm as variações compartilhadas e consomem os ingredientes; a origem explícita do ingrediente prevalece sobre a do produto preparado e sobre o padrão da unidade. A política Sem controle continua sem reserva ou baixa.

A migration `0006_product_inventory.sql` acrescenta as origens e a identidade da variação no saldo, com FK composta que impede relacionar variação de outro produto/estabelecimento e unicidade por local, produto e variação. Não move quantidades nem altera componentes já fotografados nos pedidos. Reservas, entregas, produção, checkout, cancelamentos e devoluções continuam operando sobre os IDs de saldo armazenados no pedido. Alterar modo, local, receita ou padrão afeta novos pedidos; não transfere saldos nem reescreve o histórico.

A ficha técnica permite criar a receita, inserir/editar/remover ingredientes no produto preparado. Adicionais permite vincular e desvincular grupos existentes, criar/editar os grupos e suas opções sem sair do modal. Categorias também podem ser gerenciadas a partir do cadastro. Desvincular um grupo não apaga suas opções nem afeta outros produtos; editar o grupo compartilhado tem efeito nos produtos vinculados.

`/estoque` é uma visão geral com busca por produto/variação/local e filtro de local. **Gerenciar produto** abre o mesmo modal na aba de saldos. As permissões `catalog.manage`, `inventory.view` e `inventory.adjust` continuam separadas, com o contexto retornando somente as áreas autorizadas. No celular, as tabelas de estoque e histórico viram cards, as abas acompanham a seleção e as ações de salvar ficam acessíveis.

O código exibido na lista corresponde ao identificador real do produto. Imagens e SKU continuam fora do cadastro. Os testes cobrem cadastro e edição centralizados, locais, saldo próprio e compartilhado no mesmo local, máscaras, movimentações, ingredientes, adicionais, permissões, isolamento, reservas históricas, baixa, cancelamento e o layout móvel. O ambiente local recebeu backup restrito antes da migração; testes usam banco separado.

## Resumo compacto do pedido

No atendimento da mesa, cliques repetidos nos cards somam a quantidade da linha existente. A identidade considera produto, variação, adicionais (independentemente da ordem), observação e preço; personalizações diferentes permanecem separadas. O agrupamento também vale para inclusões pelo seletor de opções e respeita o limite de 100 unidades por linha da API, sem criar duplicatas para contornar esse limite. O resumo alinha produto, quantidade, subtotal e remoção, com observação em uma linha menor logo abaixo. No celular, os controles se reorganizam sem rolagem horizontal. O agrupamento atua apenas no pedido em montagem, preservando o histórico dos pedidos já confirmados.

## Leitura rápida e baixa de fichas

O botão **Ler ficha** aparece no cabeçalho da gestão da mesa (administração e garçom) e no cabeçalho de Pedidos, para perfis com `ticket.view` e `ticket.redeem`. Abre um leitor contínuo com aviso explícito de baixa automática: cada código válido resolve a ficha e registra imediatamente sua entrega pelo endpoint existente. No modal da mesa, códigos de outra mesa são recusados antes de enviar a baixa. As validações de disponibilidade, preparo, pagamento, permissão, estabelecimento, responsável e uso único continuam no servidor.

Leitores USB/Bluetooth que funcionam como teclado usam o campo focado; o token completo emitido pelo sistema é processado ao terminar a leitura, inclusive com prefixos AIM e terminadores usuais. Enter ou colar também enviam. Durante a operação, novas leituras ficam bloqueadas; o foco retorna para a próxima ficha. O painel mostra o resultado com produto, mesa/comanda, contador e as últimas cinco entregas, sem exibir ou persistir os tokens. Fichas lidas na sessão não geram outra tentativa de baixa. Nenhuma baixa fica enfileirada offline.

A opção Câmera solicita apenas vídeo, prefere a câmera traseira no celular e decodifica QR Code com [jsQR](https://github.com/cozmo/jsQR) e Code 128 com [ZXing](https://github.com/zxing-js/browser/tree/v0.1.5), carregados sob demanda. As imagens são processadas no navegador. Os tracks e o temporizador são encerrados ao parar, mudar para o leitor físico, fechar ou navegar, inclusive se a permissão responder depois de fechar a câmera. Falhas de permissão/dispositivo apresentam orientação para retomar pelo leitor físico. A câmera exige [contexto seguro: HTTPS ou localhost](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

A tela **Conferir ficha** do garçom compartilha esse decodificador e funciona sem a API nativa opcional `BarcodeDetector`. Nessa tela, a leitura preenche o código e desliga a câmera; o garçom consulta a ficha e confirma a entrega separadamente. A permissão de câmera é solicitada para cada origem, incluindo portas diferentes do ambiente local.

Os testes usam fichas de banco isolado e vídeo simulado com imagens efetivas de QR e Code 128, passando pelo decodificador real. Cobrem baixa e atualização do atendimento, repetição, código inválido, outra mesa, preparo pendente, permissão negada, parada dos tracks e cancelamento de inicialização. Os dispositivos físicos reais dependem do navegador, foco, permissão e qualidade de enquadramento.

## Financeiro da conta

O administrador geral acessa `/financeiro`, no grupo Financeiro da navegação. O painel segue os tokens, tema, fonte e cor primária do sistema e possui sete abas funcionais: Visão geral, Vendas, Pagamentos, Contas a receber, Caixa, Fluxo de recebimentos e Fechamentos. Os gráficos e indicadores consultam dados reais; estados vazios não simulam faturamento.

O filtro de datas utiliza dias completos no fuso `America/Sao_Paulo`, inclusive a data final, com até 366 dias. A unidade pode ser qualquer estabelecimento da mesma conta. Operações de caixa continuam usando a sessão da unidade autenticada; ao consultar outra unidade, sangria, suprimento, abertura e fechamento não são oferecidos. As permissões operacionais existentes de caixa e pagamentos permanecem válidas para a equipe.

- Faturamento líquido: lançamentos CHARGE menos CREDIT e DISCOUNT pela data do lançamento. Um cancelamento posterior afeta o período em que o crédito foi registrado, sem reescrever o passado.
- Recebido líquido: pagamentos confirmados menos estornos aprovados ocorridos no período. Pagamentos divididos entre comandas são contados uma única vez.
- Em aberto: saldo atual das comandas em atendimento; não é a diferença entre os outros dois indicadores nem se restringe às datas selecionadas. A aba Contas a receber consulta saldos atuais.
- Ticket médio: faturamento líquido dividido pelos pedidos lançados no período. Mesas atendidas conta sessões iniciadas, podendo haver mais de uma utilização da mesma mesa.
- Caixa: fundo de abertura mais dinheiro recebido, estornos em dinheiro, suprimentos e sangrias. Pix e cartão não aumentam dinheiro físico. O fechamento exibe esperado, contado e diferença.
- Linhas de pagamentos: o valor estornado e o líquido atual incluem todos os estornos já efetuados naquele pagamento; os indicadores do período seguem a data de cada evento.

As listas oferecem busca, situação, forma/tipo, ordenação, paginação e CSV da página filtrada. O CSV neutraliza fórmulas em textos informados por usuários. No celular, as tabelas viram cartões. As ações de caixa usam os modais com máscara monetária, proteção de alterações, validação, idempotência e auditoria existentes.

A autorização é a relação persistida `tenant_memberships.is_account_admin`; não é uma permissão de perfil e não pode ser delegada pelo cadastro de equipe. A migration `0007_account_finance.sql` reconhece o titular original por seu evento `tenant.provisioned` no histórico. Se esse evento não existir, o acesso permanece negado até a identificação administrativa do titular. Novas contas marcam explicitamente o proprietário no provisionamento. Um perfil local chamado Administrador, mesmo com todas as permissões, não recebe acesso. O administrador SaaS também não recebe acesso implícito às finanças de outra conta.

API exclusiva do titular: `GET /finance/context`, `/finance/dashboard` e `/finance/records`. Todas as consultas verificam a relação de conta habilitada no banco e restringem os dados por tenant e unidade. A escolha de outra unidade não permite acessar outra conta. Datas e filtros são validados; listagens são paginadas no servidor. O atributo `isAccountAdmin` em `/me` e no login serve apenas para apresentar a navegação, nunca como autorização enviada pelo navegador.

Este painel cobre faturamento e recebimentos já registrados. Contas a pagar, despesas e DRE contábil não são apresentados como dados existentes sem um livro de despesas e custos correspondente.

## Revisão de fechamento da mesa

**Encerrar atendimento**, **Revisar fechamento** e **Ir para fechamento** abrem o mesmo modal de revisão. A consulta usa `GET /tables/:id/closing-review`, sem mudar o estado do atendimento. O modal mostra total, pago e saldo, além de comandas com saldo não resolvido, fichas não entregues/canceladas, pedidos não finalizados e pagamentos em processamento/conciliação. Os atalhos permitem receber o saldo sem perder a revisão, voltar às entregas ou consultar o pedido envolvido. Pedidos em montagem na própria tela também impedem a finalização, sem descartar o carrinho.

Quando não há pendências e o perfil permite, **Finalizar e liberar mesa** executa `POST /tables/:id/finalize` com o ID da ocupação revisada. A conferência e a liberação usam a mesma transação, os bloqueios, auditoria e idempotência existentes. Uma nova pendência ou outra ocupação impede o fechamento; uma tentativa bloqueada não deixa alterações parciais. Ao concluir, todas as comandas são encerradas, a mesa fica livre e a interface retorna ao salão. As rotas anteriores de checkout e release permanecem compatíveis. A liberação de uma ocupação já conferida continua respeitando a permissão de liberação separada da permissão de receber/conferir.

## Caixas operacionais

`/caixa` usa uma área própria no padrão do design system: cabeçalho com ações, indicadores, turno em operação, últimas movimentações e histórico. O turno selecionado mostra nome do caixa, responsável, abertura, dinheiro esperado e composição do valor. Sangria, suprimento, abertura e fechamento usam os modais existentes, com máscara monetária, validação, feedback e proteção de alterações.

As abas Turnos, Movimentações e Caixas mantêm as consultas separadas. O histórico tem busca por caixa/responsável/referência, filtros de caixa, situação e data de abertura, ordenação e paginação. A consulta de movimentos permite filtrar tipo, caixa e data, e cada linha identifica seu turno. O modal Extrato mostra valores esperado, contado e diferença, responsáveis pela abertura/fechamento e movimentos somente daquele turno. Turnos encerrados não oferecem ações de movimentação. O cadastro de caixas permite criar, renomear e abrir um turno diretamente no caixa disponível; caixas já abertos não aparecem nas opções para nova abertura.

O dinheiro esperado usa exatamente a regra do fechamento: fundo inicial + CASH + REFUND + WITHDRAWAL + SUPPLY, respeitando os sinais dos lançamentos. Pix e cartão vinculados ao turno são discriminados separadamente. Os indicadores abrangem a unidade autenticada: caixas cadastrados, turnos abertos, soma do dinheiro esperado nos turnos abertos e quantidade de fechamentos com diferença no histórico. Datas e horas são apresentadas em Brasília. Listagens viram cartões no celular, preservando a cor primária e os temas do sistema.

`GET /cash/sessions` continua retornando uma lista compatível e acrescenta nomes, totais por tipo, quantidade de movimentos, valor esperado e diferença calculados no servidor. As consultas e somas são restritas por tenant e estabelecimento. A tela continua exigindo `cash.manage`; um operador de caixa não recebe acesso ao painel financeiro exclusivo do administrador geral. Nenhuma migration ou alteração de movimentos/fechamentos antigos é necessária para a mudança visual.

## Cupons de consumo

Pedidos e comandas possuem emissão de cupom em modal com prévia, 58/80 mm, download de PDF, impressão pelo navegador e fila térmica. As ações são oferecidas nos detalhes do pedido e na gestão da mesa, inclusive para a comanda histórica a partir de um pedido encerrado. O rodapé de download/impressão permanece visível no celular. A emissão preserva os fluxos de pagamento e de baixa de ficha. Consulte [Cupons por pedido e comanda](receipts.md) para composição de valores, permissões e configuração do agente.

## Consulta operacional de pagamentos

A rota `/pagamentos` usa `PaymentsWorkspace` com os mesmos tokens de tema, tipografia, cabeçalho, ícones Lucide e paginação da tela de caixas. Os indicadores consideram os filtros atuais: bruto aprovado, estornos aprovados, líquido e alertas de conciliação. O período filtra a data de confirmação (ou criação quando ainda não confirmado), em America/Sao_Paulo; os estornos são os acumulados desses recebimentos, não um fluxo de caixa do dia.

A listagem oferece busca por mesa/comanda/pedido/referência, forma de pagamento, situação, datas, grupos, ordenação e CSV dos resultados filtrados. No celular, cada linha vira um cartão. O detalhe mostra alocações e histórico de estornos. O modal de estorno consulta novamente o pagamento, apresenta o saldo disponível por comanda, usa moeda com Maska, exige motivo e confirmação, protege alterações não salvas e mantém as validações do servidor.

`GET /payments` e `GET /payments/:id` conservam os campos e as permissões existentes (`payment.receive`) e acrescentam referências, estornos, líquido e saldo estornável calculados no servidor. Os vínculos sempre usam tenant e unidade autenticados. Comandas encerradas continuam bloqueadas para estorno pelo fluxo operacional; recebimentos em dinheiro exigem turno aberto. A ação só aparece para quem possui `payment.refund`. Nenhuma permissão do painel financeiro da conta foi ampliada.

## Detalhe do pedido e ficha incorporada

O modal de pedido, aberto tanto na gestão da mesa quanto em `/pedidos/:id`, usa `order-detail.tsx`: cabeçalho com cupons, indicadores de total/unidades/entregas, itens com preço unitário e observações, filtros de fichas e visualização lateral. No celular o conteúdo se empilha e a seleção leva à área da ficha, mantendo as ações do rodapé acessíveis.

A primeira ficha disponível é selecionada ao abrir um pedido confirmado. O seletor com busca e “Ver ficha” permitem trocar de unidade e consultar o documento autorizado, mostrando QR Code ou Code 128 no próprio modal. O usuário pode confirmar entrega pelo fluxo existente, solicitar segunda via com motivo ou abrir o endereço dedicado da ficha na tela de pedidos. Fichas já entregues exibem a situação e ocultam os códigos de consumo. O pedido aberto é atualizado por eventos e pela consulta periódica, inclusive quando outro operador registra a entrega. A ficha selecionada acompanha essas mudanças; erros permitem nova tentativa. A troca de seleção limpa o documento anterior, e respostas atrasadas são descartadas.

As permissões `ticket.view`, `ticket.redeem` e `ticket.reprint` são preservadas e o servidor continua validando cada ação. Usuários sem consulta de fichas não recebem indicadores de entrega fictícios. Os mesmos componentes atendem os dois pontos de entrada; os contratos da API e as regras financeiras/estoque permanecem existentes.

## Produção / cozinha e bar

A rota administrativa `/producao` e o aplicativo da cozinha (porta local 5176) utilizam `ProductionWorkspace`, mantendo tema, fonte, ícones Lucide e componentes existentes. A tela contém indicadores da seleção, busca por produto/observação/adicional/referência, filtros de setor, mesa e situação, ordenação e filas separadas de início e preparo. Cada cartão corresponde a uma unidade/ficha, com a mesa e comanda atuais, observações destacadas, adicionais históricos e tempo total desde a entrada. O tempo não representa um SLA nem apenas a duração da etapa de preparo.

`GET /production/jobs` mantém a permissão `production.manage`, os campos originais e a seleção de jobs ativos. `production-context.ts` acrescenta referências e datas ISO em duas consultas, com todos os joins limitados ao tenant/unidade. Nenhum token de resgate ou valor financeiro é retornado. A cozinha não precisa mais consultar individualmente os documentos de cada ficha para desenhar a fila.

As transições continuam em `/production/jobs/:id/status`: PENDING → PREPARING → READY. As ações são bloqueadas durante o envio daquele cartão, quando offline ou quando a situação não permite preparo. Somente após a confirmação do servidor a fila é atualizada. Concluir libera a ficha para o garçom e não registra entrega. Observações, reservas/baixas de estoque, permissões e auditoria continuam sujeitos às regras existentes. Eventos e consulta periódica atualizam ambos os aplicativos; falhas de leitura preservam os últimos dados e oferecem nova tentativa.

Arquivos principais: `packages/ui/src/production-workspace.tsx`, `production-view.ts`, `kitchen-app.tsx`, `admin-app.tsx`, `styles.css`, `apps/api/src/production-context.ts` e a rota em `app.ts`. Os testes cobrem busca/tempo, isolamento e ausência de tokens, transições, uso no celular, atualização entre operadores e recuperação após falha de leitura.

## PrintBridge

A aba **Impressão → PrintBridge** configura conexão por ação explícita, autorização nativa, descoberta de impressoras, vínculos, formato, papel, ativação/pausa e atividade recente. O indicador do cabeçalho abre essa aba. O provedor permanece montado durante a navegação administrativa; a fila continua atendendo fichas e cupons enquanto a aba está aberta. Configuração e credenciais de agente exigem `print.manage`. Consulte [PrintBridge](printbridge.md) para instalação, segurança, retomada e estados de impressão.

## Equipe

A rota `/equipe` utiliza `team-workspace.tsx`, com indicadores dos vínculos da unidade, identificação por nome/e-mail, busca sem distinção de acentos, filtros por perfil/situação, ordenação, paginação e cards no celular. O painel lateral reúne os detalhes do funcionário e distingue perfil operacional de administração geral da conta. Cadastro e alteração de perfil reutilizam o formulário com busca nos selects e confirmação de alterações não salvas. Ativação/desativação exige confirmação com a identificação do funcionário, bloqueia envio repetido e mantém feedback de erro/sucesso. O próprio vínculo aparece protegido.

`GET /staff` conserva os campos dos vínculos e a permissão `staff.manage`, acrescentando somente nome, e-mail, nome do perfil e a identificação de admin geral, com joins por tenant/unidade e projeção explícita dos dados do usuário. Credenciais e hashes não são retornados. As alterações continuam em `POST /staff` e `PATCH /staff/:id`; a validação de hierarquia de permissões, a proteção do próprio vínculo e o controle do financeiro geral continuam no servidor. Não há migração de banco. Falhas de atualização conservam os últimos registros e oferecem nova tentativa.

## Paginação compartilhada

Todas as tabelas administrativas utilizam `Pagination` de `packages/ui/src/pagination.tsx`. O componente é controlado, aceita total local ou informado pelo servidor e compartilha um indicador SVG próprio de carregamento. A equipe passou a consultar páginas no servidor; financeiro mantém paginação no servidor. Estoques da unidade e do produto e a fila de impressão receberam paginação. Veja [inventário, contratos e exemplos](pagination.md).

### Acessos da equipe e cardápio compartilhável

A equipe oferece **Copiar credenciais** na linha e nos detalhes do funcionário. O modal monta uma mensagem com estabelecimento, nome, perfil, URL do aplicativo, e-mail e senha informada. Após cadastrar um funcionário, a senha inicial fica disponível somente nesse modal; fechar remove o estado da interface. As senhas anteriores não podem ser recuperadas: o operador informa a senha conhecida ou o admin geral escolhe explicitamente definir uma nova. Nenhuma senha é salva no storage ou inserida na URL.

A visão geral apresenta **Cardápio online**, com o endereço público da unidade e **Copiar link do cliente**. A identidade pública é consultada pelo UUID para obter o slug atual. Os links dos aplicativos usam `VITE_ADMIN_URL`, `VITE_CUSTOMER_URL`, `VITE_WAITER_URL` e `VITE_KITCHEN_URL`. Configure os quatro endereços públicos no build de produção; o desenvolvimento reconhece as portas locais dos quatro aplicativos. A cópia utiliza a API de clipboard e, quando necessário, a seleção de texto no navegador local.

### Entrega de todas as fichas

Os detalhes do pedido, tanto na tela de pedidos quanto no gerenciamento da mesa, apresentam **Marcar todas como entregues** junto às fichas pendentes. Uma única confirmação mostra o total a entregar e quantas fichas ainda dependem de cozinha. O operador autorizado conclui preparo e entrega nesse mesmo passo. A ação fica indisponível para perfis sem permissão de produção enquanto houver preparo pendente, e desaparece quando todas as fichas estão entregues ou canceladas. Contadores, códigos e lista são atualizados após a operação; a entrega individual continua disponível.

### Etiqueta de QR da mesa

No cabeçalho do gerenciamento da mesa, **QR Code da mesa** abre um modal com o QR e o link copiável. O usuário escolhe A4 para recortar, etiqueta 80 × 100 mm, térmica 58 ou 80 mm. **Visualizar PDF** usa a prévia real existente antes de habilitar o download. **Imprimir no navegador** abre uma página branca com o QR, aguarda carregar a imagem e chama a impressão. O envio direto usa uma impressora vinculada à estação ativa do PrintBridge e a fila cancelável existente. Os trabalhos aparecem como **QR da mesa**, separados de fichas e cupons. O QR continua sendo o da mesa, sem regenerar o código público nem alterar atendimentos.
