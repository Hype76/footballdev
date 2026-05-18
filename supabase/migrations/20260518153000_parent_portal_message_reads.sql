create table if not exists public.parent_portal_message_reads (
  id uuid primary key default gen_random_uuid(),
  parent_link_id uuid not null references public.parent_player_links (id) on delete cascade,
  communication_log_id uuid not null references public.communication_logs (id) on delete cascade,
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  read_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists parent_portal_message_reads_unique
on public.parent_portal_message_reads (parent_link_id, communication_log_id, auth_user_id);

create index if not exists parent_portal_message_reads_auth_idx
on public.parent_portal_message_reads (auth_user_id, parent_link_id);

alter table public.parent_portal_message_reads enable row level security;

grant select, insert on public.parent_portal_message_reads to authenticated;

drop policy if exists parent_portal_message_reads_select_own on public.parent_portal_message_reads;
create policy parent_portal_message_reads_select_own
on public.parent_portal_message_reads
for select
to authenticated
using (auth_user_id = auth.uid());

drop policy if exists parent_portal_message_reads_insert_own on public.parent_portal_message_reads;
create policy parent_portal_message_reads_insert_own
on public.parent_portal_message_reads
for insert
to authenticated
with check (auth_user_id = auth.uid());

drop function if exists public.get_parent_portal_email_messages(uuid);

create or replace function public.get_parent_portal_email_messages(parent_link_id_value uuid)
returns table (
  id uuid,
  player_id uuid,
  evaluation_id uuid,
  sender_name text,
  sender_email text,
  recipient_email text,
  metadata jsonb,
  read_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    log.id,
    log.player_id,
    log.evaluation_id,
    log.user_name as sender_name,
    log.user_email as sender_email,
    log.recipient_email,
    log.metadata,
    read_log.read_at,
    log.created_at
  from public.communication_logs log
  join public.parent_player_links link
    on link.id = parent_link_id_value
    and link.auth_user_id = auth.uid()
    and link.status = 'active'
    and link.player_id = log.player_id
    and link.club_id = log.club_id
  left join public.parent_portal_message_reads read_log
    on read_log.parent_link_id = link.id
    and read_log.communication_log_id = log.id
    and read_log.auth_user_id = auth.uid()
  where auth.uid() is not null
    and log.channel = 'email'
    and log.action = 'parent_email_sent'
  order by log.created_at desc;
$$;

grant execute on function public.get_parent_portal_email_messages(uuid) to authenticated;

create or replace function public.mark_parent_portal_message_read(
  parent_link_id_value uuid,
  communication_log_id_value uuid
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  read_timestamp timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Login is required before opening this message.';
  end if;

  if not exists (
    select 1
    from public.parent_player_links link
    join public.communication_logs log
      on log.id = communication_log_id_value
      and log.player_id = link.player_id
      and log.club_id = link.club_id
      and log.channel = 'email'
      and log.action = 'parent_email_sent'
    where link.id = parent_link_id_value
      and link.auth_user_id = auth.uid()
      and link.status = 'active'
  ) then
    raise exception 'This message could not be opened.';
  end if;

  insert into public.parent_portal_message_reads (
    parent_link_id,
    communication_log_id,
    auth_user_id
  )
  values (
    parent_link_id_value,
    communication_log_id_value,
    auth.uid()
  )
  on conflict (parent_link_id, communication_log_id, auth_user_id)
  do update set read_at = public.parent_portal_message_reads.read_at
  returning read_at into read_timestamp;

  return read_timestamp;
end;
$$;

grant execute on function public.mark_parent_portal_message_read(uuid, uuid) to authenticated;
