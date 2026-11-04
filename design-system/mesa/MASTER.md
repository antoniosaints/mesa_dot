# Mesa — design system reutilizável

Status: estilo opcional **Mesa ERP** implementado nas telas da gestão. **Visual atual** permanece como padrão.

Este padrão foi preparado com a skill `ui-ux-pro-max`, inspeção do código e das capturas locais existentes. A escolha em Configurações → Aparência é salva neste navegador, independentemente de claro/escuro e das cores de marca por filial. O `DESIGN_SYSTEM.md` da raiz registra os contratos implementados. A [prévia interativa](preview.html) permanece um protótipo com dados fictícios; as telas da aplicação usam os dados e integrações reais existentes.

## Direção

ERP/SaaS de operação rápida: superfícies sólidas, azul como marca padrão, sidebar independente, tipografia Sora, ícones Lucide e densidade compacta no computador. No celular, preservar legibilidade, contexto e área de toque. Marca, cor de categoria e estado operacional têm funções diferentes.

A pesquisa da skill recomendou minimalismo funcional para painéis empresariais. As recomendações automáticas de hero/CTA são de landing page e não se aplicam à gestão; as sugestões de trocar fonte ou adotar glassmorphism foram descartadas por conflitarem com o produto e com os padrões existentes. Não são necessárias novas bibliotecas de interface, gráficos ou animação.

## 1. Diagnóstico inicial e direção adotada

| Área                   | Implementação atual                                                                                                                                                               | Evolução proposta                                                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout e navegação     | `packages/ui/src/admin-app.tsx`, `sidebar-preference.ts`, `branch-switcher.tsx`: menu agrupado, recolhimento, drawer mobile, troca de filial e permissões                         | Extrair estrutura visual em `AppShell`, `AppSidebar` e `AppTopbar`, mantendo os mesmos destinos, providers e controles operacionais                              |
| Temas e marca          | `preferences.ts`, `appearance.tsx`, `appearance-settings.tsx`: oito presets, primária e sidebar por estabelecimento, contraste derivado e preferência individual de tema          | Uma camada semântica sobre as variáveis atuais; preservar cores salvas e cálculo de contraste                                                                    |
| Base visual            | `styles.css`: 20.313 linhas e 12 declarações `!important` na revisão; regras globais e especializadas acumuladas                                                                  | Migrar por componente para tokens, primitives, layout e módulos, retirando regras antigas somente após validar cada substituição                                 |
| Documentação           | `DESIGN_SYSTEM.md` recomenda Inter, mas implementação e `docs/ui.md` usam Sora; documento e runtime também divergem na primária e dimensões                                       | Adotar Sora e registrar explicitamente a diferença entre novo padrão e preferências já salvas                                                                    |
| Indicadores e gráficos | `dashboard-overview.tsx`/`.css`, `finance-workspace.tsx`, `payments-workspace.tsx`, `cash-workspace.tsx`: KPIs com marcações e estilos próprios; gráficos operacionais já existem | Compartilhar `StatCard` e `ChartCard`, mantendo cálculos, consultas, períodos e autorização atuais                                                               |
| Tabelas                | Módulos especializados e `resource.tsx`; `pagination.tsx` já aceita paginação local e server-side; `mobile-card-table` e layouts específicos preservam dados no celular           | Compartilhar toolbar, estados e apresentação das colunas, mantendo adapters para cada origem de dados                                                            |
| Busca e ordenação      | `Resource` possui busca e paginação locais, sem ordenação de cabeçalho; pedidos/pagamentos têm controles mais completos                                                           | Oferecer ordenação nas colunas pertinentes e declarar explicitamente quando a operação é local ou remota                                                         |
| Modais                 | `common.tsx`: foco, Escape, restauração, pilha, proteção de alterações, fechamento externo por início/fim do clique; cabeçalho mobile já compartilhado                            | Evoluir o componente existente com variantes de tamanho e estrutura; preservar essas proteções                                                                   |
| Formulários            | `forms.tsx`, `controls.tsx`, `numeric-input.tsx`, `money-input.tsx`: select com busca, Maska, normalização e validação                                                            | Compartilhar `FormField`; conectar hints/erros por ID e tornar a apresentação de erros consistente. `NumericInput` já possui `aria-invalid` e `aria-describedby` |
| Feedback e estados     | `Badge`, `Empty`, `TableLoading`, `useAction`, toasts e tags por cor existem                                                                                                      | Unificar escala visual e estados sem reimplementar ações assíncronas                                                                                             |
| Mobile                 | Correções recentes de tabelas e cabeçalhos já estão na base; testes de geometria e fluxos existem                                                                                 | Incorporar os contratos recentes ao sistema de componentes, preservando ações e campos                                                                           |

Observações: existem textos auxiliares de 9–11 px, incluindo no dashboard. A identificação da filial aparece em vários pontos e compete com o título. O cabeçalho acumula controles de operação, caixa, impressão, push e notificações; precisa de prioridades responsivas, preservando acesso a todos. A extração de componentes visa reduzir divergências, não reescrever módulos ou centralizar regras de negócio no design system.

## 2. Tokens em três camadas

1. **Primitivos:** paletas, escala de espaçamento, tamanho de fonte, raio e sombra.
2. **Semânticos:** fundo da página, superfície, texto, marca, estado, foco e borda de controle.
3. **Componentes:** altura de botão, padding de célula, largura de sidebar, espaçamento de modal.

Organização em `packages/ui/src/`: `erp-tokens.css`, `erp-components.css`, `erp-workspaces.css`, `erp-tabs.css`, `erp-motion.css` e `erp-theme.css` para o layout. `styles.css` continua sendo a base do visual atual. A fundação também é aplicada em portais por contexto React, sem regras globais que modifiquem os outros aplicativos. Evitar introduzir CSS layers parcialmente: regras antigas sem layer teriam precedência sobre as novas.

### Paleta base

| Token semântico                             | Claro     | Escuro    |
| ------------------------------------------- | --------- | --------- |
| `--color-bg`                                | `#F5F7FB` | `#090E1A` |
| `--color-surface`                           | `#FFFFFF` | `#0E1525` |
| `--color-surface-subtle`                    | `#F8FAFC` | `#131E32` |
| `--color-text`                              | `#17243B` | `#E2E8F0` |
| `--color-text-secondary`                    | `#52637A` | `#A8B6CA` |
| `--color-border` (divisórias decorativas)   | `#DCE4EF` | `#27364C` |
| `--color-control-border` (limite funcional) | `#7A899D` | `#677990` |
| `--color-brand` (padrão novo)               | `#0757F9` | `#0757F9` |
| `--color-on-brand` (padrão novo)            | `#FFFFFF` | `#FFFFFF` |
| `--color-brand-ink` (texto de link/ação)    | `#0757F9` | `#6FA8FF` |
| `--color-sidebar-bg` (padrão novo)          | `#0D1B2A` | `#0D1B2A` |
| `--color-sidebar-text` (padrão novo)        | `#E2E8F0` | `#E2E8F0` |

A coluna de marca representa apenas o padrão visual proposto. Estabelecimentos existentes continuam com sua primária, fundo da sidebar e contraste calculado. Não converter automaticamente `#2584f8` ou outro preset salvo. Tema de conteúdo e cor da sidebar continuam independentes.

Aliases de compatibilidade: `--bg` → fundo; `--panel` → superfície; `--input` → superfície de campo; `--line` → divisória; `--text` e `--muted` → textos; `--blue` → marca; `--accent-ink` → texto de marca. Na primeira migração, alimentar os novos nomes a partir dos valores atuais, pois `preferences.ts` os escreve inline. Só inverter a fonte desses aliases quando todos os consumidores estiverem preparados; evitar dependências circulares entre variáveis.

### Estados e cores de identificação

| Estado     | Claro: texto / fundo  | Escuro: texto / fundo |
| ---------- | --------------------- | --------------------- |
| Sucesso    | `#06734F` / `#DFF7EC` | `#5EE6B3` / `#10372D` |
| Atenção    | `#805400` / `#FFF3CF` | `#FCD980` / `#352B14` |
| Erro       | `#B42335` / `#FFF0F1` | `#FDA4AF` / `#391C28` |
| Informação | `#0757F9` / `#EAF0FF` | `#9AC1FF` / `#172D51` |

Usar texto e, quando útil, ícone junto da cor. Manter o mapeamento de estados reais do domínio; a nova aparência não muda quando uma ficha pode ser entregue, um pagamento aprovado ou uma mesa liberada. `RecordTag` continua identificando categoria/local com cor própria e contraste derivado; não confundir essas tags com `StatusBadge`.

### Tipografia, espaço e densidade

- Sora local, com os pesos já disponíveis; labels, controles e texto operacional em 600; títulos e indicadores em 700. Texto explicativo longo pode usar 500. Não reduzir globalmente o semibold solicitado.
- Escala: auxiliares 12 px; labels 13 px; conteúdo administrativo 14 px; conteúdo e campos no celular 16 px; seções 16–18 px; título 24–28 px; KPI 22–27 px no desktop.
- Altura de linha: texto 1,5; títulos 1,25–1,35. Valores monetários, contadores e tempo com `tabular-nums`.
- Espaçamento: 4, 8, 12, 16, 24 e 32 px. Cards de indicadores: 12 px; painéis: 16 px; entre blocos e filtros: 12 px. Evitar margem inferior de título somada ao gap do container. Usar toda a largura disponível, com recuos de 20 px no desktop e 12 px no celular.
- Raios: controles 8 px; cards 12 px; modais 16 px; badges 6 px. Opções de abas com raio de 9 px e faixa agrupada com raio de 12 px.
- Botões: 36 px em ações densas desktop; padrão 40 px; toque 44 px. Campo padrão 40 px, mobile 44 px. Botões com rótulos longos podem crescer.
- Células: padding vertical 8 px e horizontal 12 px. Meta de linha simples 44–48 px; permitir crescimento natural quando o conteúdo precisar. Nenhuma altura máxima para esconder informação.
- Sombras: cards quase planos; botões de ação com relevo e pressão por sombra interna, inspirados no Polaris; dropdown elevado; modal com sombra própria. `erp-motion.css` controla entradas de modal/menu em 120–180 ms. `AppPageContent` anima opacidade na navegação sem remontar os filhos; não animar altura/largura nem manter transform sobre o preview PDF. `prefers-reduced-motion` desativa esses movimentos.

## 3. Contratos dos componentes

### Layout

`AppShell` organiza sidebar, topbar, conteúdo e atalhos. `AppSidebar` usa largura de 248 px e modo compacto de 76 px, mantendo identidade/filial no topo. Abaixo de 901 px vira drawer com fechamento, foco e retorno ao acionador. A preferência de recolhimento por contexto existente é preservada.

`AppTopbar`: título/contexto à esquerda; estado de novos pedidos e caixa acessíveis à direita. Em espaços reduzidos, agrupar utilidades secundárias em menu acessível; avisos críticos continuam visíveis. Preservar PrintBridge, push, notificações, tema e atalhos F1–F4. Reservar espaço de conteúdo para barras fixas e para o assistente.

`PageHeader` evolui `PageTitle`: breadcrumb opcional, título, contexto breve, uma ação primária e ações secundárias. Não repetir título e subtítulo em cada painel da mesma página.

### Indicadores e gráficos

`StatCard({ label, value, detail, tone, icon, loading })`: mesma anatomia em dashboard, financeiro, caixa e pagamentos. Valor domina; detalhe explica período/cálculo; variação só aparece quando houver comparação válida.

`ChartCard`: título, período, conteúdo, legenda e estados de carregamento/erro/vazio. Reutilizar os gráficos atuais. Barras para volume, linhas apenas quando houver série temporal adequada, distribuição acompanhada de valores e texto. No celular, reduzir rótulos visuais dos eixos preservando dados em alternativa acessível. Não acrescentar séries sem dados existentes.

Priorizar no dashboard: contexto/período → pendências acionáveis → indicadores → gráficos → listas recentes. Dados financeiros continuam exclusivos do admin geral quando o contrato atual assim determina; perfis operacionais recebem os blocos autorizados pela API.

### Tabelas e listas

`DataTable` é uma camada de apresentação tipada, não uma nova camada de consultas. O chamador controla busca, filtros, ordenação e página:

```tsx
<DataTable
  columns={columns} // id, label, render, align, sortable, mobileLabel, priority
  rows={rows}
  rowKey={(row) => row.id}
  label="Registros"
  sort={sort}
  onSortChange={setSort}
  pagination={{
    total,
    page,
    pageSize,
    label: 'Registros',
    onPageChange: setPage,
    onPageSizeChange: setPageSize,
  }}
  loading={loading}
  error={error}
  onRetry={reload}
/>
```

O componente é usado pelos cadastros genéricos e pelos dispositivos push. A coluna de ações usa `render` e `TableActions`. Em modo local, filtrar/ordenar todos os registros disponíveis antes de paginar. Em modo remoto, preservar o contrato do endpoint, usar seu COUNT filtrado e nunca ordenar só a página carregada como se fosse o conjunto inteiro. Não apresentar filtros ou ordenações remotas que o endpoint não suporte. Listagens especializadas preservam seus adapters e recebem o mesmo padrão visual.

`TableToolbar`: busca, filtros relevantes, contador e ação primária, na mesma região. Filtros avançados podem recolher no celular; indicar filtros ativos e disponibilizar limpar. `TableActions`: última coluna à direita; ação frequente com texto, secundárias em menu ou grupo proporcional conforme espaço. Colunas numéricas à direita; identidade à esquerda; cabeçalhos com `aria-sort`.

Reutilizar `Pagination` e `TableLoading`. Até 700 px, tabelas simples seguem `mobile-card-table`, com `data-label`, cabeçalhos semânticos e todas as ações. Preservar limites próprios dos pedidos e do catálogo quando a largura disponível exigir cards antes. Não forçar uma tabela universal sobre agrupamentos de mesa/comanda/fichas ou sobre o canvas do salão.

### Formulários, modais e feedback

`FormField`: label, obrigatório, controle, hint e erro com IDs associados. Reutilizar `SearchSelect`, `MoneyInput`, `NumericInput`, máscara telefônica e serializadores atuais. Erro junto ao campo; em falha com vários campos, resumo acessível e foco no primeiro erro. Toast complementa o feedback, sem substituir a mensagem persistente de validação.

`Modal`: manter implementação existente, adotando tamanhos nomeados de confirmação, formulário, detalhe e gestão ampla. Cabeçalho e rodapé consistentes; no celular, título/fechar na primeira linha e ações na segunda, como já corrigido. Operações complexas de mesa mantêm três áreas desktop e os painéis mobile atuais. Não converter automaticamente todos os modais para drawer.

`StatusBadge`, `RecordTag`, `EmptyState`, `ErrorState`, `LoadingState`: uma apresentação compartilhada. Diferenciar vazio inicial, busca sem resultado e falha de consulta. Loading local preserva conteúdo/contexto quando seguro; troca de filial mantém bloqueio completo até o escopo correto estar pronto.

## 4. Responsividade e acessibilidade

- Preservar inicialmente os limites consolidados: 700 px para modais/listas simples; 900 px para sidebar; componentes complexos seguem a largura disponível e os limites já testados. Não substituir todos os breakpoints de uma vez.
- Validar 320, 390, 600, 768, 1024 e 1440 px, incluindo orientação horizontal e zoom de 200% nas tarefas principais.
- Controles de toque de 44 px na evolução proposta, sem inflar todas as linhas desktop. Foco visível, nomes acessíveis e navegação por teclado.
- Texto normal com contraste mínimo de 4,5:1; limites essenciais de controles e elementos gráficos com 3:1. Divisórias decorativas não precisam se tornar bordas escuras em todos os cards.
- Abas continuam `Tabs`/`Tab` e `system-tabs`: no Mesa ERP, `erp-tabs.css` define faixa agrupada compacta, opções de 40 px no desktop/44 px no celular e seleção com preenchimento sólido na cor primária da filial. Texto e contadores usam contraste calculado; chips selecionados usam a superfície como fundo. Preservar ícones, setas/Home/End, aba ativa visível e rolagem apenas na barra quando necessária. O visual atual mantém o indicador inferior de 2 px.
- Testar cores customizadas extremas e sidebar clara/escura separadamente. Não aplicar novos tokens por cima dos valores salvos sem respeitar `appearanceStore`.

### Contrastes calculados para a paleta base

Valores sólidos, sem transparência, calculados por luminância relativa. Não representam certificação de toda a interface.

| Par                                            | Contraste |
| ---------------------------------------------- | --------- |
| Texto claro `#17243B` / branco                 | 15,53:1   |
| Texto secundário claro `#52637A` / branco      | 6,13:1    |
| Texto secundário claro / página `#F5F7FB`      | 5,72:1    |
| Texto escuro `#E2E8F0` / superfície `#0E1525`  | 14,78:1   |
| Texto secundário escuro `#A8B6CA` / superfície | 8,86:1    |
| Branco / primária `#0757F9`                    | 5,61:1    |
| Acento escuro `#6FA8FF` / superfície           | 7,57:1    |
| Borda funcional clara / branco                 | 3,56:1    |
| Borda funcional escura / superfície            | 4,09:1    |

## 5. Adoção realizada

1. **Fundação:** tokens semânticos e de componentes, temas, contraste, densidade e foco documentados na referência da raiz.
2. **Estrutura:** sidebar/topbar compartilhadas, mantendo providers, permissões, rotas, troca de filial, persistência, utilidades e F1–F4.
3. **Indicadores e tabelas:** `StatCard`/`ChartCard`, tabelas com filtros e ações compactas, ordenação e paginação sem modificar as consultas operacionais.
4. **Formulários e detalhes:** campos, botões, modais, estados e resumo de erros, preservando máscaras, proteções de edição e fluxos de entrega/recebimento.
5. **Demais módulos:** catálogo, estoque, caixa, equipe, configurações, impressão e complementos. Os portais React acompanham o estilo da gestão; os PWAs cliente/garçom/cozinha e landing/root mantêm sua apresentação específica.

Cada fase remove somente regras substituídas e verificadas. Não acrescentar um bloco global de overrides para maquiar todas as telas; não fazer substituição automática de classes, status ou callbacks de negócio.

## 6. Critérios para considerar a implementação pronta

- Rodar lint, TypeScript, build e os testes funcionais correspondentes às áreas alteradas.
- Reutilizar `tests/e2e/modal-layout.ts`, `list-layout.ts`, `mobile-lists.spec.ts` e cenários de operação/temas/permissões já existentes, complementando apenas as lacunas necessárias.
- Comparar dados e escopos: mesma conta/filial/período, financeiro restrito, nenhuma exposição entre usuários.
- Manter CRUD, estoque concorrente, Mercado Pago/OAuth/conciliação, PrintBridge/agentes, impressão/PDF, push, atalhos, QR/câmera e recuperação das fichas do cliente.
- Conferir sidebar em drawer/compacta, filtros/ordenação/paginação, nomes extensos, loading/erro/vazio, abas, ações em modal e formulários não salvos.
- Validar os dois temas, contraste de cores configuráveis, teclado, foco e redução de movimento. Não afirmar conformidade global apenas com capturas de tela.

Na etapa inicial de proposta foram realizadas análise de código, pesquisa local da skill e cálculo de contraste. A validação da prévia isolada abaixo é distinta da validação da aplicação, que acompanha a adoção dos componentes. Os dados e interações da prévia não são operações reais do sistema.

## 7. Validação da prévia isolada

Conferência em navegador concluída em 04/11/2026:

- 320, 390, 600, 768, 1024 e 1440 px, nos temas claro e escuro: 12 combinações sem rolagem horizontal da página, ações cortadas ou transbordamento do modal nas verificações realizadas.
- Busca, filtro por entrega, ordenação, paginação, estado sem resultados, abertura/fechamento do modal, menu mobile com Escape, sidebar compacta e alternância de tema verificados.
- Layout também conferido em orientação horizontal de 844 × 390 e viewport de 720 × 480. Este último verifica a largura lógica correspondente à redução do viewport; não é uma certificação de zoom nativo de navegador.
- Fonte Sora local carregada, preferência de movimento reduzido reconhecida e nenhum erro JavaScript de página durante a execução.
- Capturas de desktop e celular em ambos os temas inspecionadas. Formatação dos dois arquivos e `git diff --check` aprovados.

Os testes acima cobrem o protótipo. A validação de permissões, integrações e fluxos reais será executada na adoção de cada componente na aplicação, conforme a seção 6.

## 8. Componentes aplicados à gestão

- O estilo **Mesa ERP** é opcional em Configurações → Aparência, com **Visual atual** como padrão. A preferência é deste navegador/origem e independe dos temas e cores da filial.
- `admin-layout.tsx` compartilha shell, sidebar, cabeçalho e utilidades; `data-display.tsx` compartilha cards, gráficos e estados; `data-table.tsx` centraliza a apresentação de tabelas; `form-field.tsx` conecta campos e validação. `interface-scope.tsx` leva a seleção do visual aos portais. A entrada `erp-theme.css` importa tokens, componentes e composições.
- O dashboard mantém consultas, valores, períodos e ações reais. No novo estilo, pendências vêm antes dos indicadores; no visual atual, a ordem anterior permanece.
- Validação: seleção/persistência e troca de filial, seis larguras em ambos os temas, gráficos preenchidos, financeiro restrito, atalhos, acesso ao PrintBridge e caixa; regressões existentes de visão geral, presets e controle operacional. Lint, TypeScript, build dos quatro frontends e testes unitários de aparência aprovados.
- Salão, pedidos/fichas, catálogo/produto, estoque/reposição, produção, financeiro, pagamentos, caixa, equipe, impressão, configurações e complementos seguem a nova apresentação. Os agrupamentos especializados, canvas, telas de PDF e contratos de dados são preservados. O visual atual e as navegações específicas dos PWAs e portal público permanecem disponíveis.
- A validação de expansão incluiu os componentes compartilhados, 11 listagens em 320/390/600 px nos dois temas, produto/variações/estoques, reposição, cozinha, financeiro, pagamentos/estorno parcial, caixa, equipe/senha, fechamento de mesa, fichas, PDF/impressão, configurações/horários, personalização PWA, push e assistente. Também passaram os cenários de cadastro/pedido, descarte e listagens no visual anterior. Integrações externas usam os transportes de teste existentes, sem homologar dispositivos ou credenciais reais. Aparência/contraste, máscaras e paginação somam 37 testes unitários aprovados.
