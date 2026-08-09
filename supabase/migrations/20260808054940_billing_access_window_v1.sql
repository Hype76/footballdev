alter table public.clubs
  add column if not exists billing_arrangement text,
  add column if not exists billing_start_at timestamptz,
  add column if not exists billing_configuration_updated_at timestamptz,
  add column if not exists billing_configuration_updated_by uuid references public.users (id) on delete set null;

alter table public.clubs
  drop constraint if exists clubs_billing_arrangement_check;

alter table public.clubs
  add constraint clubs_billing_arrangement_check
  check (
    billing_arrangement is null
    or billing_arrangement in ('immediate', 'deferred', 'complimentary')
  );

alter table public.clubs
  drop constraint if exists clubs_deferred_billing_start_check;

alter table public.clubs
  add constraint clubs_deferred_billing_start_check
  check (billing_arrangement <> 'deferred' or billing_start_at is not null);

create index if not exists clubs_deferred_billing_start_idx
on public.clubs (billing_start_at)
where billing_arrangement = 'deferred' and archived_at is null;

create table if not exists public.billing_access_reminders (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  billing_start_at timestamptz not null,
  reminder_type text not null check (reminder_type in ('7_day', '1_day', 'due_day')),
  intended_recipient_user_id uuid references public.users (id) on delete set null,
  intended_recipient_role text not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  next_retry_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  safe_error_code text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (club_id, billing_start_at, reminder_type, intended_recipient_user_id)
);

create index if not exists billing_access_reminders_due_idx
on public.billing_access_reminders (status, next_retry_at, billing_start_at);

create table if not exists public.billing_access_state_events (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  billing_start_at timestamptz,
  billing_state_key text not null,
  access_state text not null check (access_state in ('payment_required', 'restored')),
  first_observed_by uuid references public.users (id) on delete set null,
  last_observed_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  unique (club_id, billing_state_key, access_state)
);

alter table public.billing_access_reminders enable row level security;
alter table public.billing_access_state_events enable row level security;

revoke all on public.billing_access_reminders from anon, authenticated;
revoke all on public.billing_access_state_events from anon, authenticated;
grant select, insert, update, delete on public.billing_access_reminders to service_role;
grant select, insert, update, delete on public.billing_access_state_events to service_role;

create schema if not exists app_private;

create or replace function app_private.billing_access_state(target_club_id uuid, at_time timestamptz default now())
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when c.id is null then 'payment_required'
    when c.archived_at is not null then 'archived'
    when lower(coalesce(c.plan_key, '')) not in ('individual', 'single_team', 'small_club', 'development_club', 'large_club', 'pilot') then 'payment_required'
    when lower(coalesce(c.plan_key, '')) = 'individual' then 'full'
    when lower(coalesce(c.plan_status, '')) in ('active', 'trialing') then 'full'
    when coalesce(c.is_plan_comped, false) or c.billing_arrangement = 'complimentary' then 'full'
    when c.billing_arrangement is null then 'full'
    when c.billing_arrangement = 'immediate' then 'payment_required'
    when c.billing_arrangement = 'deferred' and c.billing_start_at > at_time then
      case when c.billing_start_at <= at_time + interval '7 days' then 'payment_due_soon' else 'full' end
    else 'payment_required'
  end
  from public.clubs c
  where c.id = target_club_id
$$;

create or replace function app_private.billing_actor_is_exempt(target_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null then true
    when exists (
      select 1 from public.users u
      where u.id = auth.uid() and lower(coalesce(u.role, '')) = 'super_admin'
    ) then true
    when exists (
      select 1 from public.user_club_memberships m
      where m.auth_user_id = auth.uid()
        and m.club_id = target_club_id
        and lower(coalesce(m.role, '')) in ('parent', 'parent_portal', 'player', 'adult_player')
    ) then true
    else false
  end
$$;

create or replace function public.current_user_billing_staff_mutation_allowed(target_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.billing_actor_is_exempt(target_club_id)
    or app_private.billing_access_state(target_club_id, now()) <> 'payment_required'
$$;

create or replace function app_private.billing_guard_club_id(row_data jsonb, relation_name text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  resolved_club_id uuid;
  candidate text;
begin
  if relation_name = 'clubs' then
    candidate := row_data ->> 'id';
  else
    candidate := row_data ->> 'club_id';
  end if;

  if candidate is not null and candidate <> '' then
    return candidate::uuid;
  end if;

  candidate := row_data ->> 'team_id';
  if candidate is not null and candidate <> '' then
    select t.club_id into resolved_club_id from public.teams t where t.id = candidate::uuid;
    if resolved_club_id is not null then return resolved_club_id; end if;
  end if;

  candidate := row_data ->> 'player_id';
  if candidate is not null and candidate <> '' then
    select p.club_id into resolved_club_id from public.players p where p.id = candidate::uuid;
  end if;

  return resolved_club_id;
end
$$;

create or replace function app_private.enforce_billing_access_window()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_data jsonb;
  target_club_id uuid;
begin
  row_data := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  target_club_id := app_private.billing_guard_club_id(row_data, tg_table_name);

  if target_club_id is null or app_private.billing_actor_is_exempt(target_club_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if app_private.billing_access_state(target_club_id, now()) = 'payment_required' then
    raise exception using
      errcode = 'P0001',
      message = 'payment_required',
      detail = '{"category":"payment_required","exportAllowed":true}',
      hint = 'View and export remain available. The billing owner can continue with Stripe.';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

do $$
declare
  target record;
begin
  for target in
    select distinct c.table_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.column_name in ('club_id', 'team_id', 'player_id')
      and c.table_name not in (
        'audit_logs',
        'billing_access_reminders',
        'billing_access_state_events',
        'clubs',
        'data_transfer_jobs',
        'email_delivery_events',
        'formation_board_export_requests',
        'parent_email_deliveries',
        'parent_email_events',
        'platform_analytics_daily',
        'scheduled_email_queue',
        'stripe_checkout_records',
        'stripe_webhook_events',
        'users'
      )
  loop
    execute format('drop trigger if exists enforce_billing_access_window on public.%I', target.table_name);
    execute format(
      'create trigger enforce_billing_access_window before insert or update or delete on public.%I for each row execute function app_private.enforce_billing_access_window()',
      target.table_name
    );
  end loop;
end
$$;

drop trigger if exists enforce_billing_access_window on public.clubs;
create trigger enforce_billing_access_window
before update or delete on public.clubs
for each row execute function app_private.enforce_billing_access_window();

do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists staff_voice_notes_insert_scoped on storage.objects';
    execute $policy$
      create policy staff_voice_notes_insert_scoped
      on storage.objects
      for insert
      to authenticated
      with check (
        bucket_id = 'staff-voice-notes'
        and (storage.foldername(name))[1] = public.current_user_club_id()::text
        and public.current_user_role_rank() >= 20
        and public.current_user_billing_staff_mutation_allowed(public.current_user_club_id())
      )
    $policy$;

    execute 'drop policy if exists resource_library_storage_insert_manager on storage.objects';
    execute $policy$
      create policy resource_library_storage_insert_manager
      on storage.objects
      for insert
      to authenticated
      with check (
        bucket_id = 'resource-library'
        and (storage.foldername(name))[1] = public.current_user_club_id()::text
        and public.current_user_billing_staff_mutation_allowed(public.current_user_club_id())
        and case
          when coalesce((storage.foldername(name))[2], '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then public.current_user_can_manage_resource_library(public.current_user_club_id(), ((storage.foldername(name))[2])::uuid)
          else false
        end
      )
    $policy$;
  end if;
end
$$;

revoke all on function app_private.billing_access_state(uuid, timestamptz) from public, anon, authenticated;
revoke all on function app_private.billing_actor_is_exempt(uuid) from public, anon, authenticated;
revoke all on function app_private.billing_guard_club_id(jsonb, text) from public, anon, authenticated;
revoke all on function app_private.enforce_billing_access_window() from public, anon, authenticated;
revoke all on function public.current_user_billing_staff_mutation_allowed(uuid) from public, anon;
grant execute on function public.current_user_billing_staff_mutation_allowed(uuid) to authenticated, service_role;

comment on column public.clubs.billing_arrangement is
'Null preserves legacy access until Platform Admin explicitly reviews the workspace.';

comment on table public.billing_access_reminders is
'Durable and recipient-scoped delivery ledger for billing access window reminders.';

comment on function app_private.enforce_billing_access_window() is
'Database backstop that blocks authenticated staff operational writes after a billing access window expires.';
