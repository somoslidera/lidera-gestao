# supabase/: back-end do Flow

O código das Edge Functions do projeto `flow` passa a morar aqui, no git, em vez do Drive e do próprio Supabase (decisão D1 do Marco 0).

## De onde veio

Cada `functions/<nome>/index.ts` foi baixado em **26/11/2026** da versão **publicada** no Supabase (Management API, só leitura). Por isso o que está aqui é exatamente o que está rodando hoje.

| Função | Versão publicada | Gateway exige JWT? |
|---|---|---|
| `flow-api` | 27 | não (token por restaurante, `flow_api_keys`) |
| `ler-nota` | 39 | **sim** |
| `criar-cliente` | 27 | não (confere no código que é admin) |
| `anexos-limpar` | 5 | não (`x-cron`) |

As outras funções do Flow continuam fora do git por enquanto e entram nos próximos PRs do Marco 0: `nfe-sync`, `banco-sync`, `suitable-sync`, `takeat-sync`, `cardapioweb-sync`, `mpi-sync`, `instadelivery-webhook` e `criar-membro`. As funções do Lidera Hub e do Lidera Social, que dividem o mesmo projeto, não fazem parte deste repo.

## Regras

- **Revisão de segurança antes de entrar no repo.** Função nova, ou mudança em quem pode chamar o quê, só entra depois de alguém conferir: quem chama, com qual `orgId` e com qual papel (dono, membro da equipe, consultor, admin). O repo é público, então um problema encontrado vai direto aos responsáveis, nunca para issue ou PR.
- **Nenhum valor de segredo no código.** Tudo vem de `Deno.env.get(...)`, configurado em *Edge Functions → Secrets* no painel do Supabase.
- Mudou uma função? O PR traz o código, e o deploy acontece **depois** do merge, a partir da `main`:
  ```bash
  supabase functions deploy <nome> --project-ref fvcbxorfstqqeewocxkf --use-api --no-verify-jwt
  # exceção: ler-nota é publicada COM verificação de JWT (sem --no-verify-jwt)
  ```
- Antes do deploy, confira que a versão publicada ainda é a do git, para não sobrescrever uma mudança feita direto no painel:
  ```bash
  supabase functions download <nome> --project-ref fvcbxorfstqqeewocxkf --use-api --workdir /tmp/conferir
  diff /tmp/conferir/supabase/functions/<nome>/index.ts supabase/functions/<nome>/index.ts
  ```

## SQL

O SQL de criação das tabelas ainda está no Drive do responsável técnico. Ele entra num PR próprio do Marco 0. `anexos-setup.sql` já estava aqui.
