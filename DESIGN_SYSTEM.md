# PROMPT MESTRE — DESIGN SYSTEM ERP / SAAS PROFISSIONAL

## Estilos disponíveis na gestão

Em **Configurações → Aparência → Estilo da interface**, cada navegador pode escolher **Visual atual** (padrão) ou **Mesa ERP**. O estilo é independente do modo claro/escuro e das cores da filial; a troca não altera configurações do negócio. A preferência `mesa-interface` permanece após recarregar e trocar de filial.

O Mesa ERP aplica o [design system reutilizável](design-system/mesa/MASTER.md) às telas da gestão: salão, pedidos, catálogo, estoque, produção, financeiro, pagamentos, caixa, equipe, impressão, configurações e complementos. `erp-theme.css` é a entrada; `erp-tokens.css` define a fundação, `erp-components.css` os componentes e `erp-workspaces.css` as composições. O escopo `mesa-erp` cobre o layout, e `mesa-erp-surface` cobre modais e dropdowns renderizados em portais. Preserve o visual atual fora desse escopo. Não imponha a navegação administrativa ao PWA do cliente, garçom, cozinha ou portal público.

Reutilize `AppShell`, `AppSidebar`, `AppTopbar` e `HeaderUtilities` de `admin-layout.tsx`; indicadores e gráficos usam `StatCard` e `ChartCard` de `data-display.tsx`. `DataTable`, `TableToolbar` e `TableActions` apresentam listagens sem controlar consultas; `FormField` conecta rótulos, hints e erros. `useFormValidation` oferece resumo acessível nos formulários compartilhados do ERP. Modais mantêm as proteções existentes e aceitam tamanhos `confirm`, `form`, `detail` e `wide`. Cores de marca continuam vindo de `appearanceStore`, inclusive a primária e o fundo da sidebar personalizados; o destaque do ERP verifica contraste sobre todas as superfícies.

No Mesa ERP, priorize densidade de trabalho: espaço entre blocos de 12 px, cards de indicadores com padding de 12 px e painéis de 16 px. Não some margem inferior de título ao gap do container. O conteúdo usa a largura disponível com recuos de 20 px no desktop e 12 px no celular; preserve alvos de toque de 44 px. `erp-motion.css` define relevo nos botões de ação, pressão por sombra interna e entradas de modais/menus em 120–180 ms. `AppPageContent` anima a navegação sem remontar os filhos. Respeite movimento reduzido e nunca anime altura/largura de formulários, tabelas ou previews PDF.

Você é um especialista sênior em UI/UX Design, Frontend Engineering e arquitetura de interfaces para sistemas ERP, SaaS, CRM, PDV e painéis administrativos.

Sua missão é desenvolver e manter todas as interfaces deste projeto seguindo um padrão visual consistente, moderno, limpo, profissional e funcional.

## 1. IDENTIDADE VISUAL

Utilize como referência um dashboard SaaS corporativo moderno com:

- Sidebar escura, fixa e elegante.
- Área principal clara, com fundo cinza muito suave.
- Cards brancos com bordas discretas e cantos arredondados.
- Cor azul vibrante nas principais ações.
- Tipografia moderna, compacta e legível.
- Ícones minimalistas e padronizados.
- Tabelas organizadas e com excelente hierarquia visual.
- Badges coloridas para representar estados.
- Drawers laterais para visualização e edição.
- Modais elegantes para ações específicas.
- Layout desktop de alta densidade informacional, sem aparência poluída.
- Layout mobile-first com adaptações específicas para dispositivos móveis.

A interface deve parecer um sistema SaaS comercial premium, pronto para uso em produção.

## 2. PALETA DE CORES

Utilize tokens CSS centralizados.

```css
:root {
  --sidebar-bg: #0d1b2a;
  --sidebar-hover: #172b43;
  --primary: #0757f9;
  --primary-hover: #0648d4;

  --page-bg: #f5f7fb;
  --surface: #ffffff;
  --surface-muted: #f8fafc;

  --border: #e2e8f0;
  --text-primary: #0f172a;
  --text-secondary: #64748b;
  --text-muted: #94a3b8;

  --success: #10b981;
  --warning: #f59e0b;
  --danger: #ef4444;
  --info: #3b82f6;

  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;

  --shadow-card: 0 2px 8px rgba(15, 23, 42, 0.04);
  --shadow-modal: 0 20px 60px rgba(15, 23, 42, 0.16);
}
```

Os tokens são a fonte única de estilos. Não espalhar cores ou dimensões arbitrárias entre os componentes.

## 3. ESTRUTURA DO LAYOUT

Desktop:

- Sidebar lateral com aproximadamente 210–240px.
- Fundo da sidebar azul-marinho muito escuro.
- Logotipo e nome da aplicação no topo.
- Menu vertical com ícones à esquerda e texto à direita.
- Item ativo com fundo azul intenso, cantos arredondados e texto branco.
- Rodapé da sidebar contendo unidade selecionada, ajuda e saída.
- Header principal com título, breadcrumb, seletor de empresa/unidade, notificações e usuário.
- Área principal flexível com espaçamento entre 16px e 24px.
- Cards de indicadores no topo.
- Conteúdo organizado em tabelas, gráficos, abas e painéis.

Mobile:

- Sidebar transformada em drawer.
- Header compacto.
- Cards empilhados ou em grid de duas colunas quando apropriado.
- Tabelas transformadas em cards ou listas quando não couberem.
- Ações principais facilmente acessíveis pelo polegar.
- Drawer de edição ocupando toda a tela.
- Navegação e interações otimizadas para toque.
- Nenhum scroll horizontal na página inteira.

## 4. TIPOGRAFIA

Utilizar Sora local, preservando o semibold (600) nos controles e textos operacionais. No Mesa ERP, títulos e indicadores usam 700; textos explicativos podem usar 500. Não adicionar fontes externas para substituir a identidade atual.

Hierarquia:

- Título da página: 24–28px, peso 700.
- Título de seção: 16–18px, peso 600.
- Título de card: 14–16px, peso 600.
- Texto padrão: 13–14px.
- Labels: 12–13px.
- Texto auxiliar: 11–12px.
- Indicadores KPI: 24–30px, peso 700.

Utilizar espaçamentos consistentes, altura de linha confortável e números tabulares para valores financeiros.

Evitar letras excessivamente grandes, excesso de negrito ou interfaces com aparência infantil.

## 5. CARDS DE INDICADORES

Cards de KPI devem ter:

- Superfície branca.
- Borda cinza clara.
- Border-radius de 10–12px.
- Padding de 16–20px.
- Ícone em pequeno bloco com fundo colorido suave.
- Label descritiva.
- Valor em destaque.
- Indicador opcional de crescimento ou redução.
- Descrição adicional pequena.

Organizar em grids responsivos.

## 6. TABELAS E LISTAGENS

Este é um dos elementos mais importantes do projeto.

Toda listagem administrativa deve considerar:

- Campo de busca.
- Filtros relevantes.
- Ordenação por coluna.
- Cabeçalho com fundo cinza muito claro.
- Linhas brancas com divisórias sutis.
- Hover discreto.
- Ícones e miniaturas quando úteis.
- Badges para status.
- Botões de ação compactos.
- Última coluna alinhada à direita, incluindo cabeçalho, valores e grupos de ações,
  respeitando o espaçamento interno da tabela. Estados vazios e de loading com
  células mescladas mantêm seu próprio alinhamento.
- Menu contextual com ações secundárias.
- Paginação no rodapé.
- Seletor de quantidade de registros.
- Contador de resultados.
- Estados de loading, vazio e erro.

Não exagerar em bordas ou cores. A tabela deve ser visualmente limpa.

No celular, priorize cards com rótulos por campo e ações dentro de cada registro, sem esconder colunas necessárias à operação. Para tabelas simples, reutilize `mobile-card-table`, atribua `data-label` às células e mantenha os cabeçalhos semânticos. Preserve os layouts especializados existentes quando já forem responsivos. Nomes longos, valores e grupos de ações devem respeitar a largura disponível; os botões e a paginação podem quebrar linha. Não use apenas `overflow: hidden` para mascarar conteúdo ou comandos cortados.

## 7. DRAWERS LATERAIS

Para cadastrar, consultar ou editar registros, priorizar drawer lateral quando isso preservar o contexto da listagem.

Padrão:

- Drawer à direita.
- Largura desktop entre 400px e 520px, adaptável.
- Fundo branco.
- Header fixo com título, identificação, badge e botão fechar.
- Abas quando existirem múltiplas seções.
- Corpo com scroll independente.
- Footer fixo com ações Cancelar e Salvar.
- Overlay discreto quando usado como modal.
- No mobile, utilizar tela cheia.

Não perder alterações sem confirmação.

## 8. MODAIS

Usar modal para:

- Confirmações.
- Operações rápidas.
- Detalhamento pontual.
- Pagamentos.
- Transferências.
- Gerenciamento operacional de pedidos e comandas.

Modais complexos podem utilizar múltiplas colunas no desktop, mas devem se adaptar para abas ou painéis empilhados no mobile.

O modal deve apresentar hierarquia clara, foco acessível, botão de fechamento e feedback após cada operação.

No celular (até 700 px), use o cabeçalho compartilhado de `Modal`: título completo com quebra de linha e botão de fechar na primeira linha; ações adicionais em uma segunda linha com botões proporcionais. Não comprima o título para acomodar as ações nem esconda os rótulos. Rodapés devem permitir quebra de linhas e dos textos dos botões, preservando todos os comandos e as confirmações de alterações não salvas. As classes `modal-header`, `modal-title` e `modal-header-close` centralizam esse comportamento; estilos locais devem manter esse contrato.

## 9. FORMULÁRIOS

- Labels sempre visíveis.
- Campos com altura aproximada de 38–42px.
- Border-radius de 8px.
- Borda cinza clara.
- Focus azul.
- Mensagens de erro próximas ao campo.
- Combobox e select consistentes.
- Switches para campos booleanos.
- Agrupamento por assunto.
- Campos obrigatórios identificados.
- Feedback de salvamento.
- Desabilitar ações enquanto a operação estiver em andamento.
- Validação no frontend e no backend.

## 10. BOTÕES E AÇÕES

Botão primário:

- Fundo azul.
- Texto branco.
- Ícone opcional.
- Bordas arredondadas.
- Hover azul mais escuro.

Botão secundário:

- Fundo branco.
- Borda cinza.
- Texto escuro.

Botão de sucesso:

- Verde.
- Reservado a ações como confirmar entrega e concluir operação.

Botão de perigo:

- Vermelho.
- Reservado a excluir, cancelar ou estornar.

Ações destrutivas exigem confirmação e devem respeitar permissões.

## 11. STATUS E BADGES

Utilizar uma linguagem visual padronizada:

- Verde: livre, ativo, entregue, aprovado, pago.
- Azul: em andamento, em preparo, processamento.
- Amarelo/laranja: reservado, atenção, pendente.
- Vermelho: bloqueado, cancelado, erro, crítico.
- Cinza: inativo, encerrado ou indisponível.

Cada status deve apresentar texto além da cor.

## 12. GRÁFICOS

Usar gráficos modernos e discretos.

- Barras para volume por período.
- Linhas para evolução.
- Donuts para distribuições.
- Tooltips legíveis.
- Legendas claras.
- Valores monetários formatados.
- Cores consistentes com o design system.
- Evitar efeitos 3D, sombras pesadas e excesso de elementos.

## 13. ÍCONES

Utilizar Lucide Icons como biblioteca preferencial.

- Tamanhos entre 16px e 20px em controles.
- Traços consistentes.
- Evitar misturar bibliotecas.
- Ícones sempre acompanhados de rótulos ou descrições acessíveis quando necessário.

## 14. EXPERIÊNCIA DE USUÁRIO

Todas as telas devem:

- Ser visualmente consistentes.
- Priorizar a tarefa principal.
- Evitar cliques desnecessários.
- Preservar contexto ao abrir edição.
- Exibir skeleton durante carregamento.
- Informar sucesso e erro.
- Oferecer confirmação em ações irreversíveis.
- Permitir navegação por teclado no desktop.
- Usar foco visível e contraste acessível.
- Adaptar-se a diferentes tamanhos de tela.
- Manter botões e áreas de toque confortáveis em dispositivos móveis.

## 15. COMPONENTIZAÇÃO

Criar componentes reutilizáveis, por exemplo:

```text
components/
  layout/
    AppSidebar
    AppHeader
    PageContainer
    PageHeader

  data-display/
    StatsCard
    StatusBadge
    DataTable
    Pagination
    EmptyState
    LoadingSkeleton

  forms/
    FormField
    SearchInput
    FilterSelect
    ToggleField

  overlays/
    AppModal
    AppDrawer
    ConfirmDialog

  feedback/
    Toast
    Alert
    ErrorState

  charts/
    ChartCard
    BarChart
    DonutChart
```

Não duplicar layouts e estilos entre módulos.

### Padrão das abas

No **Mesa ERP**, as abas usam controle agrupado compacto: faixa com padding de 3 px, borda discreta e raio de 12 px; cada opção tem altura mínima de 40 px no desktop e 44 px no celular, raio de 9 px e ícone Lucide junto ao texto. A aba selecionada recebe preenchimento sólido na primária da aparência e texto com contraste calculado, sem sublinhado. Seus contadores usam fundo de superfície e texto de destaque com contraste, mantendo os números legíveis sobre qualquer primária. O visual atual e os PWAs preservam o fundo suave com linha inferior de 2 px. Mantenha foco visível, navegação por teclado e adaptação ao tema claro ou escuro. Quando não houver espaço, permita rolagem dentro da barra, sem gerar rolagem horizontal na página.

Neste projeto, use os componentes `Tabs` e `Tab` de `packages/ui/src/controls.tsx`, informando um `icon` para cada aba. Navegações especializadas utilizam a classe compartilhada `system-tabs`, definida em `packages/ui/src/styles.css`, com a apresentação do Mesa ERP centralizada em `erp-tabs.css`. Estilos locais devem ajustar apenas o layout; cores, bordas e estados das abas são centralizados. A navegação inferior do cliente mantém sua posição e organização para toque no celular.

## 16. PADRÃO DE PÁGINAS

Sempre que criar um módulo administrativo, seguir esta ordem:

1. Sidebar e header existentes.
2. Título e breadcrumb.
3. Ações principais à direita.
4. Indicadores, quando relevantes.
5. Abas e filtros.
6. Conteúdo principal.
7. Paginação.
8. Drawer ou modal para detalhes.
9. Estados de carregamento, vazio e erro.

Exceções são permitidas quando melhorarem a usabilidade da funcionalidade.

## 17. REGRAS PARA O CODEX

Antes de implementar uma tela:

1. Inspecione a estrutura atual do projeto.
2. Identifique o framework, componentes e tokens existentes.
3. Reutilize os elementos já implementados.
4. Não introduza outra biblioteca de UI desnecessariamente.
5. Mantenha os padrões visuais desta especificação.
6. Garanta responsividade para desktop, tablet e celular.
7. Não implemente controles sem funcionalidade.
8. Preserve as regras de negócio, contratos da API e permissões existentes.
9. Não utilize dados fictícios em fluxos de produção sem sinalização.
10. Verifique erros de TypeScript, build e testes disponíveis.
11. Ao finalizar, informe os arquivos alterados, funcionalidades implementadas e validações realizadas.

## RESULTADO ESPERADO

O resultado deve ser uma aplicação ERP/SaaS com aparência de produto comercial profissional, combinando sidebar escura, interface clara, azul como cor principal, cards brancos, tabelas elegantes, indicadores compactos, modais modernos e drawers laterais.

A experiência deve manter o mesmo padrão visual em todos os módulos, mesmo quando as funcionalidades forem diferentes.

Priorizar sempre consistência, legibilidade, agilidade operacional e qualidade de implementação.
