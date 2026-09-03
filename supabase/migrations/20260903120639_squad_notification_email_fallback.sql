-- One durable receipt per recipient and saved squad decision, delivered by app or email.
-- Parents can record Full time. Final conclusion remains a coach or manager action.
do $$
declare definition text; marker text := '  if not is_staff_actor and not is_scorer_actor then';
begin
  definition := pg_get_functiondef('public.set_match_day_timer_state(uuid,text)'::regprocedure);
  if position(marker in definition)=0 then raise exception 'Match timer authority definition changed; review before applying.'; end if;
  definition := replace(definition,marker,E'  if normalized_action = ''conclude'' and not is_staff_actor then\n    raise exception ''Only a coach or manager can conclude the game.'';\n  end if;\n\n' || marker);
  execute definition;
end;
$$;

alter table public.match_day_squad_notifications
  alter column parent_link_id drop not null,
  add column delivery_channel text not null default 'app' check (delivery_channel in ('app','email')),
  add column recipient_email text,
  add column recipient_key text;
update public.match_day_squad_notifications set recipient_key='link:' || parent_link_id::text;
alter table public.match_day_squad_notifications alter column recipient_key set not null;
create unique index match_day_squad_notifications_recipient_revision
  on public.match_day_squad_notifications(decision_id,decision_revision,recipient_key);

-- This helper is private. Mobile callers receive counts only, never recipient addresses.
create or replace function private.squad_notification_recipients(club_id_value uuid,team_id_value uuid,player_id_value uuid)
returns table(recipient_key text,parent_link_id uuid,auth_user_id uuid,recipient_email text,delivery_channel text,has_contact boolean)
language sql stable security definer set search_path = '' as $$
  with current_player as (
    select p.id from public.players p where p.id=player_id_value and p.club_id=club_id_value
      and p.team_id=team_id_value and coalesce(p.status,'active')<>'archived' and p.archived_at is null
      and exists(select 1 from public.player_team_memberships m where m.player_id=p.id and m.club_id=club_id_value
        and m.team_id=team_id_value and m.status='active' and m.ended_at is null)
  ), linked as (
    select l.id as parent_link_id,l.auth_user_id,
      lower(btrim(case when l.auth_user_id is not null then coalesce(a.email,'') else coalesce(l.email,'') end)) as email,
      (l.guardian_id is null or coalesce(l.receives_communications,true)) as communication_allowed,
      (l.auth_user_id is null or (a.id is not null and a.deleted_at is null
        and (a.banned_until is null or a.banned_until<=now())
        and not exists(select 1 from public.users u where u.id=l.auth_user_id and coalesce(u.status,'active')<>'active'))) as account_allowed,
      exists(select 1 from public.parent_mobile_app_installations i where i.auth_user_id=l.auth_user_id) as installed,
      coalesce(p.communication_channel,'both') as preference
    from current_player cp join public.parent_player_links l on l.player_id=cp.id
      and l.club_id=club_id_value and l.team_id=team_id_value and l.link_type='parent' and l.status='active'
    left join auth.users a on a.id=l.auth_user_id
    left join public.parent_communication_preferences p on p.auth_user_id=l.auth_user_id
  ), configured as (
    select null::uuid as parent_link_id,a.id as auth_user_id,r.recipient_email as email,
      true as communication_allowed,
      (a.id is null or (a.deleted_at is null and (a.banned_until is null or a.banned_until<=now())
        and not exists(select 1 from public.users u where u.id=a.id and coalesce(u.status,'active')<>'active'))) as account_allowed,
      false as installed,coalesce(p.communication_channel,'both') as preference
    from current_player cp
    cross join lateral public.event_player_eligible_recipients(club_id_value,team_id_value,array[cp.id]) r
    left join lateral (select u.id,u.deleted_at,u.banned_until from auth.users u
      where lower(btrim(u.email))=r.recipient_email order by u.id limit 1) a on true
    left join public.parent_communication_preferences p on p.auth_user_id=a.id
    where r.recipient_type=public.canonical_calendar_invite_recipient_type('parent')
      and not exists(select 1 from public.parent_player_links l where l.player_id=cp.id
        and l.club_id=club_id_value and l.team_id=team_id_value and l.link_type='parent'
        and l.status in ('active','revoked') and (lower(btrim(coalesce(l.email,'')))=r.recipient_email
          or (a.id is not null and l.auth_user_id=a.id)))
  ), contacts as (
    select * from linked union all select * from configured
  ), channels as (
    select c.*,
      (c.email ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$' or (c.parent_link_id is not null and c.auth_user_id is not null and c.installed)) as has_contact,
      case when not c.communication_allowed or not c.account_allowed then null
        when c.parent_link_id is not null and c.auth_user_id is not null and c.installed and c.preference in ('app','both') then 'app'
        when c.email ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$' and c.preference in ('email','both') then 'email'
        else null end as channel
    from contacts c
  ), recipients as (
    select distinct on (coalesce(c.auth_user_id::text,nullif(c.email,''),c.parent_link_id::text)) c.*
    from channels c
    order by coalesce(c.auth_user_id::text,nullif(c.email,''),c.parent_link_id::text),
      (c.channel is not null) desc,c.parent_link_id nulls last,c.email
  )
  select case when r.channel='app' then 'link:' || r.parent_link_id::text else 'email:' || r.email end,
    r.parent_link_id,r.auth_user_id,r.email,r.channel,r.has_contact
  from recipients r;
$$;
revoke all on function private.squad_notification_recipients(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.squad_notification_recipients(uuid,uuid,uuid) to service_role;

create or replace function public.get_match_day_squad_notification_contacts(match_id uuid)
returns table(player_id uuid,can_notify boolean,has_contact boolean,app_recipient_count integer,email_recipient_count integer)
language plpgsql stable security definer set search_path = '' as $$
declare fixture public.match_days%rowtype; actor uuid := (select auth.uid());
begin
  select * into fixture from public.match_days where id=match_id and deleted_at is null and previous_hidden_at is null;
  if actor is null or fixture.id is null or public.can_manage_match_day(fixture.team_id) is not true
    or not exists(select 1 from public.users u where u.id=actor and u.club_id=fixture.club_id
      and coalesce(u.status,'active')='active' and u.role not in ('parent_portal','adult_player','super_admin') and u.role_rank>=20)
    then raise exception 'Coach access to this fixture is required.'; end if;
  return query
    select p.id,coalesce(bool_or(r.delivery_channel is not null),false),coalesce(bool_or(r.has_contact),false),
      count(*) filter(where r.delivery_channel='app')::integer,count(*) filter(where r.delivery_channel='email')::integer
    from public.players p
    left join lateral private.squad_notification_recipients(fixture.club_id,fixture.team_id,p.id) r on true
    where p.club_id=fixture.club_id and p.team_id=fixture.team_id and coalesce(p.status,'active')<>'archived'
      and p.archived_at is null
    group by p.id;
end;
$$;
revoke all on function public.get_match_day_squad_notification_contacts(uuid) from public,anon;
grant execute on function public.get_match_day_squad_notification_contacts(uuid) to authenticated;

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
    select * from private.squad_notification_recipients(fixture.club_id,fixture.team_id,player.id)
    where delivery_channel is not null
  loop
    insert into public.match_day_squad_notifications(decision_id,decision_revision,parent_link_id,notified_by,title,body,delivery_channel,recipient_email,recipient_key)
      values(decision.id,decision.decision_revision,recipient.parent_link_id,actor,'Squad update',copy_body,recipient.delivery_channel,recipient.recipient_email,recipient.recipient_key)
      on conflict do nothing returning id into notification_id;
    if notification_id is not null then
      if recipient.delivery_channel='app' then
      insert into public.parent_mobile_notification_events(auth_user_id,parent_link_id,club_id,team_id,intent_type,title,body,data,status,sent_at,created_at,read_at,dedupe_key)
      values(recipient.auth_user_id,recipient.parent_link_id,fixture.club_id,fixture.team_id,'matchday_update','Squad update',copy_body,
        jsonb_build_object('app','parent','route','matchday','type','matchday_update','subtype','squad_decision',
          'matchDayId',fixture.id,'playerId',player.id,'parentLinkId',recipient.parent_link_id,'clubId',fixture.club_id,'teamId',fixture.team_id,
          'squadDecision',decision.status,'decisionRevision',decision.decision_revision),
        'sent',sent_time,sent_time,null,'matchday_update:' || recipient.parent_link_id || ':' || fixture.id)
      on conflict(dedupe_key) do update set title=excluded.title,body=excluded.body,data=excluded.data,
        status='sent',sent_at=excluded.sent_at,created_at=excluded.created_at,read_at=null;
      end if;
      notification_ids := notification_ids || jsonb_build_array(notification_id);
    end if;
  end loop;
  if jsonb_array_length(notification_ids)=0 then
    if not exists(select 1 from private.squad_notification_recipients(fixture.club_id,fixture.team_id,player.id) r where r.has_contact) then
      raise exception 'No contact details for this player. Add a parent email or linked app account first.';
    end if;
    raise exception 'Notifications are switched off or unavailable for this player''s contacts.';
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

-- Recheck current access and delivery preferences at claim time. Never send stale recipients.
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
  if not exists(select 1 from public.match_days m where m.id=decision.match_day_id and m.deleted_at is null
    and m.previous_hidden_at is null and m.parent_visible and m.concluded_at is null and m.status in ('scheduled','scorer_request')
    and exists(select 1 from public.clubs c where c.id=m.club_id and c.status='active')
    and exists(select 1 from public.teams t where t.id=m.team_id and t.status='active')) then
      update public.match_day_squad_notifications set push_finished_at=clock_timestamp(),push_error='Fixture access changed' where id=receipt.id;
      return null; end if;
  if not exists(select 1 from private.squad_notification_recipients(decision.club_id,decision.team_id,decision.player_id) r
    where r.recipient_key=receipt.recipient_key and r.delivery_channel=receipt.delivery_channel
      and (receipt.delivery_channel='app' or r.recipient_email=receipt.recipient_email)) then
      update public.match_day_squad_notifications set push_finished_at=clock_timestamp(),push_error='Parent contact or preferences changed' where id=receipt.id;
      return null; end if;
  update public.match_day_squad_notifications set push_claimed_at=clock_timestamp(),push_attempts=push_attempts+1 where id=receipt.id;
  return to_jsonb(receipt) || jsonb_build_object('match_day_id',decision.match_day_id);
end;
$$;
revoke all on function public.claim_squad_notification_push(uuid) from public,anon,authenticated;
grant execute on function public.claim_squad_notification_push(uuid) to service_role;

