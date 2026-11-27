# CLAUDE.md: Flow · by Lidera

Contexto para quem programa no Flow, gente ou agente. **Este repositório é público e o arquivo também fica no ar em `flow.somoslidera.com.br/CLAUDE.md`.** Aqui não entra dado de cliente, nome de pessoa, segredo, endereço de servidor nem problema de segurança.

## O que é

ERP web para restaurantes, usado pelos clientes da consultoria Lidera (Programa Lucro e Liberdade, PLL). Cobre financeiro (com DRE, fluxo de caixa e folha), custo de cardápio (fichas técnicas), estoque e compras, buffet, equipe e o acompanhamento da consultoria. O Flow PDV (`/pdv/`) é um app separado de ponto de venda.

Quem usa é dono de restaurante e a equipe dele, e **a maioria usa pelo celular**.

## Regras que valem sempre

1. **Não existe homologação.** O `index.html` deste repo fala com o banco de **produção**. Para testar, use `tools/` (preview sem banco, veja `tools/README.md`). Nunca teste gravando na produção.
2. **Tudo por PR**, a partir de uma branch. Ninguém faz push direto na `main`.
3. **Merge na `main` é deploy em produção.** O GitHub Pages publica a `main` em `flow.somoslidera.com.br` em poucos minutos. Antes de clicar em Merge, teste no link de preview do PR.
4. **Mudança de tela anexa um print do preview em 390 px** no PR. O ERP inteiro é responsivo (veja "Celular" abaixo).
5. **Repo público:** sem nome real de cliente ou de pessoa (use "Sócio 1", "Restaurante Demo"), sem segredo (só `Deno.env.get`) e sem problema de segurança em código, issue ou PR. Problema de segurança vai direto para os responsáveis, fora do GitHub.
6. **Edge Function:** o código vem no PR e o deploy acontece **depois** do merge. Veja `supabase/README.md`.
7. **Dado de cliente só muda com OK do cliente.** Nunca corrija dado de um restaurante por SQL, script ou admin sem o pedido dele e sem backup antes.

## Como uma mudança chega ao ar

1. Branch a partir da `main` (`git switch -c <tema>`).
2. Editar o `index.html` (ou `pdv/`, `supabase/`).
3. Testar local: `python3 tools/preview_build.py && python3 tools/serve.py`, abrir `http://localhost:4179`.
4. Abrir o PR. O Cloudflare Pages gera um link de preview, sem banco e com o restaurante de demonstração.
5. Testar no link do preview, no celular (390 px) e no computador. Anexar o print no PR.
6. Merge. Conferir no ar que a mudança está lá (`flow.somoslidera.com.br`).

**Aviso de versão nova:** numa atualização maior, suba no MESMO PR a constante `VER_MAIOR='AAAA-MM-DD'` do `index.html` e o `versao.json` (`{"maior":"AAAA-MM-DD"}`). O app confere o `versao.json` a cada 10 min e mostra "Saiu uma versão nova" só se a data do arquivo for maior que a dele. Ajuste pequeno não sobe a data. Para anunciar novidade, acrescente um item na lista `NOVIDADES` (aparece uma vez por pessoa e aparelho, só para quem tem acesso à área).

**Uma aba aberta com código antigo continua rodando o código antigo** até recarregar, e salva na mesma base. Mudança que reescreve dados (migração no `normData`, por exemplo) precisa conviver com a versão anterior.

## Trabalho em equipe: antes de começar

Duas frentes mexem no Flow ao mesmo tempo, a Lidera e a Adventure. As duas usam a mesma conta do GitHub, e quase tudo está num arquivo só. Para ninguém desfazer o trabalho do outro, o Claude segue estes passos em toda sessão, sem precisar que peçam:

1. **Atualizar antes de tudo:** `git switch main && git pull --ff-only`. Se houver mudança local que não foi salva num commit, pare e pergunte o que fazer com ela.
2. **Ver o que está em andamento:** `gh pr list --state open`. Em cada PR aberto, olhe o título e as funções que ele mexe (`gh pr diff <n>`). Se algum mexe na mesma tela ou nas mesmas funções do pedido, **pare e avise**: "a tela X está em andamento no PR #N; combine com o outro responsável antes". Não continue por cima.
3. **Marcar a tela como ocupada logo no começo:** crie a branch com o prefixo de quem pediu (`lidera/<tema>` ou `adv/<tema>`), faça um primeiro commit pequeno e abra o PR como **rascunho** (`gh pr create --draft`), com a tela no título (ex.: "Estoque → Posição: …"). O rascunho é o aviso para o outro lado.
4. **Um assunto por PR.** Pedido de outra tela vai em outra branch e outro PR.
5. **Quem fez fica no commit:** como a conta do GitHub é compartilhada, o nome da pessoa vai no autor do commit. Na primeira sessão nesta pasta, se `git config user.name` estiver vazio ou genérico, pergunte o nome e rode `git config user.name "<nome> (<empresa>)"`. A configuração vale só para esta pasta.
6. **No corpo do PR, sempre:** quem pediu, quem fez (pessoa ou agente) e se foi testado no preview.
7. **O Claude só faz o merge com ordem explícita.** Pode rodar `gh pr merge <n> --squash --delete-branch`, mas **só quando a pessoa disser, na conversa, que testou no preview e que pode subir**. Antes, `gh pr view <n>` precisa mostrar a branch em dia com a `main`. Se não estiver, atualize e espere o preview novo. Lembre: merge é deploy em produção.
8. **Conflito:** se o GitHub acusar conflito ou "out-of-date", o Claude atualiza a branch com a `main` e resolve. Se o conflito cair numa parte que o outro lado acabou de mudar, pergunte antes de escolher qual versão fica.

## Como está organizado

| Caminho | O que é |
|---|---|
| `index.html` | O Flow inteiro: HTML, CSS e JS puro num arquivo só (~13,6 mil linhas), sem build nem framework. Bibliotecas por CDN (supabase-js, pdf.js, xlsx). |
| `pdv/index.html`, `pdv/sw.js` | Flow PDV (PWA). O `index.html` é gerado a partir de fontes que ainda não estão no repo (`parte1.html`, `parte2.js`, `parte3.js`, `parte4.js` e `montar.py`). Até entrarem, não edite o `pdv/index.html` à mão. |
| `versao.json` | Data da última versão maior (veja acima). |
| `CNAME` | Domínio do GitHub Pages. Não mexer. |
| `supabase/functions/` | Edge Functions (Deno). |
| `supabase/*.sql` | SQL do banco. A maior parte ainda vai entrar no repo. |
| `tools/` | Preview sem banco, servidor local e smoke com Playwright. |

## Modelo de dados e salvamento

- **Cada restaurante é uma linha em `organizacoes`, e quase todo o ERP dele é um JSON só:** `organizacoes.dados`, que é o objeto `DB` do app (lançamentos, insumos, fichas, estoque, equipe, folha…). O resto (perfis, CRM, histórico, PDV, NF-e, erros) fica em tabelas próprias.
- Papéis em `perfis.papel`: `admin` (Lidera), `consultor` (vê só a carteira dele) e `cliente` (dono e equipe, presos à própria organização). Os níveis de equipe (Gerente, Estoquista, Compras…) ficam em `NIVEIS` e as permissões finas em `ESTOQUE_SUBS`. No código, pergunte sempre por `pode('<acesso>')` e `podeVerValores()`.
- **Salvar:** `save()` → `cloudCommit()`. O app grava o JSON inteiro com trava otimista em `atualizado_em`. Se outra sessão gravou antes, ele busca a versão do servidor e faz a **mesclagem em 3 vias** (`merge3`): coleções com `id` são combinadas por registro, listas simples viram união e, nos valores simples, vence o meu se eu mudei.
  - Por isso **todo registro de coleção precisa de `id`**, e os dados padrão usam **IDs determinísticos** (ex.: checklists `chk-<slug>`). Sem isso, o merge duplica.
  - `cloudPoll` puxa a versão do servidor a cada 45 s quando não há nada pendente.
  - Cada gravação pode gerar uma versão em `organizacoes_historico` (no máximo uma a cada 15 min). Restaurar é manual.
- **`normData`** roda ao abrir e completa ou migra o `DB`. Migração nova entra aqui, idempotente.
- **`dbDaOrg(org)`** completa o `DB` padrão sem perder chave existente. Nunca troque por "se não tem X, usa `emptyDB()`": uma organização preenchida só por integração já perdeu dados assim.
- **No painel admin, `o.dados` é PARCIAL** (a lista vem de uma view leve). Toda escrita do admin precisa reler o `dados` inteiro e trocar só as chaves certas (`adminSaveOrgKeys`, `projSaveOrg`, `cadSaveOrg`).
- Sem banco (`sb = null`), o app roda no **modo local**, com os dados no `localStorage` (`STORE_KEY`). É o modo que o preview usa.

## Convenções do código

- **Textos** em português do Brasil, na linguagem do dono de restaurante. Números e moeda no formato brasileiro (`fmtBRL`, `fmtN`, `parseNumBR`).
- **Escape:** todo texto vindo de dado passa por `esc()` antes de ir para o HTML. `toast(msg)` recebe texto puro (não use `esc()` ali); `toastHtml` é a exceção e o dado dentro dele leva `esc()`. JSON em atributo: `${esc(JSON.stringify(x))}`.
- **Chave é `id`, nunca nome.** Meios de pagamento, canais, armazéns e categorias têm `id` fixo; o nome é só rótulo e pode ser renomeado.
- **Confirmação:** use `uxConfirma({titulo,texto,sim,nao,perigo},cb)`, não `confirm()`. Ação que apaga sempre pergunta.
- **Filtros:** filtro com muitas opções usa `mselHTML(id,cfg)` (busca, contagem, folha de baixo no celular); lista longa ganha `buscaLista`.
- **Ação principal** da tela fica em `#topActions` (`btn-primary`); Imprimir é secundário (`btn-ghost`). Barra com mais de 3 ações usa `ddMais`.
- **Redesenho:** não redesenhe a tela inteira a cada tecla (perde o foco). Atualize só os totais, como em `bdRefresh`.
- **Erros de tela** vão para `app_erros` (`errRegistrar`), que o admin vê.
- **Notificação interna:** `notificar(alvo,titulo,texto,{rota,…})`, com alvo por permissão, setor ou admin.
- **Nada de regra fixa para um cliente no código.** Tudo é genérico e ligado por parâmetro ou permissão.
- Identidade visual: azul `#1D3573`, dourado `#A48A57`, off-white `#F2F2F2`; Fraunces (títulos) e Inter.
- O menu lateral não deve ser reorganizado nem renomeado sem pedido do responsável.

### Celular

- Toda tela nova é conferida em 375 a 390 px. `ehMobile()` (`innerWidth<=640`) decide o layout por JS.
- Regras globais em `@media(max-width:640px)`: `.input` com 16 px de fonte (evita o zoom do iOS) e 44 px de altura, botões de 38 a 46 px, modal vira folha de baixo.
- `<table class="tc">` vira cartões no celular. Classes úteis: `mob-stack`, `mob-head`, `mob-hide`, `mob-only`.
- Nenhuma tela pode ter rolagem lateral: meça `documentElement.scrollWidth > clientWidth`.
- Telas de operação (contagem, recebimento de nota, requisição, produção, checklist, lista de compras) são desenhadas para o celular primeiro. Telas de cadastro pesado podem ser otimizadas para o computador, mas não podem quebrar no celular.
- Input de arquivo: `capture` esconde a galeria e os PDFs no iPhone. Por isso a nota tem dois inputs, um com câmera e um sem.

### Impressão

- `window.print()` da tela sai em branco (o `.main` tem altura fixa). Toda folha usa `#printArea` + classe própria (`print-contagem`, `print-ficha`, `print-buffet`, `print-rel`, `print-desp`).
- Todo `@page` é nomeado com `margin:0`, e a margem vem de `pgWrap(html,tipo)`. A moldura se chama `folhapg` porque `.pg` já existe.
- **Nenhuma folha leva rodapé** ("Flow by Lidera", "Gerado em…", usuário).
- `imprimirTela()` clona a tela atual e limpa botões, filtros e inputs.
- Para ver a folha sem abrir o diálogo: `window.print=()=>{}` e olhar o `#printArea`.

## Regras de negócio por módulo

### Financeiro

- **Lançamento (`DB.lancamentos`)** é a fonte do resultado real: alimenta DRE, Fluxo de Caixa e Dashboard. `data` = competência (o DRE lê por `dreLanc()`); `liquidacoes` = caixa (o Fluxo lê por `liqDe()`). Sem `liquidacoes`, o lançamento é à vista na própria data.
- **Nunca grave campo novo dentro de `l.liquidacoes`:** as parcelas são refeitas a cada edição da nota e o campo some. Dados por parcela (boletos e anexos) ficam em `DB.boletos`.
- **Meios de pagamento (`fin.meios`)**, com `id` fixo, viram forma de pagamento e subcategoria de Receita. Prazo padrão: D+0 dinheiro e PIX, D+1 débito, D+30 crédito; também há regra mensal, semanal e convênio. A taxa de cartão é **calculada** no DRE ("Taxas de recebimento", marcada CALCULADO) e nunca gravada como lançamento.
- `fin.receitaBruta` (padrão ligado): desligue quando o cliente lança o líquido que caiu na conta, senão a taxa sai duas vezes.
- **Fora do caixa** (`foraDoCaixa`): permuta, bonificação, troca e lançamento com pagamento pendente. Fora do DRE: nota grátis (valor 0), juros, multa e desconto da cobrança, e a conta avulsa MANUAL.
- **Separação fiscal × financeiro** (`fin.sepFiscalFin`): quem lança a nota (`fin_nota`) não define o pagamento (`fin_pagto`); a nota entra com `pagtoPendente` e vai para uma fila. Membro antigo sem a chave = liberado.
- **Compra a prazo:** um lançamento por item da nota, cada um com suas parcelas; "Parcelar a nota" dá a todos os itens as mesmas datas. Sem vencimento, o padrão é 30/60/90 sem entrada. A condição do fornecedor nunca sobrescreve parcelas já definidas.
- **Número da NF:** `nfKey()` compara só os dígitos sem zeros à esquerda; `nfJaLancada` avisa duplicata. Compra sem NF ganha número interno `INT-0001`.
- **Impostos no custo da nota:** entram ICMS-ST, FCP-ST, IPI, frete, seguro e outras despesas, item a item. O ICMS normal **não** entra (já está no preço). `extrasSuspeito` quase sempre é item não lido no PDF, não imposto.
- **Padrão de compra:** o produto tem `uni` (g, ml, un, kg, L) e uma embalagem opcional (`embNome` + `embQtd`). `lmQtdNaUnidade` converte a quantidade da nota; se não consegue, o custo não atualiza e a linha mostra o aviso âmbar que abre `lmPadraoCompraModal`. **Salvar a nota nunca altera `ins.uni`.** A embalagem "só nesta nota" fica na linha (`r.embLanc`).
- **Bonificação e troca:** valor 0 com `tipoNota`, sem mudar o preço de compra do produto. Bonificação entra no estoque com custo zero; troca entra pelo custo médio e dá saída do devolvido.
- **Folha:** encargos (`fe_`) e rescisão são despesa real e ficam mesmo quando se remove o colaborador; só os salários (`fn_`) saem.

### DRE e metas

- 13 grupos padrão da planilha-modelo do PLL (Receita, CMV, Mão-de-Obra, Encargos Sociais, Benefícios, Impostos, Despesas Prediais, Terceiros, Utilidades, Publicidade, Materiais, Despesas Gerais, Despesas Financeiras).
- **7 centros da referência PLL:** CMV ≤ 30%, CMO ≤ 25%, Fixas ≤ 15%, Impostos ≤ 8%, Taxas de cartão ≤ 3%, Marketing 2 a 5%, Manutenção 1 a 2%, Lucro ≥ 15%. A régua é ajustável por cliente: leia sempre por `reguaCentros()`/`reguaLucro()`, nunca pelas constantes.
- **Dashboard:** uma tela sem rolagem no computador. Os números vêm de `dashCentros` (o mesmo do DRE). O Ponto de Equilíbrio fica no Financeiro, não no Dashboard. Blocos removidos a pedido não voltam sem pedido.
- **Compra da semana:** semana de **terça a segunda**; meta = vendido na semana anterior × CMV alvo, fixa a semana inteira. A regra é igual à do painel de controle comercial da Lidera: **se um mudar, os dois mudam juntos.**
- Metas de faturamento (mínimo, realista, desafiador) são digitadas por mês; o Dashboard acompanha a realista. Dias de funcionamento e feriados descontam do ritmo diário.

### Fichas técnicas e produtos

- 5 unidades oficiais: `gr`, `ml`, `un`, `kg`, `lt`. Não troque a convenção.
- Quantidade de ingrediente na ficha é sempre na **unidade-base** (g, ml, un). Bebida em garrafa é cadastrada em ml ou L, nunca em "un".
- Preparado = insumo com `tipo:'preparado'` (sub-receita com rendimento). Com `estocavel:true` vira subproduto: tem estoque próprio e a venda baixa o subproduto, não o bruto.
- **Porção** é só conversão (`porcaoBase` na unidade-base). Estoque, custo e lançamentos continuam na unidade do preparado.
- **Revenda:** produto com `revenda:true` gera uma ficha espelho travada; dose de bebida usa só `f.revDose`. Use `fRev(f)` para saber se a ficha é espelho.
- Trocar a unidade entre dimensões (kg ↔ un) exige converter as receitas (`insConvCheck`). Apagar ingrediente em uso pergunta pelo substituto e deixa lápide em `DB.insApagados`.
- Canais de delivery (até 3) em `fin.canais`, com preço por canal em `ficha.precos[id]`. Balcão não é canal.

### Estoque

- O saldo é resultado do **livro** `DB.estoqueMov` (kardex). Função central: `estMov(tipo,insumoId,q,opts)`; desfazer por origem: `estReverter(origem,refId)`. Custo médio ponderado em `ins.cmp`.
- **`estAplicaSaldo` é o único caminho para mexer em saldo.** Mexer em `estoqueAtual` ou `estoquePor` à mão desalinha o total e os armazéns.
- **Registre a entrada da compra ANTES de atualizar `ins.preco/qtd`**, senão o custo médio anterior vira o preço novo.
- Saldo negativo só avisa, nunca bloqueia (a importação do PDV não pode travar).
- Armazéns (`fin.armazens`, sempre com `principal`) são opcionais. Transferência, requisição para a cozinha, produção e retorno ao principal passam pelo livro.
- Na Posição, valores em dinheiro só aparecem com `podeVerValores()`.
- Chaves internas das abas: a aba **Posição** é `contagem`; a **Contagem física** é `contar`.

### NF-e (Sefaz)

- **Regra de ouro: nada vira lançamento sozinho.** A nota entra na caixa "Notas recebidas da Sefaz" e alguém do fiscal clica em "Revisar e lançar" (`nfeRevisar`), que abre a mesma tela de lançamento já preenchida.
- O vínculo item → produto é aprendido no lançamento (`fin.nfeCodigos`).
- A consulta à Sefaz roda fora das Edge Functions, numa automação separada. A ciência da nota só vale até 10 dias da emissão.

### Buffet

- Mapa do Buffet (cubas, preço por kg, CMV por cuba), Buffet do dia, Semana e Relatório.
- Regra da consultoria: CMV ideal de 30% e regra 80/20 (80% dos itens com CMV ≤ 30%).
- Método A/B/C/D em `bdDiaCalc`: A teórico, B o que o cliente comeu, C real (B + descarte), D com o almoço da equipe. Dia passado guarda o custo de quando foi digitado.

### PDV e integrações de venda

- **Receita = o que entrou no caixa, por dia e por meio:** um lançamento por (dia, meio), com chave de idempotência por integração. Vendas por prato vão para `vendasPendentes` e são baixadas ao abrir "Baixa por vendas", casando por `codPdv` ou nome da ficha.
- Cancelamento depois de contado é estornado. O dia do negócio é ajustado pelo relógio de cada PDV.
- Cliente que já digitava a receita à mão fica duplicado quando a integração liga: confira antes de ligar.
- Flow PDV: app isolado do Flow (tabelas, sessão e service worker só em `/pdv/`), com livro de eventos só de inclusão. **Não pode impactar os clientes atuais do Flow.**

### Equipe, checklists, POPs e formação

- Membro da equipe em `DB.equipe[]`, com setores (`m.setores`) e permissões (`m.sub`). Membro antigo sem `sub` = tudo liberado dentro das áreas dele.
- Checklists: o foco é a **folha impressa** mensal para preencher à mão.
- POPs: novo documento padrão entra em `POP_DEFAULTS` e sobe `_popsV` nos dois pontos de `viewPops`.
- Formação: catálogo único com vídeos do YouTube (nocookie) num player dentro do app.

### Consultoria (admin)

- Painel admin com a lista de clientes e o cockpit de Gestão de Projetos (Plano de Guerra por etapas, reuniões, demandas). O CRM fica fora do `dados` do cliente, porque o cliente não pode ver as anotações internas.
- Cliente-grupo: dono com várias unidades vira uma linha extra com `dados._grupo=true`.
- Demos: organizações com `dados._demo=true`, fora da contagem de clientes.

## Armadilhas conhecidas

- `python3 -m http.server` puro quebra o app (`SyntaxError`) porque manda `text/html` sem `charset=utf-8`. Use `tools/serve.py`.
- Não sirva arquivos direto de pasta do Google Drive (`PermissionError`).
- Com o painel do navegador escondido, `innerWidth` vale 0 e `ehMobile()` vira true. Fixe o tamanho da janela antes de testar o layout do computador.
- Captura headless com `--window-size=375` não emula celular. Use a emulação do Playwright (`tools/smoke`).
- `html{scroll-behavior:smooth}`: desligue antes de `scrollTo` para capturar a tela.
- Especificidade de CSS: um seletor mais específico fora do `@media` vence a regra do `@media`. Repita o seletor completo dentro dele.
- `input` dentro de flex estoura a tela sem `width:0;flex:1 1 0;min-width:0`.
- Valor unitário aceita até 4 casas: use `parseNumBR`/`fmtUnitInput`, não a máscara de centavos.
- Mapeamento de colunas de planilha por `includes`: `'nf'` casaria com "Informações". Termos curtos só como cabeçalho inteiro.
- O mesmo fornecedor com dois nomes separa listas de boletos, saldos de permuta e CNPJ. Ainda não há unificação.
- Nunca rode varredura SQL pesada (`jsonb_array_elements` em todas as organizações) na produção. O banco é pequeno e trava. Auditoria de dados é feita offline, em cópia de backup.
- O mesmo projeto Supabase também atende outros apps da Lidera. Mudança global de banco, de plano ou de autenticação afeta todos.

## Integrações (só os nomes; detalhes fora do repo)

- **Supabase:** Postgres, Auth, Storage (anexos) e Edge Functions.
- **Leitor de notas por IA:** Edge Function `ler-nota` (Gemini). Exige usuário logado.
- **Flow API v1:** Edge Function `flow-api` (`POST /v1/vendas`, `GET /v1/fichas`, `GET /v1/resumo`), com token por restaurante. Reenviar a mesma `chave` substitui a venda do dia. O `/v1/resumo` é soma simples, não o DRE.
- **NF-e Sefaz:** `nfe-sync` + automação de consulta.
- **PDVs e ERPs de venda:** `suitable-sync`, `takeat-sync`, `cardapioweb-sync`, `mpi-sync`, `instadelivery-webhook`.
- **Bancos:** `banco-sync` (API direta e OFX).
- **Cadastro de usuários:** `criar-cliente`, `criar-membro`.
- **Anexos:** `anexos-limpar` (limpeza agendada).
- **Google Agenda e Meet:** reuniões da Gestão de Projetos.
- **Bibliotecas por CDN:** supabase-js, pdf.js (DANFE e Plano de Guerra) e xlsx.

## O que nunca fazer

- Gravar no banco de produção para testar.
- Fazer merge sem testar no preview, ou publicar sem o OK de um dos dois responsáveis.
- Pôr segredo, nome de cliente, dado pessoal ou achado de segurança no repo, em issue ou em PR.
- Mudar dados de um restaurante sem o OK dele e sem backup antes.
- Criar função no banco ou na Edge Function que devolva certificado, chave privada ou qualquer segredo.
- Imprimir chave de integração no chat ou em log.
- Trocar `dbDaOrg` por `emptyDB()` ao abrir uma organização.
- Converter em massa dados de clientes (produtos, unidades, revendas). O dono decide item a item.

## Como pedir ajuda ao Claude neste repo

- Diga a tela e o fluxo (ex.: "Lançamentos → Notas da Sefaz → Revisar e lançar") e o que você esperava ver.
- Peça para o Claude criar a branch e o PR, e testar no preview com o print de 390 px.
- Você testa no link do preview do PR e, se estiver certo, clica em Merge ou diz ao Claude que pode subir (veja "Trabalho em equipe", passo 7).
- O Claude não grava no banco de produção, não faz deploy de Edge Function e não mexe em segredo.

## Como revisar mudança de permissão ou de dado

- No link de preview (ou no `tools/serve.py`), use o botão **Simular**: troque o perfil (Dono, cada nível da Equipe ou Personalizado, com setores) e monte cenários de dados (restaurante com setores, produtos em pacote ou caixa). Nada vai para o banco.
- O perfil passa pelo mesmo código do login de membro. Não cole comandos no console para trocar permissão: use o painel ou `flowSim` (veja `tools/README.md`).
- O painel existe só no preview. O `index.html` não ganha nada dele, e `tools/smoke/simulacao.mjs` confere isso.
- Regras do servidor (RLS, Edge Functions, gravação na nuvem) não são simuladas.
