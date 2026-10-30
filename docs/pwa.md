# PWA por estabelecimento e endereços automáticos

## Arquitetura preservada

O SaaS já distingue conta (`tenants.id`) e unidade (`establishments.id`), ambos UUIDs. Produtos, pedidos, estoque, clientes, financeiro, equipe e auditoria continuam vinculados a `tenant_id` + `establishment_id`. Como cardápio, nome, aparência e operação são por unidade, cada estabelecimento recebe um endereço público e um PWA dentro da conta. Não foi criada outra identidade de negócio.

`tenant_slugs` relaciona ambos os UUIDs a todos os endereços atuais e históricos. `establishments.slug` conserva o endereço atual por compatibilidade; `tenants.slug` mantém seu valor de cadastro/legado e não é autoridade para resolver o aplicativo público. Nenhuma FK de negócio passou a usar slug.

## Cadastro e alteração do nome

A normalização central remove acentos e caracteres especiais, converte para minúsculas, agrupa hífens, limita a 80 caracteres e usa `estabelecimento` como fallback. Rotas reais dos quatro aplicativos são reservadas. Colisões acrescentam `-2`, `-3` etc., respeitando o limite. O UNIQUE global do MySQL arbitra a concorrência; o código repete a reserva após colisões.

Cadastro SaaS, nova unidade e alteração em **Configurações → Negócio e aplicativo → Editar informações → Nome** usam o mesmo serviço. A linha imutável da unidade é bloqueada durante a transação. Nome, slug atual, histórico, auditoria e outbox são confirmados juntos; uma falha reverte a alteração. Há também UNIQUE sobre coluna gerada que permite apenas um slug atual por unidade. Um endereço antigo fica reservado para sempre à sua unidade e pode ser reativado pela própria unidade.

Payloads públicos não aceitam edição de slug. O parâmetro opcional `TENANT_SLUG` do provisionador administrativo é exclusivamente um alias de importação de endereços legados, não define o endereço atual. Para novos cadastros, informe somente o nome.

## Resolução e segurança

- `GET /api/v1/pwa/resolve/:slug`: resolve endereço atual ou histórico, conta ativa e identidade visual pública.
- `GET /api/v1/pwa/apps/:uuid`: identidade pública pelo UUID do estabelecimento.
- `GET /:slug/` e rotas compatíveis: HTML já contém título, favicon, Apple Touch e manifest corretos antes de executar JavaScript.
- Endereços históricos respondem **302**, sem cache, para o atual. Apenas caminhos conhecidos, `table` em formato UUID e `aba` válida de operadores sobrevivem ao redirecionamento. Tokens e destinos arbitrários são descartados. A política permanece temporária nesta versão para permitir validação operacional.
- Slug e UUID público apenas selecionam a apresentação. APIs protegidas continuam autenticando token, vínculo ativo e RBAC. `X-Mesa-Establishment` é uma comparação adicional com a unidade do ator autenticado; não concede acesso nem define seu tenant. Contexto divergente gera 403, inclusive no login e refresh.
- Não há cache de resolução na aplicação: a consulta usa índices e os metadados são atualizados pelo backend. HTML/manifest e respostas de identidade não devem ser cacheados por CDN/proxy.

## Instalação estável

O endereço compartilhável é `/{slug}/`. A instalação usa:

```text
start_url: /pwa/apps/{establishmentUUID}/
scope:     /pwa/apps/{establishmentUUID}/
id:        /pwa/apps/{establishmentUUID}/identity/{customer|admin|waiter|kitchen}
```

Renomear muda o link público, mas preserva os três identificadores interpretados pelo navegador. O botão **Instalar aplicativo** oferece a rota estável e o prompt nativo quando disponível. Nos demais navegadores mostra instruções. O cliente sem mesa consulta o cardápio sem se identificar e escolhe entre ler o QR de uma mesa (câmera ou link/código) e pedir para retirada no balcão. A identificação é solicitada ao continuar o pedido. A instalação não incorpora tokens ou acesso a um atendimento.

O manifest é dinâmico (`application/manifest+json`, `Cache-Control: no-store`), com nome, nome curto, cores e PNGs 192/512. O ícone 512 admite `any maskable`; a imagem é redimensionada dentro da área segura. Favicon 32 e Apple Touch 180 são gerados junto. Há ícone próprio de fallback. Logos normalizados são validados e armazenados como binário por unidade e revisão; URLs revisionadas são imutáveis e não expõem arquivos de outras unidades. A única dependência adicionada foi `pngjs`, já presente transitivamente, para validar e gerar PNGs no servidor.

## Configuração visual

**Configurações → Negócio e aplicativo** apresenta nome, endereço somente leitura, link copiável, QR, prévia, cores e instruções. **Personalizar aplicativo** permite nome curto, cor principal, fundo, logo ou restauração do ícone padrão. O upload aceita PNG/JPEG/WebP até 5 MB na interface e é convertido para PNG 512 antes do envio; o servidor valida tamanho, cabeçalho, descompressão e dimensões novamente. Alterações não salvas usam a confirmação existente. A permissão é `settings.update` e as alterações geram auditoria sem gravar base64 no log.

`VITE_CUSTOMER_URL` deve apontar para a origem pública do cardápio durante o build do painel; o padrão local é `http://localhost:5174`.

## Service Worker e isolamento no mesmo domínio

Um único worker por origem, com escopo `/`, substitui a estratégia anterior. Ele guarda somente assets públicos compilados com hash, nunca HTML de estabelecimento, APIs, respostas autenticadas, pedidos, pagamentos ou dados de equipe. Navegação exige rede; offline retorna uma página neutra, sem reapresentar a empresa anterior. Na ativação remove somente caches antigos pertencentes ao Mesa. Logos têm URL por UUID/revisão, e não um favicon global mutável.

Sessões usam `sessionStorage`, separadas por superfície e UUID; visitantes também por mesa. Renomear não troca a chave. Sessões legadas de operadores só são copiadas se a unidade autenticada coincide; sessões de outra unidade são ignoradas. Preferência de cor é por unidade. O tema claro/escuro permanece preferência do navegador.

**Limitação:** duas PWAs da mesma origem compartilham a infraestrutura do navegador, o worker e a capacidade de acessar armazenamento da origem. Escopo de manifest e chaves separadas fornecem contexto lógico, não uma fronteira contra XSS na mesma origem. A fronteira de acesso é autenticação/autorização no servidor. Subdomínios distintos são uma opção futura caso seja necessário isolamento de origem.

## Compatibilidade de navegadores

Validação automatizada: Chromium desktop e Chromium com viewport/agente Android Pixel 7. O cenário WebKit/iPhone 13 está preparado, mas não foi validado neste host: o MiniBrowser WebKit 27.2 inicia e fica bloqueado ao criar a página (diagnóstico de contexto de automação). Execute-o com `PWA_RUN_WEBKIT=1` em ambiente WebKit operacional; ele fica explicitamente ignorado por padrão. Os testes inspecionam o manifest interpretado pelo Chromium, IDs diferentes para duas unidades, metadados, navegação, sessão após renomear, ícones, configurações e offline. Emulação não equivale à instalação real no Android/iOS e não valida ícones no launcher do sistema operacional.

Instalar fisicamente dois aplicativos simultâneos e conferir atualizações de nome/ícone no launcher **ainda exige teste em aparelhos reais**, inclusive Chrome/Edge e Safari suportados. O botão depende de `beforeinstallprompt`; Safari usa Compartilhar → Adicionar à Tela de Início. O suporte a múltiplas instalações e a atualização dos metadados variam por navegador. Instalações genéricas anteriores a esta versão podem continuar com o manifest antigo: abra a nova rota estável e, se necessário, remova e reinstale o aplicativo. O aplicativo não promete acesso operacional offline.

Referências primárias: [identidade do manifest](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/id), [escopo](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/scope), [especificação W3C](https://www.w3.org/TR/appmanifest/) e [WebKit: aplicativos na tela inicial e identidade](https://webkit.org/blog/13878/).

## Migration 0010 e recuperação

`0010_tenant_pwa.sql` cria apenas `tenant_slugs`, `establishment_pwa_settings` e `pwa_icons`, com FKs compostas para as unidades existentes. O runner aplica o DDL com `IF NOT EXISTS` e executa o backfill na mesma conexão, em transação, antes de registrar o checksum. Todos os slugs legados são reservados antes de alocar endereços baseados nos nomes. Não altera IDs, FKs nem registros de negócio.

DDL MySQL tem commit implícito. Se o backfill falhar, a transação preserva slugs anteriores, e as tabelas novas podem permanecer vazias; a repetição conclui o processo. Reexecutar a migration aplicada verifica o checksum e não duplica dados. Não edite um arquivo já aplicado.

Antes de implantar, suspenda gravações e faça backup consistente. Em rollback de aplicação, mantenha as tabelas aditivas e os aliases. Restaurar uma versão que não entende o registro histórico pode fazer links antigos falharem: valide em cópia do backup e mantenha o resolvedor/redirects até concluir a recuperação. Não apague automaticamente tabelas, histórico ou dados de negócio.

## Produção

1. Faça backup e ensaie a migration numa cópia restaurada; compare UUIDs e contagens de pedidos/produtos/pagamentos antes e depois.
2. Defina `VITE_CUSTOMER_URL=https://app.seudominio` no build. Execute `pnpm install --frozen-lockfile` e `pnpm build`. No Docker, passe também `--build-arg VITE_CUSTOMER_URL=https://app.seudominio` (o estágio de build declara esse argumento). O build copia os quatro HTMLs para `dist/apps/api/web/{surface}/index.html`; estes devem acompanhar a API.
3. Copie os assets de `apps/{admin-web,customer-pwa,waiter-pwa,kitchen-display}/dist` para os respectivos servidores estáticos. API e frontend devem ser da mesma versão.
4. Em janela controlada, execute `node dist/packages/database/src/migrate.js` com o ambiente de banco configurado e permissões de migration. Não execute seed no banco real.
5. Adapte [o template Nginx](../infra/nginx/default.conf.template). As rotas de slug e `/pwa/` devem chegar à API, com `X-Mesa-App` sobrescrito pelo proxy (`customer`, `admin`, `waiter`, `kitchen`). Os assets compilados e o SW permanecem na origem de cada frontend. Evite um fallback SPA global que devolva HTML genérico no lugar do HTML personalizado. Não cacheie documentos, manifest ou API em CDN. A geração do template, os certificados e os três caminhos de publicação estão no [README](../README.md#deploy-em-produção).
6. Use HTTPS válido, quatro origens explícitas no CORS e credenciais de runtime com privilégios mínimos. Preserve WSS do PrintBridge; o CSP do documento gerado permite apenas os três endereços locais já usados pela integração.
7. Confira readiness, URLs atuais e históricas, login e QR legados, manifest, PNGs e duas unidades distintas. Depois valide instalação física nos dispositivos suportados antes de anunciar compatibilidade daquele navegador/OS.

## Arquivos e validação

Núcleo: `packages/shared/src/{slug,pwa}.ts`, `packages/database/src/slugs.ts`, migration 0010 e integração nos fluxos `provision`, `saas`, `settings`, `auth`, `tables` e `migrate`.

PWA: `apps/api/src/{pwa,pwa-icons}.ts`, `packages/ui/server/pwa-vite.ts`, `packages/ui/src/{pwa-context,pwa-install,pwa-settings}.tsx/ts`, identidade/armazenamento/roteamento compartilhados, quatro Vite configs, entrypoints e workers, `scripts/copy-pwa-shells.mjs`, build e este exemplo de proxy.

Testes: `tests/pwa.test.ts`, `tests/integration/pwa.test.ts`, `tests/e2e/pwa.spec.ts`; contratos de criação de unidade existentes foram atualizados para usar o slug retornado pelo servidor. Use sempre um `TEST_DATABASE_URL` exclusivo terminado em `_test`. O cenário Android usa Chromium emulado; o cenário WebKit é opt-in (`PWA_RUN_WEBKIT=1`). Dependências dos navegadores: `pnpm exec playwright install --with-deps chromium webkit`. Em ambientes com dependências extraídas separadamente, `PWA_WEBKIT_EXECUTABLE_PATH` pode indicar um launcher compatível, sem desabilitar segurança do navegador.

### Mapa dos arquivos alterados

| Área                    | Arquivos novos                                                                                                      | Integrações modificadas                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identidade e banco      | `packages/shared/src/slug.ts`, `packages/database/src/slugs.ts`, `packages/database/migrations/0010_tenant_pwa.sql` | `packages/database/src/migrate.ts`, `packages/database/src/provision.ts`, `scripts/provision.ts`, `apps/api/src/saas.ts`, `apps/api/src/tables.ts`         |
| HTTP e segurança        | `packages/shared/src/pwa.ts`, `apps/api/src/pwa.ts`, `apps/api/src/pwa-icons.ts`                                    | `apps/api/src/app.ts`, `apps/api/src/auth.ts`                                                                                                              |
| Interface compartilhada | `packages/ui/src/pwa-context.ts`, `packages/ui/src/pwa-install.tsx`, `packages/ui/src/pwa-settings.tsx`             | `packages/ui/src/admin-app.tsx`, `customer-app.tsx`, `common.tsx`, `client.ts`, `routing.tsx`, `preferences.ts`, `appearance.tsx`, `pos.tsx`, `styles.css` |
| Quatro aplicativos      | `packages/ui/server/pwa-vite.ts`                                                                                    | `vite.config.ts`, `src/main.tsx`, `public/sw.js` de admin-web, customer-pwa, waiter-pwa e kitchen-display                                                  |
| Build e operação        | `scripts/copy-pwa-shells.mjs`, `infra/nginx/pwa.conf.example`, `docs/pwa.md`                                        | `package.json`, `pnpm-lock.yaml`, `.env.example`, `docs/operations.md`                                                                                     |
| Testes                  | `tests/pwa.test.ts`, `tests/integration/pwa.test.ts`, `tests/e2e/pwa.spec.ts`                                       | `tests/integration/system.test.ts`, `tests/e2e/operation.spec.ts`, `playwright.config.ts`, `tests/e2e/test.ts`                                             |

### Resultados da validação desta entrega

- TypeScript, ESLint e build dos quatro frontends/API aprovados.
- 94 testes unitários aprovados.
- 62 testes de integração aprovados; os sete cenários de PWA foram repetidos após os ajustes finais de CORS/cache e passaram.
- Regressão de interface: todos os 37 cenários existentes foram exercitados. A rodada completa aprovou 34; os três restantes passaram nas repetições após os ajustes. os cenários de financeiro e equipe foram corrigidos para usar referências próprias, sem depender de nomes fixos ou de haver um único funcionário no perfil. A tela de endereço inexistente agora é um documento neutro com retorno ao início, sem carregar sessão de outra empresa.
- Cinco cenários novos de PWA validados: HTML/manifest e renomeação, personalização, offline, Android emulado e migração/logout da sessão legada. O cenário WebKit permanece ignorado explicitamente por limitação do host, e a instalação física em dois aplicativos continua pendente.
- O pool MySQL dos E2E passou a ter ciclo de vida por worker, permitindo executar os dois arquivos na mesma rodada sem fechar a conexão antes do segundo arquivo. A guarda de banco exclusivo terminado em `_test` permanece obrigatória.

### Ativação local

A migration 0010 foi aplicada no banco local em 28/10/2026 após backup consistente protegido em `.local/backups/`. A comparação posterior confirmou as mesmas contagens e o mesmo conjunto de UUIDs de pedidos (14), produtos (11), pagamentos (12), fichas (41), movimentos de estoque (79), comandas (14), atendimentos (10) e clientes (1). Os dois UUIDs de estabelecimento e seus nomes foram preservados.

O endereço atual de **Like Bar** passou a `/like-bar/`; `/boteco-da-esquina/` redireciona com 302 para ele. **Segundo Bar** manteve `/segundo-bar/`. Endereços genéricos e autenticação por aliases antigos continuam disponíveis. API, worker e quatro frontends locais foram reiniciados; não foi executado seed.

- Cliente: `http://localhost:5174/like-bar/`
- Gestão e configuração PWA: `http://localhost:5173/like-bar/configuracoes?aba=aplicativo-pwa`
- Instalação estável do cliente: `http://localhost:5174/pwa/apps/7b4176de-d078-4128-864f-85396f25cee0/`

O teste final de navegação confirmou também o retorno da página neutra de erro para `/dashboard` sem parâmetros. A validação de interface soma **42 cenários aprovados** (37 existentes + 5 novos); **1 cenário WebKit ignorado** explicitamente. Esses resultados incluem a rodada de regressão e as repetições dos cenários corrigidos, não uma única rodada integral sem falhas intermediárias.
