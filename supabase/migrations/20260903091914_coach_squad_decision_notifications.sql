alter table public.match_day_player_squad_decisions
  add column decision_revision uuid not null default gen_random_uuid(),
  add column notified_at timestamptz;

create or replace function private.reset_squad_decision_notification()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    new.decision_revision := gen_random_uuid();
    new.notified_at := null;
  end if;
  return new;
end;
$$;
revoke all on function private.reset_squad_decision_notification() from public, anon, authenticated;
create trigger reset_squad_decision_notification before update on public.match_day_player_squad_decisions
for each row execute function private.reset_squad_decision_notification();

create table public.match_day_squad_notifications (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.match_day_player_squad_decisions(id) on delete cascade,
  decision_revision uuid not null,
  parent_link_id uuid not null references public.parent_player_links(id) on delete cascade,
  notified_by uuid references auth.users(id) on delete set null,
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  push_claimed_at timestamptz,
  push_finished_at timestamptz,
  push_attempts integer not null default 0,
  push_error text,
  unique(decision_id, decision_revision, parent_link_id)
);
alter table public.match_day_squad_notifications enable row level security;
revoke all on public.match_day_squad_notifications from public, anon, authenticated;
grant all on public.match_day_squad_notifications to service_role;
create index match_day_squad_notifications_pending on public.match_day_squad_notifications(created_at)
  where push_finished_at is null and push_attempts<5;
create index match_day_squad_notifications_parent on public.match_day_squad_notifications(parent_link_id);

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
      and l.status='active' and l.auth_user_id is not null and coalesce(l.receives_communications,true)
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
    raise exception 'No linked parent can receive app notifications for this player. Check their account and communication preferences.';
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
    and l.auth_user_id is not null and coalesce(l.receives_communications,true)
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
