# Assistente IA e ações rápidas

Disponível ao **admin geral da conta**, com conexão Gemini separada por filial. Configure a chave e os modelos em **Complementos → Gemini** conforme o [guia de configuração](complementos.md).

## Chat flutuante

- Abra o botão **Assistente IA** no canto inferior direito. O painel permite conversar sem bloquear a página principal. Ele respeita os modais de cadastro e a barra de atalhos.
- Escolha **Ajuda**, **Resumo**, **Texto** ou **Imagem**. O cartão inicial oferece ajuda sobre a tela atual e resumo das últimas 24 horas. Resumos também podem considerar 7 ou 30 dias.
- No computador, Enter envia e Shift+Enter quebra a linha. No celular, use o botão de enviar; o campo acompanha o espaço disponível com o teclado aberto.
- Minimize para continuar trabalhando. Um indicador no balão sinaliza uma resposta recebida enquanto o painel estava fechado. É possível copiar respostas, baixar imagens, repetir uma solicitação que falhou e iniciar uma nova conversa.
- A conversa permanece ao navegar. Até 16 mensagens de texto são recuperadas ao recarregar a mesma aba; os dados são separados por conta, filial e usuário em `sessionStorage`. Fechar a aba pode eliminar esse histórico. Uma troca de filial não transfere conversas nem credenciais para a outra filial.
- Arquivos de imagem ficam apenas na memória do painel: **baixe antes de recarregar**. O histórico textual informa quando uma imagem anterior não está mais disponível. O envio de histórico ao Gemini é limitado a oito mensagens e 24 mil caracteres; imagens anteriores não são reenviadas.

## Ações no sistema

| Local                                                     | Ação                    | Resultado                                                                                                                                                                     |
| --------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visão geral                                               | Resumir operação com IA | Abre o chat com um resumo e prioridades da filial atual.                                                                                                                      |
| Financeiro                                                | Resumir período com IA  | Usa o período aplicado no painel, com os mesmos limites de data e horário de Brasília. Para um relatório de outra filial, acesse essa filial antes de usar sua conexão de IA. |
| Estoque                                                   | Analisar estoque com IA | Usa indicadores da filial e uma amostra de até oito saldos sem disponibilidade, com produto, local e unidade de medida.                                                       |
| Produto → Geral                                           | Gerar descrição com IA  | Cria um rascunho a partir de nome, categoria e descrição preenchidos. É possível revisar e editar antes de **Usar descrição**.                                                |
| Produto → Geral                                           | Criar imagem com IA     | Quando há modelo compatível, cria uma ilustração com prévia e download. Não adiciona uma foto automaticamente ao cadastro.                                                    |
| Configurações → Negócio e aplicativo → Editar informações | Gerar descrição com IA  | Cria uma apresentação do negócio para revisar e aplicar no campo.                                                                                                             |

Gerar uma sugestão não salva o formulário principal. **Usar descrição** preenche somente o rascunho local; depois salve o cadastro normalmente. Os limites continuam em 2.000 caracteres para produtos e 1.000 para o negócio. As confirmações de alterações não salvas continuam funcionando.

## Geração de imagens

O campo opcional de modelo de imagem permite manter um modelo para conversa e outro para imagens, usando a mesma chave da filial. O servidor cruza a disponibilidade da chave com um catálogo explícito de modelos documentados para gerar imagens. O simples suporte a `generateContent` ou a entrada de imagens não comprova saída de imagem.

A implementação usa [`generateContent` com modalidades TEXT e IMAGE](https://ai.google.dev/gemini-api/docs/generate-content/image-generation?hl=en). Modelos e compatibilidade estão em `packages/shared/src/gemini-capabilities.ts`. A disponibilidade final e a cota dependem da conta Google.

No modal, descreva a imagem e escolha quadrado 1:1, paisagem 4:3 ou banner 16:9. A prévia aparece antes do download. São aceitos PNG, JPEG e WebP de até 4 MB; respostas sem imagem válida, SVG e formatos inesperados são rejeitados. Uma geração pode levar até 90 segundos. Baixe o arquivo para utilizá-lo em material de divulgação ou em outros sistemas e confira se representa o produto.

## Operação e dados

As solicitações usam a chave somente no servidor. A geração acontece fora do bloqueio de pedidos, pagamentos e estoque. O Redis evita processamento concorrente da mesma solicitação, e a resposta fica associada à chave de idempotência; uma repetição após falha de rede reaproveita uma resposta já concluída. Pedir **outra opção** após uma geração concluída faz uma nova solicitação e pode consumir cota novamente.

O modelo não recebe ferramentas para executar comandos ou gravar cadastros. Resumos distinguem pedidos confirmados, recebimentos e estornos, com dados atuais da filial; orientações e conteúdo gerado exigem revisão. O histórico e os campos digitados pelo usuário são enviados ao Google para a tarefa solicitada. Respostas e imagens podem permanecer nos registros de idempotência do servidor.

Não há migração nova para esta melhoria: o modelo de imagem usa os ajustes JSON existentes do complemento. A homologação automatizada utiliza provedores simulados; confirme funcionamento e custos com a chave e os modelos reais do responsável.
