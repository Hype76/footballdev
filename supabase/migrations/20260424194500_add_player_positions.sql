alter table public.players
add column if not exists positions text[] not null default '{}'::text[];

update public.players
set positions = '{}'::text[]
where positions is null;
