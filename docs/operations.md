# Operação e recuperação

## Configuração

Use MySQL 8.4/InnoDB com UTF-8, SQL estrito e relógio sincronizado. A aplicação envia datas UTC e o driver retorna decimais como strings. Apresentação de horários de disponibilidade considera America/Sao_Paulo nesta versão. Sincronize os servidores: a tolerância do webhook é de cinco minutos.

A credencial de migration requer DDL no schema. A credencial de execução deve ter SELECT/INSERT/UPDATE/DELETE no schema (DELETE é necessário, por exemplo, para limpeza de assinaturas push), sem privilégios globais, FILE, administração de usuários ou DROP. Não forneça acesso SQL da aplicação aos tenants. O isolamento de aplicação usa escopo e FKs, pois MySQL não possui o RLS do plano original. Veja os três procedimentos de deploy no [README](../README.md#deploy-em-produção).

API e worker recebem `DATABASE_URL`, `REDIS_URL`, `DOCUMENT_KEY` e segredo do gateway via ambiente. Em produção exponha HTTPS através de proxy, limite CORS às quatro origens autorizadas, configure CSP no servidor estático e proteja Redis/MySQL em rede privada. O token staff expira em 30 minutos e o refresh em sete dias; visitante tem TTL configurável e expira na liberação da mesa.

A política padrão do cliente é pré-paga. Somente operadores autorizados lançam pós-pago, registram recebimentos, estornam, ajustam estoque e liberam mesas. O domínio não aceita tenant, unidade ou permissões vindos do browser como autoridade.

## Migração e rollback

`pnpm db:migrate` usa advisory lock e checksum; não altere uma migration aplicada. Sempre acrescente uma nova migration. O runner aplica statements em ordem e registra a versão somente após concluir o arquivo.

DDL MySQL tem commit implícito. Uma falha no meio de um arquivo pode deixar DDL parcialmente aplicada. Procedimento:

1. Suspenda gravações, tire backup e ensaie a versão em uma cópia restaurada.
2. Aplique em janela controlada; preserve os logs e o checksum.
3. Se houver falha parcial em ambiente novo e descartável, recrie **somente o banco descartável** e repita.
4. Com dados reais, inspecione quais statements aplicaram. Conclua o restante com revisão ou restaure o backup em outro schema e troque a conexão após conferência. Não marque uma migration como aplicada sem verificar cada constraint.
5. Para rollback de aplicação, mantenha migrations compatíveis com a versão anterior. Alterações destrutivas usam sequência expand/migrate/contract e backup validado. Não há comando automático de apagar tabelas.

## Backup automatizado

`scripts/backup.sh` gera dump consistente comprimido sem passar senha na linha de comando. Crie um arquivo de cliente com modo 0600 fora do repositório:

```ini
[client]
host=127.0.0.1
port=3306
user=backup_user
password=<segredo>
```

Execute pelo agendador da infraestrutura:

```bash
MYSQL_BACKUP_CONFIG=/caminho/protegido/client.cnf MYSQL_DATABASE=bar_saas bash scripts/backup.sh
```

Sugestão operacional: backup diário, retenção de 30 dias, cópia criptografada fora do host e binlog para recuperação pontual conforme RPO/RTO definidos pelo negócio. O script fornece a operação; configurar o agendador e o destino externo cabe à infraestrutura escolhida. Preserve também `DOCUMENT_KEY`, segredos e configurações em backup separado, cifrado e com controle de acesso.

Para restaurar, crie um schema vazio de recuperação, use `gzip -dc backup.sql.gz | mysql --defaults-extra-file=/caminho/client.cnf schema_recuperacao`, valide contagens e constraints, execute consultas de saldo e teste uma ficha fictícia em ambiente isolado antes de trocar a aplicação. Nunca ensaie restauração em cima do banco em uso. Redis pode ser reconstruído: outbox e print jobs ficam no MySQL. Persistência AOF reduz perda de filas; REST ressincroniza os aplicativos.

## Alertas e incidentes

- `/health/live`: processo HTTP ativo; `/health/ready`: MySQL acessível e conexão de tempo real com Redis pronta. Esse endpoint não comprova envio Web Push, execução do worker nem impressão física; confira também os logs e faça o teste funcional desses serviços.
- Logs Fastify são estruturados, com identificador de correlação e redaction de autorização/corpo. Erros internos não devolvem SQL nem segredo ao usuário.
- `/observability/metrics`: quantidade/idade de outbox pendente, tentativas e estados de impressão. Alertar para fila crescendo, falhas repetidas, latência de API, erro de assinatura e recebimentos com `review_reason`.
- Reiniciar API/worker não recria fichas, movimentos ou pagamentos. Consumidores e clientes devem aceitar notificações repetidas.
- Falha Redis: a confirmação financeira continua no MySQL; a outbox aguarda recuperação e o frontend usa consulta REST. Alertar para desconexão e ressincronizar após reconectar.
- Falha de impressora: preservar o job; retry/segunda via conserva a ficha. COMPLETED confirma envio ao subsistema, sem garantir saída física de papel.

## Conciliação e atendimento

Pagamento aprovado sem pedido confirmado aparece com `review_reason`. Confira valor e referência; resolva o conflito de mesa/estoque e confirme novamente se seguro, ou faça estorno autenticado. O sandbox registra estorno local; um adaptador real deve confirmar o estorno pelo provedor e conciliar eventos ausentes antes de marcar sucesso. Não invente confirmação externa.

Checkout expirado libera reservas pelo worker e cancela pedidos não pagos. Aprovação tardia é preservada para revisão. Em CLOSING, resolva pedidos pendentes, recebimentos e fichas antes de conferir novamente. A liberação manual fecha sessão e comandas e expira visitantes.

Cancelamento de produto em preparo/produzido/entregue é bloqueado nesta versão: exige conferência e política explícita de perda, compensação ou estorno administrativo. Essa validação impede devolver ao estoque um produto fisicamente indisponível.

## Privacidade

Nomes e telefones são coletados somente na identificação do visitante. Não são enviados em eventos ou logados no corpo HTTP. Após `retention_days`, o worker anonimiza clientes sem sessão ativa. Movimentos financeiros e auditoria permanecem; definir retenção legal/operacional para esses dados depende da política do estabelecimento. Restrinja acesso a backup e `DOCUMENT_KEY`.

## PrintBridge local

A integração e a migração 0009 estão documentadas em [PrintBridge](printbridge.md). Uma estação ativa processa somente os destinos vinculados. Resultados incertos exigem conferência física antes de uma nova via; aprovação nativa, certificado e acesso local do navegador continuam obrigatórios.

## Aplicativos por estabelecimento

A migração 0010, os endereços históricos, a identidade de instalação estável, a personalização e a configuração do proxy estão documentados em [PWA multi-tenant](pwa.md). O build da API deve incluir os HTMLs dos quatro aplicativos; os assets continuam sendo servidos pelas respectivas origens dos frontends.
