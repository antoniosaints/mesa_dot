# Fotos dos produtos

Em **Cardápio → Novo produto** ou **Editar → Geral**, use **Adicionar foto** para escolher PNG, JPEG ou WebP de até 5 MB e 16 megapixels. A prévia permite ampliar, trocar, remover ou desfazer a seleção. A foto só é publicada ao salvar o produto; fechar com alterações pede confirmação.

Na listagem, clicar na miniatura abre a foto em um modal, sem abrir a edição. O nome e o botão de editar mantêm a gestão do produto. As fotos também aparecem nos cards do cardápio do cliente e no cardápio da mesa. Produtos sem foto mantêm o ícone padrão.

O navegador mantém a proporção, reduz a imagem para até 1024 pixels e envia PNG com no máximo 1,5 MB. A API valida assinatura, dimensões, CRC e descompressão antes de persistir. O servidor gera uma miniatura de até 160 pixels para reduzir o tráfego das listagens.

A migration `0028_product_photos.sql` acrescenta `products.photo_revision` e cria `product_photos`, com foto e miniatura no MySQL. Não há diretório de uploads ou volume adicional: o backup do banco já inclui as fotos. Cada produto mantém uma foto; trocar ou remover substitui o registro, sem acumular versões. O salvamento é atômico com os dados do produto, exige `catalog.manage` e respeita a filial autenticada.

As imagens são arquivos públicos de apresentação do cardápio. O endpoint usa filial, produto e revisão, sem aceitar caminhos ou URLs arbitrários. O cache usa a revisão do conteúdo, mudando a URL após uma troca. Cópias já armazenadas no navegador podem permanecer no cache após a remoção.
