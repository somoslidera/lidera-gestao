-- Anexos do Flow: boletos e comprovantes por parcela · 12/11/2026
-- Arquivos no Storage (bucket privado "anexos"), caminho <org_id>/<ano>/<arquivo>. O banco guarda só o caminho, em dados.boletos.
-- Cada usuário só lê, envia e apaga arquivos das organizações que ele acessa (mesma regra da tabela organizacoes).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('anexos', 'anexos', false, 5242880, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.anexo_acesso(nome text) returns boolean
language sql stable security definer set search_path to 'public' as $$
  -- $1 e não "nome": dentro do subselect "nome" seria a coluna organizacoes.nome
  select case
    when split_part($1, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then exists (select 1 from public.organizacoes o
                 where o.id = split_part($1, '/', 1)::uuid
                   and (public.eh_admin() or o.consultor_id = auth.uid() or o.id = public.minha_org()))
    else false end;
$$;
revoke all on function public.anexo_acesso(text) from public, anon;
grant execute on function public.anexo_acesso(text) to authenticated;

drop policy if exists anexos_sel on storage.objects;
drop policy if exists anexos_ins on storage.objects;
drop policy if exists anexos_del on storage.objects;
create policy anexos_sel on storage.objects for select to authenticated using (bucket_id = 'anexos' and public.anexo_acesso(name));
create policy anexos_ins on storage.objects for insert to authenticated with check (bucket_id = 'anexos' and public.anexo_acesso(name));
create policy anexos_del on storage.objects for delete to authenticated using (bucket_id = 'anexos' and public.anexo_acesso(name));

select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'anexos';
