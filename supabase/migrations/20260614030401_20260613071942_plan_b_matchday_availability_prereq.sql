alter table public.match_days
  add column if not exists arrival_time time;

create table if not exists public.match_day_availability_requests (
  id uuid primary key default gen_random_uuid(),
  match_day_id uuid not null references public.match_days (id) on delete cascade,
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  player_id uuid not null references public.players (id) on delete cascade,
  player_name text not null default '',
  recipient_email text not null,
  recipient_name text not null default '',
  recipient_type text not null default 'parent',
  channel text not null default 'email',
  token_hash text not null,
  status text not null default 'pending',
  responded_at timestamptz,
  expires_at timestamptz not null default (timezone('utc', now()) + interval '21 days'),
  sent_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint match_day_availability_recipient_type_check check (recipient_type in ('parent', 'player')),
  constraint match_day_availability_channel_check check (channel in ('email', 'push')),
  constraint match_day_availability_status_check check (status in ('pending', 'available', 'unavailable', 'maybe', 'expired'))
);

create unique index if not exists match_day_availability_token_hash_key
on public.match_day_availability_requests (token_hash);

create unique index if not exists match_day_availability_request_unique_recipient
on public.match_day_availability_requests (match_day_id, player_id, recipient_email, recipient_type, channel);

create index if not exists match_day_availability_match_status_idx
on public.match_day_availability_requests (match_day_id, status, created_at);

create index if not exists match_day_availability_club_team_idx
on public.match_day_availability_requests (club_id, team_id, status);

create index if not exists match_day_availability_player_status_idx
on public.match_day_availability_requests (player_id, status, match_day_id);

alter table public.match_day_availability_requests enable row level security;
alter table public.match_day_availability_requests force row level security;

revoke all on public.match_day_availability_requests from public;
revoke all on public.match_day_availability_requests from anon;
revoke all on public.match_day_availability_requests from authenticated;

grant select, insert, update on public.match_day_availability_requests to authenticated;
grant select, insert, update, delete on public.match_day_availability_requests to service_role;

drop policy if exists match_day_availability_staff_select_scoped on public.match_day_availability_requests;
create policy match_day_availability_staff_select_scoped
on public.match_day_availability_requests
for select
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or (
    club_id = public.current_user_club_id()
    and public.current_user_role() <> 'parent_portal'
  )
);

drop policy if exists match_day_availability_staff_insert_scoped on public.match_day_availability_requests;
create policy match_day_availability_staff_insert_scoped
on public.match_day_availability_requests
for insert
to authenticated
with check (
  club_id = public.current_user_club_id()
  and public.can_manage_match_day(team_id)
);

drop policy if exists match_day_availability_staff_update_scoped on public.match_day_availability_requests;
create policy match_day_availability_staff_update_scoped
on public.match_day_availability_requests
for update
to authenticated
using (
  club_id = public.current_user_club_id()
  and public.can_manage_match_day(team_id)
)
with check (
  club_id = public.current_user_club_id()
  and public.can_manage_match_day(team_id)
);

create or replace function public.confirm_match_day_availability(
  token_hash_value text,
  status_value text
)
returns table (
  request_id uuid,
  player_name text,
  response_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.match_day_availability_requests%rowtype;
  normalized_token_hash text := lower(trim(coalesce(token_hash_value, '')));
  normalized_status text := lower(trim(coalesce(status_value, '')));
begin
  if normalized_status not in ('available', 'unavailable', 'maybe') then
    raise exception 'Choose a valid availability response.';
  end if;

  if normalized_token_hash !~ '^[a-f0-9]{64}$' then
    return;
  end if;

  select *
  into request_row
  from public.match_day_availability_requests
  where token_hash = normalized_token_hash;

  if request_row.id is null then
    return;
  end if;

  if request_row.status = 'expired' or request_row.expires_at < timezone('utc', now()) then
    if request_row.status = 'pending' then
      update public.match_day_availability_requests
      set status = 'expired',
          updated_at = timezone('utc', now())
      where id = request_row.id
        and status = 'pending';
    end if;

    request_id := request_row.id;
    player_name := request_row.player_name;
    response_status := 'expired';
    return next;
    return;
  end if;

  if request_row.status <> 'pending' then
    request_id := request_row.id;
    player_name := request_row.player_name;
    response_status := request_row.status;
    return next;
    return;
  end if;

  update public.match_day_availability_requests
  set status = normalized_status,
      responded_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = request_row.id
    and status = 'pending'
  returning id,
            public.match_day_availability_requests.player_name,
            public.match_day_availability_requests.status
  into request_id, player_name, response_status;

  if request_id is not null then
    return next;
  end if;
end;
$$;

revoke all on function public.confirm_match_day_availability(text, text) from public;
grant execute on function public.confirm_match_day_availability(text, text) to anon;
grant execute on function public.confirm_match_day_availability(text, text) to authenticated;

comment on table public.match_day_availability_requests is
  'Stores per-recipient matchday availability requests. Public users cannot read or write rows directly.';

comment on column public.match_day_availability_requests.token_hash is
  'SHA-256 hash of a high entropy email token. The raw token is not stored.';

comment on function public.confirm_match_day_availability(text, text) is
  'Token-possession availability confirmation. Accepts only stored SHA-256 token hashes, updates pending rows only, and returns minimal player status fields.';
