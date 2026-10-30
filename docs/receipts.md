# Cupons de consumo por pedido e comanda

Na gestão da mesa, use **Cupom da comanda** no cartão da conta ou **Cupom da comanda selecionada** nas ações da mesa. Nos detalhes do pedido, use **Cupom do pedido** ou **Cupom da comanda**. Os detalhes dos pedidos continuam disponíveis depois de encerrar a mesa, permitindo consultar e emitir novamente o cupom da comanda histórica.

Na tabela de pedidos, o botão de impressora abre um menu com **PDF** e **Cupom**. **PDF** abre a prévia do arquivo real em um modal; **Cupom** abre a seleção do papel e da térmica para envio direto pelo fluxo de impressão existente. Nos demais pontos de emissão, **Visualizar PDF** também abre essa prévia antes de qualquer download.

A prévia usa [PDF.js](https://mozilla.github.io/pdf.js/examples/), carregado sob demanda com worker servido pelo próprio sistema. Oferece papel de 58 ou 80 mm, zoom, navegação por páginas e texto acessível. O download só é liberado após a renderização e salva os mesmos bytes visualizados, sem gerar outro documento. Erros oferecem uma nova tentativa e não baixam um arquivo automaticamente. O modal de cupom mantém a impressão pelo navegador. Os documentos são cupons **não fiscais**, de conferência do consumo, e sua emissão não altera pagamentos, pedidos, fichas ou estoque. O PDF utiliza fonte monoespaçada incorporada para acentos e paginação com continuação; os blocos normais dos itens e os totais são mantidos juntos quando cabem na página. A geração usa [PDFKit](https://pdfkit.org/docs/text.html). A fonte Liberation Mono e sua licença SIL OFL acompanham o build do servidor.

## Valores e referências

- Comanda: itens vinculados pelas atribuições atuais, com valores dos snapshots do pedido. Transferências entre comandas não duplicam itens nem são apresentadas como cancelamentos. O livro financeiro fornece o total líquido, descontos, pagamentos, estornos e saldo; eventuais diferenças entre itens e livro aparecem em Outros ajustes.
- Pedido: itens originais do pedido. No pós-pago, não há rateio implícito dos descontos e recebimentos da comanda por pedido. No pré-pago, são mostrados pagamentos aprovados do próprio pedido, descontados os estornos. Rascunhos e pagamentos pendentes são identificados como prévia; pedidos cancelados são identificados e têm total zerado.
- Valores são calculados no servidor com decimais exatos. Datas padrão do MySQL são convertidas pelo UNIX_TIMESTAMP da sessão antes da apresentação em America/Sao_Paulo. A data de emissão é ISO UTC e também é apresentada no horário de Brasília.

## Impressão pelo navegador ou USB

1. Abra o cupom e selecione 58 ou 80 mm.
2. Escolha **Imprimir pelo navegador**.
3. Selecione a impressora térmica instalada no sistema e o papel correspondente. Use escala de 100%, sem cabeçalhos/rodapés do navegador, conforme as opções do driver.

Esta opção utiliza o diálogo de impressão do computador ou o serviço de impressão do celular. O sistema informa a abertura da janela; não consegue confirmar a saída física do papel por esse caminho. Não envia credenciais na URL da janela, e os textos do documento são escapados antes de montar o HTML.

## Envio direto com PrintBridge

Configure **Impressão → PrintBridge**, conecte ao aplicativo local, autorize a origem, vincule as impressoras e ative a fila. O botão **Enviar para térmica** enfileira o cupom para impressão local em PDF pelo driver ou em ESC/POS. Impressoras USB instaladas no computador também podem ser usadas por esse caminho. Consulte [configuração e recuperação](printbridge.md).

## Envio direto pelo agente de rede (TCP)

O mesmo agente ESC/POS das fichas passa a imprimir também cupons de consumo. Cadastre a impressora em **Impressão → Impressoras**, gere a credencial em **Agente local** e configure o vínculo do ID cadastrado com o dispositivo na rede. Exemplo de configuração, com valores ilustrativos:

```dotenv
PRINT_API_URL=http://localhost:3000/api/v1
PRINT_AGENT_TOKEN=credencial_gerada_no_painel
PRINT_PRINTER_ID=uuid_da_impressora_cadastrada
PRINT_HOST=192.168.1.50
PRINT_PORT=9100
```

Para múltiplas impressoras, utilize `PRINT_PRINTERS_JSON` com o mapa já suportado pelo agente. Depois de compilar, inicie ou reinicie o agente atualizado:

```bash
node --env-file=.env dist/apps/print-agent/src/index.js
```

Escolha a impressora no modal e pressione **Enviar para térmica**. O modal acompanha a fila, o processamento e o envio ao dispositivo. **Concluído** confirma o envio TCP, não uma inspeção física do papel. O caminho direto atende impressoras de rede ESC/POS mapeadas pelo agente; para uma impressora USB instalada no sistema, use o PrintBridge ou o diálogo do navegador.

O job guarda o conteúdo da emissão, sem tokens de fichas. Alterações posteriores no pedido, preço ou pagamento não reescrevem o papel que já foi solicitado. A fila mantém lease, idempotência, cinco tentativas e retry administrativo; uma nova tentativa que possa duplicar o envio é marcada como cópia. Durante tentativas automáticas, o botão de novo envio fica bloqueado. Fechar o modal não cancela um cupom já enfileirado. A migração 0008 permite jobs de cupom e conserva os jobs existentes de ficha, seus tokens e regras de utilização.

O ESC/POS de cupons usa texto e corte, sem código de resgate. Os acentos são transliterados para compatibilidade com o protocolo textual já usado pelo agente. O PDF e a versão do navegador preservam os acentos. Caracteres de controle nos nomes e observações são removidos antes da composição para impedir comandos da impressora dentro do conteúdo.

## Permissões e endpoints

As consultas e a emissão exigem STAFF com `table.view`, sempre na unidade autenticada. Clientes, cozinha sem essa permissão e usuários de outras unidades não têm acesso a estes documentos. A escolha operacional de impressora não permite editar dispositivos ou credenciais; essas funções continuam sujeitas a `print.manage`. Não há concessão de acesso ao painel financeiro da conta.

- `GET /orders/:id/receipt` e `/tabs/:id/receipt`: documento estruturado, `paper_width=58|80`.
- `GET /orders/:id/receipt.pdf` e `/tabs/:id/receipt.pdf`: PDF autenticado, `Cache-Control: no-store`, download sem token na URL.
- `POST /orders/:id/receipt/print` e `/tabs/:id/receipt/print`: `printer_id`, `paper_width` e Idempotency-Key.
- `GET /receipts/printers`: impressoras habilitadas da unidade, sem credenciais ou destinos TCP.
- `GET /receipts/jobs/:id`: situação de um job de cupom da mesma unidade.

O agente continua usando `/print/jobs/claim`, `/print/jobs/:id/document` e `/print/jobs/:id/finish`. O documento é lido depois do claim autenticado. A claim não inclui o conteúdo nem tokens. A autorização do agente e o vínculo do job são conferidos em cada leitura/confirmação.

## Verificação

Os testes cobrem transferências, descontos, recebimentos parciais, estornos, cancelamentos, isolamento por unidade, documentos históricos, snapshots, idempotência e segunda via. No navegador, o download gera PDF real; a impressão HTML é aberta com o diálogo simulado, e o agente real entrega os bytes ESC/POS a um servidor TCP de teste. Isso valida o caminho completo de software sem imprimir ou alterar contas do ambiente local de uso.

`node --import tsx scripts/receipt-samples.ts` gera dois PDFs explicitamente identificados como demonstração em `output/pdf/` e um documento longo de QA em `tmp/pdfs/`. Os exemplos são separados dos dados reais da aplicação.
