-- The public offer counter represents explicit accepted offers only.
-- The 39 grandfathered branding teams remain entitled, but do not consume the
-- 250 places advertised to teams accepting the current free offer.
alter table app_private.first_250_branding_entries
  drop constraint first_250_branding_entries_slot_check;
alter table app_private.first_250_branding_entries
  add constraint first_250_branding_entries_slot_check check (slot between 1 and 289);

create or replace function public.reserve_new_branding_team(team_id_value uuid, club_id_value uuid,
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
  select min(n)::smallint into next_slot from generate_series(40, 289) n
  where not exists (select 1 from app_private.first_250_branding_entries e where e.slot = n);
  if next_slot is null then return null; end if;
  start_value := clock_timestamp();
  deadline_value := app_private.branding_calendar_deadline(start_value, 3);
  insert into app_private.first_250_branding_entries(slot, team_id, club_id, cohort, state,
    started_at, deadline_at, terms_version)
  values (next_slot, team_id_value, club_id_value, 'new_211', 'provisional',
    start_value, deadline_value, terms_version_value);
  return next_slot;
end;
$$;

create or replace function public.read_branding_offer_counter()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare config app_private.first_250_branding_offer; mapped_count integer; accepted_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'branding_offer_service_only' using errcode = '42501';
  end if;
  select * into config from app_private.first_250_branding_offer where singleton;
  select count(*) into mapped_count from app_private.first_250_branding_entries where cohort = 'existing_39';
  if not found or not coalesce(config.release_enabled, false) or mapped_count <> 39 then
    return jsonb_build_object('status', 'not_active');
  end if;
  select count(*) into accepted_count from app_private.first_250_branding_entries
    where cohort = 'new_211' and accepted_by is not null;
  return jsonb_build_object('status', 'active', 'capacity', 250,
    'reserved', accepted_count, 'remaining', 250 - accepted_count);
end;
$$;

revoke all on function public.reserve_new_branding_team(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.read_branding_offer_counter() from public, anon, authenticated;
grant execute on function public.reserve_new_branding_team(uuid, uuid, text) to service_role;
grant execute on function public.read_branding_offer_counter() to service_role;
