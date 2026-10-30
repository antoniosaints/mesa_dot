# Configurações do estabelecimento

**Negócio e aplicativo** reúne os dados da filial, o contato comercial, o endereço, as políticas de pagamento e a identidade do aplicativo em cards. Use **Editar informações** para abrir o cadastro organizado por identificação, contato, endereço e pagamento. Os atalhos dos cards abrem o mesmo cadastro, sem duplicar informações.

Além do nome, é possível cadastrar uma descrição de até 1.000 caracteres, telefone com DDD, e-mail comercial, CEP, rua/avenida, número (inclusive S/N), complemento, bairro, cidade e UF. Esses campos são opcionais. Telefone e CEP usam Maska e são enviados sem formatação; o CEP preserva zeros à esquerda. UF possui seleção com busca. A API também valida formatos, limites e campos desconhecidos, e atualizações parciais preservam os demais dados.

A gravação usa a permissão existente `settings.update`, sempre com o escopo da filial autenticada. Fechar o modal com alterações solicita confirmação, inclusive quando apenas contato, descrição ou endereço foi alterado. A edição mantém as políticas de pagamento e o controle manual de pedidos disponíveis no mesmo formulário.

Descrição, contato e endereço são públicos e aparecem no botão **Sobre** do cardápio do cliente. O endereço pode ser consultado em um mapa, o telefone permite ligar e o e-mail abre o aplicativo de mensagens do dispositivo. Cadastre somente informações comerciais que deseja divulgar. O botão fica oculto enquanto nenhum dado público estiver preenchido.

**Identidade visual e aplicativo** mostra a prévia com o logotipo e nome da filial, as cores, o endereço gerado, o link público e o QR Code. Use **Personalizar aplicativo** para alterar nome curto, cores e ícone; a orientação de instalação pode ser expandida no próprio card. O nome do aplicativo é o das informações do negócio. Alterar esse nome atualiza o slug, mantendo os links históricos e a instalação estável. A aba **Aparência** continua responsável pelos presets e pelo tema do painel de gestão.

O modal de personalização agrupa identificação, cores e logotipo, com prévia ao vivo do ícone e do nome curto. As cores podem ser escolhidas na paleta, nos presets ou pelo código hexadecimal. É possível arrastar uma imagem PNG, JPEG ou WebP de até 5 MB, trocar o arquivo ou restaurar o logotipo salvo. **Usar ícone padrão** também prepara uma alteração no rascunho: nenhuma mudança é aplicada antes de **Salvar aplicativo**. A cor principal salva atualiza também os destaques da filial no painel. Ao fechar com alterações pendentes, é solicitada confirmação.

Em **Funcionamento e cardápio → Editar funcionamento**, use **Aplicar o mesmo horário em vários dias** para definir até quatro períodos, funcionamento por 24 horas ou dias fechados. Marque os dias individualmente ou use **Todos os dias** e **Segunda a sexta**, e clique em **Aplicar aos dias selecionados**. Apenas esses dias são substituídos na agenda abaixo; os demais ficam preservados e cada dia continua editável individualmente.

A aplicação prepara a agenda no formulário. Clique em **Salvar funcionamento** para gravar. Há validação de horários, períodos iguais e sobreposições, inclusive os que terminam no dia seguinte. Um preenchimento compartilhado ainda não aplicado precisa ser aplicado ou revertido antes de salvar. Fechar com alterações pendentes solicita confirmação.

A migration **0024_business_profile.sql** adiciona um campo JSON opcional a `establishments`. Cadastros anteriores começam sem informações complementares, sem renomear ou alterar registros e sem compartilhar os dados entre filiais. Aplique `pnpm db:migrate` antes de usar a nova versão da API. Os procedimentos de backup e deploy estão no [README](../README.md#deploy-em-produção).
