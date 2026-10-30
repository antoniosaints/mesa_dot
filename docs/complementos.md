# Complementos

O menu **Complementos** funciona como catálogo de integrações. O **admin geral da conta** pode instalar, configurar, testar, ativar e desativar cada complemento. As conexões e os indicadores são separados por filial; colaboradores com perfil local de Administrador não recebem esse acesso.

## Mercado Pago por OAuth

### Configuração da plataforma

1. Crie uma aplicação em [Mercado Pago Developers](https://www.mercadopago.com.br/developers/pt/docs/security/oauth/creation), habilite OAuth com Authorization Code e PKCE e configure o retorno exatamente como `https://SEU_DOMINIO_ADMIN/api/v1/complements/mercadopago/callback`.
2. No ambiente protegido da API, preencha `MERCADO_PAGO_CLIENT_ID`, `MERCADO_PAGO_CLIENT_SECRET`, `MERCADO_PAGO_REDIRECT_URI` e `MERCADO_PAGO_WEBHOOK_SECRET`. O último é a chave de assinatura fornecida na configuração de [notificações de pagamentos](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/payment-notifications) da aplicação. Configure o evento **Pagamentos** e a URL HTTPS `https://SEU_DOMINIO_ADMIN/api/v1/webhooks/payments/mercadopago`. As preferências também enviam essa URL com a identificação da filial.
3. Defina `ADMIN_PUBLIC_URL` e `CUSTOMER_PUBLIC_URL` como as origens HTTPS reais da gestão e do cliente. O proxy deve encaminhar `/api/` à API, inclusive callback e webhook. No Docker de produção, as origens são derivadas dos domínios e as variáveis opcionais do Mercado Pago já são repassadas. Em VM ou EasyPanel, configure as mesmas variáveis de runtime e reinicie a API. Não coloque segredos em variáveis `VITE_*`.
4. Mantenha `MERCADO_PAGO_TEST_MODE=false` para produção. Para homologação, use uma aplicação e contas de teste do provedor com `true`. Uma conta de teste não recebe dinheiro real. A aplicação deve estar habilitada pelo Mercado Pago para o uso pretendido.

`DOCUMENT_KEY` deve conter 32 bytes em hexadecimal, permanecer estável e ter backup protegido. É a chave que permite descriptografar as credenciais armazenadas. Não basta recriar outra chave após uma reinstalação.

### Vinculação e uso

Na filial correta, abra **Complementos → Mercado Pago → Instalar → Conectar Mercado Pago**. O admin autoriza sua própria conta no site oficial e retorna ao Mesa. O servidor usa state de uso único, cookie de vinculação ao navegador e PKCE; a senha do Mercado Pago nunca é digitada no Mesa.

Pedidos pré-pagos do cliente passam a abrir o Checkout Pro da conta vinculada. A volta ao cardápio não comprova pagamento: a API verifica assinatura da notificação, consulta o pagamento no provedor e confere valor, moeda, referência e conta recebedora. O botão **Verificar pagamento** também permite consultar o status. Eventos repetidos não duplicam recebimentos ou fichas. Valores recebidos após expiração, estornos externos e pagamentos adicionais ficam sinalizados para revisão. O fluxo de pagamento na comanda e recebimentos manuais continua disponível; conectar Mercado Pago não transforma automaticamente os pedidos pós-pagos em pré-pagos.

Os estornos de pagamentos Mercado Pago feitos em **Pagamentos** são enviados ao provedor e registrados após confirmação, com chave de idempotência. Tarifas e prazos são os contratados pelo estabelecimento com o Mercado Pago. Não há divisão automática de valores ou comissão do SaaS.

**Desativar** bloqueia novos checkouts, preservando a autorização para conciliar e estornar pagamentos existentes. A revogação completa é feita na conta do Mercado Pago e impede essas consultas até reconectar. Filiais com pagamentos anteriores devem reconectar a mesma conta recebedora. Tokens são renovados automaticamente e criptografados no banco.

Sem a configuração OAuth, o catálogo informa a pendência e não permite conectar. Em produção não há aprovação simulada de pagamentos. O sandbox interno permanece apenas em desenvolvimento/teste, em filiais sem credenciais Mercado Pago.

## Gemini por API

1. Crie uma chave no [Google AI Studio](https://aistudio.google.com/api-keys), com acesso à [Gemini API](https://ai.google.dev/gemini-api/docs/api-key). Verifique restrições, cotas e faturamento no projeto Google.
2. Na filial, instale **Gemini**, informe a chave e use **Consultar modelos** para selecionar um modelo disponível para aquela chave. **Salvar e ativar** valida o acesso consultando a lista de modelos; não gera conteúdo nesse teste.
3. Abra o balão **Assistente IA** no canto inferior direito da gestão. Ele mantém a conversa ao navegar, permite minimizar enquanto aguarda uma resposta, copiar textos e começar uma nova conversa. Há atalhos para ajuda, resumo, texto e imagem.
4. Para imagens, consulte os modelos e escolha **Modelo para imagens (opcional)**. A lista inclui somente modelos com saída de imagem documentada e disponíveis para a chave. Se o modelo principal já gera imagens, pode mantê-lo como origem. Um modelo que apenas analisa fotos não habilita geração de imagens. A geração utiliza a API do projeto Google e pode gerar cobrança conforme o modelo e o plano. Há limite de 10 solicitações por minuto por sessão no Mesa.

Consulte o [guia do chat e das ações rápidas](assistente-ia.md) para descrições de produtos e do negócio, resumos por período e prévia/download de imagens.

A chave é criptografada no servidor, não é devolvida para o navegador e não fica em localStorage. Para manter a chave ao salvar outra configuração, deixe o campo vazio. **Remover chave** apaga a credencial dessa filial e desativa o assistente; revogar a chave no projeto Google é uma operação separada.

O modo Ajuda envia a pergunta, o histórico recente e um guia do Mesa. O modo Resumo acrescenta indicadores agregados da filial; a análise de estoque pode incluir uma amostra de produtos e locais sem saldo disponível. Não acrescenta nomes ou contatos de clientes. As ações de descrição e imagem enviam os dados preenchidos daquele produto/negócio e as orientações digitadas. Perguntas e dados enviados são processados pelo Google; não inclua segredos. Respostas, imagens e metadata podem permanecer no registro de idempotência da operação. A IA não executa alterações financeiras, pedidos ou estoque. Descrições entram no formulário somente ao clicar em **Usar descrição** e dependem do salvamento normal. Imagens são apresentadas para revisão e download, sem alterar automaticamente o cadastro.

## Operação e segurança

- Migração `0026_complements.sql`: conexões por filial, estados OAuth e dados de checkout nas intenções de pagamento. Não altera saldos ou pedidos existentes.
- Credenciais usam AES-256-GCM com contexto de conta, filial e provedor. Estados OAuth expiram em dez minutos. Auditoria não registra chaves, tokens ou códigos de autorização.
- Consultas Gemini usam reserva temporária no Redis para impedir processamento duplicado da mesma solicitação. A geração acontece fora da transação da filial, permitindo que pedidos, recebimentos e entregas continuem enquanto a IA responde. Permissão e ativação são revalidadas antes de publicar a resposta.
- Conectividade de saída da API: `auth.mercadopago.com` (navegador), `api.mercadopago.com` e `generativelanguage.googleapis.com`. Webhooks exigem acesso público HTTPS à API.
- Testes automatizados usam transportes simulados apenas em arquivos de teste. A homologação final com aplicação, conta recebedora, chave Google e transação real precisa ser feita com as credenciais do responsável.
