# tools/: rodar e testar o Flow sem tocar no banco

O Flow não tem homologação: o `index.html` do repo fala com o banco de **produção**. Estas ferramentas montam uma cópia **sem banco**, para testar mudanças e gerar o preview de cada PR.

| Arquivo | Para quê |
|---|---|
| `smoke/req-margem.mjs` | Teste da margem % sobre a "Média do dia da semana" na requisição: média × 1,2 com +20%, trocar 20% → 40% não acumula, a barra de 0 a 100% recalcula da média, prato digitado à mão fica fora e "Repetir a última" não leva margem, em 1280 e 390 px. `node req-margem.mjs` depois do `preview_build.py`. |
| `preview_build.py` | Monta `_site/`: tira a URL do Supabase (o app roda no "modo local", só no navegador), força a demonstração no PDV, põe a faixa "PREVIEW · sem banco" e carrega um restaurante de demonstração na primeira visita. Se sobrar qualquer menção ao banco de produção, **o build falha**. |
| `preview_simulacao.js` | Painel **Simular** do preview (veja abaixo). O `preview_build.py` injeta só no `_site/`; o `index.html` do repo não ganha nada. |
| `smoke/simulacao.mjs` | Teste do painel Simular: o painel existe no `_site/` e não no `index.html` do repo; Chefe de setor com 1 setor esconde as outras áreas e a Posição mostra só o setor; voltar a dono restaura tudo. 1280 e 390 px. `node simulacao.mjs` depois do `preview_build.py`. |
| `serve.py` | Serve o `_site/` em `http://localhost:4179`. Com `--producao`, serve o repo como está (cuidado: banco de produção). |
| `smoke/compra-status.mjs` | Teste do "Comprado / aguardando chegada": marcar na Lista de Compras, aviso na Lista, Posição (coluna "Compra" logo depois de Crítico, com data e quem) e Requisição, "Itens a comprar" sem os comprados, nota ou entrada que limpa a marca, o "×" e quem não tem a permissão, em 1280 e 390 px. `node compra-status.mjs` depois do `preview_build.py`. |
| `smoke/` | Teste com Playwright: abre Flow e PDV do `_site/`, confere que nenhuma requisição vai ao Supabase e tira prints em 1280 px e 390 px (regra D9). |
| `smoke/subprodutos.mjs` | Teste de "Subprodutos em lote" (Fichas Técnicas → Mais): nasce tudo marcado, desmarcar e aplicar com confirmação, aviso de mudança fora do filtro, cancelar não muda nada, gerente não vê. É recurso por cliente: desligado, ninguém vê; só a Lidera vê o interruptor em Configurações → Conta. `node subprodutos.mjs` depois do `preview_build.py`. |
| `smoke/kpi.mjs` | Teste dos cartões de KPI: valor longo (milhões, com centavos) não pode ficar cortado no Dashboard nem na Posição do estoque, em 1024, 1280 e 390 px (a fonte reduz só o que não cabe; cartão estreito põe o ícone em cima). `node kpi.mjs` depois do `preview_build.py`. |
| `smoke/posicao.mjs` | Teste da aba Estoque → Posição: seletor "Colunas: Essencial / Completa" (Essencial padrão sem Categoria, Subcategoria, Fornecedor e colunas de custo; Completa com tudo; escolha lembrada por usuário após recarregar; ordenar, buscar e imprimir nas duas), colunas "Última compra" e "Em pacotes", filtro de unidade e scorecards (Conferir embalagem, Preço subiu, Total em kg), em 1280 e 390 px. `node posicao.mjs` depois do `preview_build.py`. |
| `smoke/contagem-aviso.mjs` | Teste do aviso de itens não contados na contagem física: com 3 de 10 em branco aparece o modal do Flow com a lista (por categoria, com o saldo de livro; item com livro 0 não entra), "Voltar e contar" não salva e foca o 1º em branco, "Salvar sem eles" salva 7 sem mexer no saldo dos 3, "Zerar" pede a 2ª confirmação com a perda (só dos saldos positivos; saldo negativo aparece à parte, como ganho), "Cancelar" volta ao aviso e "Zerar e salvar" salva 10 com os 3 em 0; o Tab fica preso no aviso; a lista de contagens mostra "7 contados · 3 zerados" (ou "3 fora (mantidos)"); porcionado aparece em porções no aviso e no detalhe; a contagem guarda quem ficou de fora (mantido/zerado) e o detalhe mostra; na contagem por setor só entra o que o setor mostra. 1280 e 390 px. `node contagem-aviso.mjs` depois do `preview_build.py`. |
| `smoke/folha-atalho.mjs` | Teste do acesso à Folha a partir do Financeiro: no menu, o grupo FINANCEIRO tem Financeiro seguido de Folha de Pagamento e a Folha continua em RH (mesmo ícone nos dois); o botão "Folha de pagamento" no topo aparece na Visão Geral e ao lado de botão que já existe (Lançamentos), e não cria linha nova no topo das outras abas; na Folha, "← Financeiro" volta para a Visão Geral e o texto liga ao DRE (Mão-de-Obra) só para quem abre o DRE. Perfis: dono, nível Financeiro, financeiro sem Folha (personalizado e Compras), financeiro restrito com Folha com e sem DRE, e só Folha (não ganha o Financeiro). 1280 e 390 px, sem rolagem lateral. `node folha-atalho.mjs` depois do `preview_build.py`. |
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

Para abrir o preview com a base vazia: `?vazio=1`. Para zerar a demonstração, limpe os dados do site no navegador.

## Simular perfil de usuário e cenário de dados (painel "Simular")

No preview, o app abre sempre como **dono** e com o restaurante de demonstração. Para revisar uma mudança que depende de **quem** está logado ou de **como** está o dado, use o botão **Simular** (canto de baixo, à direita, acima da faixa PREVIEW). Nada vai para o banco: tudo fica no navegador de quem abriu.

- **Perfil:** escolha Dono, um nível de `NIVEIS` (Administrador, Gerente, Operador, Estoquista, Estoquista + compras, Chefe de setor, Chefe da produção, Compras, Fiscal, Financeiro) ou Personalizado (marque áreas e permissões). Para níveis com setor, marque os setores. **Aplicar perfil** cria um membro de teste na Equipe ("Simulação do preview") e roda o **mesmo trecho do login de membro** do `index.html` (o `preview_build.py` copia o trecho de `entrarComoCliente` na hora do build; se o login mudar e o trecho sumir, o build falha). O botão vira o selo "Simulando: …". Recarregar a página mantém a simulação. **Voltar a dono** apaga o membro de teste e reabre o app.
- **Cenários de dados** (só dados fictícios da demonstração):
  - *Restaurante com setores*: cria Cozinha, Pizzaria e Churrascaria além do principal, vincula categorias aos setores, cria a Farinha de trigo e o preparado Massa de pizza (da Pizzaria) e põe saldo em cada setor pelo livro (entrada + transferência).
  - *Produtos em pacote e caixa*: arroz em PCT de 5 kg, óleo em CX, refrigerante em FD, feijão com 1 kg por pacote ("confira?") e tomate que chegou em CX sem embalagem.
  - *Zerar e recarregar demonstração*: apaga o que foi feito neste navegador e recarrega a demonstração.
  - *Abrir um arquivo .json exportado*: abre um `DB` exportado (botão "Exportar backup (JSON)" nas Configurações) só neste navegador. O painel só lê o arquivo escolhido; nada é enviado. **Nunca coloque esse arquivo no repositório.**
- **Pelo console** (para testes automáticos): `flowSim.aplicar({nivel:'chefe',setores:['cozinha']})`, `flowSim.setores()`, `flowSim.pacotes()`, `flowSim.dono()`.

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
