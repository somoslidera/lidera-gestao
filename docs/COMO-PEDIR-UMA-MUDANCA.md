# Como eu peço uma mudança no Flow agora

Uma página só. Você não precisa saber programar: o Claude faz a parte técnica, e você **testa** e **aprova**.

## O que mudou

- O Flow agora mora **neste repositório** (`somoslidera/lidera-gestao`). A pasta "Ágil Disc" do Drive vira **só consulta**: não edite mais por lá.
- Ninguém publica direto. Toda mudança vira um **PR**: um pedido de mudança com link de teste.
- **Quando você clica em Merge, a mudança vai para o ar** em `flow.somoslidera.com.br` em uns 2 minutos.

## Uma vez só: preparar a pasta

Abra o Claude Code numa pasta fora do Drive (por exemplo, `~/Code`) e cole:

> Clone o repositório `somoslidera/lidera-gestao` em `~/Code/lidera-gestao` e leia o `CLAUDE.md` dele. A partir de agora, todo trabalho no Flow é feito nesta pasta, e não no Drive.

Depois disso, abra o Claude sempre dentro de `~/Code/lidera-gestao`.

## Toda vez que quiser mudar algo

**1. Peça ao Claude.** Diga a tela, o que acontece hoje e o que você quer. Modelo para colar:

> Quero mudar [tela, ex.: Financeiro → Lançamentos → Notas da Sefaz]. Hoje acontece [o que acontece]. Quero que [o que deveria acontecer]. Siga o CLAUDE.md: crie uma branch, faça a mudança, teste no preview sem banco, abra o PR e me mande o link do PR, o link do preview e o print em 390 px.

**2. Receba os três links.** O Claude cria a branch, faz a mudança, testa e abre o PR. Ele te devolve:
- o link do PR (`github.com/somoslidera/lidera-gestao/pull/…`);
- o link do preview (`<nome-da-branch>.flow-preview.pages.dev`), que leva uns 2 minutos para ficar pronto e também aparece num comentário do Cloudflare dentro do PR;
- o print da tela no celular (390 px).

**3. Teste no link do preview.** É o Flow com a mudança, mas **sem banco**: ele abre num restaurante de demonstração e nada do que você fizer ali chega aos clientes. Teste no computador e no celular.
- Não ficou bom? Diga ao Claude o que falta. Ele corrige no mesmo PR, e o preview se atualiza sozinho.

**4. Aprove.** Ficou certo? Abra o link do PR e clique no botão verde **Merge pull request** e depois em **Confirm merge**.
- Se aparecer "This branch is out-of-date", clique antes em **Update branch** e espere o preview terminar.

**5. Confira no ar.** Depois de uns 2 minutos, recarregue `flow.somoslidera.com.br` e veja a mudança funcionando. Quem já está com o Flow aberto recebe a versão nova ao recarregar.

## Deu problema depois do merge?

No PR que entrou, clique em **Revert** e depois em **Merge**. O Flow volta a ser como era antes. Avise a Adventure.

## O que fica com a Adventure

- Mudança em **Edge Function** (o código entra pelo PR, mas o deploy é feito depois, à parte), no **SQL** ou no **banco**.
- Qualquer coisa que precise de **senha, chave ou certificado**.
- **Problema de segurança:** nunca em issue nem em PR, porque o repositório é público. Fale direto com a Adventure.

## Regras rápidas

- Nada de nome de cliente, dado pessoal, senha ou chave no PR. O repositório é público.
- Sem teste no preview, sem Merge.
- Mudança de tela sempre com print do celular.
