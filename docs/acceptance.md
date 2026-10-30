# Aceite e correspondência com o plano

As fases abaixo possuem código executável, migrations versionadas e verificações automatizadas. A conclusão de software não substitui homologação com os serviços e equipamentos do estabelecimento.

| Fase | Implementação                                                                                            | Verificação                                                                                          |
| ---- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| F0   | Workspaces pnpm, TS, lint/format, MySQL/Redis Compose, CI, ambiente, health                              | lint, typecheck e builds                                                                             |
| F1   | Identidade global, tenants/unidades, perfis e permissões, tokens/refresh, escopo e FKs                   | negação cross-tenant e cross-unit, RBAC, rotação, prevenção de escalada                              |
| F2   | Categorias/produtos, variações/adicionais, disponibilidade, salão/editor, QR público e estoque           | contratos HTTP, FKs e cadastro pelo navegador                                                        |
| F3   | Visitantes com TTL, SHARED/INDIVIDUAL, participação autorizada e ocupação na confirmação                 | identificação não ocupa; dois primeiros pedidos concorrentes                                         |
| F4   | Pré/pós-pago, sandbox, webhook HMAC, allocations, descontos, estornos, caixa e transferência de itens    | saldo exato, pagamentos divididos/parciais, assinatura e idempotência                                |
| F5   | Fichas unitárias, QR/Code128, consulta/scanner, entrega, chamados, receitas e cinco políticas de estoque | uso/claim concorrente, baixa única, cancelamento e bloqueio após estorno                             |
| F6   | Outbox transacional, BullMQ/Redis, Socket.IO autorizado e agente ESC/POS com lease/retry                 | entrega de eventos pelo worker no E2E, documentos e segunda via sem novas fichas                     |
| F7   | Fechamento com pendências, conferência, liberação explícita e aplicações responsivas                     | fluxo cliente → pagamento sandbox → chamado → garçom → entrega → fechamento → liberação no navegador |

## Cenários de aceite

- Empresas e unidades isoladas por autorização e integridade referencial.
- Identificação não ocupa; apenas confirmação ocupa a mesa.
- Pré-pago não emite ficha utilizável antes de confirmação confiável.
- Conflito operacional após captura preserva pagamento para revisão.
- Pós-pago exige permissão, regime e limite.
- Comandas coexistem, saldo é independente e pagamentos aceitam divisão/alocação parcial.
- Fichas unitárias têm token opaco e uso único; leitura não consome.
- Disputa entre garçons produz uma entrega e uma baixa; apenas um assume o chamado.
- ON_CONFIRMATION, ON_DELIVERY, ON_PRODUCTION, RECIPE e NO_CONTROL têm fluxos verificados.
- Estoque insuficiente reverte ocupação, fichas e financeiro na confirmação.
- Histórico de recebimentos, estornos, compensações, transferências e auditoria é preservado.
- Impressão pode falhar e ser retomada sem criar outro direito.
- Fechamento não libera mesa; liberação física exige ação autorizada.
- Reconstrução da API conserva confirmação e não emite fichas duplicadas.
- Administração em desktop/celular e fluxos de cliente, garçom e cozinha são verificados com Playwright.

## Homologação externa restante

1. Escolher gateway e implementar seu adapter de criação/consulta/estorno, assinatura e conciliação. O fluxo atual é sandbox e bloqueia intents em produção.
2. Homologar a impressora real ESC/POS/TCP, largura, QR/Code128 e driver. USB requer transporte específico.
3. Configurar infraestrutura real: TLS, credenciais de menor privilégio, destino/agendamento de backups e alertas.
4. Executar piloto no bar com a equipe e validar equipamento, rede e rotina de caixa.
5. Selecionar provedor para SMS/validação de telefone e cobrança recorrente das assinaturas, se desejado. O padrão atual é identificação local com QR e código de participação para mesa já ocupada.

## Limites deliberados desta versão

- Transferência move uma linha inteira (todas as unidades dela); para divisão unitária, registre linhas separadas.
- Produtos entregues/produzidos e estornos pós-encerramento exigem fluxo administrativo específico; a API bloqueia alterações que restaurariam estoque ou criariam saldo indevido.
- Listas de apresentação ainda retornam coleções completas; paginação deve ser acrescentada antes de grande escala. Verificações transacionais não truncam coleções financeiras.
- Os workspaces PWA têm manifest e fallback de navegação, mas não autorizam operações financeiras ou entrega offline.
- Assinaturas/planos têm administração e auditoria; cobrança automática e limites comerciais não são aplicados por um provedor nesta versão.
- Sem promessa de impressão física exatamente uma vez: após perda do ACK pode sair segunda via com a mesma ficha.

As integrações fiscal avançada, delivery, fidelidade, precificação dinâmica, marketplace, compras completas e analytics sofisticado foram mantidas fora do MVP, conforme a especificação.
