# Atalhos globais da gestão

Os atalhos ficam disponíveis depois do login no aplicativo de gestão, em todas as telas da filial ativa, inclusive com campos e modais abertos.

| Tecla | Função                                                 | Cor no rodapé |
| ----- | ------------------------------------------------------ | ------------- |
| F1    | Abrir o leitor de ficha por código de barras ou câmera | Azul          |
| F2    | Ir para Salão e mesas                                  | Verde         |
| F3    | Ir para Cardápio                                       | Âmbar         |
| F4    | Abrir a busca rápida de funções                        | Violeta       |

A barra fixa inferior também é clicável. As teclas aparecem nos botões de leitura de ficha e nas opções correspondentes do menu lateral. A barra acompanha o recolhimento do sidebar e tem espaçamento próprio no celular para não cobrir ações da página. Os avisos no celular ficam acima dela.

## Busca rápida

Digite o nome da tela ou termos como produto, estoque, dar baixa, pagamento, cozinha, aparência ou horário. A busca ignora acentos e diferenças entre maiúsculas e minúsculas, aceita vários termos e prioriza o nome da função. Setas para cima e para baixo selecionam resultados; Enter abre a função; Esc fecha o modal e devolve o foco ao campo anterior.

As funções disponíveis são filtradas pelas permissões do usuário antes da busca. O menu inclui as telas autorizadas, leitura de ficha, pedido avulso e acessos diretos às configurações de aparência e funcionamento, conforme o perfil.

## Formulários e leitor

F1 e F4 abrem sobre o formulário atual, preservando seus campos. Ao navegar por F2, F3 ou pela busca, os modais sem alterações são fechados. Se houver alterações não salvas, a confirmação de descarte é exibida. Continuar editando preserva os dados e a tela; confirmar o descarte conclui a navegação.

Uma operação em andamento ou uma confirmação aberta deve ser concluída antes de usar outro atalho. Repetir uma tecla mantém apenas um leitor ou busca abertos. A repetição automática da tecla é consumida, sem criar novas instâncias. Ctrl, Alt, Meta e Shift combinados com essas teclas mantêm o comportamento do navegador ou do sistema.

O leitor global reaproveita as verificações de ficha, preparo e entrega. O atalho F1 abre a leitura da unidade inteira; o botão de leitura de uma mesa mantém a restrição àquela mesa. Navegar fecha o leitor e libera a câmera. F1 exige as permissões de consulta e resgate de fichas.

Os listeners são removidos no logout e na desmontagem da gestão. Os atalhos não são instalados na landing, no login, no cardápio do cliente ou no gestor SaaS.

## Arquivos e testes

- `packages/ui/src/management-shortcuts.tsx`: controlador, barra e modal de busca.
- `packages/ui/src/management-shortcut-context.ts`: integração dos botões de leitura.
- `packages/ui/src/management-shortcut-model.ts`: reconhecimento de teclas e busca.
- `tests/management-shortcuts.test.ts`: modificadores, repetição e pesquisa.
- `tests/e2e/management-shortcuts.spec.ts`: navegação, modais, câmera, permissões, logout e responsividade.
