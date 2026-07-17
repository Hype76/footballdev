-- FP-V1-DATA-TRANSFER-BATCH1-IMPLEMENT-01
-- Forward-only schema. This migration is intentionally not applied by the implementation batch.

alter table public.clubs
  add column if not exists transfer_reference text,
  add column if not exists fa_affiliation_number text,
  add column if not exists address_line_1 text,
  add column if not exists address_line_2 text,
  add column if not exists town_city text,
  add column if not exists county text,
  add column if not exists postcode text,
  add column if not exists country text,
  add column if not exists primary_contact_name text,
  add column if not exists primary_contact_email text,
  add column if not exists primary_contact_phone text,
  add column if not exists website text,
  add column if not exists season text,
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

create unique index if not exists clubs_transfer_reference_key
on public.clubs (lower(transfer_reference))
where transfer_reference is not null;

alter table public.teams
  add column if not exists transfer_reference text,
  add column if not exists age_group text,
  add column if not exists category text,
  add column if not exists season text,
  add column if not exists league text,
  add column if not exists division text,
  add column if not exists home_ground text,
  add column if not exists training_day text,
  add column if not exists training_time text,
  add column if not exists status text not null default 'active',
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

create unique index if not exists teams_club_transfer_reference_key
on public.teams (club_id, lower(transfer_reference))
where transfer_reference is not null;

alter table public.players
  add column if not exists transfer_reference text,
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists preferred_name text,
  add column if not exists date_of_birth date,
  add column if not exists gender text;

create unique index if not exists players_club_transfer_reference_key
on public.players (club_id, lower(transfer_reference))
where transfer_reference is not null;

create table if not exists public.guardians (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  transfer_reference text not null,
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  address_line_1 text,
  address_line_2 text,
  town_city text,
  county text,
  postcode text,
  country text,
  status text not null default 'active',
  created_by uuid references public.users (id) on delete set null,
  updated_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint guardians_status_check check (status in ('active', 'inactive'))
);

create unique index if not exists guardians_club_transfer_reference_key
on public.guardians (club_id, lower(transfer_reference));

alter table public.guardians enable row level security;
revoke all on public.guardians from public, anon, authenticated;
grant all on public.guardians to service_role;

alter table public.parent_player_links
  add column if not exists guardian_id uuid references public.guardians (id) on delete cascade,
  add column if not exists relationship text,
  add column if not exists primary_contact boolean not null default false,
  add column if not exists receives_communications boolean not null default false,
  add column if not exists emergency_contact boolean not null default false;

alter table public.parent_player_links
  drop constraint if exists parent_player_links_status_check;
alter table public.parent_player_links
  add constraint parent_player_links_status_check
  check (status in ('uninvited', 'pending', 'active', 'revoked'));

create unique index if not exists parent_player_links_unique_guardian
on public.parent_player_links (player_id, guardian_id)
where guardian_id is not null and status <> 'revoked';

create table if not exists public.data_transfer_batches (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.users (id) on delete restrict,
  actor_role text not null,
  club_id uuid not null references public.clubs (id) on delete restrict,
  authorized_team_ids uuid[] not null default '{}'::uuid[],
  audit_reason text,
  transfer_type text not null,
  state text not null default 'uploaded',
  template_version text not null,
  workbook_name text not null,
  workbook_sha256 text not null,
  workbook_size_bytes integer not null,
  storage_path text,
  raw_expires_at timestamptz not null,
  options jsonb not null default '{}'::jsonb,
  plan jsonb,
  plan_sha256 text,
  preview_version integer not null default 1,
  confirmation_sha256 text,
  counts jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  error_summary jsonb not null default '[]'::jsonb,
  started_at timestamptz,
  confirmed_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  rolled_back_at timestamptz,
  rollback_blocked_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint data_transfer_batches_type_check check (transfer_type in ('blank_template', 'export', 'import')),
  constraint data_transfer_batches_state_check check (state in (
    'uploaded', 'inspecting', 'invalid', 'ready_for_review', 'awaiting_confirmation',
    'processing', 'completed', 'completed_with_warnings', 'failed', 'rolled_back',
    'rollback_blocked', 'expired'
  )),
  constraint data_transfer_batches_size_check check (workbook_size_bytes between 0 and 4194304)
);

create index if not exists data_transfer_batches_scope_history_idx
on public.data_transfer_batches (club_id, created_at desc);
create index if not exists data_transfer_batches_actor_history_idx
on public.data_transfer_batches (actor_id, created_at desc);
create index if not exists data_transfer_idempotency_lookup_idx
on public.data_transfer_batches (actor_id, club_id, workbook_sha256, plan_sha256)
where state in ('processing', 'completed', 'completed_with_warnings');

create table if not exists public.data_transfer_row_results (
  id bigint generated always as identity primary key,
  batch_id uuid not null references public.data_transfer_batches (id) on delete cascade,
  sheet_name text not null,
  source_row integer not null,
  entity_type text not null,
  transfer_reference text,
  outcome text not null,
  codes text[] not null default '{}'::text[],
  explanation text not null default '',
  proposed_changes jsonb not null default '{}'::jsonb,
  row_sha256 text not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint data_transfer_row_results_outcome_check check (outcome in ('create', 'update', 'link', 'unchanged', 'possible_duplicate', 'conflict', 'error', 'warning'))
);

create index if not exists data_transfer_row_results_batch_idx
on public.data_transfer_row_results (batch_id, sheet_name, source_row);

create table if not exists public.data_transfer_import_records (
  id bigint generated always as identity primary key,
  batch_id uuid not null references public.data_transfer_batches (id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  before_data jsonb,
  after_data jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint data_transfer_import_records_action_check check (action in ('create', 'update'))
);

create index if not exists data_transfer_import_records_batch_idx
on public.data_transfer_import_records (batch_id, id desc);

create table if not exists public.data_transfer_audit_entries (
  id bigint generated always as identity primary key,
  batch_id uuid references public.data_transfer_batches (id) on delete set null,
  actor_id uuid references public.users (id) on delete set null,
  club_id uuid references public.clubs (id) on delete set null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists data_transfer_audit_entries_scope_idx
on public.data_transfer_audit_entries (club_id, created_at desc);

alter table public.data_transfer_batches enable row level security;
alter table public.data_transfer_row_results enable row level security;
alter table public.data_transfer_import_records enable row level security;
alter table public.data_transfer_audit_entries enable row level security;

revoke all on public.data_transfer_batches from public, anon, authenticated;
revoke all on public.data_transfer_row_results from public, anon, authenticated;
revoke all on public.data_transfer_import_records from public, anon, authenticated;
revoke all on public.data_transfer_audit_entries from public, anon, authenticated;
grant all on public.data_transfer_batches to service_role;
grant all on public.data_transfer_row_results to service_role;
grant all on public.data_transfer_import_records to service_role;
grant all on public.data_transfer_audit_entries to service_role;
grant usage, select on sequence public.data_transfer_row_results_id_seq to service_role;
grant usage, select on sequence public.data_transfer_import_records_id_seq to service_role;
grant usage, select on sequence public.data_transfer_audit_entries_id_seq to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'data-transfer-private',
  'data-transfer-private',
  false,
  4194304,
  array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.execute_data_transfer_import(
  batch_id_value uuid,
  plan_sha256_value text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch_row public.data_transfer_batches%rowtype;
  item jsonb;
  entity_uuid uuid;
  before_row jsonb;
  after_row jsonb;
  action_value text;
  team_uuid uuid;
  player_uuid uuid;
  guardian_uuid uuid;
  imported_counts jsonb := '{"clubs":0,"teams":0,"players":0,"guardians":0,"links":0}'::jsonb;
begin
  select * into batch_row
  from public.data_transfer_batches
  where id = batch_id_value
  for update;

  if batch_row.id is null then
    raise exception 'Transfer batch was not found.';
  end if;
  if batch_row.state in ('completed', 'completed_with_warnings') then
    return jsonb_build_object('batchId', batch_row.id, 'state', batch_row.state, 'idempotent', true, 'counts', batch_row.counts);
  end if;
  if batch_row.state <> 'awaiting_confirmation' or batch_row.plan_sha256 is distinct from plan_sha256_value then
    raise exception 'Transfer confirmation is stale or invalid.';
  end if;

  update public.data_transfer_batches
  set state = 'processing', started_at = timezone('utc', now()), updated_at = timezone('utc', now())
  where id = batch_row.id;

  item := batch_row.plan -> 'club';
  if item is not null and (item ->> 'action') in ('create', 'update') then
    action_value := item ->> 'action';
    entity_uuid := batch_row.club_id;
    select to_jsonb(c) into before_row from public.clubs c where c.id = entity_uuid;
    if before_row is null or (nullif(item ->> 'expected_updated_at', '') is not null and nullif(item ->> 'expected_updated_at', '')::timestamptz is distinct from (before_row ->> 'updated_at')::timestamptz) then
      raise exception 'The club changed after preview. Inspect the workbook again.';
    end if;
    update public.clubs set
      name = coalesce(item #>> '{values,name}', name),
      transfer_reference = coalesce(item #>> '{values,transfer_reference}', transfer_reference),
      fa_affiliation_number = coalesce(item #>> '{values,fa_affiliation_number}', fa_affiliation_number),
      address_line_1 = item #>> '{values,address_line_1}', address_line_2 = item #>> '{values,address_line_2}',
      town_city = item #>> '{values,town_city}', county = item #>> '{values,county}', postcode = item #>> '{values,postcode}',
      country = item #>> '{values,country}', primary_contact_name = item #>> '{values,primary_contact_name}',
      primary_contact_email = item #>> '{values,primary_contact_email}', primary_contact_phone = item #>> '{values,primary_contact_phone}',
      website = item #>> '{values,website}', season = item #>> '{values,season}', updated_at = timezone('utc', now())
    where id = entity_uuid;
    select to_jsonb(c) into after_row from public.clubs c where c.id = entity_uuid;
    insert into public.data_transfer_import_records(batch_id, entity_type, entity_id, action, before_data, after_data)
    values (batch_row.id, 'club', entity_uuid, 'update', before_row, after_row);
    imported_counts := jsonb_set(imported_counts, '{clubs}', '1'::jsonb);
  end if;

  for item in select value from jsonb_array_elements(coalesce(batch_row.plan -> 'teams', '[]'::jsonb)) loop
    action_value := item ->> 'action';
    if action_value not in ('create', 'update') then continue; end if;
    before_row := null;
    entity_uuid := nullif(item ->> 'entity_id', '')::uuid;
    if entity_uuid is not null then select to_jsonb(t) into before_row from public.teams t where t.id = entity_uuid and t.club_id = batch_row.club_id; end if;
    if entity_uuid is not null and (before_row is null or (nullif(item ->> 'expected_updated_at', '') is not null and nullif(item ->> 'expected_updated_at', '')::timestamptz is distinct from (before_row ->> 'updated_at')::timestamptz)) then
      raise exception 'A team changed after preview. Inspect the workbook again.';
    end if;
    insert into public.teams(id, club_id, name, transfer_reference, age_group, category, season, league, division, home_ground, training_day, training_time, status, updated_at)
    values (coalesce(entity_uuid, gen_random_uuid()), batch_row.club_id, item #>> '{values,name}', item #>> '{values,transfer_reference}',
      item #>> '{values,age_group}', item #>> '{values,category}', item #>> '{values,season}', item #>> '{values,league}',
      item #>> '{values,division}', item #>> '{values,home_ground}', item #>> '{values,training_day}', item #>> '{values,training_time}',
      coalesce(item #>> '{values,status}', 'active'), timezone('utc', now()))
    on conflict (id) do update set
      transfer_reference = excluded.transfer_reference,
      name = excluded.name, age_group = excluded.age_group, category = excluded.category, season = excluded.season,
      league = excluded.league, division = excluded.division, home_ground = excluded.home_ground,
      training_day = excluded.training_day, training_time = excluded.training_time, status = excluded.status,
      updated_at = timezone('utc', now())
    returning id into entity_uuid;
    select to_jsonb(t) into after_row from public.teams t where t.id = entity_uuid;
    insert into public.data_transfer_import_records(batch_id, entity_type, entity_id, action, before_data, after_data)
    values (batch_row.id, 'team', entity_uuid, case when before_row is null then 'create' else 'update' end, before_row, after_row);
    imported_counts := jsonb_set(imported_counts, '{teams}', to_jsonb(coalesce((imported_counts ->> 'teams')::int, 0) + 1));
    before_row := null;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(batch_row.plan -> 'players', '[]'::jsonb)) loop
    action_value := item ->> 'action';
    if action_value not in ('create', 'update') then continue; end if;
    before_row := null;
    entity_uuid := nullif(item ->> 'entity_id', '')::uuid;
    team_uuid := nullif(item ->> 'team_entity_id', '')::uuid;
    if team_uuid is null then select id into team_uuid from public.teams where club_id = batch_row.club_id and lower(transfer_reference) = lower(item #>> '{values,team_reference}'); end if;
    if entity_uuid is not null then select to_jsonb(p) into before_row from public.players p where p.id = entity_uuid and p.club_id = batch_row.club_id; end if;
    if team_uuid is null then raise exception 'The confirmed player team is no longer available.'; end if;
    if entity_uuid is not null and (before_row is null or (nullif(item ->> 'expected_updated_at', '') is not null and nullif(item ->> 'expected_updated_at', '')::timestamptz is distinct from (before_row ->> 'updated_at')::timestamptz)) then
      raise exception 'A player changed after preview. Inspect the workbook again.';
    end if;
    insert into public.players(id, club_id, team_id, team, player_name, first_name, last_name, preferred_name, transfer_reference, date_of_birth, gender, section, shirt_number, positions, status, updated_at)
    values (coalesce(entity_uuid, gen_random_uuid()), batch_row.club_id, team_uuid,
      coalesce((select name from public.teams where id = team_uuid), ''),
      trim(concat_ws(' ', item #>> '{values,first_name}', item #>> '{values,last_name}')),
      item #>> '{values,first_name}', item #>> '{values,last_name}', item #>> '{values,preferred_name}', item #>> '{values,transfer_reference}',
      nullif(item #>> '{values,date_of_birth}', '')::date, item #>> '{values,gender}', coalesce(item #>> '{values,section}', 'Squad'),
      nullif(item #>> '{values,shirt_number}', '')::integer,
      coalesce(array(select jsonb_array_elements_text(coalesce(item #> '{values,positions}', '[]'::jsonb))), '{}'::text[]),
      coalesce(item #>> '{values,status}', 'active'), timezone('utc', now()))
    on conflict (id) do update set
      transfer_reference = excluded.transfer_reference,
      team_id = excluded.team_id, team = excluded.team, player_name = excluded.player_name, first_name = excluded.first_name,
      last_name = excluded.last_name, preferred_name = excluded.preferred_name, date_of_birth = excluded.date_of_birth,
      gender = excluded.gender, section = excluded.section, shirt_number = excluded.shirt_number, positions = excluded.positions,
      status = excluded.status, updated_at = timezone('utc', now())
    returning id into entity_uuid;
    select to_jsonb(p) into after_row from public.players p where p.id = entity_uuid;
    insert into public.data_transfer_import_records(batch_id, entity_type, entity_id, action, before_data, after_data)
    values (batch_row.id, 'player', entity_uuid, case when before_row is null then 'create' else 'update' end, before_row, after_row);
    imported_counts := jsonb_set(imported_counts, '{players}', to_jsonb(coalesce((imported_counts ->> 'players')::int, 0) + 1));
    before_row := null;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(batch_row.plan -> 'guardians', '[]'::jsonb)) loop
    action_value := item ->> 'action';
    if action_value not in ('create', 'update') then continue; end if;
    before_row := null;
    entity_uuid := nullif(item ->> 'entity_id', '')::uuid;
    if entity_uuid is not null then select to_jsonb(g) into before_row from public.guardians g where g.id = entity_uuid and g.club_id = batch_row.club_id; end if;
    if entity_uuid is not null and (before_row is null or (nullif(item ->> 'expected_updated_at', '') is not null and nullif(item ->> 'expected_updated_at', '')::timestamptz is distinct from (before_row ->> 'updated_at')::timestamptz)) then
      raise exception 'A guardian changed after preview. Inspect the workbook again.';
    end if;
    insert into public.guardians(id, club_id, transfer_reference, first_name, last_name, email, phone, address_line_1, address_line_2, town_city, county, postcode, country, status, created_by, updated_by)
    values (coalesce(entity_uuid, gen_random_uuid()), batch_row.club_id, item #>> '{values,transfer_reference}', item #>> '{values,first_name}',
      item #>> '{values,last_name}', item #>> '{values,email}', item #>> '{values,phone}', item #>> '{values,address_line_1}',
      item #>> '{values,address_line_2}', item #>> '{values,town_city}', item #>> '{values,county}', item #>> '{values,postcode}',
      item #>> '{values,country}', coalesce(item #>> '{values,status}', 'active'), batch_row.actor_id, batch_row.actor_id)
    on conflict (id) do update set
      transfer_reference = excluded.transfer_reference,
      first_name = excluded.first_name, last_name = excluded.last_name, email = excluded.email, phone = excluded.phone,
      address_line_1 = excluded.address_line_1, address_line_2 = excluded.address_line_2, town_city = excluded.town_city,
      county = excluded.county, postcode = excluded.postcode, country = excluded.country, status = excluded.status,
      updated_by = batch_row.actor_id, updated_at = timezone('utc', now())
    returning id into entity_uuid;
    select to_jsonb(g) into after_row from public.guardians g where g.id = entity_uuid;
    insert into public.data_transfer_import_records(batch_id, entity_type, entity_id, action, before_data, after_data)
    values (batch_row.id, 'guardian', entity_uuid, case when before_row is null then 'create' else 'update' end, before_row, after_row);
    imported_counts := jsonb_set(imported_counts, '{guardians}', to_jsonb(coalesce((imported_counts ->> 'guardians')::int, 0) + 1));
    before_row := null;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(batch_row.plan -> 'links', '[]'::jsonb)) loop
    if item ->> 'action' <> 'link' then continue; end if;
    player_uuid := nullif(item ->> 'player_entity_id', '')::uuid;
    guardian_uuid := nullif(item ->> 'guardian_entity_id', '')::uuid;
    if player_uuid is null then select id into player_uuid from public.players where club_id = batch_row.club_id and lower(transfer_reference) = lower(item #>> '{values,player_reference}'); end if;
    if guardian_uuid is null then select id into guardian_uuid from public.guardians where club_id = batch_row.club_id and lower(transfer_reference) = lower(item #>> '{values,guardian_reference}'); end if;
    if player_uuid is null or guardian_uuid is null then raise exception 'The confirmed player or guardian is no longer available.'; end if;
    select team_id into team_uuid from public.players where id = player_uuid;
    insert into public.parent_player_links(club_id, team_id, player_id, guardian_id, link_type, relationship, email, status, primary_contact, receives_communications, emergency_contact, invited_by, invited_by_name, expires_at)
    values (batch_row.club_id, team_uuid, player_uuid, guardian_uuid, 'parent', item #>> '{values,relationship}',
      (select email from public.guardians where id = guardian_uuid), 'uninvited',
      coalesce((item #>> '{values,primary_contact}')::boolean, false),
      coalesce((item #>> '{values,receives_communications}')::boolean, false),
      coalesce((item #>> '{values,emergency_contact}')::boolean, false),
      batch_row.actor_id, 'Data Transfer', timezone('utc', now()))
    returning id into entity_uuid;
    select to_jsonb(l) into after_row from public.parent_player_links l where l.id = entity_uuid;
    insert into public.data_transfer_import_records(batch_id, entity_type, entity_id, action, before_data, after_data)
    values (batch_row.id, 'link', entity_uuid, 'create', null, after_row);
    imported_counts := jsonb_set(imported_counts, '{links}', to_jsonb(coalesce((imported_counts ->> 'links')::int, 0) + 1));
  end loop;

  update public.data_transfer_batches
  set state = case when jsonb_array_length(warnings) > 0 then 'completed_with_warnings' else 'completed' end,
      counts = counts || jsonb_build_object('imported', imported_counts), completed_at = timezone('utc', now()), updated_at = timezone('utc', now())
  where id = batch_row.id;

  insert into public.data_transfer_audit_entries(batch_id, actor_id, club_id, action, metadata)
  values (batch_row.id, batch_row.actor_id, batch_row.club_id, 'data_transfer_import_completed', jsonb_build_object('counts', imported_counts, 'plan_sha256', plan_sha256_value));

  return jsonb_build_object('batchId', batch_row.id, 'state', case when jsonb_array_length(batch_row.warnings) > 0 then 'completed_with_warnings' else 'completed' end, 'idempotent', false, 'counts', imported_counts);
exception when others then
  update public.data_transfer_batches set state = 'failed', failed_at = timezone('utc', now()), updated_at = timezone('utc', now()),
    error_summary = jsonb_build_array(jsonb_build_object('code', 'IMPORT_TRANSACTION_FAILED', 'message', 'The import transaction failed without committing business records.', 'sqlstate', sqlstate))
  where id = batch_id_value and state not in ('completed', 'completed_with_warnings');
  insert into public.data_transfer_audit_entries(batch_id, actor_id, club_id, action, metadata)
  select id, actor_id, club_id, 'data_transfer_import_failed', jsonb_build_object('sqlstate', sqlstate)
  from public.data_transfer_batches where id = batch_id_value;
  return jsonb_build_object('batchId', batch_id_value, 'state', 'failed', 'idempotent', false, 'errorCode', 'IMPORT_TRANSACTION_FAILED');
end;
$$;

revoke all on function public.execute_data_transfer_import(uuid, text) from public, anon, authenticated;
grant execute on function public.execute_data_transfer_import(uuid, text) to service_role;

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
    if record_row.entity_type = 'link' then select to_jsonb(x) into current_row from public.parent_player_links x where id = record_row.entity_id;
    elsif record_row.entity_type = 'guardian' then select to_jsonb(x) into current_row from public.guardians x where id = record_row.entity_id;
    elsif record_row.entity_type = 'player' then select to_jsonb(x) into current_row from public.players x where id = record_row.entity_id;
    elsif record_row.entity_type = 'team' then select to_jsonb(x) into current_row from public.teams x where id = record_row.entity_id;
    elsif record_row.entity_type = 'club' then select to_jsonb(x) into current_row from public.clubs x where id = record_row.entity_id;
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
