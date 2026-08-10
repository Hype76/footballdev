create or replace function public.get_mobile_test_parent_development_reports(parent_link_id_value uuid)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', coalesce(report.report_snapshot->>'evaluationId', report.evaluation_id::text),
    'finalizedAt', coalesce(report.finalized_at::text, report.report_snapshot->>'finalizedAt', ''),
    'recordDate', coalesce(report.report_snapshot->>'recordDate', ''),
    'club', jsonb_build_object('name', coalesce(report.report_snapshot #>> '{club,name}', '')),
    'team', jsonb_build_object('name', coalesce(report.report_snapshot #>> '{team,name}', '')),
    'player', jsonb_build_object('name', coalesce(report.report_snapshot #>> '{player,name}', '')),
    'author', jsonb_build_object('name', coalesce(report.report_snapshot #>> '{author,name}', '')),
    'section', coalesce(nullif(report.report_snapshot->>'section', ''), 'Development'),
    'form', jsonb_build_object('name', coalesce(nullif(report.report_snapshot #>> '{form,name}', ''), 'Development report')),
    'overallScore', report.report_snapshot->'overallScore',
    'overallMaxScore', coalesce(report.report_snapshot->'overallMaxScore', '10'::jsonb),
    'responseItems', coalesce((
      select jsonb_agg(jsonb_build_object(
        'label', response_item.value->>'label',
        'displayValue', coalesce(nullif(response_item.value->>'displayValue', ''), response_item.value->>'value')
      ) order by coalesce((response_item.value->>'order')::integer, 0))
      from jsonb_array_elements(coalesce(report.report_snapshot->'responseItems', '[]'::jsonb)) as response_item(value)
      where coalesce((response_item.value->>'parentVisible')::boolean, true) is true
        and coalesce((response_item.value->>'selected')::boolean, true) is true
        and coalesce(response_item.value->>'label', '') <> ''
        and coalesce(nullif(response_item.value->>'displayValue', ''), response_item.value->>'value', '') <> ''
    ), '[]'::jsonb),
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', report_section.value->>'title',
        'body', report_section.value->>'body'
      ))
      from jsonb_array_elements(coalesce(report.report_snapshot->'emailSections', '[]'::jsonb)) as report_section(value)
      where coalesce(report_section.value->>'title', '') <> ''
        and coalesce(report_section.value->>'body', '') <> ''
    ), '[]'::jsonb),
    'deliveryState', case when exists (
      select 1 from public.communication_logs sent
      where sent.evaluation_id = report.evaluation_id
        and sent.club_id = parent_link.club_id
        and sent.player_id = parent_link.player_id
        and sent.channel = 'email'
        and sent.action = 'parent_email_sent'
        and sent.metadata->>'recipientLinkId' = parent_link.id::text
    ) then 'sent' else 'scheduled' end,
    'deliveryLabel', case when exists (
      select 1 from public.communication_logs sent
      where sent.evaluation_id = report.evaluation_id
        and sent.club_id = parent_link.club_id
        and sent.player_id = parent_link.player_id
        and sent.channel = 'email'
        and sent.action = 'parent_email_sent'
        and sent.metadata->>'recipientLinkId' = parent_link.id::text
    ) then 'Sent' else 'Scheduled' end,
    'canDownloadPdf', exists (
      select 1 from public.communication_logs attachment
      where attachment.evaluation_id = report.evaluation_id
        and attachment.club_id = parent_link.club_id
        and attachment.player_id = parent_link.player_id
        and attachment.channel = 'email'
        and attachment.action in ('parent_email_scheduled', 'parent_email_sent')
        and attachment.metadata->>'recipientLinkId' = parent_link.id::text
        and coalesce((attachment.metadata->>'hasAttachment')::boolean, false) is true
    )
  )
  from public.parent_player_links parent_link
  join public.players player
    on player.id = parent_link.player_id
   and player.club_id = parent_link.club_id
   and coalesce(player.status, 'active') <> 'archived'
   and player.archived_at is null
  join public.development_parent_reports report
    on report.club_id = parent_link.club_id
   and report.report_snapshot #>> '{player,id}' = parent_link.player_id::text
   and report.report_snapshot->'recipients' @> jsonb_build_array(jsonb_build_object('linkId', parent_link.id::text))
  where parent_link.id = parent_link_id_value
    and parent_link.auth_user_id = auth.uid()
    and parent_link.status = 'active'
    and exists (
      select 1 from public.communication_logs evidence
      where evidence.evaluation_id = report.evaluation_id
        and evidence.club_id = parent_link.club_id
        and evidence.player_id = parent_link.player_id
        and evidence.channel = 'email'
        and evidence.action in ('parent_email_scheduled', 'parent_email_sent')
        and evidence.metadata->>'recipientLinkId' = parent_link.id::text
    )
  order by coalesce(report.report_snapshot->>'recordDate', report.finalized_at::text) desc;
$$;

revoke all on function public.get_mobile_test_parent_development_reports(uuid) from public;
revoke execute on function public.get_mobile_test_parent_development_reports(uuid) from anon;
grant execute on function public.get_mobile_test_parent_development_reports(uuid) to authenticated;

create or replace function public.get_mobile_test_parent_resource_access(
  parent_link_id_value uuid,
  resource_id_value uuid
)
returns table (
  access_type text,
  external_url text,
  storage_bucket text,
  storage_path text,
  original_filename text,
  mime_type text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when external_link.resource_id is not null then 'external_link' else 'file' end,
    coalesce(external_link.external_url, ''),
    coalesce(item.storage_bucket, ''),
    coalesce(item.storage_path, ''),
    coalesce(item.original_filename, ''),
    coalesce(item.mime_type, 'application/octet-stream')
  from public.parent_player_links parent_link
  join public.players player
    on player.id = parent_link.player_id
   and player.club_id = parent_link.club_id
   and coalesce(player.status, 'active') <> 'archived'
   and player.archived_at is null
  join public.resource_library_links link
    on link.club_id = parent_link.club_id
   and (parent_link.team_id is null or parent_link.team_id = link.team_id)
   and link.team_id = player.team_id
   and link.linked_type = 'player'
   and link.linked_id = player.id
   and link.parent_visible is true
   and link.removed_at is null
  join public.resource_library_items item
    on item.id = resource_id_value
   and item.id = link.resource_id
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
$$;

revoke all on function public.get_mobile_test_parent_resource_access(uuid, uuid) from public;
revoke execute on function public.get_mobile_test_parent_resource_access(uuid, uuid) from anon;
grant execute on function public.get_mobile_test_parent_resource_access(uuid, uuid) to authenticated;

drop policy if exists mobile_test_parent_resource_objects_select on storage.objects;
create policy mobile_test_parent_resource_objects_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'resource-library'
  and exists (
    select 1
    from public.parent_player_links parent_link
    join public.players player
      on player.id = parent_link.player_id
     and player.club_id = parent_link.club_id
     and coalesce(player.status, 'active') <> 'archived'
     and player.archived_at is null
    join public.resource_library_links link
      on link.club_id = parent_link.club_id
     and (parent_link.team_id is null or parent_link.team_id = link.team_id)
     and link.team_id = player.team_id
     and link.linked_type = 'player'
     and link.linked_id = player.id
     and link.parent_visible is true
     and link.removed_at is null
    join public.resource_library_items item
      on item.id = link.resource_id
     and item.club_id = link.club_id
     and item.team_id = link.team_id
     and item.storage_bucket = storage.objects.bucket_id
     and item.storage_path = storage.objects.name
     and item.archived_at is null
    where parent_link.auth_user_id = auth.uid()
      and parent_link.status = 'active'
  )
);
