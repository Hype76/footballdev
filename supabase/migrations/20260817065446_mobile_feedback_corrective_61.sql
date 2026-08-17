-- FP-MOBILE-FEEDBACK-CORRECTIVE-61
-- New Parent Polls enqueue one preference-aware app notification per active installation.
-- Published Formation Boards remain Team Resources but may be shared with individual Players.

create table public.parent_poll_mobile_notification_intents (
  id bigint generated always as identity primary key,
  poll_id uuid not null references public.polls (id) on delete cascade,
  installation_id uuid not null references public.parent_mobile_push_installations (installation_id) on delete cascade,
  auth_user_id uuid not null references auth.users (id) on delete cascade,
  parent_link_id uuid not null references public.parent_player_links (id) on delete cascade,
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid references public.teams (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'skipped')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default timezone('utc', now()),
  locked_at timestamptz,
  processed_at timestamptz,
  safe_error_code text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint parent_poll_mobile_notification_intents_poll_installation_key
    unique (poll_id, installation_id)
);

create index parent_poll_mobile_notification_intents_due_idx
on public.parent_poll_mobile_notification_intents (status, available_at, id)
where status in ('pending', 'failed');

alter table public.parent_poll_mobile_notification_intents enable row level security;
alter table public.parent_poll_mobile_notification_intents force row level security;

revoke all on public.parent_poll_mobile_notification_intents from public, anon, authenticated;
revoke all on sequence public.parent_poll_mobile_notification_intents_id_seq from public, anon, authenticated;
grant select, insert, update, delete on public.parent_poll_mobile_notification_intents to service_role;
grant usage, select on sequence public.parent_poll_mobile_notification_intents_id_seq to service_role;

create or replace function app_private.enqueue_parent_poll_mobile_notification_intents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.audience <> 'parents' or new.status <> 'open' then
    return new;
  end if;

  insert into public.parent_poll_mobile_notification_intents (
    poll_id,
    installation_id,
    auth_user_id,
    parent_link_id,
    club_id,
    team_id
  )
  select
    new.id,
    installation.installation_id,
    installation.auth_user_id,
    installation.parent_link_id,
    new.club_id,
    new.team_id
  from public.parent_mobile_push_installations installation
  join public.parent_player_links parent_link
    on parent_link.id = installation.parent_link_id
    and parent_link.auth_user_id = installation.auth_user_id
    and parent_link.club_id = new.club_id
    and parent_link.status = 'active'
    and (new.team_id is null or parent_link.team_id = new.team_id)
  where installation.club_id = new.club_id
    and installation.status = 'active'
    and installation.enabled
    and installation.expo_push_token is not null
    and (new.team_id is null or installation.team_id = new.team_id)
  on conflict (poll_id, installation_id) do nothing;

  return new;
end;
$$;

alter function app_private.enqueue_parent_poll_mobile_notification_intents() owner to postgres;
revoke all on function app_private.enqueue_parent_poll_mobile_notification_intents()
from public, anon, authenticated, service_role;

drop trigger if exists enqueue_parent_poll_mobile_notification_intents on public.polls;
create trigger enqueue_parent_poll_mobile_notification_intents
after insert on public.polls
for each row execute function app_private.enqueue_parent_poll_mobile_notification_intents();

create or replace function public.claim_parent_poll_mobile_notification_intents(
  batch_size_value integer default 50
)
returns table (
  intent_id bigint,
  recipient_app text,
  installation_id uuid,
  auth_user_id uuid,
  parent_link_id uuid,
  club_id uuid,
  team_id uuid,
  poll_id uuid,
  expo_push_token text,
  detail_level text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate public.parent_poll_mobile_notification_intents%rowtype;
  claimed_count integer := 0;
begin
  update public.parent_poll_mobile_notification_intents intent
  set status = 'failed',
      available_at = timezone('utc', now()),
      locked_at = null,
      safe_error_code = 'claim_timeout',
      updated_at = timezone('utc', now())
  where intent.status = 'processing'
    and intent.locked_at < timezone('utc', now()) - interval '5 minutes';

  for candidate in
    select intent.*
    from public.parent_poll_mobile_notification_intents intent
    where intent.status in ('pending', 'failed')
      and intent.attempt_count < 5
      and intent.available_at <= timezone('utc', now())
    order by intent.id
    for update skip locked
    limit greatest(least(coalesce(batch_size_value, 50) * 4, 400), 1)
  loop
    if claimed_count >= greatest(least(coalesce(batch_size_value, 50), 100), 1) then
      return;
    end if;

    if not exists (
      select 1
      from public.polls poll
      join public.parent_mobile_push_installations installation
        on installation.installation_id = candidate.installation_id
        and installation.auth_user_id = candidate.auth_user_id
        and installation.parent_link_id = candidate.parent_link_id
        and installation.club_id = candidate.club_id
        and installation.status = 'active'
        and installation.enabled
        and installation.expo_push_token is not null
      join public.parent_player_links parent_link
        on parent_link.id = candidate.parent_link_id
        and parent_link.auth_user_id = candidate.auth_user_id
        and parent_link.club_id = candidate.club_id
        and parent_link.status = 'active'
      where poll.id = candidate.poll_id
        and poll.club_id = candidate.club_id
        and poll.audience = 'parents'
        and poll.status = 'open'
        and (poll.closes_at is null or poll.closes_at > timezone('utc', now()))
        and (poll.team_id is null or parent_link.team_id = poll.team_id)
        and (poll.team_id is null or installation.team_id = poll.team_id)
    ) then
      update public.parent_poll_mobile_notification_intents intent
      set status = 'skipped',
          processed_at = timezone('utc', now()),
          safe_error_code = 'authority_stale',
          updated_at = timezone('utc', now())
      where intent.id = candidate.id;
      continue;
    end if;

    update public.parent_poll_mobile_notification_intents intent
    set status = 'processing',
        attempt_count = intent.attempt_count + 1,
        locked_at = timezone('utc', now()),
        safe_error_code = null,
        updated_at = timezone('utc', now())
    where intent.id = candidate.id;

    intent_id := candidate.id;
    recipient_app := 'parent';
    installation_id := candidate.installation_id;
    auth_user_id := candidate.auth_user_id;
    parent_link_id := candidate.parent_link_id;
    club_id := candidate.club_id;
    team_id := candidate.team_id;
    poll_id := candidate.poll_id;

    select installation.expo_push_token, installation.detail_level
    into expo_push_token, detail_level
    from public.parent_mobile_push_installations installation
    where installation.installation_id = candidate.installation_id;

    claimed_count := claimed_count + 1;
    return next;
  end loop;
end;
$$;

alter function public.claim_parent_poll_mobile_notification_intents(integer) owner to postgres;
revoke all on function public.claim_parent_poll_mobile_notification_intents(integer)
from public, anon, authenticated;
grant execute on function public.claim_parent_poll_mobile_notification_intents(integer) to service_role;

comment on table public.parent_poll_mobile_notification_intents is
  'Server-owned idempotent outbox for Parent app notifications after an authorised Parent Poll is created.';
comment on function public.claim_parent_poll_mobile_notification_intents(integer) is
  'Claims Parent Poll notifications only while the Poll, Parent link and mobile installation remain current.';

create or replace function app_private.reject_formation_board_resource_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.formation_board_publications publication
    where publication.resource_id = new.resource_id
  )
    and new.linked_type <> 'player'
    and (tg_op = 'INSERT' or new.removed_at is null) then
    raise exception using errcode = '42501', message = 'formation_board_resource_assignment_forbidden';
  end if;

  return new;
end;
$$;

alter function app_private.reject_formation_board_resource_assignment() owner to postgres;
revoke all on function app_private.reject_formation_board_resource_assignment()
from public, anon, authenticated, service_role;

drop trigger if exists reject_formation_board_resource_assignment
on public.resource_library_links;
create trigger reject_formation_board_resource_assignment
before insert or update on public.resource_library_links
for each row execute function app_private.reject_formation_board_resource_assignment();

comment on function app_private.reject_formation_board_resource_assignment() is
  'Prevents duplicate Team assignment for published Formation Boards while allowing Player-specific family sharing.';
