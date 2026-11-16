-- Controle Financeiro da Obra — estrutura da nuvem (Supabase / Postgres)
-- Rodar UMA vez no SQL Editor do projeto. Pode ser rodado de novo sem estragar nada.
--
-- Modelo "local-first": o app guarda tudo no aparelho (IndexedDB) e espelha cada
-- registro aqui, como um documento JSON. Vantagem: evoluções do app não exigem
-- migração do banco na nuvem. Segurança: cada linha pertence a um usuário (RLS).

create table if not exists public.registros (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  store      text        not null,               -- items, payments, adjustments, ...
  id         text        not null,               -- id do registro no app
  data       jsonb       not null default '{}'::jsonb,
  deleted    boolean     not null default false, -- exclusão lógica (lápide)
  updated_at timestamptz not null default now(), -- relógio do SERVIDOR (cursor de sincronização)
  primary key (user_id, store, id)
);

create index if not exists registros_user_updated_idx on public.registros (user_id, updated_at);

-- updated_at sempre pelo relógio do servidor (evita erro de relógio do celular)
create or replace function public.registros_touch()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists registros_touch on public.registros;
create trigger registros_touch
  before insert or update on public.registros
  for each row execute function public.registros_touch();

-- Segurança por linha: cada usuário só enxerga e grava os próprios registros.
alter table public.registros enable row level security;

drop policy if exists "registros_select_proprio" on public.registros;
create policy "registros_select_proprio" on public.registros
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "registros_insert_proprio" on public.registros;
create policy "registros_insert_proprio" on public.registros
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "registros_update_proprio" on public.registros;
create policy "registros_update_proprio" on public.registros
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Sem política de DELETE: nada é apagado pela API (só lápide). Visitante (anon) não tem acesso.
revoke all on public.registros from anon;
grant select, insert, update on public.registros to authenticated;
