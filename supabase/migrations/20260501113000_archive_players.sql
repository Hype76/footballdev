alter table public.players
  add column if not exists archived_reason text,
  add column if not exists archived_at timestamp with time zone,
  add column if not exists archived_by uuid references auth.users(id),
  add column if not exists archived_previous_status text;

update public.players
set status = 'active'
where status is null or btrim(status) = '';
