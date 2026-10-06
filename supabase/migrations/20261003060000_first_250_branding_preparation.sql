-- Dormant implementation. No clock/grant activation or automatic signup claims.
-- Existing 39 must be individually mapped. They are permanently grandfathered.
create schema if not exists app_private;

create table app_private.first_250_branding_offer (
  singleton boolean primary key default true check (singleton),
  release_enabled boolean not null default false,
  clock_policy text not null default 'offer_claim' check (clock_policy = 'offer_claim'),
  clock_timezone text not null default 'Europe/London' check (clock_timezone = 'Europe/London'),
  terms_version text,
  check (not release_enabled or (
    nullif(btrim(clock_policy), '') is not null
    and nullif(btrim(clock_timezone), '') is not null
    and nullif(btrim(terms_version), '') is not null
  ))
);
insert into app_private.first_250_branding_offer(singleton) values (true);

-- Kept independently of display entitlement. Failure never deletes these values.
create table app_private.first_250_team_branding (
  team_id uuid primary key,
  club_id uuid not null,
  logo_url text,
  theme_accent text check (theme_accent is null or theme_accent in ('yellow', 'blue', 'green', 'red', 'purple')
    or theme_accent ~ '^#[0-9a-f]{6}$'),
  theme_button_style text check (theme_button_style is null or theme_button_style in ('solid', 'gradient')),
  updated_at timestamptz not null default clock_timestamp()
);
alter table app_private.first_250_team_branding enable row level security;
revoke all on table app_private.first_250_team_branding from public, anon, authenticated, service_role;

create function app_private.branding_calendar_deadline(start_value timestamptz, months_value integer)
returns timestamptz language sql immutable set search_path = '' as $$
  select timezone('Europe/London', timezone('Europe/London', start_value)
    + make_interval(months => months_value));
$$;
revoke all on function app_private.branding_calendar_deadline(timestamptz, integer)
  from public, anon, authenticated, service_role;

create table app_private.first_250_branding_entries (
  slot smallint primary key check (slot between 1 and 250),
  team_id uuid not null unique,
  club_id uuid not null,
  cohort text not null check (cohort in ('existing_39', 'new_211')),
  state text not null check (state in ('grandfathered', 'provisional', 'permanent', 'failed')),
  reserved_at timestamptz not null default clock_timestamp(),
  started_at timestamptz,
  deadline_at timestamptz,
  terms_version text,
  accepted_by uuid,
  qualified_at timestamptz,
  extension_used boolean not null default false,
  extended_by uuid,
  extension_reason text,
  extended_at timestamptz,
  check ((cohort = 'existing_39' and slot <= 39 and state = 'grandfathered'
      and started_at is null and deadline_at is null and not extension_used)
    or (cohort = 'new_211' and slot >= 40 and state <> 'grandfathered'
      and started_at is not null and deadline_at > started_at
      and nullif(btrim(terms_version), '') is not null)),
  check ((not extension_used and extended_by is null and extended_at is null and extension_reason is null)
    or (extension_used and extended_by is not null and extended_at is not null
      and nullif(btrim(extension_reason), '') is not null)),
  check ((state = 'permanent' and qualified_at is not null and qualified_at <= deadline_at)
    or (state <> 'permanent' and qualified_at is null))
);
-- No application-table FK. Observation and approved-transfer triggers below
-- revalidate scope while keeping saved artwork independent of display entitlement.
alter table app_private.first_250_branding_offer enable row level security;
alter table app_private.first_250_branding_entries enable row level security;
revoke all on table app_private.first_250_branding_offer from public, anon, authenticated, service_role;
revoke all on table app_private.first_250_branding_entries from public, anon, authenticated, service_role;

create function public.prepare_existing_branding_team(team_id_value uuid, club_id_value uuid)
returns smallint language plpgsql security definer set search_path = '' as $$
declare existing_entry app_private.first_250_branding_entries; next_slot smallint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'branding_offer_service_only' using errcode = '42501';
  end if;
  perform 1 from app_private.first_250_branding_offer where singleton for update;
  if exists (select 1 from app_private.first_250_branding_offer where release_enabled) then
    raise exception 'branding_cohort_mapping_closed';
  end if;
  if not exists (select 1 from public.teams t where t.id = team_id_value and t.club_id = club_id_value) then
    raise exception 'branding_team_scope_invalid';
  end if;
  select * into existing_entry from app_private.first_250_branding_entries where team_id = team_id_value;
  if found then
    if existing_entry.club_id <> club_id_value or existing_entry.cohort <> 'existing_39' then
      raise exception 'branding_reservation_conflict';
    end if;
    return existing_entry.slot;
  end if;
  select min(n)::smallint into next_slot from generate_series(1, 39) n
  where not exists (select 1 from app_private.first_250_branding_entries e where e.slot = n);
  if next_slot is null then raise exception 'branding_existing_cohort_full'; end if;
  insert into app_private.first_250_branding_entries(slot, team_id, club_id, cohort, state)
  values (next_slot, team_id_value, club_id_value, 'existing_39', 'grandfathered');
  return next_slot;
end;
$$;

create function public.reserve_new_branding_team(team_id_value uuid, club_id_value uuid,
  terms_version_value text)
returns smallint language plpgsql security definer set search_path = '' as $$
declare config app_private.first_250_branding_offer; existing_entry app_private.first_250_branding_entries;
  next_slot smallint; deadline_value timestamptz; start_value timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'branding_offer_service_only' using errcode = '42501';
  end if;
  select * into config from app_private.first_250_branding_offer where singleton for update;
  if not found or not config.release_enabled then raise exception 'branding_offer_not_active'; end if;
  if (select count(*) from app_private.first_250_branding_entries where cohort = 'existing_39') <> 39 then
    raise exception 'branding_existing_mapping_incomplete';
  end if;
  if not exists (select 1 from public.teams t where t.id = team_id_value and t.club_id = club_id_value) then
    raise exception 'branding_team_scope_invalid';
  end if;
  select * into existing_entry from app_private.first_250_branding_entries where team_id = team_id_value;
  if found then
    if existing_entry.club_id <> club_id_value then raise exception 'branding_reservation_conflict'; end if;
    return existing_entry.slot;
  end if;
  -- Eligibility is enforced for a fresh place, not a retry after a paid upgrade.
  -- Hold the current team/Club scope and plan until this allocation commits.
  perform 1 from public.teams t join public.clubs c on c.id=t.club_id
    where t.id=team_id_value and c.id=club_id_value
      and t.status='active' and t.archived_at is null
      and c.status='active' and c.archived_at is null
      and public.canonical_subscription_plan_key(c.plan_key)='matchday'
    for share of t,c;
  if not found then raise exception 'branding_matchday_required' using errcode='42501'; end if;
  if terms_version_value is distinct from config.terms_version then
    raise exception 'branding_acceptance_invalid';
  end if;
  select min(n)::smallint into next_slot from generate_series(40, 250) n
  where not exists (select 1 from app_private.first_250_branding_entries e where e.slot = n);
  if next_slot is null then return null; end if;
  -- Claim time is server-owned. Retried claims keep the first start and slot.
  start_value := clock_timestamp();
  deadline_value := app_private.branding_calendar_deadline(start_value, 3);
  insert into app_private.first_250_branding_entries(slot, team_id, club_id, cohort, state,
    started_at, deadline_at, terms_version)
  values (next_slot, team_id_value, club_id_value, 'new_211', 'provisional',
    start_value, deadline_value, terms_version_value);
  return next_slot;
end;
$$;

create function public.read_branding_offer_counter()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare config app_private.first_250_branding_offer; mapped_count integer; new_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'branding_offer_service_only' using errcode = '42501';
  end if;
  select * into config from app_private.first_250_branding_offer where singleton;
  select count(*) into mapped_count from app_private.first_250_branding_entries where cohort = 'existing_39';
  if not found or not coalesce(config.release_enabled, false) or mapped_count <> 39 then
    return jsonb_build_object('status', 'not_active');
  end if;
  select count(*) into new_count from app_private.first_250_branding_entries where cohort = 'new_211';
  -- Failure/deletion never silently recycles a reserved place.
  return jsonb_build_object('status', 'active', 'capacity', 250,
    'reserved', 39 + new_count, 'remaining', 211 - new_count);
end;
$$;

revoke all on function public.prepare_existing_branding_team(uuid, uuid) from public, anon, authenticated;
revoke all on function public.reserve_new_branding_team(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.read_branding_offer_counter() from public, anon, authenticated;
grant execute on function public.prepare_existing_branding_team(uuid, uuid) to service_role;
grant execute on function public.reserve_new_branding_team(uuid, uuid, text) to service_role;
grant execute on function public.read_branding_offer_counter() to service_role;

create function public.extend_branding_offer_team(team_id_value uuid, club_id_value uuid,
  actor_id_value uuid, reason_value text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare entry app_private.first_250_branding_entries;
begin
  if auth.role() is distinct from 'service_role'
    or not coalesce(public.platform_access_is_admin_v1(actor_id_value), false) then
    raise exception 'branding_extension_not_authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from app_private.first_250_branding_offer where release_enabled) then
    raise exception 'branding_offer_not_active';
  end if;
  if nullif(btrim(reason_value), '') is null or length(reason_value) > 500 then
    raise exception 'branding_extension_reason_required';
  end if;
  select * into entry from app_private.first_250_branding_entries
  where team_id = team_id_value and club_id = club_id_value for update;
  if not found or entry.cohort <> 'new_211' or entry.state <> 'provisional' then
    raise exception 'branding_extension_not_applicable';
  end if;
  -- Replay does not extend twice. The caller can read the existing audited result.
  if entry.extension_used then return entry.deadline_at; end if;
  if entry.deadline_at <= clock_timestamp() then
    raise exception 'branding_extension_expired_review_required';
  end if;
  update app_private.first_250_branding_entries set
    deadline_at = app_private.branding_calendar_deadline(deadline_at, 1),
    extension_used = true, extended_by = actor_id_value, extended_at = clock_timestamp(),
    extension_reason = btrim(reason_value)
  where team_id = team_id_value returning deadline_at into entry.deadline_at;
  -- Neither expired nor failed access is silently revived.
  return entry.deadline_at;
end;
$$;
revoke all on function public.extend_branding_offer_team(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.extend_branding_offer_team(uuid, uuid, uuid, text) to service_role;

create table app_private.first_250_branding_observations (
  slot smallint primary key references app_private.first_250_branding_entries(slot),
  observed_at timestamptz not null,
  players_with_parent integer not null check (players_with_parent >= 7),
  completed_matches integer not null check (completed_matches >= 10)
);
alter table app_private.first_250_branding_observations enable row level security;
revoke all on table app_private.first_250_branding_observations from public, anon, authenticated, service_role;

create function app_private.branding_actor_can_manage(actor_value uuid, club_value uuid, team_value uuid)
returns boolean language sql volatile security definer set search_path = '' as $$
  select exists (
    select 1 from public.users u
    join auth.users a on a.id=u.id
    join public.teams t on t.id=team_value and t.club_id=club_value
    join public.clubs c on c.id=t.club_id
    where u.id=actor_value and u.status='active' and a.email_confirmed_at is not null
      and (a.banned_until is null or a.banned_until<=clock_timestamp())
      and lower(coalesce(a.email,''))<>'demo@playerfeedback.online'
      and t.status='active' and t.archived_at is null and c.status='active' and c.archived_at is null
      and (
        public.platform_access_is_admin_v1(actor_value)
        or (u.club_id=club_value and exists (
          select 1 from public.user_club_memberships m where m.auth_user_id=u.id and m.club_id=c.id
            and m.role=u.role and m.role_rank=u.role_rank
        ) and ((u.role='admin' and u.role_rank>=90) or (u.role_rank>=20
          and u.role not in ('admin','parent_portal','super_admin') and exists (
          select 1 from public.team_staff s where s.user_id=u.id and s.team_id=t.id
            and s.role_key='head_manager' and s.role_rank>=70
        ))))
      )
  );
$$;
revoke all on function app_private.branding_actor_can_manage(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.read_first_250_branding_state()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when auth.role()='service_role' then jsonb_build_object(
    'enabled',release_enabled,'termsVersion',terms_version,
    'mappingComplete',(select count(*)=39 from app_private.first_250_branding_entries where cohort='existing_39'))
    else null end from app_private.first_250_branding_offer where singleton;
$$;
revoke all on function public.read_first_250_branding_state() from public,anon,authenticated;
grant execute on function public.read_first_250_branding_state() to service_role;

create function public.claim_first_250_branding_team(actor_value uuid,team_value uuid,club_value uuid,terms_value text)
returns smallint language plpgsql security definer set search_path = '' as $$
declare slot_value smallint;
begin
  if auth.role() is distinct from 'service_role'
    or not app_private.branding_actor_can_manage(actor_value,club_value,team_value) then
    raise exception 'branding_actor_denied' using errcode='42501';
  end if;
  slot_value:=public.reserve_new_branding_team(team_value,club_value,terms_value);
  -- Revalidate with a fresh snapshot after the allocator's lock wait. An error
  -- rolls back the allocation so revoked authority cannot consume a place.
  if not app_private.branding_actor_can_manage(actor_value,club_value,team_value) then
    raise exception 'branding_actor_denied' using errcode='42501'; end if;
  if slot_value is not null then
    update app_private.first_250_branding_entries set accepted_by=coalesce(accepted_by,actor_value)
    where slot=slot_value and cohort='new_211';
    perform app_private.observe_first_250_branding_team(team_value,club_value);
  end if;
  if not app_private.branding_actor_can_manage(actor_value,club_value,team_value) then
    raise exception 'branding_actor_denied' using errcode='42501'; end if;
  return slot_value;
end;
$$;
revoke all on function public.claim_first_250_branding_team(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_first_250_branding_team(uuid,uuid,uuid,text) to service_role;

create function app_private.observe_first_250_branding_team(team_value uuid,club_value uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e app_private.first_250_branding_entries; observed timestamptz;
  player_count integer:=0; match_count integer:=0;
begin
  if not exists(select 1 from app_private.first_250_branding_offer where release_enabled) then return null; end if;
  select * into e from app_private.first_250_branding_entries
    where team_id=team_value and club_id=club_value for update;
  if not found then return null; end if;
  if e.state<>'provisional' then return jsonb_build_object('state',e.state); end if;
  -- A queued read must not retain a pre-deadline timestamp while observing later
  -- committed state. Acquire the entry lock before assigning observation time.
  observed:=clock_timestamp();
  if not exists(select 1 from public.teams t join public.clubs c on c.id=t.club_id
    where t.id=team_value and c.id=club_value and t.status='active' and t.archived_at is null
      and c.status='active' and c.archived_at is null) then return null; end if;
  if observed<=e.deadline_at then
    select count(distinct p.id) into player_count from public.players p
    where p.team_id=team_value and p.club_id=club_value and p.status='active' and p.archived_at is null
      and p.created_at<=observed and exists (
        select 1 from public.parent_player_links l join auth.users a on a.id=l.auth_user_id
        where l.player_id=p.id and coalesce(l.team_id,p.team_id)=p.team_id and l.club_id=p.club_id
          and l.link_type='parent' and l.status='active' and l.accepted_at is not null
          and l.accepted_at<=observed and a.email_confirmed_at is not null
          and (a.banned_until is null or a.banned_until<=observed)
          and not exists(select 1 from public.users u where u.id=a.id and u.status is distinct from 'active'
            and (u.role='parent_portal' or u.club_id=club_value))
      );
    select count(distinct m.id) into match_count from public.match_days m
    where m.team_id=team_value and m.club_id=club_value and m.status='full_time' and m.deleted_at is null
      and m.concluded_at>=e.started_at and m.concluded_at<=observed
      and m.match_date>=timezone('Europe/London',e.started_at)::date
      and m.match_date<=timezone('Europe/London',observed)::date;
    if player_count>=7 and match_count>=10 then
      insert into app_private.first_250_branding_observations values(e.slot,observed,player_count,match_count)
        on conflict(slot) do nothing;
      update app_private.first_250_branding_entries set state='permanent',qualified_at=observed where slot=e.slot;
      e.state:='permanent';
    end if;
  else
    update app_private.first_250_branding_entries set state='failed' where slot=e.slot;
    e.state:='failed';
  end if;
  return jsonb_build_object('state',e.state,'playersWithAcceptedParent',player_count,'completedMatches',match_count);
end;
$$;
revoke all on function app_private.observe_first_250_branding_team(uuid,uuid) from public,anon,authenticated,service_role;

create function app_private.first_250_branding_observation_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_team uuid;
begin
  if exists(select 1 from app_private.first_250_branding_offer where release_enabled) then
    target_team:=new.team_id;
    if target_team is null and tg_table_name='parent_player_links' then
      select p.team_id into target_team from public.players p where p.id=new.player_id and p.club_id=new.club_id;
    end if;
    if target_team is not null then perform app_private.observe_first_250_branding_team(target_team,new.club_id); end if;
  end if;
  return new;
end;
$$;
revoke all on function app_private.first_250_branding_observation_trigger() from public,anon,authenticated,service_role;
create trigger first_250_branding_parent_observation after insert or update of status,auth_user_id,accepted_at,team_id,club_id,player_id,link_type
  on public.parent_player_links for each row execute function app_private.first_250_branding_observation_trigger();
create trigger first_250_branding_match_observation after insert or update of status,concluded_at,team_id,club_id,deleted_at,match_date
  on public.match_days for each row execute function app_private.first_250_branding_observation_trigger();
create trigger first_250_branding_player_observation after insert or update of status,team_id,club_id,archived_at
  on public.players for each row execute function app_private.first_250_branding_observation_trigger();

create function app_private.first_250_branding_account_observation_trigger()
returns trigger language plpgsql security definer set search_path='' as $$
declare scoped record;
begin
  if not exists(select 1 from app_private.first_250_branding_offer where release_enabled) then return new; end if;
  -- Only participating provisional teams, in a consistent lock order.
  for scoped in select e.team_id,e.club_id from app_private.first_250_branding_entries e
    where e.state='provisional' and exists(select 1 from public.parent_player_links l
      join public.players p on p.id=l.player_id and p.club_id=l.club_id
      where l.auth_user_id=new.id and p.team_id=e.team_id and p.club_id=e.club_id)
    order by e.slot loop
    perform app_private.observe_first_250_branding_team(scoped.team_id,scoped.club_id);
  end loop;
  return new;
end;
$$;
revoke all on function app_private.first_250_branding_account_observation_trigger() from public,anon,authenticated,service_role;
create trigger first_250_branding_auth_observation after update of email_confirmed_at,banned_until
  on auth.users for each row execute function app_private.first_250_branding_account_observation_trigger();
create trigger first_250_branding_user_observation after update of status
  on public.users for each row execute function app_private.first_250_branding_account_observation_trigger();

create function public.reconcile_first_250_branding_offer(limit_value integer default 50)
returns integer language plpgsql security definer set search_path = '' as $$
declare e record; processed integer:=0;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'branding_offer_service_only' using errcode='42501'; end if;
  if not exists(select 1 from app_private.first_250_branding_offer where release_enabled) then return 0; end if;
  if limit_value<1 or limit_value>250 then raise exception 'branding_limit_invalid'; end if;
  for e in select team_id,club_id from app_private.first_250_branding_entries where state='provisional'
    order by deadline_at,slot limit limit_value for update skip locked loop
    perform app_private.observe_first_250_branding_team(e.team_id,e.club_id); processed:=processed+1;
  end loop;
  return processed;
end;
$$;
revoke all on function public.reconcile_first_250_branding_offer(integer) from public,anon,authenticated;
grant execute on function public.reconcile_first_250_branding_offer(integer) to service_role;

create function public.get_team_branding_display(team_value uuid,club_value uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.clubs; e app_private.first_250_branding_entries;
  b app_private.first_250_team_branding; promotion_allowed boolean:=false;
  logo_allowed boolean; colour_allowed boolean; paid_club boolean;
begin
  if not exists(select 1 from app_private.first_250_branding_offer where release_enabled)
    or (select count(*) from app_private.first_250_branding_entries where cohort='existing_39')<>39 then return null; end if;
  if auth.uid() is null or not exists(select 1 from auth.users a where a.id=auth.uid()
    and a.email_confirmed_at is not null and (a.banned_until is null or a.banned_until<=clock_timestamp())) then
    raise exception 'branding_actor_denied' using errcode='42501'; end if;
  if not (coalesce(public.current_user_can_access_team(club_value,team_value),false)
    or coalesce(public.current_user_can_access_parent_team(team_value),false)
    or exists(select 1 from jsonb_array_elements(public.list_fan_connections()) f
      where f->>'team_id'=team_value::text and f->>'club_id'=club_value::text
        and f->>'status'='active' and f->>'is_owner'='false'
        and f->>'relationship_type' in ('fan','player'))
    or exists(select 1 from public.get_own_adult_player_account_state() a
      where a.team_id=team_value and a.club_id=club_value and a.access_granted)) then
    raise exception 'branding_actor_denied' using errcode='42501';
  end if;
  select c0.* into c from public.clubs c0 join public.teams t on t.club_id=c0.id
    where c0.id=club_value and t.id=team_value and c0.status='active' and c0.archived_at is null
      and t.status='active' and t.archived_at is null;
  if not found then raise exception 'branding_actor_denied' using errcode='42501'; end if;
  select * into e from app_private.first_250_branding_entries where team_id=team_value and club_id=club_value;
  promotion_allowed:=coalesce(e.state in ('grandfathered','permanent')
    or (e.state='provisional' and e.started_at<=clock_timestamp() and e.deadline_at>clock_timestamp()),false);
  logo_allowed:=public.can_use_plan_feature(club_value,'basicLogoBranding');
  colour_allowed:=public.can_use_plan_feature(club_value,'customColoursBranding');
  paid_club:=public.workspace_scope_for_plan_key(c.plan_key)='club' and logo_allowed and colour_allowed;
  if paid_club then
    return jsonb_build_object('teamId',team_value,'clubId',club_value,'source','paid_club',
      'logoAllowed',true,'coloursAllowed',true,'logoUrl',coalesce(c.logo_url,''),
      'accent',coalesce(c.theme_accent,''),'buttonStyle',coalesce(c.theme_button_style,'solid'));
  end if;
  select * into b from app_private.first_250_team_branding where team_id=team_value and club_id=club_value;
  -- Non-participants preserve their existing display behaviour exactly.
  if e.team_id is null and b.team_id is null then return null; end if;
  return jsonb_build_object('teamId',team_value,'clubId',club_value,'source','team',
    'logoAllowed',logo_allowed or promotion_allowed,'coloursAllowed',colour_allowed or promotion_allowed,
    'baseLogoAllowed',logo_allowed,'baseColoursAllowed',colour_allowed,
    'expiresAt',case when e.state='provisional' then e.deadline_at else null end,
    'logoUrl',case when logo_allowed or promotion_allowed then coalesce(b.logo_url,'') else '' end,
    'accent',case when colour_allowed or promotion_allowed then coalesce(b.theme_accent,'') else '' end,
    'buttonStyle',coalesce(b.theme_button_style,'solid'));
end;
$$;
revoke all on function public.get_team_branding_display(uuid,uuid) from public,anon;
grant execute on function public.get_team_branding_display(uuid,uuid) to authenticated;

create function public.save_first_250_team_branding(actor_value uuid,team_value uuid,club_value uuid,
  logo_value text,accent_value text,button_value text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare e app_private.first_250_branding_entries; promo boolean;
begin
  if auth.role() is distinct from 'service_role'
    or not app_private.branding_actor_can_manage(actor_value,club_value,team_value) then
    raise exception 'branding_actor_denied' using errcode='42501';
  end if;
  if not exists(select 1 from app_private.first_250_branding_offer where release_enabled) then
    raise exception 'branding_offer_not_active'; end if;
  select * into e from app_private.first_250_branding_entries where team_id=team_value and club_id=club_value for update;
  if not app_private.branding_actor_can_manage(actor_value,club_value,team_value) then
    raise exception 'branding_actor_denied' using errcode='42501'; end if;
  promo:=coalesce(e.state in ('grandfathered','permanent')
    or (e.state='provisional' and e.deadline_at>clock_timestamp()),false);
  if (logo_value is not null and not (promo or public.can_use_plan_feature(club_value,'basicLogoBranding')))
    or ((accent_value is not null or button_value is not null)
      and not (promo or public.can_use_plan_feature(club_value,'customColoursBranding'))) then
    raise exception 'branding_not_entitled' using errcode='42501'; end if;
  if logo_value is not null and logo_value !~ ('^https://[^/]+/storage/v1/object/public/club-logos/teams/'
    || team_value::text || '/logos/[0-9a-f]{64}\.png$') then raise exception 'branding_logo_invalid'; end if;
  insert into app_private.first_250_team_branding(team_id,club_id,logo_url,theme_accent,theme_button_style)
    values(team_value,club_value,logo_value,accent_value,button_value)
    on conflict(team_id) do update set logo_url=coalesce(excluded.logo_url,first_250_team_branding.logo_url),
      theme_accent=coalesce(excluded.theme_accent,first_250_team_branding.theme_accent),
      theme_button_style=coalesce(excluded.theme_button_style,first_250_team_branding.theme_button_style),updated_at=clock_timestamp()
    where first_250_team_branding.club_id=excluded.club_id;
  if not found then raise exception 'branding_reservation_conflict'; end if;
  return true;
end;
$$;
revoke all on function public.save_first_250_team_branding(uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.save_first_250_team_branding(uuid,uuid,uuid,text,text,text) to service_role;

create function public.read_first_250_team_branding_management(actor_value uuid,team_value uuid,club_value uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e app_private.first_250_branding_entries; b app_private.first_250_team_branding;
  progress jsonb; promo boolean;
begin
  if auth.role() is distinct from 'service_role'
    or not app_private.branding_actor_can_manage(actor_value,club_value,team_value) then
    raise exception 'branding_actor_denied' using errcode='42501'; end if;
  if not exists(select 1 from app_private.first_250_branding_offer where release_enabled)
    or (select count(*) from app_private.first_250_branding_entries where cohort='existing_39')<>39 then
    return jsonb_build_object('enabled',false); end if;
  progress:=app_private.observe_first_250_branding_team(team_value,club_value);
  if not app_private.branding_actor_can_manage(actor_value,club_value,team_value) then
    raise exception 'branding_actor_denied' using errcode='42501'; end if;
  select * into e from app_private.first_250_branding_entries where team_id=team_value and club_id=club_value;
  select * into b from app_private.first_250_team_branding where team_id=team_value and club_id=club_value;
  promo:=coalesce(e.state in ('grandfathered','permanent')
    or (e.state='provisional' and e.started_at<=clock_timestamp() and e.deadline_at>clock_timestamp()),false);
  return jsonb_build_object('enabled',true,'teamId',team_value,'clubId',club_value,
    'claimAllowed',e.slot is null and exists(select 1 from public.clubs c where c.id=club_value
      and public.canonical_subscription_plan_key(c.plan_key)='matchday'),
    'state',coalesce(e.state,'unclaimed'),'cohort',e.cohort,'deadlineAt',e.deadline_at,
    'extensionUsed',coalesce(e.extension_used,false),
    'playersWithAcceptedParent',coalesce((select players_with_parent from app_private.first_250_branding_observations where slot=e.slot),(progress->>'playersWithAcceptedParent')::integer,0),
    'completedMatches',coalesce((select completed_matches from app_private.first_250_branding_observations where slot=e.slot),(progress->>'completedMatches')::integer,0),
    'termsVersion',(select terms_version from app_private.first_250_branding_offer where singleton),
    'logoAllowed',promo or public.can_use_plan_feature(club_value,'basicLogoBranding'),
    'coloursAllowed',promo or public.can_use_plan_feature(club_value,'customColoursBranding'),
    'logoUrl',coalesce(b.logo_url,''),'accent',coalesce(b.theme_accent,''),
    'buttonStyle',coalesce(b.theme_button_style,'solid'));
end;
$$;
revoke all on function public.read_first_250_team_branding_management(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.read_first_250_team_branding_management(uuid,uuid,uuid) to service_role;

-- Extend the existing completed transfer transaction without changing its public records,
-- billing checks, approval workflow or original function definition.
create function app_private.first_250_branding_completed_transfer_trigger()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status<>'completed' or old.status='completed' then return new; end if;
  if not exists(select 1 from app_private.first_250_branding_entries where team_id=new.team_id)
    and not exists(select 1 from app_private.first_250_team_branding where team_id=new.team_id) then return new; end if;
  if old.status<>'ready' or new.source_approved_by is null or new.destination_approved_by is null
    or new.completed_by is null or not public.platform_access_is_admin_v1(new.completed_by)
    or not exists(select 1 from public.teams t where t.id=new.team_id and t.club_id=new.destination_club_id)
    or exists(select 1 from app_private.first_250_branding_entries where team_id=new.team_id and club_id<>new.source_club_id)
    or exists(select 1 from app_private.first_250_team_branding where team_id=new.team_id and club_id<>new.source_club_id) then
    raise exception 'branding_transfer_scope_invalid' using errcode='42501'; end if;
  update app_private.first_250_branding_entries set club_id=new.destination_club_id
    where team_id=new.team_id and club_id=new.source_club_id;
  update app_private.first_250_team_branding set club_id=new.destination_club_id,updated_at=clock_timestamp()
    where team_id=new.team_id and club_id=new.source_club_id;
  return new;
end;
$$;
revoke all on function app_private.first_250_branding_completed_transfer_trigger() from public,anon,authenticated,service_role;
create trigger first_250_branding_completed_transfer after update of status
  on public.workspace_team_transfer_requests for each row execute function app_private.first_250_branding_completed_transfer_trigger();
