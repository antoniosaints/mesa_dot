# Paginação das tabelas

`packages/ui/src/pagination.tsx` fornece `Pagination`, `TableLoading` e `useClientPagination`. O cálculo compartilhado está em `packages/shared/src/pagination.ts`; o helper `cashPage` permanece compatível e delega ao mesmo cálculo. Não há biblioteca nova.

## Comportamento comum

O rodapé informa o intervalo real e o total filtrado, permite primeira/anterior/próxima/última página, apresenta números com reticências em conjuntos grandes e permite alterar a quantidade de registros. O tamanho muda a seleção para a página 1. Filtros e ordenação são aplicados antes do recorte. Totais menores corrigem páginas que deixaram de existir; o vazio mostra `0–0 de 0`, com os controles de navegação de limite desabilitados.

A paginação é controlada: `total`, `page` e `pageSize` são fornecidos pela tela. Os callbacks não submetem formulários, pois todos os botões têm `type="button"`. O seletor também pode usar o combobox com busca existente por meio de `searchableSize`. Cada instância tem um nome acessível próprio, útil nas páginas com mais de uma tabela. No celular, os números intermediários dão lugar à indicação de página atual/total.

`loading` bloqueia os controles e apresenta o SVG próprio do Mesa. `TableLoading` oferece a mesma identidade para o corpo da tabela e uma versão compacta. O desenho é SVG inline, usa os tokens de tema, tem texto acessível e respeita `prefers-reduced-motion`. Requisições de equipe e registros financeiros são canceladas ao substituir a consulta e respostas antigas não substituem a página atual.

## Paginação local

Use quando o conjunto completo já foi carregado e também alimenta seletores, resumos e cálculos operacionais:

```tsx
const filtered = records.filter(matchesFilters).sort(compareRows);
const paging = useClientPagination(filtered, JSON.stringify(filters));
// Renderize somente paging.rows no tbody.
<Pagination
  label="Minha listagem"
  total={paging.total}
  page={paging.page}
  pageSize={paging.pageSize}
  onPageChange={paging.onPageChange}
  onPageSizeChange={paging.onPageSizeChange}
  loading={loading}
/>;
```

O hook reinicia a página quando `resetKey` muda e normaliza a seleção quando os registros diminuem. Para telas que já controlam página e tamanho, `paginate(rows, page, size)` utiliza o mesmo modelo sem outro estado. Os filtros, indicadores e exportações que representam todo o conjunto devem continuar usando os registros filtrados completos, sem confundir a página visível com o total.

## Paginação no servidor

O mesmo `Pagination` recebe o `total` informado pelo servidor, nunca o tamanho do array da página. Ao mudar página/tamanho, a tela envia uma consulta nova; não aplique outro `slice` na resposta. Preserve o estado dos filtros, ordenação e unidade na consulta e reinicie a página ao alterar esses critérios.

A equipe usa `GET /staff?page=1&page_size=10&search=...&role_id=...&status=active&sort=name&direction=asc`. A resposta contém `{ rows, total, page, page_size, summary }`. `summary` representa todos os vínculos da unidade; `total` representa o filtro atual. A consulta sem parâmetros conserva o array anterior para clientes existentes. Páginas fora do total são ajustadas para a última válida; parâmetros inválidos são rejeitados. As colunas de ordenação são uma lista fixa e as condições são parametrizadas. Permissão `staff.manage`, isolamento de conta/unidade e projeção sem credenciais são preservados.

O financeiro já utiliza `GET /finance/records` com `page`, `page_size`, período, unidade, tipo, filtros e ordenação. Passou a compartilhar os limites de entrada e o cálculo de página. Seu acesso continua exclusivo do administrador geral da conta e os totais monetários permanecem calculados no servidor.

`apps/api/src/pagination.ts` fornece `pageFields` e `sqlPage` para outros endpoints. O chamador deve fornecer SQL previamente limitado à conta/unidade e ordenar apenas por colunas de uma lista fixa. O helper executa COUNT, corrige a página e aplica LIMIT/OFFSET. O limite de tamanho é de 100 e a página solicitada aceita inteiros de 1 a 100000. O exemplo em `apps/api/src/team.ts` é uma implementação completa.

## Inventário da revisão

| Tela / tabela                                                        | Paginação aplicada                                                         |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Salão: mesas e áreas                                                 | Componente Resource, local                                                 |
| Cardápio: produtos, categorias e variações                           | Componente comum; Resource nas sublistas                                   |
| Estoque: saldos da unidade                                           | Paginação adicionada; filtros antes do recorte                             |
| Produto: estoques por local/variação                                 | Paginação adicionada; todas as origens continuam disponíveis nos seletores |
| Produto: movimentações                                               | Componente comum; tamanho agora selecionável                               |
| Pedidos                                                              | Componente comum, preservando busca, filtros e ordenação                   |
| Pagamentos operacionais                                              | Componente comum; resumos/exportação usam todos os resultados filtrados    |
| Financeiro: vendas, pagamentos, recebíveis, movimentos e fechamentos | Servidor, com controle comum e carregamento SVG                            |
| Caixa: histórico, movimentos e extrato                               | Componente comum; filtros e totais preservados                             |
| Caixas cadastrados                                                   | Cards paginados pelo componente comum                                      |
| Equipe                                                               | Servidor, COUNT/LIMIT e contadores da unidade                              |
| Impressão: impressoras                                               | Resource com o componente comum                                            |
| Impressão: fila de trabalhos                                         | Paginação adicionada à lista de trabalhos                                  |

O Dashboard mantém a prévia explícita dos cinco últimos pedidos e a ação **Ver todos**, que abre a listagem paginada. As filas operacionais de cozinha/entrega e os agrupamentos expansíveis de fichas são cards de atendimento; permanecem com a visão operacional existente para não ocultar solicitações entre páginas. Não há outra implementação de tabela HTML fora dos componentes inventariados nesta revisão.

## Validação

Os testes cobrem limites, vazio, última página incompleta, diminuição de total, mudança de tamanho e quantidade limitada de botões em totais grandes. A integração verifica COUNT antes do recorte, ordenação sem repetição, filtros, validação de parâmetros e isolamento por unidade. No navegador são conferidos os fluxos de tabelas e modais, o SVG durante uma requisição pendente e a navegação no celular. Os dados de teste ficam no banco exclusivo de testes; nenhum cadastro ou impressão real é utilizado para ensaiar páginas extras.
