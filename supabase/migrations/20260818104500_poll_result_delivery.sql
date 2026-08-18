-- FP-MOBILE-NOTIFICATIONS-PROFILE-66
-- Preference-aware, idempotent Parent Poll result delivery.

alter table public.polls
  add column if not exists notify_results_on_close boolean not null default false,
  add column if not exists results_notified_at timestamptz;

create table if not exists public.poll_result_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  parent_link_id uuid references public.parent_player_links(id) on delete set null,
  auth_user_id uuid not null,
  recipient_email text not null default '',
  communication_channel text not null default 'both'
    check (communication_channel in ('app', 'email', 'both')),
  email_status text not null default 'not_requested'
    check (email_status in ('not_requested', 'pending', 'sent', 'failed')),
  push_status text not null default 'not_requested'
    check (push_status in ('not_requested', 'pending', 'sent', 'no_device', 'failed')),
  email_provider_id text,
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (poll_id, auth_user_id)
);

create index if not exists poll_result_notification_deliveries_pending_idx
on public.poll_result_notification_deliveries (poll_id, email_status, push_status);

alter table public.poll_result_notification_deliveries enable row level security;
alter table public.poll_result_notification_deliveries force row level security;
revoke all on public.poll_result_notification_deliveries from public, anon, authenticated;
grant select, insert, update, delete on public.poll_result_notification_deliveries to service_role;

create or replace function public.configure_poll_result_delivery(
  p_poll_id uuid,
  p_notify_results boolean
)
returns public.polls
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
  poll_row public.polls;
begin
  select * into poll_row
  from public.polls poll
  where poll.id = p_poll_id;

  if poll_row.id is null
    or not app_private.actor_can_manage_team_resource(
      actor_id,
      poll_row.club_id,
      poll_row.team_id,
      50
    ) then
    raise exception 'poll_result_delivery_forbidden';
  end if;

  update public.polls poll
  set notify_results_on_close = coalesce(p_notify_results, false),
      results_notified_at = case
        when coalesce(p_notify_results, false) then poll.results_notified_at
        else null
      end,
      updated_at = timezone('utc', now())
  where poll.id = poll_row.id
  returning poll.* into poll_row;

  return poll_row;
end;
$$;

alter function public.configure_poll_result_delivery(uuid, boolean) owner to postgres;
revoke all on function public.configure_poll_result_delivery(uuid, boolean)
from public, anon, service_role;
grant execute on function public.configure_poll_result_delivery(uuid, boolean)
to authenticated;

comment on column public.polls.notify_results_on_close is
  'When true, the scheduled Poll result worker sends the ranked result using each Parent communication preference.';
comment on table public.poll_result_notification_deliveries is
  'Recipient-scoped idempotency ledger for Parent Poll result email and app delivery.';
