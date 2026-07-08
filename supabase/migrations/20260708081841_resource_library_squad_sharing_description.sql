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
