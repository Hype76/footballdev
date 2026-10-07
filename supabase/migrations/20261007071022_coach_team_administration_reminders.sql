-- BEGIN TEAM ADMINISTRATION REMINDERS
-- Team reminder policy is opt-in. Existing events, invitations and responses are preserved.
create table public.team_reminder_policies (
  team_id uuid primary key references public.teams(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  squad_enabled boolean not null default false,
  squad_hours_before integer not null default 48 check (squad_hours_before between 1 and 168),
  availability_enabled boolean not null default false,
  availability_hours_before integer not null default 48 check (availability_hours_before between 1 and 168),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.team_reminder_policies enable row level security;
alter table public.team_reminder_policies force row level security;
revoke all on public.team_reminder_policies from public, anon, authenticated;
grant select, insert, update, delete on public.team_reminder_policies to service_role;

create table app_private.team_reminder_deliveries (
  delivery_key text primary key,
  club_id uuid not null references public.clubs(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  payload jsonb not null,
  lease_id uuid,
  leased_until timestamptz,
  attempts integer not null default 0,
  completed_at timestamptz,
  inbox_event_id bigint,
  last_error text
);
alter table app_private.team_reminder_deliveries enable row level security;
revoke all on app_private.team_reminder_deliveries from public, anon, authenticated, service_role;

create function app_private.team_admin_can_manage(actor_value uuid, team_value uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.teams t
    join public.clubs c on c.id=t.club_id and coalesce(c.status,'active')='active' and c.archived_at is null
    join public.users u on u.id=actor_value and u.club_id=c.id and u.status='active'
    join auth.users au on au.id=u.id and au.email_confirmed_at is not null and (au.banned_until is null or au.banned_until<=now())
    join public.user_club_memberships m on m.auth_user_id=u.id and m.club_id=u.club_id
      and m.role=u.role and m.role_rank=u.role_rank
    where t.id=team_value and t.archived_at is null and coalesce(t.status,'active')='active'
      and public.is_club_plan_access_active(c.id)
      and ((u.role='admin' and u.role_rank>=90) or exists (
        select 1 from public.team_staff s where s.team_id=t.id and s.user_id=u.id
          and s.role_key='head_manager' and s.role_rank>=70
      ))
  );
$$;
revoke all on function app_private.team_admin_can_manage(uuid,uuid) from public, anon, authenticated, service_role;

create function public.manage_team_reminder_policy(actor_value uuid, team_value uuid, action_value text,
  squad_enabled_value boolean default false, squad_hours_value integer default 48,
  availability_enabled_value boolean default false, availability_hours_value integer default 48)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.teams%rowtype; p public.team_reminder_policies%rowtype; editable boolean;
begin
  select * into t from public.teams where id=team_value and archived_at is null;
  if t.id is null or actor_value is null or not app_private.actor_can_manage_team_resource(actor_value,t.club_id,t.id,20)
    or not exists(select 1 from auth.users au where au.id=actor_value and au.email_confirmed_at is not null and (au.banned_until is null or au.banned_until<=now())) then
    raise exception 'Active access to this team is required.' using errcode='42501';
  end if;
  editable:=app_private.team_admin_can_manage(actor_value,t.id);
  if action_value='save' then
    if not editable then raise exception 'Only the team admin can change reminders.' using errcode='42501'; end if;
    if squad_hours_value is null or availability_hours_value is null or squad_hours_value not between 1 and 168 or availability_hours_value not between 1 and 168
      or squad_enabled_value is null or availability_enabled_value is null then
      raise exception 'Choose reminder times from 1 to 168 hours.' using errcode='22023';
    end if;
    insert into public.team_reminder_policies(team_id,club_id,squad_enabled,squad_hours_before,availability_enabled,availability_hours_before,updated_by)
    values(t.id,t.club_id,squad_enabled_value,squad_hours_value,availability_enabled_value,availability_hours_value,actor_value)
    on conflict(team_id) do update set squad_enabled=excluded.squad_enabled,squad_hours_before=excluded.squad_hours_before,
      availability_enabled=excluded.availability_enabled,availability_hours_before=excluded.availability_hours_before,
      updated_by=actor_value,updated_at=now();
  elsif action_value<>'read' then raise exception 'Invalid reminder action.' using errcode='22023'; end if;
  select * into p from public.team_reminder_policies where team_id=t.id;
  return jsonb_build_object('teamId',t.id,'clubId',t.club_id,'canManage',editable,
    'squadEnabled',coalesce(p.squad_enabled,false),'squadHoursBefore',coalesce(p.squad_hours_before,48),
    'availabilityEnabled',coalesce(p.availability_enabled,false),'availabilityHoursBefore',coalesce(p.availability_hours_before,48));
end;
$$;
revoke all on function public.manage_team_reminder_policy(uuid,uuid,text,boolean,integer,boolean,integer) from public,anon,authenticated;
grant execute on function public.manage_team_reminder_policy(uuid,uuid,text,boolean,integer,boolean,integer) to service_role;

create function public.create_phone_team_coach_invite(actor_value uuid, team_value uuid, email_value text, role_value text, limit_value integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.teams%rowtype; invitation public.club_user_invites%rowtype; target_id uuid; answer jsonb;
  normalized_email text:=lower(btrim(email_value));
begin
  select * into t from public.teams where id=team_value for update;
  if not app_private.team_admin_can_manage(actor_value,t.id) then
    raise exception 'Only the team admin can add coaches.' using errcode='42501';
  end if;
  if role_value not in ('coach','assistant_coach') or normalized_email !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
    or length(normalized_email)>254 then raise exception 'Enter a valid coach email and role.' using errcode='22023'; end if;
  if not public.can_use_plan_feature(t.club_id,'teamStaffRoles') then
    raise exception 'This plan does not include coach access.' using errcode='42501'; end if;
  -- Serialise invitation counts across all teams within this club.
  perform 1 from public.clubs where id=t.club_id for update;
  if limit_value is not null and not exists(select 1 from public.users where club_id=t.club_id and lower(email)=normalized_email)
    and not exists(select 1 from public.club_user_invites where club_id=t.club_id and lower(email)=normalized_email and status='pending')
    and (select count(distinct email) from (
      select lower(email) email from public.users where club_id=t.club_id
      union select lower(email) from public.club_user_invites where club_id=t.club_id and accepted_at is null
    ) access_emails)>=limit_value then raise exception 'Your coach login allowance has been reached.' using errcode='23514'; end if;
  select id into target_id from public.users where club_id=t.club_id and lower(email)=normalized_email and status='active' limit 1;
  if target_id is not null then
    -- Existing accounts require the canonical authenticated assignment command, never a service-role update.
    return jsonb_build_object('kind','existing','userId',target_id,'teamId',t.id,'clubId',t.club_id,'role',role_value);
  end if;
  select * into invitation from public.club_user_invites where club_id=t.club_id and lower(email)=normalized_email
    and status='pending' and accepted_at is null and cancelled_at is null and replaced_at is null for update;
  if invitation.id is not null and invitation.team_id is distinct from t.id then
    raise exception 'This email already has an invitation for another team. Review its access first.' using errcode='23514';
  end if;
  if invitation.id is null then
    insert into public.club_user_invites(club_id,email,role_key,role_label,role_rank,created_by,invite_token,team_id,expires_at,status)
    values(t.club_id,normalized_email,role_value,case when role_value='coach' then 'Coach' else 'Assistant Coach' end,
      case when role_value='coach' then 30 else 20 end,actor_value,gen_random_uuid(),t.id,now()+interval '7 days','pending') returning * into invitation;
  elsif invitation.role_key is distinct from role_value or invitation.expires_at<=now() then
    raise exception 'This email has an existing invitation. Review or replace it before changing its role.' using errcode='23514';
  end if;
  return jsonb_build_object('kind','invite','inviteId',invitation.id,'teamId',t.id,'clubId',t.club_id,
    'inviteToken',invitation.invite_token,'roleLabel',invitation.role_label,'email',invitation.email,
    'alreadySent',invitation.invite_sent_at is not null,'teamName',t.name);
end;
$$;
revoke all on function public.create_phone_team_coach_invite(uuid,uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.create_phone_team_coach_invite(uuid,uuid,text,text,integer) to service_role;

-- Phone mail transport rechecks the stored reservation, not a client role or command flag.
create function public.phone_team_invite_can_send(actor_value uuid, invite_value uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.club_user_invites i join public.teams t on t.id=i.team_id and t.club_id=i.club_id
    where i.id=invite_value and i.status='pending' and i.accepted_at is null and i.cancelled_at is null and i.replaced_at is null
      and i.expires_at>now() and i.invite_token is not null
      and ((i.role_key='coach' and i.role_rank=30) or (i.role_key='assistant_coach' and i.role_rank=20))
      and app_private.team_admin_can_manage(actor_value,t.id)
      and public.can_use_plan_feature(i.club_id,'teamStaffRoles')
  );
$$;
revoke all on function public.phone_team_invite_can_send(uuid,uuid) from public,anon,authenticated;
grant execute on function public.phone_team_invite_can_send(uuid,uuid) to service_role;

create function public.claim_due_team_reminders(batch_value integer default 25)
returns setof jsonb language plpgsql security definer set search_path = '' as $$
begin
  insert into app_private.team_reminder_deliveries(delivery_key,club_id,team_id,payload)
  select 'squad:'||m.id||':'||(m.match_date+m.kickoff_time)::text||':'||s.user_id,p.club_id,p.team_id,
    jsonb_build_object('kind','squad','eventId',m.id,'startsAt',(m.match_date+m.kickoff_time) at time zone 'Europe/London','clubId',p.club_id,'teamId',p.team_id,'recipientId',s.user_id,'actorId',p.updated_by,'policyVersion',p.updated_at)
  from public.team_reminder_policies p join public.match_days m on m.team_id=p.team_id and m.club_id=p.club_id
  join public.team_staff s on s.team_id=p.team_id and s.role_key in ('head_manager','manager','coach','assistant_coach') and s.role_rank>=20
  where p.squad_enabled and m.deleted_at is null and m.status in ('scheduled','scorer_request') and not m.kickoff_time_tbc
    and m.kickoff_time is not null and ((m.match_date+m.kickoff_time) at time zone 'Europe/London')>now()
    and ((m.match_date+m.kickoff_time) at time zone 'Europe/London')<=now()+make_interval(hours=>p.squad_hours_before)
    and app_private.team_admin_can_manage(p.updated_by,p.team_id)
    and app_private.actor_can_manage_team_resource(s.user_id,p.club_id,p.team_id,20)
    and (not exists(select 1 from public.match_day_player_squad_decisions d where d.match_day_id=m.id and d.status='selected' and d.notified_at is not null)
      or exists(select 1 from public.match_day_player_squad_decisions d where d.match_day_id=m.id and d.status='selected' and d.notified_at is null))
  on conflict(delivery_key) do update set payload=excluded.payload,completed_at=null,last_error=null,attempts=0,lease_id=null,leased_until=null
    where app_private.team_reminder_deliveries.last_error='Skipped: not current.'
      and app_private.team_reminder_deliveries.inbox_event_id is null
      and app_private.team_reminder_deliveries.payload->>'policyVersion' is distinct from excluded.payload->>'policyVersion';
  insert into app_private.team_reminder_deliveries(delivery_key,club_id,team_id,payload)
  select distinct 'availability:match-day:'||m.id||':'||(m.match_date+m.kickoff_time)::text||':'||r.player_id,p.club_id,p.team_id,
    jsonb_build_object('kind','availability','sourceType','match-day','eventId',m.id,'startsAt',(m.match_date+m.kickoff_time) at time zone 'Europe/London','clubId',p.club_id,'teamId',p.team_id,'playerId',r.player_id,'actorId',p.updated_by,'policyVersion',p.updated_at)
  from public.team_reminder_policies p join public.match_days m on m.team_id=p.team_id and m.club_id=p.club_id
  join public.match_day_availability_requests r on r.match_day_id=m.id and r.team_id=p.team_id and r.club_id=p.club_id
  where p.availability_enabled and r.status='pending' and r.responded_at is null and r.token_revoked_at is null
    and r.sent_at is not null and not exists(select 1 from public.match_day_player_availability a where a.match_day_id=m.id and a.player_id=r.player_id and a.status<>'pending')
    and m.deleted_at is null and m.status in ('scheduled','scorer_request') and not m.kickoff_time_tbc
    and m.kickoff_time is not null and ((m.match_date+m.kickoff_time) at time zone 'Europe/London')>now()
    and ((m.match_date+m.kickoff_time) at time zone 'Europe/London')<=now()+make_interval(hours=>p.availability_hours_before)
    and app_private.team_admin_can_manage(p.updated_by,p.team_id)
  on conflict(delivery_key) do update set payload=excluded.payload,completed_at=null,last_error=null,attempts=0,lease_id=null,leased_until=null
    where app_private.team_reminder_deliveries.last_error='Skipped: not current.'
      and app_private.team_reminder_deliveries.inbox_event_id is null
      and app_private.team_reminder_deliveries.payload->>'policyVersion' is distinct from excluded.payload->>'policyVersion';
  insert into app_private.team_reminder_deliveries(delivery_key,club_id,team_id,payload)
  select distinct 'availability:calendar:'||r.calendar_event_id||':'||r.occurrence_starts_at::text||':'||rp.player_id,p.club_id,p.team_id,
    jsonb_build_object('kind','availability','sourceType','calendar','eventId',r.calendar_event_id,'occurrenceDate',r.occurrence_date,
      'startsAt',r.occurrence_starts_at,'clubId',p.club_id,'teamId',p.team_id,'playerId',rp.player_id,'actorId',p.updated_by,'policyVersion',p.updated_at)
  from public.team_reminder_policies p join public.training_availability_requests r on r.team_id=p.team_id and r.club_id=p.club_id
  join public.training_availability_request_players rp on rp.request_id=r.id and rp.status in ('sent','queued') and rp.email_sent_at is not null
  join public.calendar_events e on e.id=r.calendar_event_id and e.team_id=p.team_id and e.cancelled_at is null
  where p.availability_enabled and r.status in ('sent','queued','partial_failed') and r.occurrence_starts_at>now()
    and r.occurrence_starts_at<=now()+make_interval(hours=>p.availability_hours_before)
    and not exists(select 1 from public.training_availability_responses a where a.request_id=r.id and a.player_id=rp.player_id)
    and app_private.team_admin_can_manage(p.updated_by,p.team_id)
  on conflict(delivery_key) do update set payload=excluded.payload,completed_at=null,last_error=null,attempts=0,lease_id=null,leased_until=null
    where app_private.team_reminder_deliveries.last_error='Skipped: not current.'
      and app_private.team_reminder_deliveries.inbox_event_id is null
      and app_private.team_reminder_deliveries.payload->>'policyVersion' is distinct from excluded.payload->>'policyVersion';
  return query with chosen as (
    select d.delivery_key from app_private.team_reminder_deliveries d
    where completed_at is null and attempts<5 and (leased_until is null or leased_until<now())
    order by delivery_key for update skip locked limit least(50,greatest(1,batch_value))
  ), leased as (
    update app_private.team_reminder_deliveries d set lease_id=gen_random_uuid(),leased_until=now()+interval '2 minutes',attempts=attempts+1
    from chosen c where d.delivery_key=c.delivery_key returning d.*
  ) select payload||jsonb_build_object('deliveryKey',delivery_key,'leaseId',lease_id) from leased;
end;
$$;
revoke all on function public.claim_due_team_reminders(integer) from public,anon,authenticated;
grant execute on function public.claim_due_team_reminders(integer) to service_role;

create function public.finish_team_reminder(delivery_key_value text,lease_value uuid,error_value text default '')
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update app_private.team_reminder_deliveries set completed_at=case when error_value in ('','Skipped: not current.') then now() else null end,
    leased_until=case when error_value in ('','Skipped: not current.') then null else now()+interval '5 minutes' end,last_error=left(error_value,200)
  where delivery_key=delivery_key_value and lease_id=lease_value;
  return found;
end;
$$;
revoke all on function public.finish_team_reminder(text,uuid,text) from public,anon,authenticated;
grant execute on function public.finish_team_reminder(text,uuid,text) to service_role;

create function public.team_reminder_is_current(delivery_key_value text, lease_value uuid default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare d app_private.team_reminder_deliveries%rowtype; p public.team_reminder_policies%rowtype; m public.match_days%rowtype;
begin
  select * into d from app_private.team_reminder_deliveries where delivery_key=delivery_key_value;
  if lease_value is not null and (d.lease_id is distinct from lease_value or d.leased_until<=now()) then return false; end if;
  select * into p from public.team_reminder_policies where team_id=d.team_id and club_id=d.club_id;
  if p.team_id is null or p.updated_by::text is distinct from d.payload->>'actorId'
    or not app_private.team_admin_can_manage(p.updated_by,p.team_id) then return false; end if;
  if d.payload->>'kind'='squad' or d.payload->>'sourceType'='match-day' then
    select * into m from public.match_days where id=(d.payload->>'eventId')::uuid and team_id=d.team_id and club_id=d.club_id;
    if m.id is null or m.deleted_at is not null or m.status not in ('scheduled','scorer_request') or m.kickoff_time_tbc
      or m.kickoff_time is null or ((m.match_date+m.kickoff_time) at time zone 'Europe/London')<=now()
      or ((m.match_date+m.kickoff_time) at time zone 'Europe/London') is distinct from (d.payload->>'startsAt')::timestamptz then return false; end if;
    if d.payload->>'kind'='squad' then
      return p.squad_enabled and app_private.actor_can_manage_team_resource((d.payload->>'recipientId')::uuid,d.club_id,d.team_id,20)
        and exists(select 1 from public.team_staff s join auth.users au on au.id=s.user_id and au.email_confirmed_at is not null
          and (au.banned_until is null or au.banned_until<=now()) where s.team_id=d.team_id and s.user_id=(d.payload->>'recipientId')::uuid
          and s.role_key in ('head_manager','manager','coach','assistant_coach') and s.role_rank>=20)
        and ((m.match_date+m.kickoff_time) at time zone 'Europe/London')<=now()+make_interval(hours=>p.squad_hours_before)
        and (not exists(select 1 from public.match_day_player_squad_decisions where match_day_id=m.id and status='selected' and notified_at is not null)
          or exists(select 1 from public.match_day_player_squad_decisions where match_day_id=m.id and status='selected' and notified_at is null));
    end if;
    return p.availability_enabled
      and ((m.match_date+m.kickoff_time) at time zone 'Europe/London')<=now()+make_interval(hours=>p.availability_hours_before)
      and exists(select 1 from public.match_day_availability_requests where match_day_id=m.id and player_id=(d.payload->>'playerId')::uuid
        and status='pending' and responded_at is null and token_revoked_at is null and sent_at is not null)
      and not exists(select 1 from public.match_day_player_availability where match_day_id=m.id and player_id=(d.payload->>'playerId')::uuid and status<>'pending');
  end if;
  return p.availability_enabled and exists(
    select 1 from public.training_availability_requests r
    join public.calendar_events e on e.id=r.calendar_event_id and e.team_id=d.team_id and e.club_id=d.club_id and e.cancelled_at is null
    join public.training_availability_request_players rp on rp.request_id=r.id and rp.player_id=(d.payload->>'playerId')::uuid
      and rp.status in ('sent','queued') and rp.email_sent_at is not null
    where r.calendar_event_id=(d.payload->>'eventId')::uuid and r.occurrence_date=(d.payload->>'occurrenceDate')::date
      and r.club_id=d.club_id and r.team_id=d.team_id and r.status in ('sent','queued','partial_failed')
      and r.occurrence_starts_at=(d.payload->>'startsAt')::timestamptz
      and r.occurrence_starts_at>now() and r.occurrence_starts_at<=now()+make_interval(hours=>p.availability_hours_before)
      and not exists(select 1 from public.training_availability_responses where request_id=r.id and player_id=rp.player_id)
  );
end;
$$;
revoke all on function public.team_reminder_is_current(text,uuid) from public,anon,authenticated;
grant execute on function public.team_reminder_is_current(text,uuid) to service_role;

create function public.record_team_reminder_inbox(delivery_key_value text, lease_value uuid default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare d app_private.team_reminder_deliveries%rowtype; event_id bigint; opponent_name text;
begin
  select * into d from app_private.team_reminder_deliveries where delivery_key=delivery_key_value for update;
  if not public.team_reminder_is_current(delivery_key_value,lease_value) or d.payload->>'kind'<>'squad' then return null; end if;
  if d.inbox_event_id is not null then return d.inbox_event_id; end if;
  select opponent into opponent_name from public.match_days where id=(d.payload->>'eventId')::uuid;
  insert into public.coach_mobile_notification_events(auth_user_id,user_profile_id,club_id,team_id,intent_type,title,body,data,status)
  values((d.payload->>'recipientId')::uuid,(d.payload->>'recipientId')::uuid,d.club_id,d.team_id,'coach_update','Squad selection reminder',
    'Choose and confirm the squad for '||coalesce(opponent_name,'your upcoming match')||'.',
    jsonb_build_object('app','coach','type','squad_reminder','route','matchday','targetId',d.payload->>'eventId','teamId',d.team_id),'sent')
  returning id into event_id;
  update app_private.team_reminder_deliveries set inbox_event_id=event_id where delivery_key=delivery_key_value;
  return event_id;
end;
$$;
revoke all on function public.record_team_reminder_inbox(text,uuid) from public,anon,authenticated;
grant execute on function public.record_team_reminder_inbox(text,uuid) to service_role;
-- END TEAM ADMINISTRATION REMINDERS

-- BEGIN SHARED APPEARANCE ADMIN BOUNDARIES
-- Paid Club appearance is Club-admin-only. Paid Team appearance is Team-admin-only.
-- Existing Matchday and individual kit authority, branding records and offer clocks are preserved.
create or replace function app_private.enforce_team_matchday_kit_update()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare plan_value text; scope_value text;
begin
  if tg_op = 'INSERT' and new.home_kit_colour is null and new.away_kit_colour is null then return new; end if;
  if tg_op = 'UPDATE' and new.home_kit_colour is not distinct from old.home_kit_colour
    and new.away_kit_colour is not distinct from old.away_kit_colour then return new; end if;
  if not coalesce(public.current_user_can_access_team(new.club_id,new.id),false)
    or (coalesce(public.current_user_role(),'') not in ('admin','super_admin')
      and coalesce(public.current_user_team_role_rank(new.id),0)<50) then
    raise exception 'team_kit_update_not_authorized' using errcode='42501'; end if;
  select public.canonical_subscription_plan_key(c.plan_key),public.workspace_scope_for_plan_key(c.plan_key)
    into plan_value,scope_value from public.clubs c where c.id=new.club_id;
  if scope_value='club' and (coalesce(public.current_user_role(),'')<>'admin'
    or public.current_user_role_rank()<90 or public.current_user_club_id() is distinct from new.club_id) then
    raise exception 'club_kit_update_requires_club_admin' using errcode='42501'; end if;
  if plan_value='team' and not coalesce((
    (public.current_user_role()='admin' and public.current_user_role_rank()>=90 and public.current_user_club_id()=new.club_id)
    or exists(select 1 from public.team_staff s where s.user_id=auth.uid() and s.team_id=new.id
      and s.role_key='head_manager' and s.role_rank>=70)
  ),false) then raise exception 'team_kit_update_requires_team_admin' using errcode='42501'; end if;
  if not coalesce(public.can_use_plan_feature(new.club_id,'matchDay'),false) then
    raise exception 'plan_capability_not_available' using errcode='42501'; end if;
  return new;
end;
$$;

create or replace function app_private.branding_actor_can_manage(actor_value uuid,club_value uuid,team_value uuid)
returns boolean language sql volatile security definer set search_path='' as $$
  select exists(
    select 1 from public.users u join auth.users a on a.id=u.id
    join public.teams t on t.id=team_value and t.club_id=club_value
    join public.clubs c on c.id=t.club_id
    where u.id=actor_value and u.status='active' and a.email_confirmed_at is not null
      and (a.banned_until is null or a.banned_until<=clock_timestamp())
      and lower(coalesce(a.email,''))<>'demo@playerfeedback.online'
      and t.status='active' and t.archived_at is null and c.status='active' and c.archived_at is null
      and (
        (public.platform_access_is_admin_v1(actor_value) and public.workspace_scope_for_plan_key(c.plan_key)<>'club')
        or (u.club_id=club_value and exists(select 1 from public.user_club_memberships m
          where m.auth_user_id=u.id and m.club_id=c.id and m.role=u.role and m.role_rank=u.role_rank)
          and ((u.role='admin' and u.role_rank>=90) or (public.workspace_scope_for_plan_key(c.plan_key)<>'club'
            and u.role_rank>=20 and u.role not in ('admin','parent_portal','super_admin')
            and exists(select 1 from public.team_staff s where s.user_id=u.id and s.team_id=t.id
              and s.role_key='head_manager' and s.role_rank>=70))))
      )
  );
$$;
revoke all on function app_private.branding_actor_can_manage(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function app_private.enforce_team_appearance_admin_boundary()
returns trigger language plpgsql security definer set search_path='' as $$
declare plan_value text; scope_value text;
begin
  if new.theme_mode is not distinct from old.theme_mode and new.theme_accent is not distinct from old.theme_accent
    and new.theme_button_style is not distinct from old.theme_button_style then return new; end if;
  if not coalesce(public.current_user_can_access_team(new.club_id,new.id),false) then
    raise exception 'team_appearance_not_authorized' using errcode='42501'; end if;
  select public.canonical_subscription_plan_key(c.plan_key),public.workspace_scope_for_plan_key(c.plan_key)
    into plan_value,scope_value from public.clubs c where c.id=new.club_id;
  if scope_value='club' and not coalesce((public.current_user_role()='admin' and public.current_user_role_rank()>=90
    and public.current_user_club_id()=new.club_id),false) then
    raise exception 'club_appearance_requires_club_admin' using errcode='42501'; end if;
  if plan_value='team' and not coalesce(((public.current_user_role()='admin' and public.current_user_role_rank()>=90
    and public.current_user_club_id()=new.club_id)
    or exists(select 1 from public.team_staff s where s.user_id=auth.uid() and s.team_id=new.id
      and s.role_key='head_manager' and s.role_rank>=70)),false) then
    raise exception 'team_appearance_requires_team_admin' using errcode='42501'; end if;
  return new;
end;
$$;
revoke all on function app_private.enforce_team_appearance_admin_boundary() from public,anon,authenticated,service_role;
create trigger enforce_team_appearance_admin_boundary before update of theme_mode,theme_accent,theme_button_style
  on public.teams for each row execute function app_private.enforce_team_appearance_admin_boundary();
-- END SHARED APPEARANCE ADMIN BOUNDARIES

-- Phone assessment finalisation: one original draft, one stable final record.
-- Invoker privileges retain all existing table grants, tenant RLS and plan checks.
create or replace function public.finalise_coach_mobile_assessment(
  draft_id_value uuid,
  expected_save_version_value bigint,
  evaluation_value jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  draft public.evaluation_drafts%rowtype;
  saved public.evaluations%rowtype;
  incoming public.evaluations%rowtype;
begin
  if auth.uid() is null or public.current_user_role() = 'parent_portal'
    or public.current_user_role_rank() < 20 then
    raise exception using errcode = '42501', message = 'An authorised coach is required.';
  end if;
  if draft_id_value is null or expected_save_version_value is null
    or expected_save_version_value < 1 or coalesce(jsonb_typeof(evaluation_value), '') <> 'object' then
    raise exception using errcode = '22023', message = 'A synced assessment draft is required.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('coach-assessment:' || draft_id_value::text, 0));
  -- Submitted drafts are selectable, but not updateable under the existing RLS.
  select * into draft from public.evaluation_drafts
    where id = draft_id_value and status = 'draft' for update;
  if not found then
    select * into draft from public.evaluation_drafts
      where id = draft_id_value and status = 'submitted';
  end if;
  if draft.id is null or draft.created_by_user_id <> auth.uid()
    or draft.report_type <> 'development_record' or draft.player_id is null
    or not public.current_user_can_access_team(draft.club_id, draft.team_id)
    or not public.can_use_plan_feature(draft.club_id, 'assessments') then
    raise exception using errcode = '42501', message = 'This assessment draft is no longer authorised.';
  end if;
  if draft.client_save_version <> expected_save_version_value then
    raise exception using errcode = '40001', message = 'This draft changed on another device. Your phone copy has been kept.';
  end if;
  incoming := pg_catalog.jsonb_populate_record(null::public.evaluations, evaluation_value);
  if incoming.club_id is distinct from draft.club_id
    or incoming.team_id is distinct from draft.team_id
    or incoming.player_id is distinct from draft.player_id
    or incoming.coach_id is distinct from auth.uid()
    or incoming.form_responses is distinct from draft.draft_data->'responseValues'
    or incoming.feedback_form_snapshot->>'id' is distinct from draft.draft_data->>'selectedFeedbackFormId'
    or pg_catalog.btrim(coalesce(incoming.comments->>'overall', '')) is distinct from pg_catalog.btrim(coalesce(draft.draft_data->>'notes', '')) then
    raise exception using errcode = '22023', message = 'Finalise the exact synced draft before making further changes.';
  end if;
  if draft.status = 'submitted' then
    select * into saved from public.evaluations
      where id = draft.id and club_id = draft.club_id and team_id = draft.team_id
        and player_id = draft.player_id and coach_id = auth.uid();
    if saved.id is null then
      raise exception using errcode = '22023', message = 'The final record needs recovery. Your phone draft has been kept.';
    end if;
    return pg_catalog.to_jsonb(saved);
  end if;
  if not public.can_insert_evaluation_for_plan(draft.club_id) then
    raise exception using errcode = '42501', message = 'The current plan cannot save another assessment.';
  end if;
  if not exists(select 1 from public.players where id = draft.player_id
    and club_id = draft.club_id and team_id = draft.team_id) then
    raise exception using errcode = '42501', message = 'This player is no longer available in the team.';
  end if;
  if incoming.assessment_session_id is not null and not exists(
    select 1 from public.assessment_sessions where id = incoming.assessment_session_id
      and club_id = draft.club_id and team_id = draft.team_id
  ) then
    raise exception using errcode = '42501', message = 'This session is not available in the team.';
  end if;
  if incoming.feedback_form_id is not null and not exists(
    select 1 from public.feedback_forms where id = incoming.feedback_form_id
      and club_id = draft.club_id and team_id = draft.team_id
  ) then
    raise exception using errcode = '42501', message = 'This form is not available in the team.';
  end if;
  insert into public.evaluations (
    id,club_id,team_id,player_id,player_name,section,team,session,assessment_session_id,
    date,status,coach,coach_id,average_score,scores,comments,form_responses,
    feedback_form_id,feedback_form_name,feedback_form_version,feedback_form_snapshot,
    created_by_email,created_by_name,updated_by,updated_by_email,updated_by_name
  ) values (
    draft.id,draft.club_id,draft.team_id,draft.player_id,incoming.player_name,incoming.section,
    incoming.team,incoming.session,incoming.assessment_session_id,incoming.date,'Submitted',
    incoming.coach,auth.uid(),incoming.average_score,incoming.scores,incoming.comments,incoming.form_responses,
    incoming.feedback_form_id,incoming.feedback_form_name,incoming.feedback_form_version,incoming.feedback_form_snapshot,
    incoming.created_by_email,incoming.created_by_name,auth.uid(),incoming.updated_by_email,incoming.updated_by_name
  ) returning * into saved;
  update public.evaluation_drafts set status = 'submitted', submitted_at = pg_catalog.now(), updated_at = pg_catalog.now()
    where id = draft.id and created_by_user_id = auth.uid() and status = 'draft'
      and client_save_version = expected_save_version_value;
  if not found then
    raise exception using errcode = '40001', message = 'The assessment draft changed. No final record was saved.';
  end if;
  return pg_catalog.to_jsonb(saved);
end;
$$;
revoke all on function public.finalise_coach_mobile_assessment(uuid,bigint,jsonb) from public,anon;
grant execute on function public.finalise_coach_mobile_assessment(uuid,bigint,jsonb) to authenticated;
