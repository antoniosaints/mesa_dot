# Validação dos procedimentos de deploy

Revisão em **30/10/2026**, no workspace local, com Node **24.19.0** e pnpm **11.23.0**. Procedimentos de instalação, operação e atualização: [README](../README.md#deploy-em-produção).

## Checks executados e resultado

| Verificação                      | Resultado e alcance                                                                                                                                                                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm build`                     | Passou: typecheck, compilação dos backends e build dos quatro frontends.                                                                                                                                                                                                                               |
| Artefatos de produção            | Confirmadas as CLIs compiladas de migration/provisionamento/bootstrap SaaS, migrations SQL, fonte dos PDFs e os quatro HTMLs em `dist/apps/api/web/`.                                                                                                                                                  |
| Compose base                     | `config --quiet` passou com Compose **2.40.3**, usando ambiente temporário gerado, sem ler os segredos de produção.                                                                                                                                                                                    |
| Compose VM                       | `config --quiet` passou com os dois arquivos combinados. Conferidos seis serviços, dependências de migration/readiness, ambientes compartilhados, targets `runtime`/`web` e única publicação em `127.0.0.1:8080`. O arquivo base não publica portas.                                                   |
| Geração de ambiente              | Senhas distintas em hexadecimal, chaves VAPID aceitas por `web-push`, modo `0600`, reexecução sem trocar segredos e rejeição de par VAPID incompleto sem sobrescrever o arquivo.                                                                                                                       |
| Script Web Push                  | Caminho customizado de ambiente testado em arquivo temporário; geração e reexecução preservando o par.                                                                                                                                                                                                 |
| Migration compilada              | Executada em banco exclusivo terminado em `_test`, com sucesso. Esse check verifica execução/reexecução do runner no schema de testes existente; não representa instalação nova de MySQL em VM.                                                                                                        |
| API compilada em produção        | Iniciada temporariamente com `NODE_ENV=production`, porta **33001**, banco/Redis de testes e chaves temporárias. `/health/ready` retornou `ready` e `/entrar` com superfície admin retornou HTTP 200.                                                                                                  |
| Nginx                            | Binário **1.24.0**, extraído de pacote oficial Ubuntu em `/tmp`, sem instalação no host. `nginx -t` passou com o template renderizado e com o exemplo do proxy externo. Teste usou porta **38080**, diretórios temporários e API local.                                                                |
| Roteamento dos quatro frontends  | HTTP 200 para as quatro raízes e respectivos slugs, assets referenciados, manifests e service workers. Confirmados `mesa-boot.js`, `mesa-push-sw.js` nas superfícies pertinentes e SW sem cache permanente. O proxy sobrescreveu `X-Mesa-App` inválido enviado no teste.                               |
| Entradas SaaS e tempo real       | `/entrar`, `/criar-conta` e `/gestor` passaram pelo proxy. Handshake Socket.IO por polling retornou abertura de sessão; upgrade WebSocket retornou **HTTP 101**. Não foram feitas alterações em dados de negócio.                                                                                      |
| systemd                          | `systemd-analyze verify` passou em cópias temporárias das duas unidades, substituindo apenas `/usr/local/bin/node` pelo caminho real do Node deste computador. As unidades documentadas pressupõem Node instalado em `/usr/local/bin/node` na VM. Não foram instaladas nem iniciadas no systemd local. |
| Qualidade dos arquivos alterados | ESLint dos dois scripts e Prettier de Markdown/JS/YAML passaram.                                                                                                                                                                                                                                       |

Os **22 blocos Bash** do README passaram em `bash -n`, sem executar instalação no host. O seletor de arquitetura do download oficial Node 24 foi conferido com o arquivo SHASUMS atual para x64 e ARM64; a instalação desse binário pertence à VM de destino. Os destinos dos links locais nos documentos alterados também foram conferidos.

O Compose e o Nginx foram baixados e extraídos em uma pasta temporária, sem instalar Docker Engine ou alterar os serviços do projeto. API e proxy temporários foram encerrados ao final. O arquivo `.env` do projeto e as credenciais do ambiente real foram preservados.

## Comandos de configuração para repetir na VM

Depois de gerar e revisar `.env.production`, com Docker/Compose disponíveis:

```bash
docker compose --env-file .env.production -f infra/compose.production.yaml config --quiet
docker compose --env-file .env.production \
  -f infra/compose.production.yaml -f infra/compose.vm.yaml config --quiet
```

Use `--quiet`: a saída completa de `compose config` contém segredos interpolados. Na VM, execute também `nginx -t`, `systemd-analyze verify` e os testes de aceite do README, usando os caminhos e as ferramentas instaladas nela.

## Etapas que precisam do servidor de destino

Não há Docker Engine, VM remota ou instância EasyPanel disponível neste ambiente. Portanto, **não foram executados** build das imagens, inicialização da stack em containers, reinício real de serviços systemd, publicação por EasyPanel, emissão/renovação externa de certificados, nem restauração de backup em uma VM nova. O build Node local e a validação do Compose não substituem esses testes.

O tutorial EasyPanel foi conferido com as páginas oficiais de [Compose](https://easypanel.io/docs/services/compose), [instalação](https://easypanel.io/docs/index), [App](https://easypanel.io/docs/services/app), [MySQL](https://easypanel.io/docs/services/mysql) e [Redis](https://easypanel.io/docs/services/redis). Ainda exige teste no painel da versão instalada, DNS, certificados, volumes, backups e acesso SSH do destino.

A entrega Web Push real depende de permissão e assinatura do dispositivo e de saída HTTPS do worker para o provedor. A impressão depende do computador agente/PrintBridge e de uma impressora física. Pagamentos online continuam sandbox e bloqueados em produção, conforme o README.
