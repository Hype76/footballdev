create function app_private.execute_pitchero_import(batch_id_value uuid, plan_sha256_value text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_row public.data_transfer_batches%rowtype;
  club_row public.clubs%rowtype;
  team_row public.teams%rowtype;
  player_row public.players%rowtype;
  guardian_row public.guardians%rowtype;
  item jsonb;
  outcome jsonb;
  contacts jsonb;
  before_row jsonb;
  after_row jsonb;
  new_teams integer;
  team_limit integer;
  override_limit integer;
  player_updates integer := 0;
begin
  select * into strict batch_row from public.data_transfer_batches where id = batch_id_value for update;
  if batch_row.template_version <> 'FP-V1-PITCHERO-1'
    or batch_row.plan #>> '{context,planning_mode}' is distinct from 'pitchero'
    or batch_row.plan_sha256 is distinct from plan_sha256_value then
    raise exception 'Invalid Pitchero confirmation.';
  end if;
  if batch_row.state in ('completed', 'completed_with_warnings') then
    return jsonb_build_object('batchId', batch_row.id, 'state', batch_row.state, 'idempotent', true, 'counts', batch_row.counts);
  end if;
  if batch_row.state <> 'awaiting_confirmation' then raise exception 'Stale Pitchero confirmation.'; end if;

  -- Serialise Pitchero imports for this club, including confirmation from two browser sessions.
  select * into strict club_row from public.clubs where id = batch_row.club_id for update;
  if club_row.archived_at is not null or club_row.status is distinct from 'active'
    or club_row.plan_key is distinct from (batch_row.options ->> 'planKey')
    or club_row.subscription_team_capacity is distinct from (batch_row.options ->> 'subscriptionTeamCapacity')::integer
    or (club_row.tester_access_expires_at is not null and club_row.tester_access_expires_at <= now())
    or (not coalesce(club_row.is_plan_comped, false) and coalesce(club_row.plan_status, '') not in ('active', 'trialing'))
    or not exists (
      select 1 from public.users actor
      join auth.users account on account.id = actor.id and account.deleted_at is null
        and (account.banned_until is null or account.banned_until <= now())
      join public.user_club_memberships membership on membership.auth_user_id = actor.id
        and membership.club_id = actor.club_id and membership.role = actor.role and membership.role_rank = actor.role_rank
      where actor.id = batch_row.actor_id and actor.club_id = club_row.id
        and actor.status = 'active' and actor.role = 'admin' and actor.role_rank >= 90
      for share of actor, membership, account
    ) then
    raise exception 'Club Admin access or the club plan changed.';
  end if;

  select count(*) into new_teams from jsonb_array_elements(batch_row.plan -> 'teams') as team
    where team ->> 'action' = 'create';
  if new_teams > 0 then
    select team_limit_override into override_limit from public.club_team_limit_overrides where club_id = club_row.id;
    team_limit := (batch_row.options ->> 'teamLimit')::integer;
    if override_limit is distinct from (batch_row.options ->> 'teamLimitOverride')::integer
      or (team_limit is not null and (select count(*) from public.teams where club_id = club_row.id) + new_teams > team_limit) then
      raise exception 'Club team capacity changed after preview.';
    end if;
  end if;

  for item in select value from jsonb_array_elements(batch_row.plan -> 'teams') loop
    if item ->> 'action' = 'create' then
      if exists (select 1 from public.teams t where t.club_id = club_row.id
        and lower(regexp_replace(btrim(t.name), '\s+', ' ', 'g')) = lower(item #>> '{values,name}')) then
        raise exception 'A matching team was added after preview.';
      end if;
    else
      select * into strict team_row from public.teams where id = (item ->> 'entity_id')::uuid
        and club_id = club_row.id and status = 'active' and archived_at is null for share;
      if team_row.updated_at is distinct from nullif(item ->> 'expected_updated_at', '')::timestamptz then
        raise exception 'A team changed after preview.';
      end if;
    end if;
  end loop;

  for item in select value from jsonb_array_elements(batch_row.plan -> 'players') loop
    if item ->> 'action' = 'create' then
      if exists (select 1 from public.players p where p.club_id = club_row.id
        and lower(regexp_replace(btrim(p.player_name), '\s+', ' ', 'g')) =
          lower(concat_ws(' ', item #>> '{values,first_name}', item #>> '{values,last_name}'))) then
        raise exception 'A matching player was added after preview.';
      end if;
    else
      select * into strict player_row from public.players where id = (item ->> 'entity_id')::uuid
        and club_id = club_row.id and team_id = (item ->> 'team_entity_id')::uuid
        and status = 'active' and archived_at is null for update;
      if player_row.updated_at is distinct from nullif(item ->> 'expected_updated_at', '')::timestamptz
        or (item ->> 'pitchero_kind' = 'adult' and exists (
          select 1 from public.parent_player_links where player_id = player_row.id and link_type = 'parent' and status <> 'revoked'
        )) then
        raise exception 'A player or their relationships changed after preview.';
      end if;
    end if;
    if item ->> 'pitchero_kind' = 'adult'
      and nullif(item #>> '{values,date_of_birth}', '')::date > (current_date - interval '18 years')::date then
      raise exception 'Adult player date of birth is inconsistent.';
    end if;
  end loop;

  for item in select value from jsonb_array_elements(batch_row.plan -> 'guardians') loop
    if item ->> 'action' = 'create' then
      if exists (select 1 from public.guardians g where g.club_id = club_row.id and (
        lower(g.email) = (item #>> '{values,email}') or
        lower(regexp_replace(btrim(concat_ws(' ', g.first_name, g.last_name)), '\s+', ' ', 'g')) =
          lower(concat_ws(' ', item #>> '{values,first_name}', item #>> '{values,last_name}'))
      )) then
        raise exception 'A matching guardian was added after preview.';
      end if;
    else
      select * into strict guardian_row from public.guardians where id = (item ->> 'entity_id')::uuid
        and club_id = club_row.id and status = 'active' for share;
      if guardian_row.updated_at is distinct from nullif(item ->> 'expected_updated_at', '')::timestamptz then
        raise exception 'A guardian changed after preview.';
      end if;
    end if;
  end loop;

  if exists (
    select 1 from jsonb_array_elements(batch_row.plan -> 'links') as planned(value)
    join public.parent_player_links link on link.player_id = nullif(planned.value ->> 'player_entity_id', '')::uuid
      and link.link_type = 'parent'
    left join public.guardians guardian on guardian.transfer_reference = planned.value #>> '{values,guardian_reference}' and guardian.club_id = club_row.id
    where link.guardian_id = nullif(planned.value ->> 'guardian_entity_id', '')::uuid
      or (guardian.email is not null and lower(link.email) = lower(guardian.email))
      or (nullif(planned.value #>> '{values,guardian_email}', '') is not null and lower(link.email) = planned.value #>> '{values,guardian_email}')
  ) then
    raise exception 'A parent relationship changed after preview.';
  end if;

  outcome := public.execute_data_transfer_import(batch_row.id, plan_sha256_value);
  if outcome ->> 'state' = 'failed' then return outcome; end if;

  for item in select value from jsonb_array_elements(batch_row.plan -> 'players') loop
    if item ->> 'action' = 'create' then
      select * into strict player_row from public.players where club_id = club_row.id
        and transfer_reference = item #>> '{values,transfer_reference}' for update;
      contacts := item -> 'pitchero_contacts';
    elsif item ->> 'pitchero_update' = 'true' then
      select * into strict player_row from public.players where id = (item ->> 'entity_id')::uuid for update;
      contacts := player_row.parent_contacts;
      if jsonb_array_length(contacts) = 0 and (nullif(player_row.parent_name, '') is not null or nullif(player_row.parent_email, '') is not null) then
        contacts := jsonb_build_array(jsonb_build_object('name', coalesce(player_row.parent_name, ''), 'email', coalesce(player_row.parent_email, ''),
          'type', case when player_row.contact_type = 'self' then 'self' else 'parent' end));
      end if;
      contacts := contacts || (item -> 'pitchero_contacts');
    else
      continue;
    end if;
    before_row := to_jsonb(player_row);
    update public.players p set
      contact_type = case when item ->> 'pitchero_kind' = 'adult' then 'self' else p.contact_type end,
      date_of_birth = coalesce(p.date_of_birth, nullif(item #>> '{values,date_of_birth}', '')::date),
      parent_contacts = contacts,
      parent_name = coalesce(nullif(p.parent_name, ''), contacts #>> '{0,name}'),
      parent_email = coalesce(nullif(p.parent_email, ''), nullif(contacts #>> '{0,email}', '')),
      updated_at = timezone('utc', now())
    where p.id = player_row.id returning to_jsonb(p) into after_row;

    if item ->> 'action' = 'create' then
      update public.data_transfer_import_records set after_data = after_row
        where batch_id = batch_row.id and entity_type = 'player' and entity_id = player_row.id;
      -- The roster trigger creates the initial membership in this same transaction.
      insert into public.data_transfer_import_records(batch_id, entity_type, entity_id, action, after_data)
      select batch_row.id, 'player_team_membership', membership.id, 'create', to_jsonb(membership)
      from public.player_team_memberships membership where membership.player_id = player_row.id
        and membership.team_id = player_row.team_id and membership.status = 'active';
    else
      insert into public.data_transfer_import_records(batch_id, entity_type, entity_id, action, before_data, after_data)
      values (batch_row.id, 'player', player_row.id, 'update', before_row, after_row);
      player_updates := player_updates + 1;
    end if;
  end loop;

  update public.data_transfer_batches set counts = counts || jsonb_build_object('pitchero_player_updates', player_updates)
    where id = batch_row.id;
  return outcome || jsonb_build_object('pitcheroPlayerUpdates', player_updates);
exception when others then
  update public.data_transfer_batches set state = 'failed', failed_at = timezone('utc', now()),
    updated_at = timezone('utc', now()),
    error_summary = jsonb_build_array(jsonb_build_object('code', 'PITCHERO_IMPORT_REVIEW_REQUIRED',
      'message', 'The Pitchero import could not be applied. Review the latest club data and preview the CSV again.', 'sqlstate', sqlstate))
  where id = batch_id_value and template_version = 'FP-V1-PITCHERO-1' and state = 'awaiting_confirmation';
  return jsonb_build_object('batchId', batch_id_value, 'state', 'failed', 'errorCode', 'PITCHERO_IMPORT_REVIEW_REQUIRED');
end;
$$;

alter function app_private.execute_pitchero_import(uuid, text) owner to postgres;
revoke all on function app_private.execute_pitchero_import(uuid, text) from public, anon, authenticated;
grant usage on schema app_private to service_role;
grant execute on function app_private.execute_pitchero_import(uuid, text) to service_role;

create function public.execute_pitchero_import(batch_id_value uuid, plan_sha256_value text)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select app_private.execute_pitchero_import(batch_id_value, plan_sha256_value);
$$;

revoke all on function public.execute_pitchero_import(uuid, text) from public, anon, authenticated;
grant execute on function public.execute_pitchero_import(uuid, text) to service_role;

-- Preserve the existing rollback workflow for Pitchero contacts and generated memberships.
create or replace function public.data_transfer_external_dependency(
  batch_id_value uuid,
  entity_type_value text,
  entity_id_value uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_table regclass;
  dependency record;
  has_dependency boolean;
  has_id_column boolean;
begin
  target_table := case entity_type_value
    when 'team' then to_regclass('public.teams')
    when 'player' then to_regclass('public.players')
    when 'guardian' then to_regclass('public.guardians')
    when 'link' then to_regclass('public.parent_player_links')
    when 'player_team_membership' then to_regclass('public.player_team_memberships')
    else null
  end;
  if target_table is null then return null; end if;

  for dependency in
    select namespace.nspname as schema_name, relation.relname as table_name, attribute.attname as column_name
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_class relation on relation.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    join pg_catalog.pg_attribute attribute
      on attribute.attrelid = constraint_row.conrelid
     and attribute.attnum = constraint_row.conkey[1]
    where constraint_row.contype = 'f'
      and constraint_row.confrelid = target_table
      and array_length(constraint_row.conkey, 1) = 1
  loop
    select exists (
      select 1 from pg_catalog.pg_attribute id_attribute
      where id_attribute.attrelid = format('%I.%I', dependency.schema_name, dependency.table_name)::regclass
        and id_attribute.attname = 'id'
        and not id_attribute.attisdropped
    ) into has_id_column;

    if has_id_column then
      execute format(
        'select exists (select 1 from %I.%I dependent where dependent.%I = $1 and not exists (select 1 from public.data_transfer_import_records imported where imported.batch_id = $2 and imported.entity_id = dependent.id and imported.action = ''create''))',
        dependency.schema_name,
        dependency.table_name,
        dependency.column_name
      ) into has_dependency using entity_id_value, batch_id_value;
    else
      execute format(
        'select exists (select 1 from %I.%I dependent where dependent.%I = $1)',
        dependency.schema_name,
        dependency.table_name,
        dependency.column_name
      ) into has_dependency using entity_id_value;
    end if;

    if has_dependency then return format('%I.%I', dependency.schema_name, dependency.table_name); end if;
  end loop;
  return null;
end;
$$;

revoke all on function public.data_transfer_external_dependency(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.data_transfer_external_dependency(uuid, text, uuid) to service_role;

create or replace function public.rollback_data_transfer_import(batch_id_value uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_row public.data_transfer_batches%rowtype;
  record_row public.data_transfer_import_records%rowtype;
  current_row jsonb;
  dependency_name text;
begin
  select * into batch_row from public.data_transfer_batches where id = batch_id_value for update;
  if batch_row.id is null then raise exception 'Transfer batch was not found.'; end if;
  if batch_row.transfer_type <> 'import' then raise exception 'Only an import transfer can be rolled back.'; end if;
  if batch_row.state = 'rolled_back' then return jsonb_build_object('batchId', batch_row.id, 'state', 'rolled_back', 'idempotent', true); end if;
  if batch_row.state not in ('completed', 'completed_with_warnings', 'rollback_blocked') then raise exception 'Only a completed transfer can be rolled back.'; end if;

  for record_row in select * from public.data_transfer_import_records where batch_id = batch_row.id order by id desc loop
    current_row := null;
    if record_row.entity_type = 'link' then select to_jsonb(x) into current_row from public.parent_player_links x where id = record_row.entity_id for update;
    elsif record_row.entity_type = 'player_team_membership' then
      select to_jsonb(x) into current_row from public.player_team_memberships x where id = record_row.entity_id for update;
    elsif record_row.entity_type = 'guardian' then select to_jsonb(x) into current_row from public.guardians x where id = record_row.entity_id for update;
    elsif record_row.entity_type = 'player' then select to_jsonb(x) into current_row from public.players x where id = record_row.entity_id for update;
    elsif record_row.entity_type = 'team' then select to_jsonb(x) into current_row from public.teams x where id = record_row.entity_id for update;
    elsif record_row.entity_type = 'club' then select to_jsonb(x) into current_row from public.clubs x where id = record_row.entity_id for update;
    end if;
    if current_row is distinct from record_row.after_data then
      update public.data_transfer_batches set state = 'rollback_blocked', rollback_blocked_reason = 'A transferred record changed after import.', updated_at = timezone('utc', now()) where id = batch_row.id;
      insert into public.data_transfer_audit_entries(batch_id, actor_id, club_id, action, metadata)
      values (batch_row.id, batch_row.actor_id, batch_row.club_id, 'data_transfer_rollback_blocked', jsonb_build_object('entity_type', record_row.entity_type, 'entity_id', record_row.entity_id));
      return jsonb_build_object('batchId', batch_row.id, 'state', 'rollback_blocked', 'idempotent', false, 'reason', 'A transferred record changed after import.');
    end if;
    if record_row.action = 'create' then
      dependency_name := public.data_transfer_external_dependency(batch_row.id, record_row.entity_type, record_row.entity_id);
      if dependency_name is not null then
        update public.data_transfer_batches set state = 'rollback_blocked', rollback_blocked_reason = 'A transferred record has later dependent records.', updated_at = timezone('utc', now()) where id = batch_row.id;
        insert into public.data_transfer_audit_entries(batch_id, actor_id, club_id, action, metadata)
        values (batch_row.id, batch_row.actor_id, batch_row.club_id, 'data_transfer_rollback_blocked', jsonb_build_object('entity_type', record_row.entity_type, 'entity_id', record_row.entity_id, 'dependency', dependency_name));
        return jsonb_build_object('batchId', batch_row.id, 'state', 'rollback_blocked', 'idempotent', false, 'reason', 'A transferred record has later dependent records.');
      end if;
    end if;
  end loop;

  for record_row in select * from public.data_transfer_import_records where batch_id = batch_row.id order by id desc loop
    if record_row.action = 'create' then
      if record_row.entity_type = 'link' then delete from public.parent_player_links where id = record_row.entity_id;
      elsif record_row.entity_type = 'player_team_membership' then delete from public.player_team_memberships where id = record_row.entity_id;
      elsif record_row.entity_type = 'guardian' then delete from public.guardians where id = record_row.entity_id;
      elsif record_row.entity_type = 'player' then delete from public.players where id = record_row.entity_id;
      elsif record_row.entity_type = 'team' then delete from public.teams where id = record_row.entity_id;
      end if;
    else
      if record_row.entity_type = 'club' then
        update public.clubs c set name = x.name, transfer_reference = x.transfer_reference, fa_affiliation_number = x.fa_affiliation_number,
          address_line_1 = x.address_line_1, address_line_2 = x.address_line_2, town_city = x.town_city, county = x.county,
          postcode = x.postcode, country = x.country, primary_contact_name = x.primary_contact_name,
          primary_contact_email = x.primary_contact_email, primary_contact_phone = x.primary_contact_phone,
          website = x.website, season = x.season, updated_at = x.updated_at
        from jsonb_populate_record(null::public.clubs, record_row.before_data) x where c.id = record_row.entity_id;
      elsif record_row.entity_type = 'team' then
        update public.teams t set name=x.name, transfer_reference=x.transfer_reference, age_group=x.age_group, category=x.category,
          season=x.season, league=x.league, division=x.division, home_ground=x.home_ground, training_day=x.training_day,
          training_time=x.training_time, status=x.status, updated_at=x.updated_at
        from jsonb_populate_record(null::public.teams, record_row.before_data) x where t.id=record_row.entity_id;
      elsif record_row.entity_type = 'player' and batch_row.template_version = 'FP-V1-PITCHERO-1' then
        update public.players p set contact_type=x.contact_type, parent_contacts=x.parent_contacts,
          parent_name=x.parent_name, parent_email=x.parent_email, date_of_birth=x.date_of_birth
        from jsonb_populate_record(null::public.players, record_row.before_data) x where p.id=record_row.entity_id;
      elsif record_row.entity_type = 'player' then
        update public.players p set team_id=x.team_id, team=x.team, player_name=x.player_name, first_name=x.first_name,
          last_name=x.last_name, preferred_name=x.preferred_name, transfer_reference=x.transfer_reference,
          date_of_birth=x.date_of_birth, gender=x.gender, section=x.section, shirt_number=x.shirt_number,
          positions=x.positions, status=x.status, updated_at=x.updated_at
        from jsonb_populate_record(null::public.players, record_row.before_data) x where p.id=record_row.entity_id;
      elsif record_row.entity_type = 'guardian' then
        update public.guardians g set transfer_reference=x.transfer_reference, first_name=x.first_name, last_name=x.last_name,
          email=x.email, phone=x.phone, address_line_1=x.address_line_1, address_line_2=x.address_line_2,
          town_city=x.town_city, county=x.county, postcode=x.postcode, country=x.country, status=x.status,
          updated_by=x.updated_by, updated_at=x.updated_at
        from jsonb_populate_record(null::public.guardians, record_row.before_data) x where g.id=record_row.entity_id;
      end if;
    end if;
  end loop;

  update public.data_transfer_batches set state='rolled_back', rolled_back_at=timezone('utc', now()), rollback_blocked_reason=null, updated_at=timezone('utc', now()) where id=batch_row.id;
  insert into public.data_transfer_audit_entries(batch_id, actor_id, club_id, action, metadata)
  values (batch_row.id, batch_row.actor_id, batch_row.club_id, 'data_transfer_rollback_completed', '{}'::jsonb);
  return jsonb_build_object('batchId', batch_row.id, 'state', 'rolled_back', 'idempotent', false);
end;
$$;

revoke all on function public.rollback_data_transfer_import(uuid) from public, anon, authenticated;
grant execute on function public.rollback_data_transfer_import(uuid) to service_role;

create function app_private.can_edit_team_league(target_club_id uuid, target_team_id uuid)
returns boolean
language sql security definer set search_path = ''
as $$
  select coalesce(app_private.actor_can_manage_team_resource(auth.uid(), target_club_id, target_team_id, 50), false)
    and public.current_user_billing_staff_mutation_allowed(target_club_id) is true
    and (
      exists (select 1 from public.users profile where profile.id = auth.uid()
        and profile.club_id = target_club_id and profile.role = 'admin' and profile.role_rank >= 90)
      or exists (select 1 from public.team_staff assignment where assignment.team_id = target_team_id
        and assignment.user_id = auth.uid() and assignment.role_rank >= 50)
    );
$$;

revoke all on function app_private.can_edit_team_league(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function app_private.enforce_team_league_url_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.league_url is not distinct from old.league_url
    and new.league_link_enabled is not distinct from old.league_link_enabled then
    return new;
  end if;
  if tg_op = 'INSERT' and new.league_url is null and not new.league_link_enabled then return new; end if;

  if not app_private.team_league_account_active()
    or new.archived_at is not null or coalesce(new.status, 'active') <> 'active'
    or not exists (select 1 from public.clubs club where club.id = new.club_id
      and club.archived_at is null and coalesce(club.status, 'active') = 'active')
    or not app_private.can_edit_team_league(new.club_id, new.id) then
    raise exception using errcode = '42501', message = 'Club Admin or assigned Team Admin access is required for this team.';
  end if;
  new.league_url := nullif(btrim(new.league_url), '');
  return new;
end;
$$;
create or replace function public.get_team_league_url(team_id_value uuid)
-- The trusted authority helper locks stored membership rows; keep this getter
-- volatile rather than asserting STABLE semantics around that helper.
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target_team public.teams%rowtype; can_edit boolean;
begin
  select team.* into target_team from public.teams team
  join public.clubs club on club.id = team.club_id
  where team.id = team_id_value and team.archived_at is null
    and coalesce(team.status, 'active') = 'active' and club.archived_at is null
    and coalesce(club.status, 'active') = 'active';
  if not app_private.team_league_account_active() or target_team.id is null
    or not coalesce(app_private.actor_can_manage_team_resource(auth.uid(), target_team.club_id, target_team.id, 20), false) then
    raise exception using errcode = '42501', message = 'Coach access is required for this team.';
  end if;
  can_edit := app_private.can_edit_team_league(target_team.club_id, target_team.id);
  return jsonb_build_object('team_id', target_team.id, 'team_name', target_team.name,
    'league_url', case when can_edit or target_team.league_link_enabled then target_team.league_url else null end,
    'league_link_enabled', target_team.league_link_enabled, 'can_edit', can_edit);
end;
$$;

create or replace function public.set_team_league_url(team_id_value uuid, url_value text, enabled_value boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target_team public.teams%rowtype;
  actor public.users%rowtype;
  normalized_url text := nullif(btrim(url_value), '');
begin
  select team.* into target_team from public.teams team
  where team.id = team_id_value and team.archived_at is null
    and coalesce(team.status, 'active') = 'active' for update;
  if not app_private.team_league_account_active() or target_team.id is null
    or not exists (select 1 from public.clubs club where club.id = target_team.club_id
      and club.archived_at is null and coalesce(club.status, 'active') = 'active')
    or not app_private.can_edit_team_league(target_team.club_id, target_team.id) then
    raise exception using errcode = '42501', message = 'Club Admin or assigned Team Admin access is required for this team.';
  end if;
  select profile.* into actor from public.users profile where profile.id = auth.uid();
  update public.teams team set league_url = normalized_url, league_link_enabled = coalesce(enabled_value, false),
    updated_at = timezone('utc', now()), updated_by = actor.id,
    updated_by_name = coalesce(nullif(actor.display_name, ''), nullif(actor.name, ''), actor.email, ''),
    updated_by_email = coalesce(actor.email, '')
  where team.id = target_team.id;
  -- Do not duplicate URL query credentials in audit metadata.
  insert into public.audit_logs(club_id, actor_id, action, entity_type, entity_id, metadata)
  values(target_team.club_id, actor.id, 'team_league_url_updated', 'team', target_team.id,
    jsonb_build_object('previouslySet', target_team.league_url is not null, 'currentlySet', normalized_url is not null,
      'previouslyEnabled', target_team.league_link_enabled, 'currentlyEnabled', coalesce(enabled_value, false)));
  return public.get_team_league_url(target_team.id);
end;
$$;
