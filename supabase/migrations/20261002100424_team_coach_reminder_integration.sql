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
  parent_responder_active boolean := false;
  adult_responder_active boolean := false;
begin
  if job_value->>'kind'='MATCH' then
    select jsonb_build_object('id',id,'club_id',club_id,'team_id',team_id,'status',status,'deleted_at',deleted_at,
      'match_date',match_date,'kickoff_time',kickoff_time,'kickoff_time_tbc',kickoff_time_tbc,'created_at',created_at,'parent_visible',parent_visible,'parent_audience',parent_audience)
    into event_value from public.match_days where id=(job_value->>'eventId')::uuid;
  elsif job_value->>'kind'='TRAINING' then
    select jsonb_build_object('id',id,'club_id',club_id,'team_id',team_id,'event_type',event_type,'cancelled_at',cancelled_at,
      'starts_at',starts_at,'ends_at',ends_at,'recurrence_frequency',recurrence_frequency,'recurrence_until',recurrence_until,
      'deleted_occurrence_dates',deleted_occurrence_dates,'created_at',created_at,'parent_visible',parent_visible,'parent_audience',parent_audience)
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
      -- Link authority is independent of email/app notification preferences.
      -- Use the existing event-contact authority, including account eligibility,
      -- and retain this value in the raw commit CAS snapshot.
      select coalesce(bool_or(recipient.parent_link_id is not null),false),
        coalesce(bool_or(recipient.recipient_type='player' and recipient.parent_link_id is null),false)
      into parent_responder_active,adult_responder_active
      from public.event_player_eligible_recipients(
        club_id_value=>club_value,team_id_value=>team_value,
        player_ids_value=>array[(enrolment_value->>'player_id')::uuid]) recipient;
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
        if not exists(select 1 from public.training_availability_request_players source
          where source.request_id=(enrolment_value->>'request_id')::uuid and source.player_id=(enrolment_value->>'player_id')::uuid
            and source.club_id=club_value and source.team_id=team_value and source.email_sent_at is not null
            and source.token_revoked_at is null and source.status not in ('cancelled','expired')
            and source.created_at >= greatest((policy_value->>'effective_from')::timestamptz,(release_value->>'activated_at')::timestamptz))
          then member_active:=false; end if;
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
  return jsonb_build_object('parentResponderActive',parent_responder_active,'adultResponderActive',adult_responder_active,'policy',policy_value,'release',release_value,'event',event_value,'enrolment',enrolment_value,
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
    if effect_value->>'status'='unavailable' and not (coalesce((context_current_value->>'parentResponderActive')::boolean,false)
      or coalesce((context_current_value->>'adultResponderActive')::boolean,false)) then
      return jsonb_build_object('committed',false,'reason','no_eligible_responder');
    end if;
    if effect_value->>'jobKey' is distinct from job_key_value or effect_value->>'provenance' is distinct from 'coach_deadline_automation'
      or state_value<>'completed' or effect_value->>'clubId' is distinct from job.club_id::text
      or effect_value->>'teamId' is distinct from job.team_id::text then
      raise exception 'reminder_effect_invalid' using errcode='22023';
    end if;
    insert into public.team_coach_reminder_effects(job_key,club_id,team_id,payload)
    values(job.job_key,job.club_id,job.team_id,effect_value || jsonb_build_object('sourceContext',context_current_value)) on conflict do nothing;
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


-- REMINDER_SOURCE_INTEGRATION
-- Future-only delivery capture. Release remains disabled; no backfill or cron.
alter table public.coach_mobile_notification_events add column coach_reminder_delivery_key text unique;
create or replace function app_private.capture_coach_reminder_delivery_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare policy public.team_coach_reminder_policies%rowtype; release_time timestamptz;
 delivered timestamptz; kind_value text; event_value uuid; occurrence_value date; invite_value uuid; request_value uuid;
begin
 select activated_at into release_time from public.team_coach_reminder_release_control where enabled;
 if release_time is null then return new; end if;
 select * into policy from public.team_coach_reminder_policies where team_id=new.team_id and club_id=new.club_id and opted_in;
 if not found or new.created_at < greatest(policy.effective_from,release_time) then return new; end if;
 if tg_table_name='match_day_availability_requests' then
  delivered:=new.sent_at; kind_value:='MATCH';event_value:=new.match_day_id;request_value:=new.id;
 else
  delivered:=new.email_sent_at;kind_value:='TRAINING';request_value:=new.request_id;
  select calendar_event_id,occurrence_date into event_value,occurrence_value from public.training_availability_requests
   where id=new.request_id and club_id=new.club_id and team_id=new.team_id and status<>'cancelled';
 end if;
 if delivered is null or delivered < greatest(policy.effective_from,release_time) or new.token_revoked_at is not null then return new; end if;
 select id into invite_value from public.calendar_event_invites where club_id=new.club_id and team_id=new.team_id
  and player_id=new.player_id and cancelled_at is null and invite_status<>'cancelled'
  and ((kind_value='MATCH' and match_day_id=event_value) or(kind_value='TRAINING' and calendar_event_id=event_value));
 if invite_value is null then return new; end if;
 insert into public.team_coach_reminder_enrolments(club_id,team_id,policy_id,policy_revision,kind,event_id,occurrence_date,player_id,invitation_id,request_id,source_created_at,first_delivered_at)
 values(new.club_id,new.team_id,policy.id,policy.revision,kind_value,event_value,occurrence_value,new.player_id,invite_value,request_value,new.created_at,delivered)
 on conflict do nothing;
 return new;
end $$;
revoke all on function app_private.capture_coach_reminder_delivery_v1() from public,anon,authenticated;
create trigger coach_reminder_match_delivery after insert or update of sent_at on public.match_day_availability_requests
 for each row execute function app_private.capture_coach_reminder_delivery_v1();
create trigger coach_reminder_training_delivery after insert or update of email_sent_at on public.training_availability_request_players
 for each row execute function app_private.capture_coach_reminder_delivery_v1();

create table public.team_coach_reminder_scan_cursor(singleton boolean primary key default true check(singleton),cursor_value text not null default '',processor_phase integer not null default 0 check(processor_phase between 0 and 2));
insert into public.team_coach_reminder_scan_cursor(singleton,cursor_value) values(true,'');
alter table public.team_coach_reminder_scan_cursor enable row level security;
revoke all on public.team_coach_reminder_scan_cursor from public,anon,authenticated;
grant select,update on public.team_coach_reminder_scan_cursor to service_role;
create or replace function public.next_team_coach_reminder_processor_phase_v1()
returns integer language plpgsql security invoker set search_path=pg_catalog,public as $$
declare phase integer;
begin
 if not exists(select 1 from public.team_coach_reminder_release_control where enabled) then return 0; end if;
 select processor_phase into phase from public.team_coach_reminder_scan_cursor where singleton for update;
 update public.team_coach_reminder_scan_cursor set processor_phase=(phase+1)%3 where singleton;
 return phase;
end $$;
revoke all on function public.next_team_coach_reminder_processor_phase_v1() from public,anon,authenticated;
grant execute on function public.next_team_coach_reminder_processor_phase_v1() to service_role;
create or replace function public.scan_team_coach_reminder_candidates_v1(batch_size integer default 30)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare cursor_key text; result jsonb; next_key text;
begin
 if not exists(select 1 from public.team_coach_reminder_release_control where enabled) then return '[]'::jsonb; end if;
 select cursor_value into cursor_key from public.team_coach_reminder_scan_cursor where singleton for update;
 with candidates as (
  select 'A:'||e.id as scan_key,jsonb_build_object('kind',e.kind,'eventId',e.event_id,'occurrenceDate',coalesce(e.occurrence_date::text,''),'clubId',e.club_id,'teamId',e.team_id,'playerId',e.player_id,'enrolmentId',e.id,'action','availability_reminder') payload
  from public.team_coach_reminder_enrolments e join public.team_coach_reminder_policies p on p.id=e.policy_id and p.revision=e.policy_revision and p.opted_in
  where (e.kind='MATCH' and exists(select 1 from public.match_days m where m.id=e.event_id and m.match_date>=(clock_timestamp() at time zone 'Europe/London')::date and m.deleted_at is null and m.status in ('scheduled','scorer_request')))
   or (e.kind='TRAINING' and e.occurrence_date>=(clock_timestamp() at time zone 'Europe/London')::date)
  union all
  select 'S:'||m.id,jsonb_build_object('kind','MATCH','eventId',m.id,'clubId',m.club_id,'teamId',m.team_id,'action','squad_reminder')
  from public.match_days m join public.team_coach_reminder_policies p on p.team_id=m.team_id and p.club_id=m.club_id and p.opted_in
  cross join public.team_coach_reminder_release_control r
  where (p.options->>'squadReminderEnabled')::boolean and m.created_at>=greatest(p.effective_from,r.activated_at)
   and m.match_date>=(clock_timestamp() at time zone 'Europe/London')::date and m.deleted_at is null and m.status in ('scheduled','scorer_request')
 ), page as(select * from candidates where scan_key>cursor_key order by scan_key limit greatest(1,least(batch_size,100)))
 select coalesce(jsonb_agg(payload order by scan_key),'[]'::jsonb),max(scan_key) into result,next_key from page;
 update public.team_coach_reminder_scan_cursor set cursor_value=coalesce(next_key,'') where singleton;
 return result;
end $$;
revoke all on function public.scan_team_coach_reminder_candidates_v1(integer) from public,anon,authenticated;
grant execute on function public.scan_team_coach_reminder_candidates_v1(integer) to service_role;

create or replace function app_private.coach_reminder_planning_excluded_v1(enrolment_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare enrolment public.team_coach_reminder_enrolments%rowtype; context_value jsonb; start_time timestamptz; event_value jsonb;
 first_date date; local_time time; cursor_date date; month_steps integer:=0; valid_occurrence boolean;
begin
 select * into enrolment from public.team_coach_reminder_enrolments where id=enrolment_id;
 if not found then return false; end if;
 context_value:=public.team_coach_reminder_context_v1(jsonb_build_object('kind',enrolment.kind,'eventId',enrolment.event_id,'enrolmentId',enrolment.id,'occurrenceDate',coalesce(enrolment.occurrence_date::text,'')));
 event_value:=context_value->'event';
 -- Retain historical automatic effects for audit, but stop applying them when
 -- no eligible Parent or verified adult self-responder remains. Explicit answers remain
 -- canonical; this does not rewrite attendance or clear manual decisions.
 if context_value->'policy'->'options'->>'deadlineMode'='automatic_not_attending'
  and not (coalesce((context_value->>'parentResponderActive')::boolean,false)
    or coalesce((context_value->>'adultResponderActive')::boolean,false)) then return false; end if;
 if not coalesce((context_value->>'authorityActive')::boolean,false) or not coalesce((context_value->>'memberActive')::boolean,false)
  or not coalesce((context_value->'policy'->>'opted_in')::boolean,false)
  or enrolment.policy_id::text is distinct from context_value->'policy'->>'id' or enrolment.policy_revision::text is distinct from context_value->'policy'->>'revision'
  or coalesce(context_value->'policy'->'options'->>'deadlineMode','reminders_only')='reminders_only'
  or enrolment.source_created_at<greatest((context_value->'policy'->>'effective_from')::timestamptz,(context_value->'release'->>'activated_at')::timestamptz)
  or enrolment.first_delivered_at+make_interval(hours=>(context_value->'policy'->'options'->>'deadlineAfterHours')::integer)>clock_timestamp()
  or coalesce(context_value->'response'->>'status','pending') not in ('pending','maybe')
  or context_value->'invitation' is null or context_value->'invitation'->>'invite_status'='cancelled' or context_value->'invitation'->>'cancelled_at' is not null then return false; end if;
 if enrolment.kind='MATCH' then
  if event_value->>'status' not in ('scheduled','scorer_request') or event_value->>'deleted_at' is not null or (event_value->>'kickoff_time_tbc')::boolean then return false; end if;
  start_time:=((event_value->>'match_date')::date+(event_value->>'kickoff_time')::time) at time zone 'Europe/London';
  if start_time is null or (start_time at time zone 'Europe/London')::time<>(event_value->>'kickoff_time')::time
   or ((start_time+interval '1 hour') at time zone 'Europe/London')=(start_time at time zone 'Europe/London')
   or ((start_time-interval '1 hour') at time zone 'Europe/London')=(start_time at time zone 'Europe/London') then return false; end if;
 else
  if event_value->>'cancelled_at' is not null or event_value->>'event_type'<>'training'
   or coalesce(event_value->'deleted_occurrence_dates','[]'::jsonb) ? enrolment.occurrence_date::text then return false; end if;
  first_date:=((event_value->>'starts_at')::timestamptz at time zone 'Europe/London')::date;
  local_time:=((event_value->>'starts_at')::timestamptz at time zone 'Europe/London')::time;
  valid_occurrence:=enrolment.occurrence_date=first_date;
  if enrolment.occurrence_date>first_date and enrolment.occurrence_date<=coalesce((event_value->>'recurrence_until')::date,first_date) then
   case lower(coalesce(event_value->>'recurrence_frequency','none'))
    when 'weekly' then valid_occurrence:=((enrolment.occurrence_date-first_date)%7)=0;
    when 'fortnightly' then valid_occurrence:=((enrolment.occurrence_date-first_date)%14)=0;
    when 'monthly' then
     -- Match the existing training generator's iterative Date.setUTCMonth
     -- rollover, including 31 January -> 3 March, rather than SQL month clamp.
     cursor_date:=first_date;
     while cursor_date<enrolment.occurrence_date and month_steps<400 loop
      cursor_date:=(date_trunc('month',cursor_date::timestamp)+interval '1 month')::date+extract(day from cursor_date)::integer-1;
      month_steps:=month_steps+1;
     end loop;
     valid_occurrence:=cursor_date=enrolment.occurrence_date;
    else valid_occurrence:=false;
   end case;
  end if;
  if not coalesce(valid_occurrence,false) then return false; end if;
  start_time:=(enrolment.occurrence_date+local_time) at time zone 'Europe/London';
  if (start_time at time zone 'Europe/London')::time<>local_time
   or ((start_time+interval '1 hour') at time zone 'Europe/London')=(start_time at time zone 'Europe/London')
   or ((start_time-interval '1 hour') at time zone 'Europe/London')=(start_time at time zone 'Europe/London') then return false; end if;
 end if;
 return coalesce(start_time>clock_timestamp(),false);
end $$;
revoke all on function app_private.coach_reminder_planning_excluded_v1(uuid) from public,anon,authenticated;

create or replace function app_private.coach_reminder_projection_v1(enrolment_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare effect jsonb; job jsonb; context_value jsonb; status_value text; automatic_value boolean; enrolment public.team_coach_reminder_enrolments%rowtype; fallback jsonb;
begin
 if not app_private.coach_reminder_planning_excluded_v1(enrolment_id) then return null; end if;
 select * into enrolment from public.team_coach_reminder_enrolments where id=enrolment_id;
 job:=jsonb_build_object('kind',enrolment.kind,'eventId',enrolment.event_id,'enrolmentId',enrolment.id,'occurrenceDate',coalesce(enrolment.occurrence_date::text,''),'playerId',enrolment.player_id);
 context_value:=public.team_coach_reminder_context_v1(job);
 fallback:=jsonb_build_object('eventId',enrolment.event_id,'kind',enrolment.kind,'occurrenceDate',coalesce(enrolment.occurrence_date::text,''),'playerId',enrolment.player_id,
  'status',coalesce(context_value->'response'->>'status','pending'),'automatic',false,'provenance',coalesce(context_value->'response'->>'response_source','no_response'),'planningExcluded',true);
 select e.payload,j.payload into effect,job from public.team_coach_reminder_effects e join public.team_coach_reminder_jobs j on j.job_key=e.job_key
 where j.payload->>'enrolmentId'=enrolment_id::text order by e.created_at desc limit 1;
 if effect is null then
  return fallback;
 end if;
 context_value:=public.team_coach_reminder_context_v1(job);
 status_value:=coalesce(context_value->'response'->>'status','pending');
 if not coalesce((context_value->>'authorityActive')::boolean,false) or not coalesce((context_value->>'memberActive')::boolean,false)
  or not coalesce((context_value->'policy'->>'opted_in')::boolean,false)
  or effect->>'policyId' is distinct from context_value->'policy'->>'id'
  or effect->>'policyRevision' is distinct from context_value->'policy'->>'revision'
  or context_value->'event' is distinct from effect->'sourceContext'->'event'
  or context_value->'invitation'->>'id' is distinct from effect->'sourceContext'->'invitation'->>'id'
  or context_value->'invitation'->>'invited_at' is distinct from effect->'sourceContext'->'invitation'->>'invited_at'
  or context_value->'invitation'->>'invite_status'='cancelled' or context_value->'invitation'->>'cancelled_at' is not null
  or clock_timestamp()>=(job->>'startsAt')::timestamptz or status_value not in ('pending','maybe')
  or(status_value='pending' and context_value->'response' is distinct from effect->'sourceContext'->'response') then return fallback; end if;
 automatic_value:=status_value='pending' and effect->>'status'='unavailable';
 return jsonb_build_object('eventId',job->>'eventId','kind',job->>'kind','occurrenceDate',job->>'occurrenceDate','playerId',job->>'playerId',
  'status',case when automatic_value then 'unavailable' else status_value end,'automatic',automatic_value,
  'provenance',case when automatic_value then 'coach_deadline_automation' else coalesce(context_value->'response'->>'response_source','explicit_response') end,
  'planningExcluded',true,'appliedAt',effect->>'appliedAt');
end $$;
revoke all on function app_private.coach_reminder_projection_v1(uuid) from public,anon,authenticated;

create or replace function public.get_team_coach_reminder_projections_v1(kind_value text,event_ids uuid[],parent_link_id_value uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare enrolment record; projection jsonb; result jsonb:='[]'::jsonb;
begin
 if auth.uid() is null or kind_value not in ('MATCH','TRAINING') or cardinality(event_ids)>100 then raise exception 'reminder_scope_invalid' using errcode='42501'; end if;
 if not exists(select 1 from public.team_coach_reminder_release_control where enabled) then return result; end if;
 for enrolment in select e.* from public.team_coach_reminder_enrolments e where e.kind=kind_value and e.event_id=any(event_ids)
  and ((parent_link_id_value is null and app_private.can_manage_team_coach_reminders(e.club_id,e.team_id)) or exists(select 1 from public.parent_player_links link
   where link.player_id=e.player_id and link.club_id=e.club_id and link.auth_user_id=auth.uid() and link.status='active'
    and (parent_link_id_value is null or link.id=parent_link_id_value)
    and public.current_user_can_access_parent_link(link.id,link.player_id)
    and exists(select 1 from public.get_parent_portal_invitation_summary(link.id) invitation
      where invitation.event_id=e.event_id and invitation.child_id=e.player_id
        and invitation.source_event_type=case when e.kind='MATCH' then 'match_day' else 'calendar_event' end
        and invitation.invitation_type=case when e.kind='MATCH' then 'match_attendance' else 'training_attendance' end
        and (e.kind='MATCH' or (invitation.event_start at time zone 'Europe/London')::date=e.occurrence_date)))
   or (parent_link_id_value is null and exists(select 1 from public.get_own_adult_player_account_state() adult
    where adult.access_granted and adult.player_id=e.player_id and adult.club_id=e.club_id and adult.team_id=e.team_id)
    and exists(select 1 from public.get_own_adult_player_invitation_state() invitation where invitation.event_id=e.event_id
     and invitation.invitation_type=case when e.kind='MATCH' then 'match_attendance' else 'training_attendance' end
     and (e.kind='MATCH' or (invitation.event_start at time zone 'Europe/London')::date=e.occurrence_date)))) loop
  projection:=app_private.coach_reminder_projection_v1(enrolment.id);
  if projection is not null then result:=result||jsonb_build_array(projection); end if;
 end loop;
 return result;
end $$;
revoke all on function public.get_team_coach_reminder_projections_v1(text,uuid[],uuid) from public,anon;
grant execute on function public.get_team_coach_reminder_projections_v1(text,uuid[],uuid) to authenticated;

create or replace function app_private.guard_coach_reminder_squad_planning_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare enrolment uuid;
begin
 if new.status<>'selected' or not exists(select 1 from public.team_coach_reminder_release_control where enabled) then return new; end if;
 for enrolment in select id from public.team_coach_reminder_enrolments where kind='MATCH' and event_id=new.match_day_id and player_id=new.player_id and club_id=new.club_id and team_id=new.team_id loop
  if app_private.coach_reminder_planning_excluded_v1(enrolment) then
   raise exception 'This Player needs an Attending response before selection under the team deadline policy.' using errcode='22023';
  end if;
 end loop;
 return new;
end $$;
revoke all on function app_private.guard_coach_reminder_squad_planning_v1() from public,anon,authenticated;
create trigger coach_reminder_squad_planning before insert or update of status on public.match_day_player_squad_decisions
 for each row execute function app_private.guard_coach_reminder_squad_planning_v1();
create or replace function app_private.guard_coach_reminder_formation_planning_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare match_id uuid; placements_value jsonb; bench_value jsonb; excluded uuid;
begin
 if not exists(select 1 from public.team_coach_reminder_release_control where enabled) then return new; end if;
 if tg_table_name='formation_board_versions' then
  select linked_match_day_id into match_id from public.formation_boards where id=new.board_id;
  placements_value:=new.placements;bench_value:=new.bench;
 elsif tg_table_name='formation_board_match_publications' then
  match_id:=new.match_day_id;
  select placements,bench into placements_value,bench_value from public.formation_board_versions where id=new.board_version_id;
 else
  match_id:=new.linked_match_day_id;
  select placements,bench into placements_value,bench_value from public.formation_board_versions where id=new.current_version_id;
 end if;
 if match_id is null then return new; end if;
 for excluded in select e.id from public.team_coach_reminder_enrolments e
  where e.kind='MATCH' and e.event_id=match_id and e.club_id=new.club_id and e.team_id=new.team_id
   and exists(select 1 from jsonb_array_elements(coalesce(placements_value,'[]'::jsonb)||coalesce(bench_value,'[]'::jsonb)) player where player->>'playerId'=e.player_id::text) loop
  if app_private.coach_reminder_planning_excluded_v1(excluded) then
   raise exception 'This Player needs an Attending response before being included in the match plan under the team deadline policy.' using errcode='22023';
  end if;
 end loop;
 return new;
end $$;
revoke all on function app_private.guard_coach_reminder_formation_planning_v1() from public,anon,authenticated;
create trigger coach_reminder_formation_version before insert on public.formation_board_versions
 for each row execute function app_private.guard_coach_reminder_formation_planning_v1();
create trigger coach_reminder_formation_link before insert or update of linked_match_day_id,current_version_id on public.formation_boards
 for each row execute function app_private.guard_coach_reminder_formation_planning_v1();
create trigger coach_reminder_formation_publication before insert on public.formation_board_match_publications
 for each row execute function app_private.guard_coach_reminder_formation_planning_v1();
