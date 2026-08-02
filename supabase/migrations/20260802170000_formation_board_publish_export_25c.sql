-- FP-V1-FORMATION-BOARD-PUBLISH-EXPORT-25C

alter table public.formation_board_publications
  add column board_title_snapshot text,
  add column board_description_snapshot text,
  add column published_by_name text;

update public.formation_board_publications publication
set board_title_snapshot = board.title,
    board_description_snapshot = board.description
from public.formation_boards board
where board.id = publication.board_id;

update public.formation_board_publications publication
set published_by_name = coalesce(actor.name, '')
from public.users actor
where actor.id = publication.published_by_profile_id;

alter table public.formation_board_publications
  alter column board_title_snapshot set not null,
  alter column board_description_snapshot set not null,
  alter column published_by_name set not null,
  add constraint formation_board_publications_title_snapshot_check
    check (char_length(btrim(board_title_snapshot)) between 1 and 120),
  add constraint formation_board_publications_description_snapshot_check
    check (char_length(board_description_snapshot) <= 1000),
  add constraint formation_board_publications_publisher_name_check
    check (char_length(published_by_name) <= 200);

drop function public.publish_formation_board_version(uuid, uuid, text, text, uuid);

create function public.publish_formation_board_version(
  target_board_id uuid,
  target_version_id uuid,
  category_value text,
  publication_action_value text default 'new_resource',
  target_resource_id uuid default null,
  thumbnail_path_value text default null,
  thumbnail_failed_value boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  actor public.users%rowtype;
  board public.formation_boards%rowtype;
  version public.formation_board_versions%rowtype;
  prior_publication public.formation_board_publications%rowtype;
  resource public.resource_library_items%rowtype;
  publication public.formation_board_publications%rowtype;
  publication_number_value integer;
  protected_url text;
  synthetic_storage_path text;
  expected_thumbnail_path text;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'formation_board_auth_required';
  end if;

  select * into board
  from public.formation_boards
  where id = target_board_id and deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'formation_board_not_found';
  end if;

  if board.archived_at is not null then
    raise exception using errcode = '55000', message = 'formation_board_archived_publish_forbidden';
  end if;

  if app_private.formation_board_team_role_rank(actor_id, board.team_id, board.club_id) < 30 then
    raise exception using errcode = '42501', message = 'formation_board_publish_forbidden';
  end if;

  if category_value not in ('general', 'training', 'match_day', 'development', 'admin') then
    raise exception using errcode = '22023', message = 'formation_board_resource_category_invalid';
  end if;

  if publication_action_value not in ('new_resource', 'update_resource') then
    raise exception using errcode = '22023', message = 'formation_board_publication_action_invalid';
  end if;

  select * into version
  from public.formation_board_versions
  where id = target_version_id
    and board_id = board.id
    and club_id = board.club_id
    and team_id = board.team_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'formation_board_version_not_found';
  end if;

  if exists (
    select 1
    from public.formation_board_publications existing
    where existing.board_id = board.id
      and existing.board_version_id = version.id
      and (
        publication_action_value = 'new_resource'
        or existing.resource_id = target_resource_id
      )
  ) then
    raise exception using errcode = '23505', message = 'formation_board_duplicate_publication';
  end if;

  expected_thumbnail_path := board.club_id::text
    || '/' || board.team_id::text
    || '/formation-boards/' || board.id::text
    || '/versions/' || version.id::text
    || '/thumbnail.png';

  if thumbnail_path_value is not null then
    if thumbnail_path_value <> expected_thumbnail_path
      or not exists (
        select 1
        from storage.objects object
        where object.bucket_id = 'resource-library'
          and object.name = thumbnail_path_value
      ) then
      raise exception using errcode = '42501', message = 'formation_board_thumbnail_invalid';
    end if;
  elsif not coalesce(thumbnail_failed_value, false) then
    raise exception using errcode = '22023', message = 'formation_board_thumbnail_required';
  end if;

  select * into actor from public.users where id = actor_id and status = 'active';

  if not found then
    raise exception using errcode = '28000', message = 'formation_board_auth_required';
  end if;

  publication_number_value := coalesce((
    select max(existing.publication_number)
    from public.formation_board_publications existing
    where existing.board_id = board.id
  ), 0) + 1;

  protected_url := 'https://footballplayer.online/resources/formation-boards?board='
    || board.id::text || '&version=' || version.id::text;

  if publication_action_value = 'new_resource' then
    if target_resource_id is not null then
      raise exception using errcode = '22023', message = 'formation_board_new_resource_id_forbidden';
    end if;

    resource.id := gen_random_uuid();
    synthetic_storage_path := board.club_id::text || '/' || board.team_id::text
      || '/formation-boards/' || resource.id::text;

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
    ) values (
      resource.id,
      board.club_id,
      board.team_id,
      board.title,
      board.description,
      category_value,
      'resource-library',
      synthetic_storage_path,
      'formation-board-' || board.id::text || '-v' || version.version_number::text,
      'application/vnd.footballplayer.formation-board+json',
      1,
      actor_id,
      coalesce(actor.name, ''),
      actor.email
    ) returning * into resource;

    insert into public.resource_library_external_links (
      resource_id,
      club_id,
      team_id,
      external_url,
      created_by_profile_id
    ) values (
      resource.id,
      board.club_id,
      board.team_id,
      protected_url,
      actor_id
    );
  else
    if target_resource_id is null then
      raise exception using errcode = '22023', message = 'formation_board_update_resource_required';
    end if;

    select * into prior_publication
    from public.formation_board_publications existing
    where existing.board_id = board.id
      and existing.resource_id = target_resource_id
      and existing.club_id = board.club_id
      and existing.team_id = board.team_id
    order by existing.publication_number desc
    limit 1;

    if not found then
      raise exception using errcode = '42501', message = 'formation_board_resource_not_linked';
    end if;

    select * into resource
    from public.resource_library_items item
    where item.id = target_resource_id
      and item.club_id = board.club_id
      and item.team_id = board.team_id
      and item.archived_at is null
    for update;

    if not found then
      raise exception using errcode = 'P0002', message = 'formation_board_resource_not_found';
    end if;

    update public.resource_library_items
    set title = board.title,
        description = board.description,
        category = category_value,
        updated_at = timezone('utc', now())
    where id = resource.id
    returning * into resource;

    update public.resource_library_external_links
    set external_url = protected_url,
        updated_at = timezone('utc', now())
    where resource_id = resource.id
      and club_id = board.club_id
      and team_id = board.team_id;
  end if;

  insert into public.formation_board_publications (
    board_id,
    board_version_id,
    club_id,
    team_id,
    resource_id,
    resource_category,
    publication_number,
    publication_action,
    previous_publication_id,
    published_by_profile_id,
    published_by_name,
    board_title_snapshot,
    board_description_snapshot,
    thumbnail_bucket,
    thumbnail_path,
    publication_state
  ) values (
    board.id,
    version.id,
    board.club_id,
    board.team_id,
    resource.id,
    category_value,
    publication_number_value,
    publication_action_value,
    case when publication_action_value = 'update_resource' then prior_publication.id else board.current_publication_id end,
    actor_id,
    coalesce(actor.name, ''),
    board.title,
    board.description,
    case when thumbnail_path_value is not null then 'resource-library' end,
    thumbnail_path_value,
    case when thumbnail_path_value is null then 'export_failed' else 'published' end
  ) returning * into publication;

  update public.formation_boards
  set current_publication_id = publication.id
  where id = board.id;

  perform app_private.formation_board_record_audit(
    actor_id,
    board.club_id,
    board.team_id,
    'formation_board_published',
    board.id,
    jsonb_build_object(
      'boardVersionId', version.id,
      'boardVersion', version.version_number,
      'publicationId', publication.id,
      'publicationNumber', publication.publication_number,
      'publicationAction', publication.publication_action,
      'resourceId', resource.id,
      'resourceCategory', category_value,
      'thumbnailState', publication.publication_state,
      'notificationSent', false,
      'emailSent', false,
      'parentVisible', false
    )
  );

  return jsonb_build_object(
    'publication', to_jsonb(publication),
    'resource', to_jsonb(resource),
    'protectedUrl', protected_url
  );
end;
$$;

create function public.get_formation_board_export_payload(target_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  request_record public.formation_board_export_requests%rowtype;
  board public.formation_boards%rowtype;
  version public.formation_board_versions%rowtype;
  publication public.formation_board_publications%rowtype;
  club_record public.clubs%rowtype;
  team_record public.teams%rowtype;
begin
  if actor_id is null then
    raise exception using errcode = '28000', message = 'formation_board_auth_required';
  end if;

  select * into request_record
  from public.formation_board_export_requests request
  where request.id = target_request_id
    and request.requested_by_profile_id = actor_id
    and request.export_state = 'pending';

  if not found then
    raise exception using errcode = '42501', message = 'formation_board_export_forbidden';
  end if;

  select * into board
  from public.formation_boards
  where id = request_record.board_id
    and club_id = request_record.club_id
    and team_id = request_record.team_id
    and deleted_at is null;

  if not found
    or app_private.formation_board_team_role_rank(actor_id, board.team_id, board.club_id) < 30 then
    raise exception using errcode = '42501', message = 'formation_board_export_forbidden';
  end if;

  select * into version
  from public.formation_board_versions
  where id = request_record.board_version_id
    and board_id = board.id
    and club_id = board.club_id
    and team_id = board.team_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'formation_board_version_not_found';
  end if;

  select * into club_record from public.clubs where id = board.club_id and status = 'active';
  select * into team_record from public.teams where id = board.team_id and status = 'active';
  select * into publication
  from public.formation_board_publications published
  where published.board_id = board.id
    and published.board_version_id = version.id
  order by published.publication_number desc
  limit 1;

  if club_record.id is null or team_record.id is null then
    raise exception using errcode = '42501', message = 'formation_board_export_forbidden';
  end if;

  return jsonb_build_object(
    'request', to_jsonb(request_record),
    'board', jsonb_build_object(
      'id', board.id,
      'club_id', board.club_id,
      'team_id', board.team_id,
      'title', coalesce(publication.board_title_snapshot, board.title),
      'description', coalesce(publication.board_description_snapshot, board.description),
      'updated_at', board.updated_at
    ),
    'version', to_jsonb(version),
    'club', jsonb_build_object(
      'id', club_record.id,
      'name', club_record.name,
      'logo_url', club_record.logo_url,
      'theme_accent', club_record.theme_accent
    ),
    'team', jsonb_build_object(
      'id', team_record.id,
      'name', team_record.name
    )
  );
end;
$$;

create function app_private.reject_formation_board_resource_assignment()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.formation_board_publications publication
    where publication.resource_id = new.resource_id
  ) and (tg_op = 'INSERT' or new.removed_at is null) then
    raise exception using errcode = '42501', message = 'formation_board_resource_assignment_forbidden';
  end if;

  return new;
end;
$$;

create trigger reject_formation_board_resource_assignment
before insert or update on public.resource_library_links
for each row execute function app_private.reject_formation_board_resource_assignment();

revoke all on function public.publish_formation_board_version(uuid, uuid, text, text, uuid, text, boolean) from public, anon;
revoke all on function public.get_formation_board_export_payload(uuid) from public, anon;
revoke all on function app_private.reject_formation_board_resource_assignment() from public, anon, authenticated;

grant execute on function public.publish_formation_board_version(uuid, uuid, text, text, uuid, text, boolean) to authenticated, service_role;
grant execute on function public.get_formation_board_export_payload(uuid) to authenticated, service_role;

comment on function public.get_formation_board_export_payload(uuid)
is 'Resolves one pending Formation Board export from the authenticated request owner and current Team authority.';
