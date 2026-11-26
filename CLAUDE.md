# CLAUDE.md: Flow · by Lidera

Contexto para quem programa no Flow, gente ou agente. **Este repositório é público:** aqui não entra dado de cliente, segredo, endereço de servidor nem problema de segurança.

> Esqueleto do Marco 0 (26/11/2026). As seções marcadas com *(a completar)* recebem o contexto do responsável técnico.

## O que é

ERP web para restaurantes, usado pelos clientes da consultoria Lidera (Programa Lucro e Liberdade). Ele cobre financeiro, custo de cardápio (fichas técnicas), estoque e compras, equipe e o acompanhamento da consultoria. O Flow PDV (`/pdv/`) é um app separado de ponto de venda.

## Regras que valem sempre

1. **Não existe homologação.** O `index.html` deste repo fala com o banco de **produção**. Para testar, use `tools/` (preview sem banco). Veja `tools/README.md`.
2. **Tudo por PR**, de uma branch. A `main` é o que está no ar (GitHub Pages, `flow.somoslidera.com.br`). Cada PR ganha um preview sem banco.
3. **Mudança de tela anexa o print do preview em 390 px** no PR. O ERP é responsivo e as telas de operação são pensadas primeiro para o celular.
4. **Repo público:** sem nome real de cliente ou de pessoa (use "Sócio 1", "Restaurante Demo"), sem segredo (só `Deno.env.get`) e sem problema de segurança em código, issue ou PR. Problema de segurança vai direto para os responsáveis, fora do GitHub.
5. Mexeu numa Edge Function? O código vem para o PR e o deploy acontece **depois** do merge. Veja `supabase/README.md`.

## Como está organizado

| Caminho | O que é |
|---|---|
| `index.html` | O Flow inteiro: HTML, CSS e JS puro num arquivo só, sem build. Bibliotecas por CDN (supabase-js, pdf.js, xlsx). |
| `pdv/index.html`, `pdv/sw.js` | Flow PDV (PWA). *(a completar: as fontes `parte1.html`, `parte2.js`, `parte3.js` e `montar.py`)* |
| `versao.json` | `{"maior":"AAAA-MM-DD"}`. Quando muda e é maior que `VER_MAIOR` no `index.html`, o app avisa que há versão nova. |
| `supabase/functions/` | Edge Functions (Deno). |
| `supabase/*.sql` | SQL do banco. *(a completar)* |
| `tools/` | Preview sem banco, servidor local e smoke com Playwright. |

## Modelo de dados (o essencial)

- Quase todo o ERP de um restaurante é **um JSON só**: `organizacoes.dados` (lançamentos, insumos, fichas, estoque, equipe, folha…).
- O app lê o JSON inteiro e grava o JSON inteiro, com trava otimista em `atualizado_em`. Se outra sessão gravou antes, ele faz mesclagem em 3 vias (`merge3`).
- Cada gravação gera uma versão em `organizacoes_historico`.
- Papéis em `perfis.papel`: `admin` (Lidera), `consultor` (vê só os restaurantes dele) e `cliente` (dono e equipe, presos à própria organização).
- Os níveis de equipe (Gerente, Estoquista…) ficam na constante `NIVEIS` do front.
- Sem banco (`sb = null`), o app roda no **modo local**: os dados ficam no `localStorage` (`STORE_KEY`). É o modo que o preview usa.

## Convenções do código

*(a completar com o responsável técnico: nomes, padrões de tela, como criar módulo novo, como versionar.)*

- Textos da interface em português do Brasil, com linguagem de dono de restaurante.
- Números e moeda no formato brasileiro (`fmtBRL`, `fmtN`).
- Escapar todo texto vindo de dado com `esc()` antes de pôr no HTML.

## Como pedir ajuda ao Claude neste repo

- Diga a tela e o fluxo (ex.: "Lançamentos → Notas da Sefaz → Revisar e lançar").
- Peça o teste no preview (`python3 tools/preview_build.py && python3 tools/serve.py`) e o print de 390 px.
- O Claude não grava no banco de produção, não faz deploy e não mexe em segredo.
