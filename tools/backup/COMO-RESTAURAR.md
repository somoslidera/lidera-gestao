# Como restaurar o backup do Flow

O backup roda todo dia às 04:30 (Brasília) pelo GitHub Action **Backup do banco** (`.github/workflows/backup.yml`). Ele usa o script `tools/backup/backup.sh`.

## O que tem no backup

Cada arquivo `flow-AAAA-MM-DDTHHMMZ.tar.age` fica no bucket R2 da Lidera, na pasta `flow/`. Ele é **criptografado com age**, e por dentro tem:

| Arquivo | Conteúdo |
|---|---|
| `public.dump` | Estrutura e dados de todo o app: `organizacoes` (o ERP de cada restaurante), histórico, perfis, CRM, PDV, NF-e etc. Inclui as tabelas do Hub e do Social, que dividem o projeto. |
| `auth-storage.dump` | Só dados: os logins (`auth.*`) e o índice dos anexos (`storage.*`). |
| `cron-job.dump` | Só dados: a lista de rotinas agendadas (`cron.job`). |
| `MANIFESTO.txt` | Data, versão do pg_dump e sha256 de cada arquivo. |

**Fora do backup:** os arquivos dos anexos em si (PDFs e fotos do Storage), os secrets das Edge Functions e o código, que está no git.

**O backup contém dados sensíveis**, como certificados e tokens de integração que ficam no banco. Nunca descriptografe numa pasta sincronizada (Drive, iCloud) e apague a cópia aberta ao terminar.

## O que você precisa

- A **chave privada** do age (`AGE-SECRET-KEY-…`). Ela fica no Infisical da Adventure (`/clientes/LIDERA` → `FLOW_BACKUP_AGE_KEY`) e numa cópia guardada pela Lidera. A chave pública está em `tools/backup/chave-publica.age.txt`.
- `age` e as ferramentas do PostgreSQL 17 ou mais novas (`brew install age libpq` no Mac).
- Acesso ao bucket R2 (painel Cloudflare da Lidera → R2 → bucket do backup → pasta `flow/` → baixar).

## 1. Abrir o arquivo

```bash
mkdir -p ~/flow-restaurar && cd ~/flow-restaurar     # fora de Drive e iCloud
# salve a chave privada num arquivo só seu: chave.txt (chmod 600)
age -d -i chave.txt flow-AAAA-MM-DDTHHMMZ.tar.age | tar -xf -
shasum -a 256 -c <(grep dump MANIFESTO.txt)           # os 3 têm que dar OK
```

## 2a. Recuperar os dados de UM restaurante (o caso mais comum)

Antes de tudo, veja se o **histórico de versões** no próprio banco (`organizacoes_historico`) já resolve: ele guarda versões recentes de cada restaurante. O backup serve quando o histórico não alcança.

Restaure só a tabela num Postgres local descartável e pegue o JSON:

```bash
docker run -d --name flow-restaurar -e POSTGRES_PASSWORD=local -p 55432:5432 postgres:17
export PGPASSWORD=local; U=postgresql://postgres@localhost:55432/postgres
pg_restore -d "$U" --no-owner --table=organizacoes public.dump
psql "$U" -c "select id, nome, atualizado_em from organizacoes order by nome;"
psql "$U" -At -c "select dados from organizacoes where id = '<id do restaurante>'" > dados.json
```

**Devolver esse JSON para a produção é gravar em dado de cliente.** Só com o OK do cliente, com backup do estado atual antes e pela trava de `atualizado_em`. Veja "Como gravar dados de cliente" no contexto técnico. Na dúvida, chame a Adventure.

## 2b. Desastre: subir tudo num projeto Supabase novo

Este caminho foi testado em 26/11/2026 num Postgres 17 que simulava um projeto novo, e todas as linhas voltaram.

1. Crie o projeto novo no Supabase (região sa-east-1). Pegue a connection string do **Session pooler** com o usuário `postgres` (Project Settings → Database).
2. Restaure **primeiro** os logins e o índice dos anexos, porque as tabelas do app apontam para `auth.users`:
   ```bash
   U='postgresql://postgres.<ref-novo>:<senha>@<pooler>:5432/postgres?sslmode=require'
   pg_restore -d "$U" --data-only --disable-triggers auth-storage.dump
   ```
3. Depois o app inteiro:
   ```bash
   pg_restore -d "$U" --no-owner public.dump
   ```
   Erros esperados e inofensivos: `schema "public" already exists` e `role "backup_ro" does not exist` (recrie a role com `tools/backup/criar-role-backup.sql` se quiser o backup no projeto novo). **Qualquer outro erro: pare e confira.**
4. Rotinas agendadas: veja a lista com `pg_restore -f - cron-job.dump` e recrie com `cron.schedule(...)`.
5. Edge Functions: `supabase functions deploy` de cada uma, a partir de `supabase/functions/` (veja `supabase/README.md`), e recadastre os secrets.
6. Aponte o front para o projeto novo: `SUPA_URL` e a anon key no `index.html` (e no PDV), por PR.
7. Os arquivos dos anexos não estão neste backup.

## Conferir que o backup está rodando

- GitHub → Actions → **Backup do banco**: o último run deve estar verde e ter menos de 1 dia. O log mostra só o nome, o tamanho e o sha256 do arquivo.
- No R2, `flow/` deve ter um arquivo por dia. A regra do bucket apaga os arquivos com mais de 30 dias.
- Testar a restauração (passo 2a) de vez em quando, porque backup que nunca foi aberto não é backup.
- Se o run falhar, o GitHub avisa por e-mail quem editou o workflow por último.
- **Atenção:** o GitHub **desliga sozinho** o agendamento depois de 60 dias sem nenhum commit no repo. Se o Flow ficar parado esse tempo, reative em Actions → Backup do banco → Enable workflow.
