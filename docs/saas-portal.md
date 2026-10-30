# Mesa: site público e gestor SaaS

Na origem da gestão (`http://localhost:5173` no ambiente local):

- `/`: landing pública Mesa, com Sora local, marca SVG e demonstração ilustrativa.
- `/criar-conta`: cria conta, administrador, unidade, perfis, mesa, estoque e caixa iniciais. Não cria dados de demonstração nem privilégios de plataforma.
- `/entrar`: escolha pesquisável do estabelecimento; abre `/{slug}/` com o login da equipe.
- `/gestor`: login exclusivo do administrador SaaS, painel de contas e indicadores.
- `/gestor/planos`: cadastro dos planos comerciais.
- `/gestor/auditoria`: alterações realizadas pelo gestor.

As origens de cliente, garçom e cozinha mantêm os fluxos existentes. A gestão de cada estabelecimento e os links por slug continuam nos próprios ambientes.

## Acesso do gestor

O gestor é um usuário `is_superadmin` em um tenant `is_platform`, criado apenas por CLI confiável. Um administrador de restaurante não recebe essa permissão. A conta de plataforma fica fora da seleção pública, dos indicadores de clientes e da resolução de PWAs.

Depois das migrações, execute `pnpm saas:bootstrap` com as variáveis `SAAS_ROOT_EMAIL`, `SAAS_ROOT_NAME` e `SAAS_ROOT_PASSWORD` no ambiente do processo. A senha precisa ter pelo menos 16 caracteres. Use um gerenciador de segredos ou um arquivo de ambiente protegido; não exponha a senha no histórico do terminal. Reexecutar não altera a senha ou os privilégios de usuários existentes.

A sessão do gestor usa `mesa-saas-root` no sessionStorage, separada da sessão de restaurante. As APIs `/saas/*` validam a permissão no servidor a cada acesso. Suspender uma conta bloqueia sessões existentes, novos logins e os acessos públicos; os registros são preservados. Reativar restaura o acesso.

## Cadastros e assinaturas

O cadastro público exige senha de pelo menos 12 caracteres, valida campos estritamente, limita tentativas e usa uma transação com chave de idempotência. A impressão digital do pedido é HMAC: não armazena senha em texto nem um hash simples da senha. Repetir o mesmo pedido não cria contas duplicadas; mudar os dados exige outra chave. Não há confirmação de e-mail ou recuperação de senha neste fluxo.

Planos, mensalidades, validade e situação da assinatura são controles comerciais. Não há cobrança automática nem aplicação automática dos limites do plano. A suspensão de acesso é explícita e confirmada pelo gestor. O painel informa esse comportamento.

A lista de contas usa busca, filtro e paginação no servidor com cancelamento de respostas antigas. Planos e auditoria usam o componente de paginação compartilhado; a auditoria é limitada aos últimos 200 eventos, conforme informado na tela.

## Hospedagem

A landing e o gestor compartilham o build `admin-web`. Publique seu `dist` na origem principal do Mesa e mantenha os outros frontends em suas respectivas origens. O template `infra/nginx/default.conf.template` seleciona o frontend pelos quatro domínios configurados e sobrescreve `X-Mesa-App` no proxy; siga o [deploy completo do README](../README.md#deploy-em-produção). Não confie em um cabeçalho enviado diretamente pelo cliente para decidir permissões.

O backend também entrega o shell admin nas rotas públicas e do gestor quando recebe `X-Mesa-App: admin` do proxy. Os assets do Vite e `/mesa-mark.svg` são servidos estaticamente nessa origem. Execute `pnpm build` antes de publicar.

## Validação

`tests/integration/saas.test.ts` cobre cadastro concorrente/idempotente, validação, isolamento, autorização, diretório, paginação, suspensão, planos, assinaturas, auditoria e entrega dos shells. `tests/e2e/saas.spec.ts` cobre o fluxo completo pelo navegador e a responsividade. Use exclusivamente `TEST_DATABASE_URL` com banco de testes para executar esses cenários.
