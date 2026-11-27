# tools/: rodar e testar o Flow sem tocar no banco

O Flow não tem homologação: o `index.html` do repo fala com o banco de **produção**. Estas ferramentas montam uma cópia **sem banco**, para testar mudanças e gerar o preview de cada PR.

| Arquivo | Para quê |
|---|---|
| `preview_build.py` | Monta `_site/`: tira a URL do Supabase (o app roda no "modo local", só no navegador), força a demonstração no PDV, põe a faixa "PREVIEW · sem banco" e carrega um restaurante de demonstração na primeira visita. Se sobrar qualquer menção ao banco de produção, **o build falha**. |
| `serve.py` | Serve o `_site/` em `http://localhost:4179`. Com `--producao`, serve o repo como está (cuidado: banco de produção). |
| `smoke/` | Teste com Playwright: abre Flow e PDV do `_site/`, confere que nenhuma requisição vai ao Supabase e tira prints em 1280 px e 390 px (regra D9). |
| `smoke/posicao.mjs` | Teste da aba Estoque → Posição: colunas "Última compra" e "Em pacotes", filtro de unidade e scorecards (Conferir embalagem, Preço subiu, Total em kg), em 1280 e 390 px. `node posicao.mjs` depois do `preview_build.py`. |

## Uso rápido

```bash
python3 tools/preview_build.py          # monta _site/
python3 tools/serve.py                  # abre em http://localhost:4179
# smoke (1ª vez: cd tools/smoke && npm ci && npx playwright install chromium)
cd tools/smoke && npm run smoke         # prints em tools/smoke/prints/
node lc-derivado.mjs                     # Lista de compras: quanto do bruto vai para cada preparado, em 1280 e 390 px
```

Para abrir o preview com a base vazia: `?vazio=1`. Para zerar a demonstração, limpe os dados do site no navegador.

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
