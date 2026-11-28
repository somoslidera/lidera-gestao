-- Role só de leitura para o backup diário (tools/backup/backup.sh).
-- Rodar UMA VEZ no SQL Editor do Supabase, como postgres.
--
-- Antes de rodar: troque TROQUE_PELA_SENHA por uma senha forte (gerenciador de
-- senhas, 32+ caracteres, só letras e números para não precisar escapar na URL).
-- Depois de rodar, apague a senha desta aba sem salvar a query.
--
-- O que a role pode: LER tudo (public, auth, storage, cron.job), ignorando o RLS,
-- que é o que o pg_dump exige. Não pode gravar, criar nem apagar nada.

begin;

create role backup_ro
  login
  password 'TROQUE_PELA_SENHA'
  nosuperuser nocreatedb nocreaterole noreplication
  bypassrls
  connection limit 2;

-- Não deixar o backup pesar no banco: sem trava longa, sem sessão esquecida.
alter role backup_ro set statement_timeout = '30min';
alter role backup_ro set idle_in_transaction_session_timeout = '5min';
alter role backup_ro set default_transaction_read_only = on;

-- public: tudo, inclusive tabelas criadas no futuro.
grant usage on schema public to backup_ro;
grant select on all tables in schema public to backup_ro;
grant select on all sequences in schema public to backup_ro;
alter default privileges for role postgres in schema public grant select on tables to backup_ro;
alter default privileges for role postgres in schema public grant select on sequences to backup_ro;

-- auth e storage: os logins e o índice dos anexos.
grant usage on schema auth, storage to backup_ro;
grant select on all tables in schema auth to backup_ro;
grant select on all tables in schema storage to backup_ro;
grant select on all sequences in schema auth to backup_ro;
grant select on all sequences in schema storage to backup_ro;

-- cron: só a lista de rotinas.
grant usage on schema cron to backup_ro;
grant select on cron.job to backup_ro;
grant select on all sequences in schema cron to backup_ro;

commit;

-- Conferência: tudo tem que vir "true". Se algum vier false, me avise antes de seguir.
select t as tabela, has_table_privilege('backup_ro', t, 'SELECT') as le,
       not has_table_privilege('backup_ro', t, 'INSERT') as nao_grava
from unnest(array['public.organizacoes', 'public.perfis', 'auth.users',
                  'storage.objects', 'cron.job']) as t;
