-- Preparation only. No application binding, signup hook, clock or grant activation.
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
  theme_button_style text check (theme_button_style is null or theme_button_style in ('solid', 'gradient'))
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
-- No FK/trigger on existing application tables: deletion and transfer workflows
-- keep their existing behaviour. Revalidate team/club authority at every use.
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
