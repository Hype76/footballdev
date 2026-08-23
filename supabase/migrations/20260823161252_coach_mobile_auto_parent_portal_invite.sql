begin;

create schema if not exists app_private;

create unique index if not exists scheduled_email_queue_parent_portal_invite_link_key
on public.scheduled_email_queue ((payload #>> '{parentPortalInvite,linkId}'))
where nullif(payload #>> '{parentPortalInvite,linkId}', '') is not null;

create or replace function app_private.enqueue_coach_mobile_parent_portal_invites()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_headers jsonb := '{}'::jsonb;
  client_info text := '';
  actor_email text := '';
  actor_name text := '';
  actor_role text := '';
  parent_contact record;
  parent_link_id_value uuid;
  parent_link_expires_at timestamptz;
begin
  begin
    request_headers := coalesce(
      nullif(pg_catalog.current_setting('request.headers', true), ''),
      '{}'
    )::jsonb;
  exception when others then
    return new;
  end;

  client_info := lower(btrim(coalesce(request_headers ->> 'x-client-info', '')));

  if client_info not like 'supabase-js-react-native/%'
    or auth.uid() is null
    or lower(btrim(coalesce(new.section, ''))) <> 'squad'
    or lower(btrim(coalesce(new.status, 'active'))) not in ('active', 'promoted')
    or new.archived_at is not null
    or lower(btrim(coalesce(new.contact_type, 'parent'))) not in ('parent', 'both')
    or new.team_id is null then
    return new;
  end if;

  actor_email := lower(btrim(coalesce(auth.jwt() ->> 'email', new.created_by_email, '')));
  actor_name := coalesce(nullif(btrim(new.created_by_name), ''), nullif(actor_email, ''), 'Coach');
  actor_role := lower(btrim(coalesce(public.current_user_role(), '')));

  if actor_email = 'demo@playerfeedback.online'
    or actor_role in ('', 'parent_portal', 'adult_player', 'super_admin')
    or not public.current_user_can_access_team(new.club_id, new.team_id)
    or not public.can_manage_parent_link(new.team_id)
    or not public.can_use_plan_feature(new.club_id, 'parentInvitations') then
    return new;
  end if;

  for parent_contact in
    with contact_source as (
      select case
        when pg_catalog.jsonb_typeof(coalesce(new.parent_contacts, '[]'::jsonb)) = 'array'
          then coalesce(new.parent_contacts, '[]'::jsonb)
        else '[]'::jsonb
      end as contacts
    ),
    configured_contacts as (
      select
        lower(btrim(coalesce(contact.value ->> 'email', contact.value ->> 'parentEmail', ''))) as email,
        coalesce(
          nullif(btrim(coalesce(contact.value ->> 'name', contact.value ->> 'parentName', '')), ''),
          nullif(btrim(new.parent_name), ''),
          'Parent or guardian'
        ) as name,
        1 as priority
      from contact_source source
      cross join lateral pg_catalog.jsonb_array_elements(source.contacts) contact(value)
      where lower(btrim(coalesce(contact.value ->> 'type', contact.value ->> 'contactType', 'parent'))) <> 'self'
        and btrim(coalesce(contact.value ->> 'email', contact.value ->> 'parentEmail', ''))
          ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
    ),
    fallback_contact as (
      select
        lower(btrim(coalesce(new.parent_email, ''))) as email,
        coalesce(nullif(btrim(new.parent_name), ''), 'Parent or guardian') as name,
        2 as priority
      from contact_source source
      where pg_catalog.jsonb_array_length(source.contacts) = 0
        and btrim(coalesce(new.parent_email, ''))
          ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
    ),
    candidates as (
      select * from configured_contacts
      union all
      select * from fallback_contact
    )
    select distinct on (candidate.email)
      candidate.email,
      candidate.name
    from candidates candidate
    where candidate.email <> ''
    order by candidate.email, candidate.priority
  loop
    parent_link_id_value := null;
    parent_link_expires_at := null;

    update public.parent_player_links link
    set
      status = 'revoked',
      updated_at = timezone('utc', now())
    where link.club_id = new.club_id
      and link.team_id = new.team_id
      and link.player_id = new.id
      and link.link_type = 'parent'
      and lower(btrim(coalesce(link.email, ''))) = parent_contact.email
      and link.status = 'pending'
      and link.expires_at is not null
      and link.expires_at <= timezone('utc', now());

    select link.id, link.expires_at
    into parent_link_id_value, parent_link_expires_at
    from public.parent_player_links link
    where link.club_id = new.club_id
      and link.team_id = new.team_id
      and link.player_id = new.id
      and link.link_type = 'parent'
      and lower(btrim(coalesce(link.email, ''))) = parent_contact.email
      and link.status = 'pending'
      and link.invite_sent_at is null
      and (link.expires_at is null or link.expires_at > timezone('utc', now()))
    order by link.created_at desc
    limit 1;

    if parent_link_id_value is null and exists (
      select 1
      from public.parent_player_links link
      where link.club_id = new.club_id
        and link.team_id = new.team_id
        and link.player_id = new.id
        and link.link_type = 'parent'
        and lower(btrim(coalesce(link.email, ''))) = parent_contact.email
        and link.status in ('active', 'pending')
    ) then
      continue;
    end if;

    if parent_link_id_value is null then
      insert into public.parent_player_links (
        club_id,
        team_id,
        player_id,
        link_type,
        email,
        status,
        expires_at,
        invited_by,
        invited_by_name
      ) values (
        new.club_id,
        new.team_id,
        new.id,
        'parent',
        parent_contact.email,
        'pending',
        timezone('utc', now()) + interval '24 hours',
        auth.uid(),
        actor_name
      )
      on conflict do nothing
      returning id, expires_at
      into parent_link_id_value, parent_link_expires_at;
    end if;

    if parent_link_id_value is null then
      select link.id, link.expires_at
      into parent_link_id_value, parent_link_expires_at
      from public.parent_player_links link
      where link.club_id = new.club_id
        and link.team_id = new.team_id
        and link.player_id = new.id
        and link.link_type = 'parent'
        and lower(btrim(coalesce(link.email, ''))) = parent_contact.email
        and link.status = 'pending'
        and link.invite_sent_at is null
      order by link.created_at desc
      limit 1;
    end if;

    if parent_link_id_value is null then
      continue;
    end if;

    insert into public.scheduled_email_queue (
      club_id,
      team_id,
      created_by,
      created_by_email,
      to_email,
      subject,
      status,
      scheduled_at,
      payload
    ) values (
      new.club_id,
      new.team_id,
      auth.uid(),
      actor_email,
      parent_contact.email,
      'Parent portal invite',
      'scheduled',
      timezone('utc', now()),
      jsonb_build_object(
        'visibleInEmailQueue', false,
        'outputKey', concat('parent-portal-invite:', parent_link_id_value),
        'displayName', actor_name,
        'clubId', new.club_id,
        'teamId', new.team_id,
        'playerId', new.id,
        'playerName', new.player_name,
        'actorId', auth.uid(),
        'actorEmail', actor_email,
        'actorRole', actor_role,
        'requiredFeature', 'parentInvitations',
        'parentPortalInvite', jsonb_build_object(
          'type', 'coach_mobile_new_player',
          'linkId', parent_link_id_value,
          'playerId', new.id,
          'expiresAt', parent_link_expires_at
        ),
        'communicationLog', jsonb_build_object(
          'clubId', new.club_id,
          'playerId', new.id,
          'userId', auth.uid(),
          'userName', actor_name,
          'userEmail', actor_email,
          'recipientEmail', parent_contact.email,
          'metadata', jsonb_build_object(
            'source', 'coach_mobile_auto_parent_invite',
            'parentLinkId', parent_link_id_value,
            'playerId', new.id
          )
        ),
        'deliveryTelemetry', jsonb_build_object(
          'sourceType', 'coach_mobile_auto_parent_invite',
          'sourceId', new.id,
          'originActionAt', timezone('utc', now()),
          'enqueuedAt', timezone('utc', now())
        )
      )
    )
    on conflict do nothing;
  end loop;

  return new;
exception when others then
  return new;
end;
$$;

alter function app_private.enqueue_coach_mobile_parent_portal_invites() owner to postgres;
revoke all on function app_private.enqueue_coach_mobile_parent_portal_invites()
from public, anon, authenticated;

drop trigger if exists zz_players_enqueue_coach_mobile_parent_portal_invites
on public.players;

create trigger zz_players_enqueue_coach_mobile_parent_portal_invites
after insert on public.players
for each row execute function app_private.enqueue_coach_mobile_parent_portal_invites();

alter table public.players
disable trigger zz_players_enqueue_coach_mobile_parent_portal_invites;

comment on function app_private.enqueue_coach_mobile_parent_portal_invites() is
  'Creates one Parent Portal invitation and retryable email job for each valid parent contact when Coach mobile creates an eligible Squad Player. Release migration installs this trigger disabled until the compatible worker is live.';

commit;
