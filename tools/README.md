# tools/: rodar e testar o Flow sem tocar no banco

O Flow não tem homologação: o `index.html` do repo fala com o banco de **produção**. Estas ferramentas montam uma cópia **sem banco**, para testar mudanças e gerar o preview de cada PR.

| Arquivo | Para quê |
|---|---|
| `smoke/req-margem.mjs` | Teste da margem % sobre a "Média do dia da semana" na requisição: média × 1,2 com +20%, trocar 20% → 40% não acumula, a barra de 0 a 100% recalcula da média, prato digitado à mão fica fora e "Repetir a última" não leva margem, em 1280 e 390 px. `node req-margem.mjs` depois do `preview_build.py`. |
| `preview_build.py` | Monta `_site/`: tira a URL do Supabase (o app roda no "modo local", só no navegador), força a demonstração no PDV, põe a faixa "PREVIEW · sem banco" e carrega um restaurante de demonstração na primeira visita. Se sobrar qualquer menção ao banco de produção, **o build falha**. |
| `preview_mock.js` | **Restaurante fictício completo** do preview. O `preview_build.py` injeta só no `_site/`; na primeira visita ele completa a demo de sempre (`buildDemoDados(DEMO_SPECS[0])`, que não muda) com cerca de 3 meses de histórico, gravando pelos caminhos oficiais do app. Tudo é determinístico: datas relativas a hoje e semente fixa. Veja "Dados fictícios do preview" abaixo. |
| `smoke/mock.mjs` | Teste do restaurante fictício: abre o preview padrão e confere que nenhuma tela principal (Dashboard, Financeiro e abas, DRE, Estoque e todas as abas, Fichas, Folha, Buffet, Desperdícios, Checklists) mostra estado vazio ou só zeros, sem erro de JS, sem chamada ao banco, sem rolagem lateral em 390 px e com os saldos do estoque iguais ao livro; `?demo=base` e `?vazio=1` continuam valendo. 1280 e 390 px. `node mock.mjs` depois do `preview_build.py`. |
| `preview_simulacao.js` | Painel **Simular** do preview (veja abaixo). O `preview_build.py` injeta só no `_site/`; o `index.html` do repo não ganha nada. |
| `smoke/simulacao.mjs` | Teste do painel Simular: o painel existe no `_site/` e não no `index.html` do repo; Chefe de setor com 1 setor esconde as outras áreas e a Posição mostra só o setor; voltar a dono restaura tudo. 1280 e 390 px. `node simulacao.mjs` depois do `preview_build.py`. |
| `serve.py` | Serve o `_site/` em `http://localhost:4179`. Com `--producao`, serve o repo como está (cuidado: banco de produção). |
| `smoke/compra-status.mjs` | Teste do "Comprado / aguardando chegada": marcar na Lista de Compras, aviso na Lista, Posição (coluna "Compra" logo depois de Crítico, com data e quem) e Requisição, "Itens a comprar" sem os comprados, nota ou entrada que limpa a marca, o "×" e quem não tem a permissão, em 1280 e 390 px. `node compra-status.mjs` depois do `preview_build.py`. |
| `smoke/` | Teste com Playwright: abre Flow e PDV do `_site/`, confere que nenhuma requisição vai ao Supabase e tira prints em 1280 px e 390 px (regra D9). |
| `smoke/subprodutos.mjs` | Teste de "Subprodutos em lote" (Fichas Técnicas → Mais): nasce tudo marcado, desmarcar e aplicar com confirmação, aviso de mudança fora do filtro, cancelar não muda nada, gerente não vê. É recurso por cliente: desligado, ninguém vê; só a Lidera vê o interruptor em Configurações → Conta. `node subprodutos.mjs` depois do `preview_build.py`. |
| `smoke/escuro-calendario.mjs` | Teste do tema escuro nos campos de mês: ícone do calendário claro (`color-scheme: dark`) e "novembro de 2026" inteiro, no Dashboard, Financeiro e DRE, em 1280 e 390 px, sem rolagem lateral. `node escuro-calendario.mjs` depois do `preview_build.py`. |
| `smoke/kpi.mjs` | Teste dos cartões de KPI: valor longo (milhões, com centavos) não pode ficar cortado no Dashboard nem na Posição do estoque, em 1024, 1280 e 390 px, e em 1024 e 1280 com o menu lateral escondido (a fonte reduz só o que não cabe; cartão estreito põe o ícone em cima). `node kpi.mjs` depois do `preview_build.py`. |
| `smoke/posicao.mjs` | Teste da aba Estoque → Posição: seletor "Colunas: Essencial / Completa" (Essencial padrão sem Categoria, Subcategoria, Fornecedor e colunas de custo; Completa com tudo; escolha lembrada por usuário após recarregar; ordenar, buscar e imprimir nas duas), colunas "Última compra" e "Em pacotes", filtro de unidade e os filtros Conferir embalagem, Preço subiu e Total em kg (chips na faixa de status), em 1280 e 390 px. `node posicao.mjs` depois do `preview_build.py`. |
| `smoke/posicao-topo.mjs` | Teste do topo da Posição (#48): três faixas na ordem KPIs de valor → status com os chips Conferir embalagem, Preço subiu e Total em kg (`#estPosStatus`) → uma barra de filtros só com "Colunas" na mesma linha (`#estPosBar`). Em 1440 e 1280 px nenhuma linha de faixa ocupa menos da metade da largura; os chips filtram e limpam; sem `podeVerValores()` não há Preço subiu nem valor em reais no topo; 390 px na mesma ordem e sem rolagem lateral. `node posicao-topo.mjs` depois do `preview_build.py`. |
| `smoke/contagem-aviso.mjs` | Teste do aviso de itens não contados na contagem física: com 3 de 10 em branco aparece o modal do Flow com a lista (por categoria, com o saldo de livro; item com livro 0 não entra), "Voltar e contar" não salva e foca o 1º em branco, "Salvar sem eles" salva 7 sem mexer no saldo dos 3, "Zerar" pede a 2ª confirmação com a perda (só dos saldos positivos; saldo negativo aparece à parte, como ganho), "Cancelar" volta ao aviso e "Zerar e salvar" salva 10 com os 3 em 0; o Tab fica preso no aviso; a lista de contagens mostra "7 contados · 3 zerados" (ou "3 fora (mantidos)"); porcionado aparece em porções no aviso e no detalhe; a contagem guarda quem ficou de fora (mantido/zerado) e o detalhe mostra; na contagem por setor só entra o que o setor mostra. 1280 e 390 px. `node contagem-aviso.mjs` depois do `preview_build.py`. |
| `smoke/rotas.mjs` | Teste do endereço por tela (`#/estoque/contar`, `#/financeiro/dre`…): menu e abas mudam o endereço, voltar/avançar voltam à tela e à aba certas, voltar com modal (ou confirmação) aberto fecha só o modal, recarregar abre a tela do endereço, endereço inválido cai na tela padrão, `?parâmetro` fica, membro (`flowSim`) com endereço de área proibida cai na área liberada com o endereço corrigido e voltar antes do início sai do app, em 1280 e 390 px. `node rotas.mjs` depois do `preview_build.py`. |
| `smoke/pwa.mjs` | Teste do Flow instalável como app no celular (#62): manifest com os campos e ícones de tamanho real (192, 512, maskable e 180 do iPhone), meta tags do iPhone, `pages.yml` publicando `manifest.webmanifest`, `sw.js` e `icons/`; service worker ativo na raiz que não guarda a página em cache, não responde o `/pdv/` e deixa o `versao.json` ir à rede; tela "Sem internet" quando a rede cai; safe areas (simuladas com `--sa-t`/`--sa-b`) no topo, menu, rodapé e conteúdo, claro e escuro; dica de instalar no iPhone (só Safari, uma vez) e no Android (só com o pedido do Chrome, botão Instalar); app instalado sem dica e com link externo abrindo fora; 1280 px igual a antes. `node pwa.mjs` depois do `preview_build.py`. |
| `smoke/rotas-setas.mjs` | Teste das setas ‹ › e do caminho clicável no topo: no Dashboard não há caminho e as setas ficam inativas; trocar de tela e de aba mostra Início › Área › Aba (no celular, Início › Aba); ‹ volta, › avança e ‹ fica inativo na 1ª tela sem sair do app; clicar em Início ou na área abre a tela. 1280 e 390 px, sem rolagem lateral. `node rotas-setas.mjs` depois do `preview_build.py`. |
| `smoke/folha-atalho.mjs` | Teste do acesso à Folha a partir do Financeiro: no menu, a Folha é subpágina do Financeiro (não é item solto no grupo FINANCEIRO) e continua em RH; o botão "Folha de pagamento" no topo aparece na Visão Geral e ao lado de botão que já existe (Lançamentos), e não cria linha nova no topo das outras abas; na Folha, "← Financeiro" volta para a Visão Geral e o texto liga ao DRE (Mão-de-Obra) só para quem abre o DRE. Perfis: dono, nível Financeiro, financeiro sem Folha (personalizado e Compras), financeiro restrito com Folha com e sem DRE, e só Folha (não ganha o Financeiro). 1280 e 390 px, sem rolagem lateral. `node folha-atalho.mjs` depois do `preview_build.py`. |
| `smoke/menu-sub.mjs` | Teste do menu lateral com subpáginas (D23): seta e expansão (a seta só expande, o nome abre a tela), subitem abre a aba e o endereço certos e fica destacado, a Folha dentro do Financeiro e em RH (e não solta em FINANCEIRO), perfis do `flowSim` só veem as abas permitidas, modo de edição pelo lápis (olho oculta, cadeado nos obrigatórios, recarregar lembra), Configurações → Menu lateral e "Restaurar padrão", menu escondido no computador (botão e Ctrl/Cmd+B, lembrado, KPIs reajustados) em 1280 e 1024 px, e Sair com confirmação. 1280 e 390 px, claro e escuro, sem rolagem lateral nem erro de JS. `node menu-sub.mjs` depois do `preview_build.py`. |
| `smoke/quanto-comprar.mjs` | Teste da aba Estoque › Quanto comprar (`#/estoque/quanto-comprar`): vem logo depois da Lista de Compras, que perde a calculadora e ganha o atalho "Calcular porções →"; com o cenário *Preparado com 8 ingredientes*, 20 porções dão 8 linhas (insumo · quantidade · un · saldo atual · falta comprar, arredondado pela embalagem); com preparado, gramas por porção e perda ficam travados; à mão dá o bruto com a perda; imprimir sai com a lista; Compras vê a aba e Estoquista não (nem pelo endereço). 1280 e 390 px, sem rolagem lateral. `node quanto-comprar.mjs` depois do `preview_build.py`. |
| `smoke/ideal.mjs` | Teste da trava do estoque ideal e crítico: dono, administrador e quem tem a permissão marcada alteram; gerente, chefe e personalizado sem a permissão só veem, na Posição e no cadastro do produto. `node ideal.mjs` depois do `preview_build.py`. |

## Uso rápido

```bash
python3 tools/preview_build.py          # monta _site/
python3 tools/serve.py                  # abre em http://localhost:4179
# smoke (1ª vez: cd tools/smoke && npm ci && npx playwright install chromium)
node tools/smoke/req-setor.mjs          # requisição por setor: chefe só pede para o próprio setor (pela tela e pelas funções), em 1280 e 390 px
cd tools/smoke && npm run smoke         # prints em tools/smoke/prints/
node lc-derivado.mjs                     # Lista de compras: quanto do bruto vai para cada preparado, em 1280 e 390 px
```

Para abrir o preview com a base vazia: `?vazio=1`. Com só a demo simples (sem o restaurante fictício completo): `?demo=base`. O parâmetro vale na primeira visita: para trocar, limpe os dados do site no navegador (ou use uma aba anônima).

## Dados fictícios do preview (`preview_mock.js`)

**Regra: toda mudança de tela traz, no mesmo PR, os dados fictícios que a deixam visível no preview (em tools/preview_mock.js). O link de teste nunca pode abrir a tela nova vazia.** Acrescente em `montar()` o que a tela precisa e uma conferência em `smoke/mock.mjs`.

O que o restaurante fictício tem (nomes sempre inventados: Colaborador 1, Sócio 1, Distribuidora Exemplo, Hortifrúti Demo…):

- **Estoque:** cerca de 40 produtos em kg, L e un, vários com embalagem (PCT, CX, FD); armazéns Estoque principal, Produção e Bar (bebidas entram direto no Bar); ideal e crítico preenchidos; livro (`estoqueMov`) com saldo inicial, compras (`estEntradaDeLanc`), baixas por vendas (`estBaixaVendas`), requisições da Produção (`estTransferir`), produções (`estProduzir`), desperdícios (`estPerdaDeDesp`) e 3 contagens (fim dos dois meses anteriores e uma de hoje, com itens não contados e dois zerados). Itens na Lista de Compras, um "Comprado · chega dd/mm", um com preço que subiu e um com embalagem a conferir; requisições do dia aberta, solicitada e pronta.
- **Fichas:** os 5 pratos do buffet da demo e mais 9 (executivo, feijoada, parmegiana, massa, peixe, marmita, sobremesa, suco, café), preços por canal (iFood e delivery próprio), revenda de bebidas e preparados estocáveis com porção (a feijoada tem 9 ingredientes).
- **Financeiro:** receita diária por meio de pagamento (com o recebimento pelas regras de cada meio), compras por nota com parcelas e boletos, despesas nos 13 grupos do DRE (CMV perto de 30–33%), custos fixos que viram contas a pagar (pagas, a vencer e uma vencida), contas a receber, metas de faturamento e Controle de CMV dos meses fechados.
- **Equipe e Folha:** 8 colaboradores CLT e o Sócio 1, com os meses pagos, salários e encargos lançados; três membros com acesso na Equipe.
- **O resto:** buffet dos últimos 21 dias, checklists com registros e notificações no sino.

Os smokes que foram escritos contra a demo simples abrem `/?demo=base`.

## Simular perfil de usuário e cenário de dados (painel "Simular")

No preview, o app abre sempre como **dono** e com o restaurante de demonstração. Para revisar uma mudança que depende de **quem** está logado ou de **como** está o dado, use o botão **Simular** (canto de baixo, à direita, acima da faixa PREVIEW). Nada vai para o banco: tudo fica no navegador de quem abriu.

- **Perfil:** escolha Dono, um nível de `NIVEIS` (Administrador, Gerente, Operador, Estoquista, Estoquista + compras, Chefe de setor, Chefe da produção, Compras, Fiscal, Financeiro) ou Personalizado (marque áreas e permissões). Para níveis com setor, marque os setores. **Aplicar perfil** cria um membro de teste na Equipe ("Simulação do preview") e roda o **mesmo trecho do login de membro** do `index.html` (o `preview_build.py` copia o trecho de `entrarComoCliente` na hora do build; se o login mudar e o trecho sumir, o build falha). O botão vira o selo "Simulando: …". Recarregar a página mantém a simulação. **Voltar a dono** apaga o membro de teste e reabre o app.
- **Cenários de dados** (só dados fictícios da demonstração):
  - *Restaurante com setores*: cria Cozinha, Pizzaria e Churrascaria além do principal, vincula categorias aos setores, cria a Farinha de trigo e o preparado Massa de pizza (da Pizzaria) e põe saldo em cada setor pelo livro (entrada + transferência).
  - *Produtos em pacote e caixa*: arroz em PCT de 5 kg, óleo em CX, refrigerante em FD, feijão com 1 kg por pacote ("confira?") e tomate que chegou em CX sem embalagem.
  - *Preparado com 8 ingredientes*: cria o Molho da casa (demo), com porção de 250 g e 8 ingredientes fictícios (ovo em bandeja, azeite em garrafa, parte com saldo), para conferir Estoque › Quanto comprar.
  - *Zerar e recarregar demonstração*: apaga o que foi feito neste navegador e recarrega a demonstração.
  - *Abrir um arquivo .json exportado*: abre um `DB` exportado (botão "Exportar backup (JSON)" nas Configurações) só neste navegador. O painel só lê o arquivo escolhido; nada é enviado. **Nunca coloque esse arquivo no repositório.**
- **Pelo console** (para testes automáticos): `flowSim.aplicar({nivel:'chefe',setores:['cozinha']})`, `flowSim.setores()`, `flowSim.pacotes()`, `flowSim.receita8()`, `flowSim.dono()`.

O que o painel **não** simula: regras do servidor (RLS do Supabase, Edge Functions, gravação na nuvem, `merge3`, notificações entre sessões), login de verdade (senha, troca de unidade, painel admin/consultor) e o que depende de `CLOUD` ou `ORG` (por exemplo, transferência entre unidades). Isso continua precisando de teste combinado com os responsáveis.

## Preview por PR (Cloudflare Pages, decisão D5)

Configuração do projeto no Cloudflare Pages, ligado a este repo:

| Campo | Valor |
|---|---|
| Framework preset | None |
| Build command | `python3 tools/preview_build.py` |
| Build output directory | `_site` |
| Production branch | `main` (vira só mais um preview sem banco, em `*.pages.dev`) |

A produção de verdade continua no GitHub Pages (`flow.somoslidera.com.br`). O Cloudflare **nunca** recebe o `CNAME` e nunca fala com o banco.

## Como abrir a revisão de nota sem a Sefaz

A tela **Novo lançamento** com itens da nota (aviso âmbar "CX ≠ kg", Padrão de compra, desvincular e vincular) normalmente vem das notas da Sefaz, que dependem do servidor. No preview, sem banco, dá para chegar nela pela nota de teste:

1. Financeiro → Lançamentos → **Importar NF-e (XML ou PDF)** → escolha `tools/fixtures/nfe-demo-troca.xml`.
2. A nota é fictícia: o fornecedor é de demonstração, com CNPJ zerado, e o único item é COCO RALADO 24X100G, em CX. A natureza "TROCA DE MERCADORIA" faz o Flow abrir a **tela de revisão** em vez de importar direto.
3. Se o caso pedir uma compra, troque o tipo para **Compra** no topo.

Uma nota sem natureza de troca ou bonificação importa direto, sem passar pela revisão.

Para gravar uma demonstração, rode o roteiro antes no Playwright, contra o preview, e só depois grave.

## Quando o build falha

O `preview_build.py` procura trechos exatos do `index.html` e do `pdv/index.html`, como `const SUPA_URL='…'` e `DEMO=QS.has('demo')||`. Se alguém mudar essas linhas, o build para com a mensagem "O código mudou". Ajuste o padrão no script. Não desligue a conferência.

O mesmo vale para o painel Simular: o build copia o trecho do login de membro de `entrarComoCliente` (de `MEMBRO_PERMS=null;…` até `if(MEMBRO_PERMS){aplicarAcessoMembro();go(MEMBRO_PERMS[0]);}`). Se esse trecho mudar de forma, o build falha. Ajuste `trecho_login()` no `preview_build.py` e rode `tools/smoke/simulacao.mjs`.
