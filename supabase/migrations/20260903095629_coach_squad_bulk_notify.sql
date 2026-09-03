-- Legacy links default to receives_communications=false. Only guardian-backed contacts make that an explicit preference.
-- Keep app channel preferences, active links and all fixture authority checks.
-- Saving a decision never sends a message. Only this explicit coach action does.
create or replace function public.notify_match_day_squad_decision(
  match_id uuid, player_id_value uuid, expected_revision uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  fixture public.match_days%rowtype;
  decision public.match_day_player_squad_decisions%rowtype;
  player public.players%rowtype;
  recipient record;
  notification_id uuid;
  notification_ids jsonb := '[]'::jsonb;
  copy_body text;
  fixture_label text;
  sent_time timestamptz := clock_timestamp();
  actor uuid := (select auth.uid());
begin
  if actor is null then raise exception 'Login is required.'; end if;
  select * into fixture from public.match_days where id = match_id;
  if fixture.id is null or fixture.team_id is null or public.can_manage_match_day(fixture.team_id) is not true
    or not exists(select 1 from public.users u where u.id=actor and u.club_id=fixture.club_id
      and coalesce(u.status,'active')='active' and u.role not in ('parent_portal','adult_player','super_admin') and u.role_rank>=20)
    then raise exception 'Coach access to this fixture is required.'; end if;
  if fixture.deleted_at is not null or fixture.previous_hidden_at is not null or fixture.concluded_at is not null
    or fixture.status not in ('scheduled','scorer_request') then raise exception 'Squad notifications are closed for this fixture.'; end if;
  if fixture.parent_visible is not true then raise exception 'Share this fixture with parents before notifying them.'; end if;
  if not exists(select 1 from public.clubs c where c.id=fixture.club_id and coalesce(c.status,'active')='active')
    or not exists(select 1 from public.teams t where t.id=fixture.team_id and coalesce(t.status,'active')='active')
    then raise exception 'This team is not active.'; end if;
  select * into player from public.players where id=player_id_value and club_id=fixture.club_id
    and team_id=fixture.team_id and coalesce(status,'active')<>'archived';
  if player.id is null then raise exception 'Choose a current player from this fixture team.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(concat(match_id::text, ':', player_id_value::text),0));
  select * into decision from public.match_day_player_squad_decisions
    where match_day_id=match_id and player_id=player_id_value for update;
  if decision.id is null or decision.status not in ('selected','not_selected') then
    raise exception 'Choose Selected or Not selected before notifying the parent.'; end if;
  if expected_revision is distinct from decision.decision_revision then
    raise exception 'The squad decision has changed. Refresh before notifying the parent.'; end if;
  if decision.notified_at is not null then
    return jsonb_build_object('sent',true,'alreadySent',true,'revision',decision.decision_revision,'notificationIds','[]'::jsonb);
  end if;
  fixture_label := 'the match against ' || fixture.opponent || ' on ' || to_char(fixture.match_date,'Dy FMDD Mon');
  copy_body := case when decision.status='selected'
    then player.player_name || ' is in the squad for ' || fixture_label || '. We look forward to seeing you.'
    else player.player_name || ' has not been selected for ' || fixture_label || ' this time. Thank you for your support.' end;
  for recipient in
    select distinct on (l.auth_user_id) l.id,l.auth_user_id
    from public.parent_player_links l
    left join public.parent_communication_preferences p on p.auth_user_id=l.auth_user_id
    where l.player_id=player.id and l.club_id=fixture.club_id and l.team_id=fixture.team_id
      and l.status='active' and l.auth_user_id is not null and (l.guardian_id is null or coalesce(l.receives_communications,true))
      and coalesce(p.communication_channel,'both') in ('app','both')
      and not exists(select 1 from public.users u where u.id=l.auth_user_id and u.status='suspended')
    order by l.auth_user_id,l.id
  loop
    insert into public.match_day_squad_notifications(decision_id,decision_revision,parent_link_id,notified_by,title,body)
      values(decision.id,decision.decision_revision,recipient.id,actor,'Squad update',copy_body)
      on conflict do nothing returning id into notification_id;
    if notification_id is not null then
      insert into public.parent_mobile_notification_events(auth_user_id,parent_link_id,club_id,team_id,intent_type,title,body,data,status,sent_at,created_at,read_at,dedupe_key)
      values(recipient.auth_user_id,recipient.id,fixture.club_id,fixture.team_id,'matchday_update','Squad update',copy_body,
        jsonb_build_object('app','parent','route','matchday','type','matchday_update','subtype','squad_decision',
          'matchDayId',fixture.id,'playerId',player.id,'parentLinkId',recipient.id,'clubId',fixture.club_id,'teamId',fixture.team_id,
          'squadDecision',decision.status,'decisionRevision',decision.decision_revision),
        'sent',sent_time,sent_time,null,'matchday_update:' || recipient.id || ':' || fixture.id)
      on conflict(dedupe_key) do update set title=excluded.title,body=excluded.body,data=excluded.data,
        status='sent',sent_at=excluded.sent_at,created_at=excluded.created_at,read_at=null;
      notification_ids := notification_ids || jsonb_build_array(notification_id);
    end if;
  end loop;
  if jsonb_array_length(notification_ids)=0 then
    if not exists(select 1 from public.parent_player_links l where l.player_id=player.id and l.club_id=fixture.club_id and l.team_id=fixture.team_id and l.status='active' and l.auth_user_id is not null) then raise exception 'No active parent app account is linked to this player.'; end if;
    raise exception 'App notifications are switched off for this player''s linked parents.';
  end if;
  update public.match_day_player_squad_decisions set notified_at=sent_time where id=decision.id;
  insert into public.match_day_event_log(club_id,team_id,match_day_id,player_id,actor_user_id,event_type,event_label,new_value,metadata)
    values(fixture.club_id,fixture.team_id,fixture.id,player.id,actor,'player_selection_notification_queued','Parent notified of squad decision',
      jsonb_build_object('status',decision.status),jsonb_build_object('decisionRevision',decision.decision_revision,'recipients',jsonb_array_length(notification_ids)));
  return jsonb_build_object('sent',true,'revision',decision.decision_revision,'notificationIds',notification_ids);
end;
$$;
revoke all on function public.notify_match_day_squad_decision(uuid,uuid,uuid) from public,anon;
grant execute on function public.notify_match_day_squad_decision(uuid,uuid,uuid) to authenticated;

-- Concurrent phone deliveries share one lease; obsolete decisions are retired.
create or replace function public.claim_squad_notification_push(notification_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare receipt public.match_day_squad_notifications%rowtype; decision public.match_day_player_squad_decisions%rowtype;
begin
  select * into receipt from public.match_day_squad_notifications where id=notification_id for update;
  if receipt.id is null or receipt.push_finished_at is not null or receipt.push_attempts>=5
    or receipt.push_claimed_at>clock_timestamp()-interval '2 minutes' then return null; end if;
  select * into decision from public.match_day_player_squad_decisions where id=receipt.decision_id;
  if decision.decision_revision is distinct from receipt.decision_revision or decision.notified_at is null then
    update public.match_day_squad_notifications set push_finished_at=clock_timestamp(),push_error='Decision superseded' where id=receipt.id;
    return null; end if;
  if not exists(select 1 from public.parent_player_links l where l.id=receipt.parent_link_id
    and l.status='active' and l.player_id=decision.player_id and l.team_id=decision.team_id and l.club_id=decision.club_id
    and l.auth_user_id is not null and (l.guardian_id is null or coalesce(l.receives_communications,true))
    and not exists(select 1 from public.users u where u.id=l.auth_user_id and u.status='suspended')) then
      update public.match_day_squad_notifications set push_finished_at=clock_timestamp(),push_error='Parent access changed' where id=receipt.id;
      return null; end if;
  if not exists(select 1 from public.match_days m where m.id=decision.match_day_id and m.deleted_at is null
    and m.previous_hidden_at is null and m.parent_visible and m.status in ('scheduled','scorer_request')
    and exists(select 1 from public.clubs c where c.id=m.club_id and c.status='active')
    and exists(select 1 from public.teams t where t.id=m.team_id and t.status='active')) then
      update public.match_day_squad_notifications set push_finished_at=clock_timestamp(),push_error='Fixture access changed' where id=receipt.id;
      return null; end if;
  update public.match_day_squad_notifications set push_claimed_at=clock_timestamp(),push_attempts=push_attempts+1 where id=receipt.id;
  return to_jsonb(receipt) || jsonb_build_object('match_day_id',decision.match_day_id);
end;
$$;
revoke all on function public.claim_squad_notification_push(uuid) from public,anon,authenticated;
grant execute on function public.claim_squad_notification_push(uuid) to service_role;

-- Each chosen player keeps a separate result. Locks use a stable order across batches.
create or replace function public.notify_match_day_squad_decisions(match_id uuid, decisions jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare item jsonb; outcome jsonb; results jsonb := '[]'::jsonb; notification_ids jsonb := '[]'::jsonb;
begin
  if (select auth.uid()) is null then raise exception 'Login is required.'; end if;
  if jsonb_typeof(decisions) is distinct from 'array' then raise exception 'Choose players to notify.'; end if;
  if jsonb_array_length(decisions) < 1 or jsonb_array_length(decisions) > 100 then
    raise exception 'Choose between 1 and 100 players to notify.'; end if;
  if exists(select 1 from jsonb_array_elements(decisions) d where
    coalesce(d->>'playerId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(d->>'revision','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
      raise exception 'Choose saved squad decisions before notifying parents.'; end if;
  if (select count(distinct (d->>'playerId')::uuid) from jsonb_array_elements(decisions) d) <> jsonb_array_length(decisions) then
    raise exception 'Choose each player only once.'; end if;
  for item in select value from jsonb_array_elements(decisions) order by value->>'playerId' loop
    begin
      outcome := public.notify_match_day_squad_decision(match_id,(item->>'playerId')::uuid,(item->>'revision')::uuid);
      notification_ids := notification_ids || coalesce(outcome->'notificationIds','[]'::jsonb);
      results := results || jsonb_build_array((outcome - 'notificationIds') || jsonb_build_object('playerId',item->>'playerId'));
    exception when sqlstate 'P0001' then
      results := results || jsonb_build_array(jsonb_build_object('playerId',item->>'playerId','revision',item->>'revision','sent',false,'message',sqlerrm));
    end;
  end loop;
  return jsonb_build_object('results',results,'notificationIds',notification_ids);
end;
$$;
revoke all on function public.notify_match_day_squad_decisions(uuid,jsonb) from public,anon;
grant execute on function public.notify_match_day_squad_decisions(uuid,jsonb) to authenticated;


-- Include current linked Parent accounts even when their email is absent from the Player contact snapshot.
create or replace function app_private.get_team_parent_app_installation_status_internal(team_id_value uuid)
returns table (
  player_id uuid,
  parent_contact_count integer,
  installed_contact_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (
    select
      auth.uid() as user_id,
      public.current_user_club_id() as club_id,
      public.current_user_role() as role,
      public.current_user_role_rank() as role_rank
  ),
  authorized_players as (
    select
      player.id,
      player.club_id,
      player.parent_contacts,
      player.parent_email,
      player.contact_type
    from actor
    join public.teams team
      on team.id = team_id_value
     and team.club_id = actor.club_id
    join public.player_team_memberships membership
      on membership.team_id = team.id
     and membership.club_id = team.club_id
     and membership.status = 'active'
    join public.players player
      on player.id = membership.player_id
     and player.club_id = membership.club_id
     and coalesce(player.status, 'active') <> 'archived'
     and player.archived_at is null
    where actor.user_id is not null
      and actor.role <> 'super_admin'
      and actor.role_rank >= 20
      and (
        actor.role = 'admin'
        or exists (
          select 1
          from public.team_staff assignment
          where assignment.team_id = team.id
            and assignment.user_id = actor.user_id
        )
      )
  ),
  configured_contacts as (
    select
      player.id as player_id,
      player.club_id,
      pg_catalog.lower(pg_catalog.btrim(coalesce(contact.value ->> 'email', contact.value ->> 'parentEmail', ''))) as email
    from authorized_players player
    cross join lateral pg_catalog.jsonb_array_elements(
      case
        when pg_catalog.jsonb_typeof(coalesce(player.parent_contacts, '[]'::jsonb)) = 'array'
          then coalesce(player.parent_contacts, '[]'::jsonb)
        else '[]'::jsonb
      end
    ) contact(value)
    where pg_catalog.lower(pg_catalog.btrim(coalesce(contact.value ->> 'type', contact.value ->> 'contactType', 'parent'))) <> 'self'
      and pg_catalog.btrim(coalesce(contact.value ->> 'email', contact.value ->> 'parentEmail', ''))
        ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
  ),
  fallback_contacts as (
    select
      player.id as player_id,
      player.club_id,
      pg_catalog.lower(pg_catalog.btrim(coalesce(player.parent_email, ''))) as email
    from authorized_players player
    where pg_catalog.lower(pg_catalog.btrim(coalesce(player.contact_type, 'parent'))) <> 'self'
      and pg_catalog.btrim(coalesce(player.parent_email, ''))
        ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
  ),
  contacts as (
    select distinct contact.player_id, contact.club_id, contact.email
    from (
      select * from configured_contacts
      union all
      select * from fallback_contacts
      union all
      select player.id, player.club_id, pg_catalog.lower(pg_catalog.btrim(link.email))
      from authorized_players player
      join public.parent_player_links link
        on link.player_id=player.id and link.club_id=player.club_id and link.team_id=team_id_value
       and link.link_type='parent' and link.status='active'
      where pg_catalog.btrim(coalesce(link.email,'')) ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
    ) contact
    where contact.email <> ''
  ),
  contact_installation as (
    select
      contact.player_id,
      coalesce(link.auth_user_id::text,contact.email) as contact_key,
      pg_catalog.bool_or(exists (
        select 1
        from public.parent_mobile_app_installations installation
        where installation.auth_user_id = link.auth_user_id
      )) as installed
    from contacts contact
    left join public.parent_player_links link
      on link.club_id=contact.club_id and link.team_id=team_id_value and link.player_id=contact.player_id
     and link.link_type='parent' and link.status='active' and link.auth_user_id is not null
     and pg_catalog.lower(pg_catalog.btrim(coalesce(link.email,'')))=contact.email
    group by contact.player_id,coalesce(link.auth_user_id::text,contact.email)
  )
  select
    player.id as player_id,
    pg_catalog.count(installation.contact_key)::integer as parent_contact_count,
    pg_catalog.count(installation.contact_key) filter (where installation.installed)::integer
      as installed_contact_count
  from authorized_players player
  left join contact_installation installation
    on installation.player_id = player.id
  group by player.id;
$$;


