# Filiais e acessos da equipe

No topo do menu lateral da gestão, clique na marca e no nome da filial para abrir **Suas filiais**. A lista contém apenas filiais em que o usuário tem vínculo ativo. Há busca, indicação da filial atual e perfil em cada unidade. O seletor funciona com menu recolhido e no celular.

O administrador geral encontra **Criar nova filial** nesse dropdown. Ao criar, a filial recebe perfis iniciais (Administrador, Garçom, Caixa e Cozinha), uma área, uma mesa, um local de estoque e um caixa fechado. Não são copiados produtos, categorias, variações, saldos, movimentações, pedidos, pagamentos, clientes ou configurações de impressão. Somente o usuário que criou a filial recebe acesso inicial.

## Equipe

Em **Equipe → Usuários e filiais**, o administrador geral pesquisa os usuários da conta e define filiais e perfil de cada um. O mesmo controle pode ser aberto no botão de filiais da linha do funcionário ou nos detalhes do funcionário.

Nome, e-mail e senha pertencem à identidade compartilhada. Vínculo, situação e perfil são próprios de cada filial. Para aproveitar alguém já cadastrado em outra filial, use **Usuários e filiais**, em vez de cadastrar outro usuário com o mesmo e-mail.

Remover uma filial ou alterar um perfil revoga as sessões daquela filial. As demais continuam válidas. Um vínculo desativado é preservado para manter o histórico e pode ser reativado depois; os tokens antigos continuam revogados.

O acesso e perfil do próprio administrador na filial atual ficam protegidos. Cada filial precisa manter pelo menos um administrador geral com acesso. Um perfil operacional chamado Administrador não concede automaticamente a condição de administrador geral da conta.

O formulário compara sua versão com a dos vínculos no servidor para evitar sobrescrever alterações de outro administrador. Em caso de conflito, reabra o formulário para revisar os dados atuais. Alterações não salvas usam a confirmação de descarte padrão.

## Isolamento e autenticação

A troca chama `POST /api/v1/auth/switch-branch`, usando a sessão atual e o ID da filial escolhida. O servidor confere conta, usuário e vínculos de origem e destino e emite uma sessão nova limitada à filial. Credenciais de sessão não são persistidas nos registros genéricos de idempotência nem transportadas na URL.

O frontend guarda a sessão na chave da unidade de destino (`mesa:admin:{id}:bar-staff`) e abre o endereço canônico com slug. Essa navegação reinicia os dados, os filtros e a conexão de impressão da filial anterior. Não há cópia dos dados operacionais entre as unidades.

O backend mantém os filtros por `tenant_id` e `establishment_id`, inclusive em agregados financeiros, e rejeita referências de outra filial. O financeiro continua exclusivo do administrador geral; seu seletor lista somente filiais a que ele tem acesso e nunca soma unidades implicitamente.

Operações de filial tomam lock compartilhado da conta antes do lock da unidade. Criação de filiais e alterações de vínculos usam lock exclusivo da conta para serializar alterações simultâneas e impedir sessões concedidas durante uma revogação.

APIs: `GET /branches`, `POST /establishments`, `GET /account/users`, `GET/PATCH /account/users/:id/branches`. A lista de usuários da conta tem busca e paginação no servidor. As estruturas existentes de unidades e vínculos são reutilizadas; não há migração de dados neste recurso.

Validação: `tests/integration/branches.test.ts` e `tests/e2e/branches.spec.ts`, sempre com banco exclusivo de testes.

## Entrada pela conta

O seletor público de empresas lista uma opção por conta ativa: nome atual e logo da unidade principal (a primeira criada), sem exibir filiais ou slugs no rótulo. As opções usam nomes em maiúsculas e permitem busca; contas suspensas e a conta interna da plataforma ficam ocultas.

Após escolher a empresa, a equipe informa e-mail e senha. O login público `POST /auth/account-login` prefere a unidade principal quando o usuário tem vínculo nela. Caso tenha vínculo apenas em filiais, encaminha para a primeira filial autorizada, mantendo a sessão restrita àquela unidade. O link direto de uma filial exige vínculo nessa filial. Tokens ficam no armazenamento da origem e da unidade de destino, nunca na URL. O endpoint original `POST /auth/login` continua exigindo a unidade exata.
