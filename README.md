# Controle Financeiro da Obra — PWA (v1.1 · Fases 1 e 2-núcleo)

Endereço publicado: https://mellogarstka.github.io/APP-OBRA/

Aplicativo local-first: todos os dados ficam no celular (IndexedDB), funciona 100% offline
e não usa servidor, login nem serviços externos.

## O que está pronto
- **Fase 1:** modelo de dados (valores em centavos, datas ISO), novo lançamento com as 5 formas
  de pagamento (à vista, entrada + evolução, parcelado com datas editáveis, cartão de crédito,
  sem data), tela do item, validação de pagamento com atalho para aditivo, dashboard com
  próximos pagamentos (atrasados, hoje, 30 dias, realizados, sem data), categorias/subcategorias
  e etapas editáveis, PWA instalável e offline, backup e restauração.
- **Fase 2 (núcleo):** aditivos numerados, reduções, desconto de quitação, correção do valor
  original com motivo, histórico de auditoria, cancelamentos (sem exclusão definitiva),
  fornecedores (criados direto no lançamento), busca e filtros.
- **Adiantado da Fase 3:** relatórios em tela (categoria, etapa, tipo com separação material/MO,
  natureza, fornecedor, por mês com as duas visões, compromissos futuros, aditivos, parcelados)
  e avisos no app (badge + destaque, antecedência configurável).

## Novidades da v1.1
- Aditivo, redução e desconto em **serviço misto**: campos de material e mão de obra
  (pré-preenchidos na proporção do cadastro e editáveis). Relatório por tipo usa essa separação.
- Correção do valor original de serviço misto mantém a proporção material/MO.
- **Pagamento a menor** de parcela programada: o app pergunta o destino do restante
  (mesma data, outra data, sem data ou desconto de quitação).
- Botão "+" redondo no celular (rótulo completo em telas largas), títulos em até 2 linhas,
  aba de origem destacada na tela do item, correção do menu de Configurações.

## Próximas fases
- Fase 2: anexos (câmera, compressão de imagens).
- Fase 3: PDF (jsPDF + autoTable) e exportação Excel (SheetJS).
- Fase 4: importação da planilha Excel em assistente.

## Como publicar (GitHub Pages)
Repositório `mellogarstka/APP-OBRA`, branch `main`, pasta raiz. Todo envio para `main`
atualiza o site em 1–2 minutos. No celular: abrir o endereço acima no Chrome (Android) ou
Safari (iPhone) e usar Configurações → Instalar na tela inicial.

Teste no computador: `python -m http.server 8000` dentro da pasta e abrir http://localhost:8000.
(Abrir o index.html com duplo clique não funciona: módulos JS e Service Worker exigem servidor.)

## Atualizações
Ao alterar arquivos, mude `VERSION` em `sw.js` (ex.: `obra-v1.1.1`). O cache do app é renovado;
os dados do IndexedDB nunca são apagados. Mudanças de estrutura do banco: incrementar
`DB_VERSION` em `js/db.js` e acrescentar a migração correspondente.

## Estrutura
| Arquivo | Função |
|---|---|
| js/fmt.js | dinheiro (centavos ↔ R$), datas BR ↔ ISO, soma de meses |
| js/calc.js | fórmulas do item 3 e validações (puras, testáveis) |
| js/db.js | IndexedDB com transações atômicas e migrações versionadas |
| js/store.js | regras de negócio: cada operação valida, grava e registra histórico |
| js/seed.js | listas iniciais de categorias e etapas |
| js/actions.js | folhas de pagamento, ajuste, correção e cancelamento |
| js/views/*.js | telas |
| sw.js | cache offline |

## Testes de aceite
Os casos T1–T12 do prompt foram verificados automaticamente (regras no banco simulado e fluxo
completo no navegador, incluindo modo avião).
