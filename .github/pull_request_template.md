## O que muda

<!-- Em linguagem de quem usa o Flow: tela, fluxo, antes → depois. -->

## Link de teste (homologação)

<!-- O Cloudflare Pages gera o link sozinho; ele corta o nome da branch em 28 caracteres:
     https://<nome-da-branch-com-hifens>.flow-preview.pages.dev
     O link fixo flow-preview.pages.dev mostra a main (o que JÁ está em produção): não serve para homologar. -->
Prévia: https://

Caminho na tela: <!-- ex.: Financeiro → Contas a Pagar → "○ Pago" numa parcela -->

O preview roda **sem banco**, com um restaurante de demonstração. Nada do que se faz ali chega ao Flow de verdade.

- [ ] **Toda mudança de tela traz, no mesmo PR, os dados fictícios que a deixam visível no preview (em tools/preview_mock.js). O link de teste nunca pode abrir a tela nova vazia.**

## Homologação

- [ ] Testado no computador
- [ ] Testado no celular (390 px), print anexado abaixo
- [ ] Quem testou comentou **"homologado"** neste PR

Enquanto a etiqueta **`homologar`** estiver no PR, ele **não** vai para produção. Depois do OK, tire a etiqueta e faça o merge (merge = produção).

## Teste automático

<!-- tools/smoke/*.mjs que cobre a mudança; diga se ele falha na main e passa aqui. -->

## Print 390 px

<!-- arraste a imagem aqui -->
