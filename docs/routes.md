# Navegação e operação

A interface usa React Router com URLs reais e histórico do navegador. A autenticação é mantida ao atualizar uma tela; links protegidos exibem o login antes do conteúdo. Permissões continuam sendo verificadas na API.

## Administração — porta 5173

| Tela                    | Rota                                 |
| ----------------------- | ------------------------------------ |
| Visão geral             | `/dashboard`                         |
| Salão e mesas           | `/salao`                             |
| Atendimento de uma mesa | `/salao/atendimento/:id`             |
| Pedidos                 | `/pedidos`                           |
| Pedido e suas fichas    | `/pedidos/:id`                       |
| Documento de uma ficha  | `/pedidos/:orderId/fichas/:ticketId` |
| Cardápio                | `/cardapio`                          |
| Pagamentos              | `/pagamentos`                        |
| Caixa                   | `/caixa`                             |
| Estoque                 | `/estoque`                           |
| Produção                | `/producao`                          |
| Impressão               | `/impressao`                         |
| Equipe                  | `/equipe`                            |
| Configurações           | `/configuracoes`                     |

As abas são preservadas em `?aba=...`: por exemplo, `/cardapio?aba=categorias`, `/pedidos?aba=fichas` e `/configuracoes?aba=aparencia`. Voltar e avançar restauram a tela e a aba. Uma tentativa de navegar com alterações não salvas reutiliza a confirmação de descarte dos modais.

## Outros aplicativos

- Cliente, porta 5174: `/cardapio`, `/minhas-fichas`, `/consumo`. Os parâmetros `bar` e `table` do QR são preservados ao navegar.
- Garçom, porta 5175: `/mesas`, `/mesas/:id`, `/chamados`, `/entregas`, `/conferir-ficha`.
- Cozinha, porta 5176: `/producao`.
- `/` direciona à tela inicial do aplicativo. Endereços desconhecidos oferecem um retorno ao início.

## Fluxo de atendimento

1. Em **Pedidos → Novo pedido**, escolha a mesa; também é possível abrir diretamente pelo salão.
2. Uma mesa livre recebe uma comanda compartilhada quando o primeiro pedido é confirmado. Identificação e seleção da mesa não iniciam a ocupação. Em atendimento aberto, escolha a comanda de destino antes de lançar itens.
3. Em **Novo pedido**, busque produtos e confira o resumo. Quantidades e observações podem ser ajustadas; produtos com variações ou adicionais abrem uma configuração antes de entrar no resumo. O servidor recalcula valores e valida a disponibilidade.
4. A confirmação lança o pedido, emite fichas por unidade e direciona a **Comandas e consumo**. Se a confirmação de um rascunho falhar, o botão repete a confirmação do mesmo pedido para evitar criar outro rascunho.
5. Em **Comandas e consumo**, crie contas individuais ou compartilhadas, veja os itens, registre recebimentos conferidos ou transfira linhas inteiras para outra comanda aberta da mesma sessão. Saldo, pagamento e transferências mantêm as regras do backend.
6. **Encerrar atendimento** abre o modal de revisão com saldos e pendências. Sem pendências, **Finalizar e liberar mesa** confere novamente no servidor, encerra as comandas e retorna ao salão.

As listagens de pedidos mostram mesa, comanda atual, resumo dos itens, horário, origem, estado e total. As fichas são carregadas automaticamente e indicam produto, mesa, comanda, pedido e estado de preparo/entrega. Depois de uma transferência, a referência da comanda acompanha a atribuição atual do item; o pedido original é preservado.

## Publicação

Vite local já fornece o fallback de navegação. Ao servir o build por outro servidor, direcione rotas da interface para o `index.html` correspondente a cada aplicativo, preservando o proxy `/api` e `/socket.io`. Exemplo de localização para arquivos estáticos em Nginx: `try_files $uri $uri/ /index.html;`. Não use o fallback para respostas de API.

Ícones: [Lucide React](https://lucide.dev/guide/react). Navegação: [React Router](https://reactrouter.com/start/declarative/routing).

## Fichas e entrega

Em **Pedidos → Fichas**, as mesas podem ser expandidas. Dentro de cada mesa, os atendimentos atuais e encerrados ficam separados. Expanda o atendimento para ver comandas, pedidos e fichas. Os botões **Expandir atendimentos** e **Recolher atendimentos** controlam todos os grupos; os filtros continuam disponíveis. A identidade da comanda é usada no agrupamento, evitando misturar contas que tenham o mesmo nome.

No aplicativo do **Garçom**, acesse **Entregas** ou abra uma mesa e a aba **Entregas**. Use **Marcar como entregue** ao lado do produto e, depois da entrega física, **Confirmar entrega ao cliente**. Também há o botão direto em **Chamados**. A leitura pelo scanner continua disponível em **Conferir ficha**, mas não é necessária para entregar pelas listas. Fichas em preparo não permitem entrega; solicitações assumidas por outro garçom devem ser concluídas pelo responsável.

Quando o cliente usa **Pedir para trazer**, o salão destaca a mesa com sino, contador e pulso visual, e mostra uma faixa persistente com as solicitações. Novas solicitações geram um toast. O alerta continua ao assumir o chamado e desaparece ao entregar ou cancelar a solicitação, com atualização por eventos e ressincronização periódica. A animação respeita a preferência de redução de movimento do navegador.

## Estorno durante o cancelamento

Ao abrir **Cancelar pedido**, o sistema consulta os pagamentos vinculados e as condições do pedido. Havendo valor líquido pré-pago, a própria tela oferece **Estornar pagamento**, com valor restante e motivo preenchidos. Depois de confirmar o estorno, o motivo do cancelamento é preservado e o cancelamento pode ser confirmado separadamente, quando permitido. Um estorno parcial mantém o restante visível.

A tela informa quando o perfil não pode estornar ou quando a comanda está encerrada. Produtos entregues, em preparo ou já produzidos continuam exigindo o tratamento manual previsto na operação; estornar o pagamento não altera essa regra. Nenhum estorno é executado automaticamente por tentar cancelar.

## Produto e estoque centralizados

Em `/cardapio`, as abas são Produtos, Categorias e Adicionais. Ao abrir Novo produto ou Editar, o modal concentra preços, variações, estoques por local, histórico de movimentações, ficha técnica/ingredientes e grupos vinculados. O gerenciamento de grupos e suas opções fica em `/cardapio?aba=adicionais`; as associações por produto ficam no modal. `/estoque` apresenta a visão geral dos saldos e abre o mesmo modal pela ação Gerenciar produto, diretamente em Estoques e locais.

### Financeiro exclusivo do administrador geral

- `/financeiro`: indicadores, gráficos e pedidos recentes.
- `/financeiro?aba=sales`: vendas.
- `/financeiro?aba=payments`: pagamentos e posição atual de estornos.
- `/financeiro?aba=receivables`: comandas com saldo atual.
- `/financeiro?aba=cash`: caixa e movimentações.
- `/financeiro?aba=flow`: fluxo diário de recebimentos e estornos.
- `/financeiro?aba=closures`: histórico de fechamentos e diferenças.

A rota e o menu exigem a relação de administrador geral da conta. `/caixa` e `/pagamentos` continuam sendo telas operacionais sujeitas às permissões existentes da equipe.

### Caixas operacionais

- `/caixa?aba=turnos`: turno selecionado, composição do dinheiro, últimas movimentações e histórico pesquisável.
- `/caixa?aba=movimentacoes`: consulta de movimentos por caixa, tipo, data e motivo.
- `/caixa?aba=caixas`: cadastro, edição e disponibilidade dos caixas.

O extrato abre em modal sobre a consulta. Acesso por `cash.manage`, preservando a operação dos caixas da equipe e a restrição separada do painel `/financeiro`.

## Entrada e seleção de empresa

Sem empresa na URL, a entrada do painel, do garçom e da cozinha apresenta somente um select pesquisável de empresas ativas. Não exibe campos de e-mail, senha ou slug digitável. Selecionar uma empresa navega para `/{slug}/`, preservando apenas caminhos conhecidos daquela interface e parâmetros seguros (`aba`, `table`).

Com slug ou rota estável PWA resolvidos pelo servidor, o login apresenta a identidade da empresa e apenas e-mail e senha. O contexto continua preso ao UUID verificado pela API. O link **Escolher outra empresa** abre a seleção geral com `?selecionar-empresa=1`, inclusive quando existe uma sessão legada na origem; não altera ou encerra sessões de outras empresas. O parâmetro é removido ao escolher o próximo endereço.

A lista pública `GET /api/v1/auth/establishments` contém somente nome e slug atual, sem contas desativadas, aliases históricos, IDs de tenant, usuários, e-mails ou permissões. Falhas e listas vazias exibem orientação e nova tentativa.
