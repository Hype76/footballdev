-- Additive, inert policy persistence only. No attendance changes, backfill,
-- invitation enrolment, queues, triggers on existing records or cron activation.
create or replace function app_private.valid_team_coach_reminder_options(value jsonb)
returns boolean language plpgsql immutable
set search_path = pg_catalog
as $$
declare
  field text;
  limit_value integer;
  required_value boolean;
  raw_value jsonb;
begin
  if jsonb_typeof(value) is distinct from 'object'
    or not (value ?& array['reminderEnabled','reminderAfterHours','deadlineMode','deadlineAfterHours','squadReminderEnabled','squadDaysBefore'])
    or exists (select 1 from jsonb_object_keys(value) key where key <> all(array['reminderEnabled','reminderAfterHours','deadlineMode','deadlineAfterHours','squadReminderEnabled','squadDaysBefore'])) then return false; end if;
  if jsonb_typeof(value->'reminderEnabled') is distinct from 'boolean'
    or jsonb_typeof(value->'squadReminderEnabled') is distinct from 'boolean'
    or coalesce(value->>'deadlineMode', '') not in ('reminders_only','exclude_from_planning','automatic_not_attending') then return false; end if;
  foreach field in array array['reminderAfterHours','deadlineAfterHours','squadDaysBefore'] loop
    raw_value := value->field;
    limit_value := case when field='squadDaysBefore' then 30 else 720 end;
    required_value := case field
      when 'reminderAfterHours' then (value->>'reminderEnabled')::boolean
      when 'deadlineAfterHours' then value->>'deadlineMode' <> 'reminders_only'
      else (value->>'squadReminderEnabled')::boolean end;
    if raw_value = 'null'::jsonb then
      if required_value then return false; end if;
    elsif jsonb_typeof(raw_value) is distinct from 'number' or (raw_value #>> '{}') !~ '^[0-9]+$' then
      return false;
    elsif (raw_value #>> '{}')::numeric < 1 or (raw_value #>> '{}')::numeric > limit_value then
      return false;
    end if;
  end loop;
  if (value->>'reminderEnabled')::boolean and value->>'deadlineMode' <> 'reminders_only'
    and (value->>'reminderAfterHours')::integer >= (value->>'deadlineAfterHours')::integer then return false; end if;
  return true;
end;
$$;
revoke all on function app_private.valid_team_coach_reminder_options(jsonb) from public, anon, authenticated;
grant execute on function app_private.valid_team_coach_reminder_options(jsonb) to service_role;

create or replace function app_private.can_manage_team_coach_reminders(target_club uuid, target_team uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null
    and coalesce(public.current_user_can_access_team(target_club, target_team), false)
    and exists (
      select 1 from public.users staff
      join public.user_club_memberships membership on membership.auth_user_id=staff.id
        and membership.club_id=staff.club_id and membership.role=staff.role and membership.role_rank=staff.role_rank
      join public.clubs club on club.id=staff.club_id
      join public.teams team on team.club_id=club.id and team.id=target_team
      where staff.id=auth.uid() and staff.club_id=target_club and staff.status='active'
        and club.status='active' and team.archived_at is null
        and staff.role not in ('parent_portal','super_admin','adult_player') and staff.role_rank >= 20
        and coalesce(public.current_user_team_role_rank(target_team), 0) >= 20
    );
$$;
revoke all on function app_private.can_manage_team_coach_reminders(uuid,uuid) from public, anon;
grant execute on function app_private.can_manage_team_coach_reminders(uuid,uuid) to authenticated, service_role;

create table public.team_coach_reminder_policies (
  id uuid not null unique default gen_random_uuid(),
  team_id uuid primary key references public.teams(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  options jsonb not null default '{"reminderEnabled":false,"reminderAfterHours":null,"deadlineMode":"reminders_only","deadlineAfterHours":null,"squadReminderEnabled":false,"squadDaysBefore":null}',
  opted_in boolean not null default false,
  configured_at timestamptz,
  effective_from timestamptz,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint team_coach_reminder_options_valid check (app_private.valid_team_coach_reminder_options(options)),
  constraint team_coach_reminder_activation_valid check (
    (not opted_in and effective_from is null)
    or (opted_in and configured_at is not null and effective_from is not null and effective_from >= configured_at
      and ((options->>'reminderEnabled')::boolean or options->>'deadlineMode' <> 'reminders_only' or (options->>'squadReminderEnabled')::boolean))
  )
);
create index team_coach_reminder_policies_club_idx on public.team_coach_reminder_policies(club_id,team_id);
alter table public.team_coach_reminder_policies enable row level security;
revoke all on public.team_coach_reminder_policies from public, anon, authenticated;
grant select on public.team_coach_reminder_policies to authenticated;
grant select, insert, update, delete on public.team_coach_reminder_policies to service_role;
create policy team_coach_reminder_policies_scoped_read on public.team_coach_reminder_policies
for select to authenticated using (app_private.can_manage_team_coach_reminders(club_id,team_id));

create table public.team_coach_reminder_policy_commands (
  request_id uuid primary key,
  actor_id uuid not null references public.users(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  request jsonb not null,
  saved_revision bigint not null,
  created_at timestamptz not null default now()
);
alter table public.team_coach_reminder_policy_commands enable row level security;
revoke all on public.team_coach_reminder_policy_commands from public, anon, authenticated;
grant select, insert, update, delete on public.team_coach_reminder_policy_commands to service_role;

create or replace function public.save_team_coach_reminder_policy_v1(
  target_club_id uuid, target_team_id uuid, expected_revision bigint,
  request_id_value uuid, options_value jsonb, opted_in_value boolean
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  current_policy public.team_coach_reminder_policies%rowtype;
  prior_command public.team_coach_reminder_policy_commands%rowtype;
  request_value jsonb;
  save_time timestamptz;
begin
  if not coalesce(app_private.can_manage_team_coach_reminders(target_club_id,target_team_id), false) then
    raise exception 'team_coach_reminder_not_authorized' using errcode='42501';
  end if;
  if request_id_value is null or expected_revision is null or expected_revision < 0 or opted_in_value is null
    or not coalesce(app_private.valid_team_coach_reminder_options(options_value),false) then
    raise exception 'team_coach_reminder_configuration_invalid' using errcode='22023';
  end if;
  if opted_in_value and not ((options_value->>'reminderEnabled')::boolean
    or options_value->>'deadlineMode' <> 'reminders_only' or (options_value->>'squadReminderEnabled')::boolean) then
    raise exception 'team_coach_reminder_choose_an_option' using errcode='22023';
  end if;
  -- Serialise the initial insert as well as subsequent edits for this team.
  perform 1 from public.teams where id=target_team_id and club_id=target_club_id for update;
  if not found then raise exception 'team_coach_reminder_not_authorized' using errcode='42501'; end if;
  request_value := jsonb_build_object('expectedRevision',expected_revision,'options',options_value,'optedIn',opted_in_value);
  select * into current_policy from public.team_coach_reminder_policies where team_id=target_team_id;
  select * into prior_command from public.team_coach_reminder_policy_commands where request_id=request_id_value;
  if found then
    if prior_command.actor_id <> auth.uid() or prior_command.club_id <> target_club_id
      or prior_command.team_id <> target_team_id or prior_command.request is distinct from request_value then
      raise exception 'team_coach_reminder_request_key_conflict' using errcode='22023';
    end if;
    -- Replay returns current shared settings without reapplying the old choice.
    return jsonb_build_object('policy',to_jsonb(current_policy),'duplicate',true,'savedRevision',prior_command.saved_revision);
  end if;
  if coalesce(current_policy.revision,0) <> expected_revision then
    raise exception 'team_coach_reminder_policy_changed' using errcode='40001';
  end if;
  save_time := clock_timestamp();
  insert into public.team_coach_reminder_policies(team_id,club_id,options,opted_in,configured_at,effective_from,updated_by,updated_at)
  values(target_team_id,target_club_id,options_value,opted_in_value,save_time,
    case when opted_in_value then save_time else null end,auth.uid(),save_time)
  on conflict(team_id) do update set options=excluded.options,opted_in=excluded.opted_in,
    revision=team_coach_reminder_policies.revision+1,configured_at=excluded.configured_at,
    effective_from=excluded.effective_from,updated_by=excluded.updated_by,updated_at=excluded.updated_at
  returning * into current_policy;
  insert into public.team_coach_reminder_policy_commands(request_id,actor_id,club_id,team_id,request,saved_revision)
  values(request_id_value,auth.uid(),target_club_id,target_team_id,request_value,current_policy.revision);
  return jsonb_build_object('policy',to_jsonb(current_policy),'duplicate',false,'savedRevision',current_policy.revision);
end;
$$;
revoke all on function public.save_team_coach_reminder_policy_v1(uuid,uuid,bigint,uuid,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.save_team_coach_reminder_policy_v1(uuid,uuid,bigint,uuid,jsonb,boolean) to authenticated;

comment on table public.team_coach_reminder_policies is
  'One explicitly configured shared policy per team. Inert metadata; delivery requires a separate server release gate and scheduler. No backfill.';

-- A second, server-owned release gate prevents a saved opt-in from activating
-- any work before the separately authorised release. Never enable in migration.
create table public.team_coach_reminder_release_control (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  activated_at timestamptz,
  check ((not enabled and activated_at is null) or (enabled and activated_at is not null))
);
insert into public.team_coach_reminder_release_control(singleton) values(true);
create table public.team_coach_reminder_jobs (
  job_key text primary key,
  club_id uuid not null references public.clubs(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  payload jsonb not null,
  state text not null default 'pending' check(state in ('pending','completed','skipped')),
  reason text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index team_coach_reminder_jobs_pending_idx on public.team_coach_reminder_jobs(created_at) where state='pending';
create table public.team_coach_reminder_effects (
  job_key text primary key references public.team_coach_reminder_jobs(job_key) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  payload jsonb not null check(coalesce(payload->>'provenance','')='coach_deadline_automation'),
  created_at timestamptz not null default now()
);
create table public.team_coach_reminder_outbox (
  delivery_key text primary key,
  job_key text not null references public.team_coach_reminder_jobs(job_key) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  payload jsonb not null,
  state text not null default 'pending' check(state in ('pending','accepted','skipped','held')),
  lease_token uuid,
  lease_until timestamptz,
  provider_id text,
  reason text,
  created_at timestamptz not null default now()
);
create index team_coach_reminder_outbox_pending_idx on public.team_coach_reminder_outbox(created_at) where state='pending';
create table public.team_coach_reminder_enrolments (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  policy_id uuid not null,
  policy_revision bigint not null,
  kind text not null check(kind in ('MATCH','TRAINING')),
  event_id uuid not null,
  occurrence_date date,
  player_id uuid not null,
  invitation_id uuid not null,
  request_id uuid not null,
  source_created_at timestamptz not null,
  first_delivered_at timestamptz not null,
  unique nulls not distinct(policy_id,policy_revision,kind,event_id,occurrence_date,player_id,invitation_id)
);
alter table public.team_coach_reminder_enrolments enable row level security;
revoke all on public.team_coach_reminder_enrolments from public,anon,authenticated;
grant select,insert on public.team_coach_reminder_enrolments to service_role;
alter table public.team_coach_reminder_release_control enable row level security;
alter table public.team_coach_reminder_jobs enable row level security;
alter table public.team_coach_reminder_effects enable row level security;
alter table public.team_coach_reminder_outbox enable row level security;
revoke all on public.team_coach_reminder_release_control,public.team_coach_reminder_jobs,public.team_coach_reminder_effects,public.team_coach_reminder_outbox from public,anon,authenticated;
grant select,insert,update,delete on public.team_coach_reminder_release_control,public.team_coach_reminder_jobs,public.team_coach_reminder_effects,public.team_coach_reminder_outbox to service_role;

create or replace function public.team_coach_reminder_context_v1(job_value jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare
  event_value jsonb; policy_value jsonb; enrolment_value jsonb; response_value jsonb;
  release_value jsonb; invite_value jsonb; team_value uuid; club_value uuid; recipient_emails jsonb; coaches_value jsonb;
  member_active boolean := false; squad_picked boolean := false; authority_active boolean := false;
begin
  if job_value->>'kind'='MATCH' then
    select jsonb_build_object('id',id,'club_id',club_id,'team_id',team_id,'status',status,'deleted_at',deleted_at,
      'match_date',match_date,'kickoff_time',kickoff_time,'kickoff_time_tbc',kickoff_time_tbc,'created_at',created_at)
    into event_value from public.match_days where id=(job_value->>'eventId')::uuid;
  elsif job_value->>'kind'='TRAINING' then
    select jsonb_build_object('id',id,'club_id',club_id,'team_id',team_id,'event_type',event_type,'cancelled_at',cancelled_at,
      'starts_at',starts_at,'ends_at',ends_at,'recurrence_frequency',recurrence_frequency,'recurrence_until',recurrence_until,
      'deleted_occurrence_dates',deleted_occurrence_dates,'created_at',created_at)
    into event_value from public.calendar_events where id=(job_value->>'eventId')::uuid;
  else return null; end if;
  if event_value is null then return null; end if;
  club_value := (event_value->>'club_id')::uuid; team_value := (event_value->>'team_id')::uuid;
  select to_jsonb(p) into policy_value from public.team_coach_reminder_policies p where p.club_id=club_value and p.team_id=team_value;
  select to_jsonb(r) into release_value from public.team_coach_reminder_release_control r where singleton;
  select coalesce((release_value->>'enabled')::boolean,false) and exists(
    select 1 from public.teams team join public.clubs club on club.id=team.club_id
    where team.id=team_value and club.id=club_value and team.archived_at is null and club.status='active'
  ) and exists(
    select 1 from public.team_staff staff join public.users usr on usr.id=staff.user_id
    join public.user_club_memberships membership on membership.auth_user_id=usr.id and membership.club_id=club_value
    where staff.team_id=team_value and staff.role_rank>=20 and usr.status='active' and usr.club_id=club_value
      and membership.role=usr.role and membership.role_rank=usr.role_rank and membership.role_rank>=20
      and membership.role not in ('parent_portal','super_admin','adult_player')
  ) into authority_active;
  if nullif(job_value->>'enrolmentId','') is not null then
    select to_jsonb(e) into enrolment_value from public.team_coach_reminder_enrolments e where id=(job_value->>'enrolmentId')::uuid;
    if enrolment_value is not null then
      select jsonb_build_object('id',id,'invited_at',invited_at,'invite_status',invite_status,'cancelled_at',cancelled_at)
      into invite_value from public.calendar_event_invites where id=(enrolment_value->>'invitation_id')::uuid
        and club_id=club_value and team_id=team_value and player_id=(enrolment_value->>'player_id')::uuid
        and ((job_value->>'kind'='MATCH' and match_day_id=(job_value->>'eventId')::uuid)
          or (job_value->>'kind'='TRAINING' and calendar_event_id=(job_value->>'eventId')::uuid));
      select exists(select 1 from public.players player join public.player_team_memberships membership on membership.player_id=player.id
        where player.id=(enrolment_value->>'player_id')::uuid and player.club_id=club_value and player.status<>'archived'
          and membership.club_id=club_value and membership.team_id=team_value and membership.status='active' and membership.ended_at is null)
      into member_active;
      if job_value->>'kind'='MATCH' then
        select jsonb_build_object('id',id,'status',status,'selected_at',selected_at,'updated_at',updated_at,'selected_by_parent_link_id',selected_by_parent_link_id)
        into response_value from public.match_day_player_availability where match_day_id=(job_value->>'eventId')::uuid
          and club_id=club_value and player_id=(enrolment_value->>'player_id')::uuid;
        select coalesce(jsonb_agg(distinct lower(recipient_email)),'[]'::jsonb) into recipient_emails
        from public.match_day_availability_requests where match_day_id=(job_value->>'eventId')::uuid
          and player_id=(enrolment_value->>'player_id')::uuid and club_id=club_value and team_id=team_value
          and sent_at is not null and token_revoked_at is null and status not in ('expired','cancelled')
          and created_at >= greatest((policy_value->>'effective_from')::timestamptz,(release_value->>'activated_at')::timestamptz);
        if not exists(select 1 from public.match_day_availability_requests where id=(enrolment_value->>'request_id')::uuid
          and club_id=club_value and team_id=team_value and match_day_id=(job_value->>'eventId')::uuid
          and player_id=(enrolment_value->>'player_id')::uuid and token_revoked_at is null
          and status not in ('expired','cancelled')) then member_active:=false; end if;
      else
        select jsonb_build_object('id',id,'status',status,'responded_at',responded_at,'updated_at',updated_at,'response_source',response_source)
        into response_value from public.training_availability_responses where request_id=(enrolment_value->>'request_id')::uuid
          and club_id=club_value and player_id=(enrolment_value->>'player_id')::uuid;
        select coalesce(jsonb_agg(distinct lower(recipient_email)),'[]'::jsonb) into recipient_emails
        from public.training_availability_request_players where request_id=(enrolment_value->>'request_id')::uuid
          and player_id=(enrolment_value->>'player_id')::uuid and club_id=club_value and team_id=team_value
          and email_sent_at is not null and token_revoked_at is null and status not in ('cancelled','expired')
          and created_at >= greatest((policy_value->>'effective_from')::timestamptz,(release_value->>'activated_at')::timestamptz);
        if not exists(select 1 from public.training_availability_requests request
          where request.id=(enrolment_value->>'request_id')::uuid and request.club_id=club_value and request.team_id=team_value
            and request.calendar_event_id=(job_value->>'eventId')::uuid and request.occurrence_date=(job_value->>'occurrenceDate')::date
            and request.status<>'cancelled') then member_active:=false; end if;
        if exists(select 1 from public.event_player_occurrence_exclusions where calendar_event_id=(job_value->>'eventId')::uuid
          and player_id=(enrolment_value->>'player_id')::uuid and (scope='occurrence' and effective_from_date=(job_value->>'occurrenceDate')::date
            or scope='this_and_future' and effective_from_date <= (job_value->>'occurrenceDate')::date)) then member_active:=false; end if;
      end if;
    end if;
  end if;
  if job_value->>'kind'='MATCH' then
    select exists(select 1 from public.match_day_player_squad_decisions where match_day_id=(job_value->>'eventId')::uuid
      and club_id=club_value and team_id=team_value and status='selected') into squad_picked;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',usr.id,'email',usr.email,'notificationsEnabled',coalesce(preference.invites,true)) order by usr.id),'[]'::jsonb)
  into coaches_value from public.team_staff staff join public.users usr on usr.id=staff.user_id
  join public.user_club_memberships membership on membership.auth_user_id=usr.id and membership.club_id=club_value
  left join public.mobile_notification_preferences preference on preference.auth_user_id=usr.id and preference.app='coach'
  where staff.team_id=team_value and staff.role_rank>=20 and usr.status='active' and usr.club_id=club_value
    and membership.role=usr.role and membership.role_rank=usr.role_rank and membership.role_rank>=20
    and membership.role not in ('parent_portal','super_admin','adult_player');
  return jsonb_build_object('policy',policy_value,'release',release_value,'event',event_value,'enrolment',enrolment_value,
    'invitation',invite_value,'response',response_value,'memberActive',member_active,'squadSelected',squad_picked,'authorityActive',authority_active,
    'recipientEmails',recipient_emails,'coaches',coaches_value);
end;
$$;
revoke all on function public.team_coach_reminder_context_v1(jsonb) from public,anon,authenticated;
grant execute on function public.team_coach_reminder_context_v1(jsonb) to service_role;

create or replace function public.commit_team_coach_reminder_job_v1(
  job_key_value text, context_snapshot_value jsonb,
  effect_value jsonb, notifications_value jsonb, state_value text, reason_value text
)
returns jsonb language plpgsql security invoker
set search_path=pg_catalog,public
as $$
declare job public.team_coach_reminder_jobs%rowtype; notification jsonb; context_current_value jsonb;
begin
  if not exists(select 1 from public.team_coach_reminder_release_control where enabled) then
    return jsonb_build_object('committed',false,'reason','release_disabled');
  end if;
  select * into job from public.team_coach_reminder_jobs where job_key=job_key_value for update;
  if not found then return jsonb_build_object('committed',false,'reason','missing'); end if;
  if job.state <> 'pending' then return jsonb_build_object('committed',true,'duplicate',true); end if;
  context_current_value := public.team_coach_reminder_context_v1(job.payload);
  if context_snapshot_value is distinct from context_current_value then
    return jsonb_build_object('committed',false,'reason','context_changed');
  end if;
  if state_value not in ('completed','skipped') or jsonb_typeof(notifications_value) is distinct from 'array' then
    raise exception 'reminder_commit_invalid' using errcode='22023';
  end if;
  if effect_value is not null then
    if effect_value->>'jobKey' is distinct from job_key_value or effect_value->>'provenance' is distinct from 'coach_deadline_automation'
      or state_value<>'completed' or effect_value->>'clubId' is distinct from job.club_id::text
      or effect_value->>'teamId' is distinct from job.team_id::text then
      raise exception 'reminder_effect_invalid' using errcode='22023';
    end if;
    insert into public.team_coach_reminder_effects(job_key,club_id,team_id,payload)
    values(job.job_key,job.club_id,job.team_id,effect_value) on conflict do nothing;
  end if;
  for notification in select value from jsonb_array_elements(notifications_value) loop
    if notification->>'jobKey' is distinct from job_key_value or coalesce(notification->>'idempotencyKey','')='' then
      raise exception 'reminder_notification_invalid' using errcode='22023';
    end if;
    insert into public.team_coach_reminder_outbox(delivery_key,job_key,club_id,team_id,payload)
    values(notification->>'idempotencyKey',job.job_key,job.club_id,job.team_id,notification)
    on conflict(delivery_key) do update set job_key=excluded.job_key,payload=excluded.payload,state='pending',reason=null
    where team_coach_reminder_outbox.state in ('pending','skipped') and team_coach_reminder_outbox.lease_token is null;
  end loop;
  update public.team_coach_reminder_jobs set state=state_value,reason=reason_value,completed_at=clock_timestamp() where job_key=job_key_value;
  return jsonb_build_object('committed',true,'duplicate',false);
end;
$$;
revoke all on function public.commit_team_coach_reminder_job_v1(text,jsonb,jsonb,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.commit_team_coach_reminder_job_v1(text,jsonb,jsonb,jsonb,text,text) to service_role;

create or replace function public.claim_team_coach_reminder_notification_v1(delivery_key_value text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare result public.team_coach_reminder_outbox%rowtype;
begin
  if not exists(select 1 from public.team_coach_reminder_release_control where enabled) then return null; end if;
  -- An expired lease may already have reached the provider. Hold it for
  -- reconciliation rather than automatically issuing another transport send.
  update public.team_coach_reminder_outbox set state='held',reason='delivery_requires_reconciliation'
  where delivery_key=delivery_key_value and state='pending' and lease_token is not null and lease_until < clock_timestamp();
  update public.team_coach_reminder_outbox set lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes'
  where delivery_key=delivery_key_value and state='pending' and lease_token is null
  returning * into result;
  if not found then return null; end if;
  return to_jsonb(result);
end;
$$;
revoke all on function public.claim_team_coach_reminder_notification_v1(text) from public,anon,authenticated;
grant execute on function public.claim_team_coach_reminder_notification_v1(text) to service_role;
