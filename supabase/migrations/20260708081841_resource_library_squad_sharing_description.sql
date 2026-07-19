-- The reviewed parent-sharing SQL was applied before this ledger migration but was
-- never represented by an active migration. Establish its required objects here so
-- the first active consumer is self-contained for blank rebuilds.
alter table public.resource_library_links
  add column if not exists parent_visible boolean not null default false;

create index if not exists resource_library_links_parent_visible_player_idx
on public.resource_library_links (club_id, linked_id)
where linked_type = 'player' and parent_visible is true and removed_at is null;

create table if not exists public.resource_library_external_links (
  resource_id uuid primary key,
  club_id uuid not null,
  team_id uuid not null,
  external_url text not null,
  created_by_profile_id uuid,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint resource_library_external_links_resource_fkey
    foreign key (resource_id, club_id)
    references public.resource_library_items (id, club_id)
    on delete cascade,
  constraint resource_library_external_links_team_fkey
    foreign key (team_id)
    references public.teams (id)
    on delete cascade,
  constraint resource_library_external_links_url_check
    check (
      external_url ~* '^https?://'
      and char_length(external_url) <= 2048
    )
);

create index if not exists resource_library_external_links_team_idx
on public.resource_library_external_links (club_id, team_id);

revoke all on public.resource_library_external_links from public;
revoke all on public.resource_library_external_links from anon;
revoke all on public.resource_library_external_links from authenticated;
grant select, insert, update on public.resource_library_external_links to authenticated;
grant all on public.resource_library_external_links to service_role;

alter table public.resource_library_external_links enable row level security;

drop policy if exists resource_library_external_links_insert_manager
on public.resource_library_external_links;
create policy resource_library_external_links_insert_manager
on public.resource_library_external_links
for insert
to authenticated
with check (
  created_by_profile_id = auth.uid()
  and public.current_user_can_manage_resource_library(club_id, team_id)
);

drop policy if exists resource_library_external_links_update_manager
on public.resource_library_external_links;
create policy resource_library_external_links_update_manager
on public.resource_library_external_links
for update
to authenticated
using (
  public.current_user_can_manage_resource_library(club_id, team_id)
)
with check (
  public.current_user_can_manage_resource_library(club_id, team_id)
);

create or replace function public.create_external_resource_library_item(
  target_club_id uuid,
  target_team_id uuid,
  title_value text,
  description_value text default '',
  category_value text default 'general',
  external_url_value text default ''
)
returns table (
  id uuid,
  club_id uuid,
  team_id uuid,
  title text,
  description text,
  category text,
  resource_type text,
  external_url text,
  storage_bucket text,
  storage_path text,
  original_filename text,
  mime_type text,
  file_size_bytes integer,
  uploaded_by_profile_id uuid,
  uploaded_by_name text,
  uploaded_by_email text,
  archived_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
set search_path = public
as $$
declare
  new_resource_id uuid := gen_random_uuid();
  normalized_title text := btrim(coalesce(title_value, ''));
  normalized_description text := coalesce(description_value, '');
  normalized_category text := coalesce(nullif(category_value, ''), 'general');
  normalized_external_url text := btrim(coalesce(external_url_value, ''));
  synthetic_storage_path text := target_club_id::text || '/' || target_team_id::text || '/external-links/' || new_resource_id::text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  if not public.current_user_can_manage_resource_library(target_club_id, target_team_id) then
    raise exception 'Resource library manager access required.';
  end if;

  if normalized_title = '' then
    raise exception 'Resource title is required.';
  end if;

  if normalized_external_url !~* '^https?://' then
    raise exception 'External URL must start with http:// or https://.';
  end if;

  insert into public.resource_library_items (
    id,
    club_id,
    team_id,
    title,
    description,
    category,
    storage_bucket,
    storage_path,
    original_filename,
    mime_type,
    file_size_bytes,
    uploaded_by_profile_id,
    uploaded_by_name,
    uploaded_by_email
  )
  values (
    new_resource_id,
    target_club_id,
    target_team_id,
    normalized_title,
    normalized_description,
    normalized_category,
    'resource-library',
    synthetic_storage_path,
    normalized_external_url,
    'text/plain',
    1,
    auth.uid(),
    '',
    coalesce(auth.jwt() ->> 'email', '')
  );

  insert into public.resource_library_external_links (
    resource_id,
    club_id,
    team_id,
    external_url,
    created_by_profile_id
  )
  values (
    new_resource_id,
    target_club_id,
    target_team_id,
    normalized_external_url,
    auth.uid()
  );

  return query
  select
    item.id,
    item.club_id,
    item.team_id,
    item.title,
    item.description,
    item.category,
    'external_link'::text as resource_type,
    external_link.external_url,
    item.storage_bucket,
    item.storage_path,
    item.original_filename,
    item.mime_type,
    item.file_size_bytes,
    item.uploaded_by_profile_id,
    item.uploaded_by_name,
    item.uploaded_by_email,
    item.archived_at,
    item.created_at,
    item.updated_at
  from public.resource_library_items item
  join public.resource_library_external_links external_link
    on external_link.resource_id = item.id
   and external_link.club_id = item.club_id
  where item.id = new_resource_id;
end;
$$;

revoke all on function public.create_external_resource_library_item(uuid, uuid, text, text, text, text) from public;
revoke execute on function public.create_external_resource_library_item(uuid, uuid, text, text, text, text) from anon;
grant execute on function public.create_external_resource_library_item(uuid, uuid, text, text, text, text) to authenticated, service_role;

alter table public.resource_library_links
  add column if not exists share_description text;

do $$
begin
  alter table public.resource_library_links
    add constraint resource_library_links_share_description_length
    check (
      share_description is null
      or char_length(share_description) <= 500
    );
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  if to_regclass('public.resource_library_external_links') is not null
    and exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'get_parent_portal_player_resources'
    )
  then
    execute 'drop function if exists public.get_parent_portal_player_resources(uuid)';

    execute $ddl$
    create function public.get_parent_portal_player_resources(parent_link_id_value uuid)
    returns table (
      id uuid,
      club_id uuid,
      team_id uuid,
      player_id uuid,
      title text,
      description text,
      share_description text,
      category text,
      resource_type text,
      external_url text,
      storage_bucket text,
      storage_path text,
      original_filename text,
      mime_type text,
      file_size_bytes integer,
      uploaded_by_profile_id uuid,
      uploaded_by_name text,
      uploaded_by_email text,
      archived_at timestamptz,
      created_at timestamptz,
      updated_at timestamptz,
      link_id uuid,
      assigned_at timestamptz
    )
    language sql
    stable
    set search_path = public
    as $body$
      select
        item.id,
        item.club_id,
        item.team_id,
        link.linked_id as player_id,
        item.title,
        item.description,
        coalesce(link.share_description, '') as share_description,
        item.category,
        case
          when external_link.resource_id is not null then 'external_link'
          else 'file'
        end as resource_type,
        coalesce(external_link.external_url, '') as external_url,
        item.storage_bucket,
        item.storage_path,
        item.original_filename,
        item.mime_type,
        item.file_size_bytes,
        item.uploaded_by_profile_id,
        item.uploaded_by_name,
        item.uploaded_by_email,
        item.archived_at,
        item.created_at,
        item.updated_at,
        link.id as link_id,
        link.assigned_at
      from public.parent_player_links parent_link
      join public.resource_library_links link
        on link.club_id = parent_link.club_id
       and link.team_id = coalesce(parent_link.team_id, link.team_id)
       and link.linked_type = 'player'
       and link.linked_id = parent_link.player_id
       and link.parent_visible is true
       and link.removed_at is null
      join public.resource_library_items item
        on item.id = link.resource_id
       and item.club_id = link.club_id
       and item.team_id = link.team_id
       and item.archived_at is null
      left join public.resource_library_external_links external_link
        on external_link.resource_id = item.id
       and external_link.club_id = item.club_id
       and external_link.team_id = item.team_id
      where parent_link.id = parent_link_id_value
        and parent_link.auth_user_id = auth.uid()
        and parent_link.status = 'active';
    $body$;
    $ddl$;

    revoke all on function public.get_parent_portal_player_resources(uuid) from public;
    revoke execute on function public.get_parent_portal_player_resources(uuid) from anon;
    grant execute on function public.get_parent_portal_player_resources(uuid) to authenticated, service_role;
  end if;
end
$$;
