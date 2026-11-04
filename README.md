# Mesa — SaaS de bares, mesas e comandas

Implementação do plano técnico v1.0, de 27/10/2026, com **MySQL 8.4** no lugar de PostgreSQL. Monólito modular Fastify/TypeScript, quatro aplicativos React/Vite, Redis, BullMQ, Socket.IO e agente local ESC/POS.

## Ambiente local preparado neste computador

Os runtimes e os dados locais ficam em `.local/`, fora do versionamento. As credenciais ficam no `.env` protegido. Este ambiente usa MySQL na porta 33306, Redis em 36379, API em 3000 e aplicativos em 5173–5176. Depois da preparação inicial, não precisa de Docker:

```bash
pnpm local:start
pnpm local:status
pnpm local:stop
```

Os comandos preservam os dados e não interrompem processos de outros projetos. Logs ficam em `.local/logs/`. Em outro computador, siga a instalação abaixo; `.local/` não faz parte da distribuição.

## Executar localmente

Requisitos: Node.js 24, pnpm 11.23, Docker com Compose (ou MySQL 8.4 e Redis 7 disponíveis).

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
```

Edite `.env`: configure `DOCUMENT_KEY` com a saída de `openssl rand -hex 32`, `PAYMENT_WEBHOOK_SECRET` com outro segredo de pelo menos 32 caracteres e `SEED_PASSWORD` com uma senha de pelo menos 12 caracteres. Não publique esse arquivo.

```bash
docker compose -f infra/compose.yaml up -d
pnpm db:migrate
```

Para dados demonstrativos de duas empresas, configure `SEED_DEMO=true` no `.env` e execute:

```bash
pnpm db:seed
pnpm dev
```

| Aplicativo    | Endereço padrão            |
| ------------- | -------------------------- |
| Administração | http://localhost:5173      |
| Cliente       | http://localhost:5174      |
| Garçom        | http://localhost:5175      |
| Produção      | http://localhost:5176      |
| API / OpenAPI | http://localhost:3000/docs |

A raiz da administração (`/`) apresenta a landing pública do Mesa. Use `/criar-conta` para cadastrar um estabelecimento, `/entrar` para escolher a empresa no select com busca e `/gestor` para o painel exclusivo do gestor SaaS. Os outros aplicativos mantêm suas entradas por função. Veja [o portal SaaS e seu provisionamento](docs/saas-portal.md). O endereço com slug já abre diretamente o formulário de e-mail e senha, sem pedir o estabelecimento. Login demonstrativo: estabelecimento `boteco-da-esquina`, email `admin@boteco.local`, senha definida em `SEED_PASSWORD`. A segunda empresa usa `segundo-bar` e `admin@segundo.local`. O seed preserva cadastros existentes; não troca senhas nem apaga dados.

Na administração, abra uma mesa e expanda **QR Code da mesa para clientes**. O link usa o aplicativo cliente; em outro ambiente configure `VITE_CUSTOMER_URL` na construção do admin/garçom. Uma mesa ocupada exige código de participação, exibido aos participantes e funcionários autorizados. Identificar um cliente não ocupa a mesa. O link público sem mesa mostra o cardápio e permite ler uma mesa pela câmera ou fazer um pedido avulso para retirada no balcão, usando o pagamento antecipado existente.

Pagamentos online usam **Mercado Pago** quando a filial está vinculada e ativa em Complementos. Sem conexão, o modo **sandbox** fica disponível apenas fora de produção e é claramente identificado. Somente a confirmação processada pelo backend libera o pedido; a API bloqueia intents sandbox com `NODE_ENV=production`. Recebimentos manuais exigem permissão específica do funcionário.

Se 3000/5173 estiverem ocupadas, configure `API_PORT`, `API_PROXY_TARGET`, as portas Vite e `CORS_ORIGINS`. As portas dos testes de navegador são independentes: 33000 e 35173–35176.

## Sem dados de demonstração

Provisionamento inicial por CLI, com variáveis de ambiente:

```bash
TENANT_SLUG=minha-casa TENANT_NAME='Minha Casa' \
OWNER_EMAIL=proprietario@example.com OWNER_NAME='Proprietário' \
OWNER_PASSWORD='defina-uma-senha-forte' pnpm db:provision
```

A senha acima é um marcador de exemplo: defina uma credencial própria, preferencialmente injetada por secret manager. A CLI cria tenant, unidade, perfis, usuário proprietário, mesa, local de estoque e caixa. Para o gestor da plataforma, use `pnpm saas:bootstrap` com `SAAS_ROOT_EMAIL`, `SAAS_ROOT_NAME` e `SAAS_ROOT_PASSWORD` no ambiente. Essa CLI cria um tenant administrativo separado e oculto do diretório público, sem promover proprietários existentes. O gestor administra contas, planos e assinaturas em `/gestor`, com autorização no servidor e auditoria. O proprietário cria outras unidades em `POST /establishments`; a seleção da empresa direciona para a URL com o slug da unidade antes de solicitar e-mail e senha.

## Filiais

O seletor no topo do menu lateral permite criar e trocar filiais. Em **Equipe → Usuários e filiais**, o admin geral define quais filiais cada usuário pode acessar e seu perfil em cada uma. Nome, e-mail e senha são compartilhados; cardápio, estoque, caixa e financeiro ficam separados. Veja [o funcionamento e os controles de acesso](docs/filiais.md).

## Atalhos da gestão

Após o login, use **F1** para ler fichas, **F2** para mesas, **F3** para cardápio e **F4** para buscar funções. A barra fixa no rodapé mostra os atalhos com cores diferentes e permite acioná-los pelo mouse ou toque. Veja [o funcionamento e as regras de navegação](docs/atalhos-gestao.md).

## Proxy e conciliação de pagamentos

Configure os pares confiáveis em `TRUSTED_PROXIES` para que o rate limit diferencie clientes atrás do Nginx/EasyPanel. A migration `0029_gateway_operations.sql` e o worker habilitam operações Mercado Pago em fases, recuperação idempotente e conciliação automática por BullMQ. API e worker precisam ser atualizados juntos. Veja [configuração, limites e recuperação](docs/proxy-e-pagamentos.md).

## Complementos

O admin geral encontra **Complementos** no menu da gestão: um catálogo para instalar e configurar **Mercado Pago por OAuth** (checkout e estornos online na conta da filial) e **Gemini por API** (ajuda e resumos com indicadores agregados). Conexões são criptografadas e separadas por filial. A aplicação OAuth exige configuração de ambiente da plataforma; a chave Gemini é cadastrada pelo admin no modal. Veja [configuração, homologação e cuidados operacionais](docs/complementos.md).

O **Assistente IA** fica em um balão flutuante na gestão, com conversa por filial, atalhos para resumos e geração de textos. Há ações de descrição nos formulários de produtos e do negócio, além de prévia e download de imagens com modelos compatíveis. Sugestões precisam ser revisadas e aplicadas antes do salvamento normal do cadastro. Veja [chat e ações rápidas de IA](docs/assistente-ia.md).

## Estrutura

```text
apps/
  api/               HTTP, autenticação, módulos de domínio e Socket.IO
  worker/            outbox, BullMQ, expiração de checkout e retenção
  admin-web/         gestão, salão/editor, catálogo, pedidos, caixa e estoque
  customer-pwa/      identificação, cardápio, checkout sandbox, fichas e consumo
  waiter-pwa/        mesas, chamados, scanner e confirmação de entrega
  kitchen-display/   produção e produtos prontos
  print-agent/       impressão local TCP ESC/POS
packages/
  database/          migrations MySQL, escopo, transações e provisionamento
  shared/            validação, contratos, dinheiro e credenciais
  ui/                componentes e interfaces compartilhadas
infra/               Compose e Dockerfile
```

## Verificar

```bash
pnpm verify
pnpm format:check
```

Crie um banco exclusivo com nome terminado em `_test` e usuário com acesso **somente a ele**. Os testes de integração recusam execução sem `TEST_DATABASE_URL` explícita.

```bash
TEST_DATABASE_URL='mysql://bar_test:senha@127.0.0.1:3306/bar_saas_test' pnpm test:integration
pnpm exec playwright install chromium
TEST_DATABASE_URL='mysql://bar_test:senha@127.0.0.1:3306/bar_saas_test' \
TEST_REDIS_URL='redis://127.0.0.1:6379' pnpm test:e2e
```

Use também uma instância Redis exclusiva para testes. As fixtures recebem identificadores únicos; os testes não apagam o banco. Crie um banco novo para verificar migrations desde zero. A CI executa formatação, lint, tipos, testes, builds, integração MySQL e navegador.

## Deploy em produção

Há três caminhos completos abaixo. Os comandos partem da **raiz deste repositório**, em Bash. `infra/compose.yaml` é apenas para desenvolvimento (MySQL/Redis); em produção use `infra/compose.production.yaml`. Não copie o `.env`, o banco ou a pasta `.local/` deste computador para publicar uma instalação nova.

### Topologia, domínios e segredos

A publicação tem quatro frontends, uma API, um worker, MySQL 8.4 e Redis 7. Comece com uma instância de API e uma de worker; múltiplas réplicas exigem validação adicional de sessões Socket.IO e distribuição de tarefas.

| Origem de exemplo                   | Aplicativo                  | Entrada                   |
| ----------------------------------- | --------------------------- | ------------------------- |
| `https://mesa.userp.com.br`         | Administração e portal SaaS | `/`, `/entrar`, `/gestor` |
| `https://app.mesa.userp.com.br`     | Cardápio do cliente         | `/<slug>/`                |
| `https://garcom.mesa.userp.com.br`  | Garçom                      | `/<slug>/`                |
| `https://cozinha.mesa.userp.com.br` | Cozinha                     | `/<slug>/`                |

Crie DNS A (e AAAA somente se IPv6 estiver configurado) para os quatro nomes, apontando ao servidor. São **origens diferentes**, não quatro aplicações montadas em subpastas. Os nomes são exemplos: substitua-os em todas as configurações se usar outros. Somente HTTP/HTTPS e SSH administrativo precisam entrar na VM; mantenha MySQL, Redis e API privados. Habilite HTTPS antes de usar login real, câmera, instalação PWA e notificações no celular.

As quatro `VITE_*_URL` são públicas e incorporadas durante o **build**; mudar domínio exige novo build dos frontends **e do backend**, que contém seus HTMLs. `VITE_API_URL` fica vazio: cada origem usa `/api` e `/socket.io` através do proxy. `CUSTOMER_PUBLIC_URL` é a origem HTTPS do cliente usada nos QR Codes. `CORS_ORIGINS` deve conter exatamente as quatro origens, sem barra final.

Preserve `DOCUMENT_KEY` e o par `WEB_PUSH_*_KEY` entre deploys e em backup cifrado. Trocar a primeira impede ler documentos/assinaturas criptografados existentes; trocar VAPID exige renovar assinaturas push. API e worker precisam dos mesmos valores. Não coloque segredos em build args, imagens, Git, screenshots ou logs. O `.dockerignore` exclui ambientes privados e `.local/`.

### 1. VM com Docker Compose

Requisitos: Linux com Docker Engine e plugin Compose v2 ou posterior. Instale pelo [procedimento oficial do Docker para Ubuntu](https://docs.docker.com/engine/install/ubuntu/), incluindo `docker-compose-plugin` e `docker-buildx-plugin`. Para compilar na própria VM, reserve inicialmente 2 vCPU e 4 GB de RAM; isso é uma referência de partida, ajuste pela carga e pelo uso de memória do build. Use disco persistente e backups externos.

**Preparação.** Envie um checkout limpo para a VM e entre na raiz. Prepare os segredos sem imprimir seus valores. Se já houver Node 24 instalado:

```bash
node scripts/setup-production-env.mjs
```

Ou use o próprio Docker, sem instalar Node/pnpm no host:

```bash
docker run --rm --user "$(id -u):$(id -g)" \
  -v "$PWD:/work" -w /work node:24-bookworm-slim \
  node scripts/setup-production-env.mjs
```

O script cria `.env.production` a partir de `.env.production.example`, gera os segredos ausentes e o par VAPID, preserva os existentes e aplica modo `0600`. Edite os quatro `*_DOMAIN` e `WEB_PUSH_SUBJECT`. As senhas geradas são hexadecimais e podem ser usadas nas URLs sem escape; se escolher outra senha, faça o percent-encoding necessário em URLs. Não reutilize a senha root do MySQL na aplicação.

Defina esta função no terminal para os próximos comandos (refaça ao abrir outra sessão):

```bash
mesa() {
  docker compose --env-file .env.production \
    -f infra/compose.production.yaml -f infra/compose.vm.yaml "$@"
}
mesa config --quiet
mesa build
mesa up -d
mesa ps -a
mesa logs --tail=100 migrate api worker web
```

O serviço `migrate` aguarda MySQL/Redis saudáveis e aplica as migrations antes da API e do worker. Seu estado esperado é **Exited (0)**. A API tem healthcheck; o web só inicia depois dela ficar pronta. Banco e Redis têm volumes nomeados, sem portas publicadas; apenas o web fica em `127.0.0.1:8080`. O worker não é um servidor HTTP: confira seus logs. Redis usa AOF e `noeviction`, conforme a [orientação do BullMQ](https://docs.bullmq.io/guide/going-to-production).

O Compose usa o usuário MySQL da aplicação também nas migrations para simplificar o primeiro deploy. Em ambiente com separação de credenciais, forneça ao serviço `migrate` uma `DATABASE_URL` com DDL, mantendo API/worker com somente SELECT/INSERT/UPDATE/DELETE no schema. A criação de usuários e concessões é feita pelo administrador do banco.

**Proxy e TLS.** Instale Nginx e Certbot no host da VM, ajuste os domínios de `infra/nginx/edge.conf.example` e execute:

```bash
sudo apt-get update
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo cp infra/nginx/edge.conf.example /etc/nginx/conf.d/mesa.conf
sudo nginx -t
sudo systemctl reload nginx
curl -fsS -H 'Host: mesa.userp.com.br' http://127.0.0.1:8080/health/ready
sudo certbot --nginx --redirect \
  -d mesa.userp.com.br -d app.mesa.userp.com.br \
  -d garcom.mesa.userp.com.br -d cozinha.mesa.userp.com.br
sudo certbot renew --dry-run
curl -fsS https://mesa.userp.com.br/health/ready
```

Troque os quatro `-d` e o cabeçalho Host se mudou os nomes. DNS deve resolver e portas 80/443 estar liberadas para o Certbot. Não instale este proxy no servidor gerenciado pelo EasyPanel: ele já termina HTTPS. `infra/nginx/default.conf.template`, dentro da imagem web, entrega os arquivos e encaminha API, WebSocket, slugs e PWA corretamente; um fallback genérico de todas as rotas para `index.html` perde a identificação do estabelecimento.

**Criar os acessos.** Na administração, `/criar-conta` cadastra a primeira empresa sem dados demo. Para o gestor exclusivo do SaaS, leia a senha sem gravá-la no histórico:

```bash
read -rp 'E-mail do gestor SaaS: ' SAAS_ROOT_EMAIL
read -rsp 'Senha do gestor (mínimo 16 caracteres): ' SAAS_ROOT_PASSWORD; echo
export SAAS_ROOT_EMAIL SAAS_ROOT_PASSWORD
mesa exec -e SAAS_ROOT_EMAIL -e SAAS_ROOT_PASSWORD api \
  node dist/scripts/bootstrap-saas-root.js
unset SAAS_ROOT_EMAIL SAAS_ROOT_PASSWORD
```

Acesse `https://mesa.userp.com.br/gestor`. Este usuário é separado dos donos de restaurantes. Para provisionar um restaurante via CLI, use `dist/scripts/provision.js` no mesmo comando `mesa exec`, passando `TENANT_NAME`, `TENANT_SLUG`, `OWNER_NAME`, `OWNER_EMAIL` e `OWNER_PASSWORD` (mínimo 12 caracteres) com `-e`. Não execute `db:seed` em produção.

**Atualizar.** Tire e verifique um backup, coloque o acesso em manutenção no proxy e suspenda gravações. Na versão nova do checkout, mantendo `.env.production` e volumes:

```bash
mesa build
mesa stop web api worker
mesa rm -f migrate
mesa up -d
mesa ps -a
mesa logs --tail=100 migrate api worker
curl -fsS https://mesa.userp.com.br/health/ready
```

A remoção acima afeta apenas o container de migration encerrado. Com uma migration falhando, mantenha manutenção e inspecione os logs: DDL MySQL pode ter sido aplicada parcialmente. Não force a versão na tabela de migrations. Remova a manutenção somente após os testes de aceite abaixo. Não rode `down -v` nem apague os volumes: isso remove os dados. Alterar `MYSQL_PASSWORD` no arquivo não troca a senha de um banco já inicializado; faça a rotação SQL e sincronize os serviços na mesma janela.

### 2. VM sem Docker: Node + systemd + Nginx

Referência: Ubuntu Server 24.04, instalação nova. Use Node **24** pelo [download oficial](https://nodejs.org/en/download). O exemplo abaixo instala o binário oficial e verifica o checksum, para Linux x64 ou ARM64, em `/usr/local`. Execute em uma VM nova, sem outra instalação gerenciada nesse diretório:

```bash
(
  set -eu
  sudo apt-get update
  sudo apt-get install -y curl ca-certificates xz-utils openssl nginx redis-server \
    certbot python3-certbot-nginx gettext-base rsync
  case "$(uname -m)" in
    x86_64) mesa_node_arch=x64 ;;
    aarch64) mesa_node_arch=arm64 ;;
    *) echo 'Escolha manualmente a distribuição Node 24 para esta arquitetura'; exit 1 ;;
  esac
  mesa_node_dir=$(mktemp -d)
  curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt \
    -o "$mesa_node_dir/SHASUMS256.txt"
  mesa_node_file=$(awk -v arch="$mesa_node_arch" '$2 ~ ("-linux-" arch "\\.tar\\.xz$") { print $2; exit }' "$mesa_node_dir/SHASUMS256.txt")
  test -n "$mesa_node_file"
  curl -fsSL "https://nodejs.org/dist/latest-v24.x/$mesa_node_file" \
    -o "$mesa_node_dir/$mesa_node_file"
  (cd "$mesa_node_dir" && sha256sum --check --ignore-missing SHASUMS256.txt)
  sudo tar -xJf "$mesa_node_dir/$mesa_node_file" -C /usr/local --strip-components=1
  sudo corepack enable
  corepack prepare pnpm@11.23.0 --activate
  /usr/local/bin/node --version
  pnpm --version
)
```

Não dependa do NVM de um usuário interativo nos serviços. Se instalar Node em outro caminho, ajuste `ExecStart` nos dois arquivos `infra/systemd/mesa-*.service`. O checksum confere a integridade do download HTTPS; para verificar também a assinatura do distribuidor siga as instruções de assinaturas na página oficial do Node. O download acima acompanha as atualizações da série 24; a versão usada nos checks locais está registrada no relatório de validação.

Para **MySQL 8.4**, configure o [repositório oficial MySQL APT](https://dev.mysql.com/doc/mysql-apt-repo-quick-guide/en/), selecionando a série **8.4 LTS**, e então instale `mysql-server`. O `mysql-server` padrão de uma distribuição pode ser de outra versão. Confirme `mysql --version` e `redis-server --version` (Redis 7). Em `/etc/mysql/mysql.conf.d/mesa.cnf`, configure a instalação nova:

```ini
[mysqld]
bind-address=127.0.0.1
character-set-server=utf8mb4
collation-server=utf8mb4_0900_ai_ci
default-time-zone=+00:00
```

Em `/etc/redis/redis.conf`, mantenha bind local e configure `appendonly yes`, `maxmemory-policy noeviction` e `requirepass <segredo-proprio>`. Reinicie e habilite MySQL/Redis. Ajuste nomes de unidades se a distribuição usar outros:

```bash
sudo systemctl enable --now mysql redis-server
sudo systemctl restart mysql redis-server
sudo mysql
```

No cliente SQL administrativo, crie banco e usuários. Substitua os marcadores por **senhas diferentes**, preferencialmente hexadecimais; não copie literalmente:

```sql
CREATE DATABASE mesa CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'mesa'@'127.0.0.1' IDENTIFIED BY '<senha_app>';
CREATE USER 'mesa_migrate'@'127.0.0.1' IDENTIFIED BY '<senha_migration>';
GRANT SELECT, INSERT, UPDATE, DELETE ON mesa.* TO 'mesa'@'127.0.0.1';
GRANT ALL PRIVILEGES ON mesa.* TO 'mesa_migrate'@'127.0.0.1';
```

Se root usa senha, entre com `mysql -u root -p`. A conta de migration não recebe privilégios globais. Saia do cliente e prepare o usuário de serviço e o código em `/opt/mesa`:

```bash
sudo useradd --system --user-group --home-dir /opt/mesa --shell /usr/sbin/nologin mesa
sudo install -d -o mesa -g mesa /opt/mesa
sudo install -d -o root -g mesa -m 0750 /etc/mesa
```

Copie um checkout limpo para `/opt/mesa`, com leitura e escrita para o usuário `mesa` durante o build; não inclua `.local/`, `.env`, `node_modules` ou `dist` de outra máquina. Em `/opt/mesa`, instale e construa como o usuário de serviço:

```bash
sudo -u mesa -H pnpm install --frozen-lockfile
sudo -u mesa -H env \
  VITE_API_URL='' \
  VITE_ADMIN_URL=https://mesa.userp.com.br \
  VITE_CUSTOMER_URL=https://app.mesa.userp.com.br \
  VITE_WAITER_URL=https://garcom.mesa.userp.com.br \
  VITE_KITCHEN_URL=https://cozinha.mesa.userp.com.br pnpm build
```

Crie `/etc/mesa/mesa.env`, pertencente a `root:mesa`, modo `0640`, com as seguintes variáveis. Gere `DOCUMENT_KEY` e o segredo de webhook separadamente com `openssl rand -hex 32`. Para VAPID, copie o `.env.example` para um arquivo temporário protegido, execute `node scripts/setup-web-push.mjs /caminho/do/arquivo`, transfira o par para a configuração e apague a cópia temporária. Não regenere chaves já utilizadas.

```dotenv
NODE_ENV=production
API_HOST=127.0.0.1
TRUSTED_PROXIES=loopback
API_PORT=3000
DATABASE_URL=mysql://mesa:<senha_app>@127.0.0.1:3306/mesa
REDIS_URL=redis://:<senha_redis>@127.0.0.1:6379
CORS_ORIGINS=https://mesa.userp.com.br,https://app.mesa.userp.com.br,https://garcom.mesa.userp.com.br,https://cozinha.mesa.userp.com.br
CUSTOMER_PUBLIC_URL=https://app.mesa.userp.com.br
DOCUMENT_KEY=<64_hex>
PAYMENT_WEBHOOK_SECRET=<segredo_minimo_32_caracteres>
# Para pagamentos reais; API e worker precisam das mesmas configurações.
MERCADO_PAGO_CLIENT_ID=
MERCADO_PAGO_CLIENT_SECRET=
MERCADO_PAGO_REDIRECT_URI=https://mesa.userp.com.br/api/v1/complements/mercadopago/callback
MERCADO_PAGO_WEBHOOK_SECRET=
MERCADO_PAGO_TEST_MODE=false
WEB_PUSH_PUBLIC_KEY=<chave_publica_vapid>
WEB_PUSH_PRIVATE_KEY=<chave_privada_vapid>
WEB_PUSH_SUBJECT=https://mesa.userp.com.br
```

Crie também `/etc/mesa/migrate.env`, protegido e legível por `mesa`, contendo somente `DATABASE_URL=mysql://mesa_migrate:<senha_migration>@127.0.0.1:3306/mesa`. Aplique as migrations compiladas e instale os serviços:

```bash
sudo -u mesa /usr/local/bin/node --env-file=/etc/mesa/migrate.env \
  /opt/mesa/dist/packages/database/src/migrate.js
sudo cp infra/systemd/mesa-api.service infra/systemd/mesa-worker.service /etc/systemd/system/
sudo systemd-analyze verify /etc/systemd/system/mesa-api.service /etc/systemd/system/mesa-worker.service
sudo systemctl daemon-reload
sudo systemctl enable --now mesa-api mesa-worker
curl -fsS http://127.0.0.1:3000/health/ready
sudo journalctl -u mesa-api -u mesa-worker -n 100 --no-pager
```

**Publicar os quatro frontends.** Copie os builds para os diretórios esperados pelo Nginx:

```bash
sudo mkdir -p /srv/mesa/{admin,customer,waiter,kitchen}
sudo rsync -a --delete apps/admin-web/dist/ /srv/mesa/admin/
sudo rsync -a --delete apps/customer-pwa/dist/ /srv/mesa/customer/
sudo rsync -a --delete apps/waiter-pwa/dist/ /srv/mesa/waiter/
sudo rsync -a --delete apps/kitchen-display/dist/ /srv/mesa/kitchen/
sudo chmod -R a+rX /srv/mesa
export ADMIN_DOMAIN=mesa.userp.com.br CUSTOMER_DOMAIN=app.mesa.userp.com.br
export WAITER_DOMAIN=garcom.mesa.userp.com.br KITCHEN_DOMAIN=cozinha.mesa.userp.com.br
export API_UPSTREAM=127.0.0.1:3000
envsubst '${ADMIN_DOMAIN} ${CUSTOMER_DOMAIN} ${WAITER_DOMAIN} ${KITCHEN_DOMAIN} ${API_UPSTREAM}' \
  < infra/nginx/default.conf.template | sudo tee /etc/nginx/conf.d/mesa.conf >/dev/null
```

Em uma VM dedicada, desabilite `/etc/nginx/sites-enabled/default` antes de testar, pois o template define seu próprio `default_server`. Não remova configurações de outros sites. Rode `sudo nginx -t`, recarregue o Nginx e execute o mesmo Certbot com os quatro domínios do caminho Docker. O `envsubst` deve receber a lista explícita acima para preservar `$host`, `$uri` e as demais variáveis do Nginx.

Cadastre a empresa em `/criar-conta`. Para criar o gestor SaaS, use as leituras interativas de `SAAS_ROOT_EMAIL` e `SAAS_ROOT_PASSWORD` mostradas no caminho Docker e execute o bootstrap com Node, preservando as variáveis ao atravessar sudo:

```bash
sudo --preserve-env=SAAS_ROOT_EMAIL,SAAS_ROOT_PASSWORD -u mesa \
  /usr/local/bin/node --env-file=/etc/mesa/mesa.env \
  /opt/mesa/dist/scripts/bootstrap-saas-root.js
unset SAAS_ROOT_EMAIL SAAS_ROOT_PASSWORD
```

Para atualizar: manutenção no proxy, backup verificado, pare `mesa-api` e `mesa-worker`, atualize o checkout, repita instalação/build, migration com `migrate.env`, cópia dos quatro frontends e `systemctl restart mesa-api mesa-worker`. Verifique readiness, logs e os testes de aceite antes de retirar a manutenção. A cópia do código, a API e os assets devem pertencer à mesma versão. Não há rollback automático de DDL; veja [recuperação](docs/operations.md).

### 3. Hospedar no EasyPanel

O caminho recomendado aqui é **um serviço Compose**, que usa os mesmos seis serviços do deploy Docker. Assim não é preciso inventar comandos de build diferentes para cada frontend. Tutorial conferido com a [documentação oficial do serviço Compose](https://easypanel.io/docs/services/compose); a interface disponível depende da versão instalada.

1. Prepare uma VM nova e siga a [instalação oficial do EasyPanel](https://easypanel.io/docs/index). Não instale o Nginx do caminho anterior nela. Para este projeto, considere inicialmente 4 GB de RAM e 2 vCPU e monitore o build. Configure os quatro DNS.
2. Coloque este repositório, incluindo `infra/`, `tests/`, scripts e lockfile, em Git acessível ao painel. Nunca inclua os ambientes privados. Gere um `.env.production` em uma máquina confiável com o script acima, configure os domínios e mantenha uma cópia protegida dos segredos.
3. Crie um projeto, por exemplo `mesa`, e **New Service → Compose**, nome `sistema`. Escolha fonte **Git**, configure URL e branch/ref, **Build Path `/`** e **Docker Compose File `infra/compose.production.yaml`**. Em repositório privado, cadastre a chave pública do serviço como deploy key de leitura.
4. Em **Environment**, coloque o conteúdo preparado de `.env.production` e habilite **Create .env file**. O painel escreve `.env` na raiz de build para interpolação do Compose; o arquivo não entra na imagem. Aqui **não** adicione `compose.vm.yaml`: não publique 8080 nem configure `container_name`.
5. Faça **Deploy** e acompanhe a saída de build e os logs por serviço. A migration precisa terminar com código zero, API ficar saudável e worker permanecer ativo. Os volumes `mysql-data` e `redis-data` guardam os dados; não destrua o serviço nem renomeie o projeto/volumes em uma atualização.
6. Em **Domains**, adicione os quatro hostnames, cada um com caminho `/`, destino interno **`web`**, porta **80**, protocolo interno **HTTP**. Ative o certificado HTTPS e redirecionamento HTTPS no painel. O proxy preserva o Host, e o Nginx escolhe o frontend correspondente. Nenhum domínio aponta para `mysql`, `redis`, `migrate` ou `worker`.
7. Teste `https://mesa.userp.com.br/health/ready`, as quatro origens e os fluxos de aceite. Cadastre o restaurante em `/criar-conta`. Crie o gestor SaaS com a CLI compilada dentro de `api`, via SSH no servidor; use `docker ps --format '{{.ID}} {{.Names}}'` para identificar o container do projeto/serviço `api`, sem presumir um nome fixo. Leia/exporte os dados como no caminho Docker e rode:

   ```bash
   mesa_api_container=ID_OU_NOME_VERIFICADO
   docker exec -e SAAS_ROOT_EMAIL -e SAAS_ROOT_PASSWORD "$mesa_api_container" \
     node dist/scripts/bootstrap-saas-root.js
   unset SAAS_ROOT_EMAIL SAAS_ROOT_PASSWORD
   ```

8. Configure backup externo de MySQL e dos segredos e ensaie recuperação. No serviço Compose, não presuma a existência da aba de backup do serviço MySQL separado: estes bancos são containers do Compose. Use o dump por SSH descrito abaixo ou uma rotina externa apropriada. Redis também precisa de persistência e proteção dos dados de fila.
9. Para atualizar, ative manutenção no painel, pare API/worker para suspender gravações pelo SSH/Compose do serviço, tire o backup, selecione a nova versão e faça Deploy. Garanta que `migrate` seja recriado/executado para essa versão antes de iniciar API/worker; se necessário remova somente seu container encerrado via Compose. Confira logs e aceite, então retire a manutenção. Não execute outro `docker compose` em um checkout separado no servidor: ele criaria outra stack/volumes.

Se sua versão do EasyPanel não oferece Compose, atualize seguindo o fornecedor ou use o caminho VM Docker. Uma alternativa é separar serviços App/MySQL/Redis, mas exige configurar imagens, comandos, conexões privadas e migrations explicitamente; não use build Nixpacks automático para este monorepo. As capacidades de [App](https://easypanel.io/docs/services/app), [MySQL](https://easypanel.io/docs/services/mysql) e [Redis](https://easypanel.io/docs/services/redis) estão nas referências oficiais.

### Backup, recuperação e aceite de publicação

No Docker, faça um dump lógico consistente usando a função `mesa` já definida; no EasyPanel, execute o equivalente no container MySQL verificado do serviço. A senha é lida do ambiente interno e não aparece no comando do host:

```bash
mkdir -p backups
umask 077
set -o pipefail
mesa exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump -uroot --single-transaction --routines --events --triggers --no-tablespaces --set-gtid-purged=OFF "$MYSQL_DATABASE"' \
  | gzip > "backups/mesa-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
```

O dump usa root dentro do container para cobrir todo o schema; pode ser substituído por uma conta exclusiva de backup. Para a VM sem Docker use `scripts/backup.sh` com um `client.cnf` protegido, conforme [operação e restauração](docs/operations.md). Uma cópia crua do volume MySQL enquanto ele grava não substitui backup consistente. Guarde cópia cifrada fora da VM, preserve também a configuração e as chaves, defina retenção e teste restauração em um banco isolado. Snapshot/backup de Redis deve respeitar AOF e conter os arquivos persistentes completos; dados de fila não devem ser simplesmente descartados.

Antes de liberar o ambiente:

- Confirme HTTPS válido nas quatro origens e renovação de certificados; readiness retorna `{"status":"ready","database":"mysql"}` e worker permanece sem erros de conexão.
- Abra `/`, `/entrar`, `/criar-conta` e `/gestor` na administração e o mesmo `/<slug>/` nas quatro origens. Recarregue rotas internas e troque de filial: identidade e permissões devem continuar corretas.
- Verifique assets sem 404, `/sw.js` sem cache permanente, manifest identificado e instalação PWA. A resposta de um slug deve ser do aplicativo do host correto.
- Em uma conta de homologação, abra caixa/mesa, lance pedido, valide estoque, cozinha, ficha, entrega, recebimento, cupom PDF e fechamento. Confirme atualização em outro dispositivo via Socket.IO.
- Configure e permita Web Push explicitamente em um dispositivo; envie uma operação habilitada e confira recebimento e logs do worker. A readiness HTTP não testa o provedor de push.
- Para impressão remota, ative uma estação PrintBridge no computador local com impressora e mantenha o aplicativo/aba de agente em execução. O worker na nuvem não acessa USB do restaurante. Não exponha as portas nativas do PrintBridge à internet; veja [PrintBridge](docs/printbridge.md).

**Limite funcional:** o gateway online atual é sandbox e está bloqueado com `NODE_ENV=production`. Publicar o sistema não habilita cobrança real Pix/cartão. Valide a operação manual autorizada; pedidos do cliente que dependem de pagamento online exigem integração de gateway real antes do uso comercial.

### O que foi validado

Revisão realizada em 30/10/2026. Os comandos compilados, os artefatos dos quatro frontends, a inclusão de migrations/fontes/HTMLs, a configuração do Compose e a sintaxe de Nginx/systemd são verificáveis neste ambiente. O resultado dos checks executados está em [validação de deploy](docs/deploy-validation.md).

Este computador não dispõe de Docker Engine nem de uma VM/EasyPanel de destino: **não foi executado um deploy completo de containers nem publicada uma instância HTTPS externa**. O tutorial EasyPanel foi confrontado com a documentação oficial. DNS, certificados, firewall, permissões da VM, entrega push e impressora física precisam do aceite no servidor de destino descrito acima.

## Impressora local

Para impressoras instaladas no computador, use **Impressão → PrintBridge**: conecte e autorize a origem no aplicativo oficial, vincule os dispositivos e ative a fila. Fichas e cupons podem ser enviados em PDF pelo driver ou ESC/POS. Mantenha a aba aberta para receber novos trabalhos. Consulte [configuração do PrintBridge](docs/printbridge.md).

Como alternativa para térmicas de rede, cadastre uma impressora e seu setor na administração. Em **Impressão → PrintBridge → Impressão TCP/IP**, crie uma credencial de agente, exibida uma única vez. O PrintBridge não exige essa criação manual: o computador é cadastrado ao ativar a fila local. Configure `PRINT_AGENT_TOKEN`, `PRINT_API_URL`, `PRINT_PRINTER_ID` (ID devolvido por `/printers`), `PRINT_HOST` e `PRINT_PORT` no ambiente local e execute `pnpm start:print` após o build, ou `pnpm --filter @bar/print-agent start` para o código fonte. O agente suporta impressora térmica de rede via TCP/ESC/POS. Para vários dispositivos, `PRINT_PRINTERS_JSON` mapeia cada ID para seu host/porta locais. O agente reivindica somente jobs das impressoras mapeadas. A credencial fica restrita à unidade. Segunda via e retry conservam a ficha e o token; não criam outro direito de consumo. Impressoras USB instaladas no sistema podem ser utilizadas pelo PrintBridge.

## Documentação

- [Decisões de arquitetura e adaptação MySQL](docs/architecture.md)
- [Contratos e exemplos de API](docs/api.md)
- [Visão geral, indicadores e permissões por filial](docs/visao-geral.md)
- [Operação, backup e recuperação](docs/operations.md)
- [Aceite por fase e integrações externas](docs/acceptance.md)
- [Padrão visual e temas](docs/ui.md)
- [Impressão local com PrintBridge](docs/printbridge.md)

A validação com gateway real, impressora física e piloto no estabelecimento depende dos serviços e equipamentos escolhidos. A implementação fiscal, delivery, fidelidade, cobrança automática das assinaturas e demais não objetivos do MVP permanecem fora do escopo, conforme o plano.
