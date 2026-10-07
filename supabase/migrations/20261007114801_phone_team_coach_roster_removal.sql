-- BEGIN PHONE TEAM COACH ROSTER REMOVAL
-- Removes one selected-team assignment only. Accounts and other team access remain.
create function public.manage_phone_team_coaches(actor_value uuid, team_value uuid,
  action_value text, assignment_value uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  selected_team public.teams%rowtype;
  selected_staff public.team_staff%rowtype;
  removed_value boolean := false;
  coaches_value jsonb;
begin
  if actor_value is null or team_value is null or action_value is null
    or action_value not in ('read','remove')
    or (action_value='remove' and assignment_value is null)
    or (action_value='read' and assignment_value is not null) then
    raise exception 'Invalid team coach request.' using errcode='22023';
  end if;
  -- Hold authority rows until commit, then check the canonical fresh team boundary.
  perform 1 from public.teams t join public.clubs c on c.id=t.club_id
    where t.id=team_value for share of t,c;
  perform 1 from public.users u where u.id=actor_value for share;
  perform 1 from auth.users au where au.id=actor_value for share;
  perform 1 from public.user_club_memberships m
    join public.teams t on t.club_id=m.club_id
    where t.id=team_value and m.auth_user_id=actor_value for share of m;
  perform 1 from public.team_staff s
    where s.team_id=team_value and s.user_id=actor_value for share;
  if not app_private.team_admin_can_manage(actor_value,team_value) then
    raise exception 'Only the team admin can manage coaches.' using errcode='42501';
  end if;
  select * into selected_team from public.teams where id=team_value;
  if action_value='remove' then
    select * into selected_staff from public.team_staff
      where id=assignment_value and team_id=team_value for update;
    if selected_staff.id is not null then
      if selected_staff.user_id=actor_value or selected_staff.role_key is null or selected_staff.role_rank is null
        or selected_staff.role_key not in ('coach','assistant_coach') or selected_staff.role_rank not in (20,30) then
        raise exception 'Only coach or assistant coach access can be removed here.' using errcode='42501';
      end if;
      perform 1 from public.users u where u.id=selected_staff.user_id
        and u.club_id=selected_team.club_id for share;
      if not found then
        raise exception 'Coach access must belong to the selected club.' using errcode='42501';
      end if;
      if exists(select 1 from public.users u where u.id=selected_staff.user_id
        and (u.role in ('admin','super_admin') or u.role_rank>=90)) then
        raise exception 'Club admin access cannot be changed here.' using errcode='42501';
      end if;
      delete from public.team_staff where id=selected_staff.id and team_id=selected_team.id;
      removed_value := true;
    end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'userId',s.user_id,'role',s.role_key,
    'roleLabel',case when u.role in ('admin','super_admin') or u.role_rank>=90 then 'Club admin' else s.role_label end,
    'accessNote',case when u.role in ('admin','super_admin') or u.role_rank>=90 then 'Club admin access is managed by the club.' else null end,
    'name',coalesce(nullif(btrim(to_jsonb(u)->>'display_name'),''),nullif(btrim(to_jsonb(u)->>'name'),''),u.email,'Coach'),
    'email',u.email,'canRemove',s.user_id<>actor_value and u.role not in ('admin','super_admin') and u.role_rank<90
  ) order by lower(coalesce(u.email,'')),s.id),'[]'::jsonb)
    into coaches_value
    from public.team_staff s join public.users u on u.id=s.user_id and u.club_id=selected_team.club_id
    where s.team_id=selected_team.id and s.role_key in ('coach','assistant_coach') and s.role_rank in (20,30);
  return jsonb_build_object('teamId',selected_team.id,'clubId',selected_team.club_id,
    'canManage',true,'coaches',coaches_value,'removed',removed_value);
end;
$$;
revoke all on function public.manage_phone_team_coaches(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.manage_phone_team_coaches(uuid,uuid,text,uuid) to service_role;
-- END PHONE TEAM COACH ROSTER REMOVAL

-- BEGIN PHONE RESOURCE UPLOAD AUTHORITY
-- Preserve the existing manager boundary and recognise an actual selected-team admin.
-- Normalize the earlier private helper owner without widening its execution grants.
alter function app_private.team_admin_can_manage(uuid,uuid) owner to postgres;
create or replace function public.current_user_can_manage_resource_library(target_club_id uuid, target_team_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and public.current_user_club_id() = target_club_id
    and public.current_user_role() not in ('parent_portal', 'super_admin')
    and target_team_id is not null
    and public.can_use_plan_feature(target_club_id, 'resourceLibrary')
    and public.resource_library_user_can_access_team(auth.uid(), target_team_id, target_club_id)
    and (public.current_user_role_rank() >= 50
      or app_private.team_admin_can_manage(auth.uid(), target_team_id));
$$;
alter function public.current_user_can_manage_resource_library(uuid,uuid) owner to postgres;
revoke all on function public.current_user_can_manage_resource_library(uuid,uuid) from public, anon;
grant execute on function public.current_user_can_manage_resource_library(uuid,uuid) to authenticated, service_role;

-- This RPC derives the upload presentation role from fresh server records, never URL claims.
create function public.get_phone_resource_upload_scope(target_club_id uuid, target_team_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare actor public.users%rowtype; assignment public.team_staff%rowtype;
  scoped_role text; scoped_rank integer; scoped_label text;
begin
  if not coalesce(public.current_user_can_manage_resource_library(target_club_id,target_team_id),false) then
    raise exception 'You do not have resource upload access to this team.' using errcode='42501';
  end if;
  select u.* into actor from public.users u
  join auth.users au on au.id=u.id and au.email_confirmed_at is not null
    and (au.banned_until is null or au.banned_until<=now())
  join public.user_club_memberships m on m.auth_user_id=u.id and m.club_id=u.club_id
    and m.role=u.role and m.role_rank=u.role_rank
  join public.clubs c on c.id=u.club_id and coalesce(c.status,'active')='active' and c.archived_at is null
  join public.teams t on t.id=target_team_id and t.club_id=c.id
    and coalesce(t.status,'active')='active' and t.archived_at is null
  where u.id=auth.uid() and u.club_id=target_club_id and u.status='active';
  if actor.id is null then
    raise exception 'Active access to this team is required.' using errcode='42501';
  end if;
  scoped_role:=actor.role; scoped_rank:=actor.role_rank; scoped_label:=actor.role_label;
  if actor.role_rank<50 then
    select s.* into assignment from public.team_staff s
      where s.user_id=actor.id and s.team_id=target_team_id
        and s.role_key='head_manager' and s.role_rank>=70
      order by s.id limit 1;
    if assignment.id is null or not app_private.team_admin_can_manage(actor.id,target_team_id) then
      raise exception 'Active team admin access is required.' using errcode='42501';
    end if;
    scoped_role:=assignment.role_key; scoped_rank:=assignment.role_rank; scoped_label:=assignment.role_label;
  end if;
  return jsonb_build_object('actorId',actor.id,'clubId',target_club_id,'teamId',target_team_id,
    'role',scoped_role,'roleRank',scoped_rank,'roleLabel',scoped_label);
end;
$$;
alter function public.get_phone_resource_upload_scope(uuid,uuid) owner to postgres;
revoke all on function public.get_phone_resource_upload_scope(uuid,uuid) from public, anon;
grant execute on function public.get_phone_resource_upload_scope(uuid,uuid) to authenticated, service_role;
-- END PHONE RESOURCE UPLOAD AUTHORITY

-- BEGIN COACH ASSESSMENT PARENT NOTIFICATIONS
create table app_private.coach_assessment_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete cascade,
  evaluation_id uuid not null references public.evaluations(id) on delete cascade,
  parent_link_id uuid not null references public.parent_player_links(id) on delete cascade,
  installation_id uuid not null references public.parent_mobile_push_installations(installation_id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  claimed_token text not null,
  inbox_event_id bigint references public.parent_mobile_notification_events(id) on delete set null,
  lease_id uuid, leased_until timestamptz, attempts integer not null default 0,
  completed_at timestamptz, outcome text,
  unique(evaluation_id,parent_link_id,installation_id)
);
alter table app_private.coach_assessment_notification_deliveries owner to postgres;
alter table app_private.coach_assessment_notification_deliveries enable row level security;
alter table app_private.coach_assessment_notification_deliveries force row level security;
revoke all on app_private.coach_assessment_notification_deliveries from public,anon,authenticated,service_role;

create function app_private.coach_assessment_parent_is_current(actor_value uuid,evaluation_value uuid,link_value uuid)
returns boolean language sql security definer set search_path = '' as $$
  select exists (
    select 1 from public.evaluations e
    join public.development_parent_reports r on r.evaluation_id=e.id and r.club_id=e.club_id and r.finalized_by=actor_value
    join public.clubs c on c.id=e.club_id and coalesce(c.status,'active')='active' and c.archived_at is null
    join public.teams t on t.id=e.team_id and t.club_id=c.id and coalesce(t.status,'active')='active' and t.archived_at is null
    join public.players p on p.id=e.player_id and p.club_id=e.club_id and p.team_id=e.team_id and coalesce(p.status,'active')='active'
    join auth.users actor on actor.id=actor_value and actor.email_confirmed_at is not null
      and (actor.banned_until is null or actor.banned_until<=now())
    join public.parent_player_links l on l.id=link_value and l.player_id=p.id and l.club_id=c.id
      and (l.team_id is null or l.team_id=t.id) and l.link_type='parent' and l.status='active'
      and coalesce(l.receives_communications,true)
    join auth.users recipient on recipient.id=l.auth_user_id and recipient.email_confirmed_at is not null
      and (recipient.banned_until is null or recipient.banned_until<=now())
    join public.users parent_profile on parent_profile.id=recipient.id and parent_profile.status='active'
    left join public.parent_communication_preferences preference on preference.auth_user_id=recipient.id
    where e.id=evaluation_value and e.status='Submitted' and e.coach_id=actor_value
      and app_private.actor_can_manage_team_resource(actor_value,e.club_id,e.team_id,20)
      and public.is_club_plan_access_active(e.club_id) and public.can_use_plan_feature(e.club_id,'assessments')
      and coalesce(preference.communication_channel,'both') in ('app','both')
      and r.report_snapshot->>'evaluationId'=e.id::text and r.report_snapshot->'club'->>'id'=e.club_id::text
      and r.report_snapshot->'team'->>'id'=e.team_id::text and r.report_snapshot->'player'->>'id'=e.player_id::text
      and r.report_snapshot->'author'->>'id'=actor_value::text
      and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(r.report_snapshot->'recipients')='array'
        then r.report_snapshot->'recipients' else '[]'::jsonb end) item where item->>'linkId'=l.id::text)
  );
$$;
alter function app_private.coach_assessment_parent_is_current(uuid,uuid,uuid) owner to postgres;
revoke all on function app_private.coach_assessment_parent_is_current(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function app_private.coach_assessment_device_is_current(delivery_value uuid)
returns boolean language sql security definer set search_path = '' as $$
  select exists (
    select 1 from app_private.coach_assessment_notification_deliveries d
    join public.parent_player_links target on target.id=d.parent_link_id and target.auth_user_id=d.auth_user_id
    join public.parent_mobile_push_installations i on i.installation_id=d.installation_id
      and i.auth_user_id=d.auth_user_id and i.club_id=target.club_id and i.expo_push_token=d.claimed_token
      and i.enabled and i.status='active' and i.detail_level<>'off'
    join public.parent_player_links bound on bound.id=i.parent_link_id and bound.auth_user_id=d.auth_user_id
      and bound.club_id=i.club_id and bound.status='active'
    join public.players bound_player on bound_player.id=bound.player_id and bound_player.club_id=bound.club_id
      and coalesce(bound_player.status,'active')='active'
      and (bound.team_id is null or bound.team_id=bound_player.team_id)
      and (i.team_id is null or i.team_id=bound_player.team_id)
    join public.teams bound_team on bound_team.id=bound_player.team_id and bound_team.club_id=bound.club_id
      and coalesce(bound_team.status,'active')='active' and bound_team.archived_at is null
    where d.id=delivery_value and app_private.coach_assessment_parent_is_current(d.actor_id,d.evaluation_id,d.parent_link_id)
      and i.expo_push_token ~ '^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$'
  );
$$;
alter function app_private.coach_assessment_device_is_current(uuid) owner to postgres;
revoke all on function app_private.coach_assessment_device_is_current(uuid) from public,anon,authenticated,service_role;

create function public.claim_coach_assessment_notifications(actor_value uuid,evaluation_value uuid,selected_links_value uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare e public.evaluations%rowtype; r public.development_parent_reports%rowtype;
  link_value uuid; inbox_value bigint; inbox_count integer:=0; remaining_count integer;
  claimed jsonb; payload_value jsonb; club_name text; team_name text;
begin
  select * into e from public.evaluations where id=evaluation_value for key share;
  select * into r from public.development_parent_reports where evaluation_id=evaluation_value for share;
  if e.id is null or e.status<>'Submitted' or e.coach_id is distinct from actor_value
    or r.evaluation_id is null or r.finalized_by is distinct from actor_value or r.club_id is distinct from e.club_id
    or r.report_snapshot->>'evaluationId' is distinct from e.id::text
    or r.report_snapshot->'club'->>'id' is distinct from e.club_id::text
    or r.report_snapshot->'team'->>'id' is distinct from e.team_id::text
    or r.report_snapshot->'player'->>'id' is distinct from e.player_id::text
    or r.report_snapshot->'author'->>'id' is distinct from actor_value::text
    or not app_private.actor_can_manage_team_resource(actor_value,e.club_id,e.team_id,20)
    or not public.is_club_plan_access_active(e.club_id) or not public.can_use_plan_feature(e.club_id,'assessments')
    or not exists(select 1 from auth.users where id=actor_value and email_confirmed_at is not null and (banned_until is null or banned_until<=now())) then
    raise exception 'Current authority to share this saved assessment is required.' using errcode='42501';
  end if;
  if coalesce(cardinality(selected_links_value),0)=0 or cardinality(selected_links_value)>32
    or exists(select 1 from unnest(selected_links_value) selected where selected is null or not exists(
      select 1 from jsonb_array_elements(case when jsonb_typeof(r.report_snapshot->'recipients')='array'
        then r.report_snapshot->'recipients' else '[]'::jsonb end) item where item->>'linkId'=selected::text)) then
    raise exception 'Use the selected parents in the finalized assessment.' using errcode='42501';
  end if;
  select c.name,coalesce(nullif(t.notification_display_name,''),t.name) into club_name,team_name
    from public.clubs c join public.teams t on t.club_id=c.id where c.id=e.club_id and t.id=e.team_id;
  for link_value in select distinct selected from unnest(selected_links_value) selected loop
    if not app_private.coach_assessment_parent_is_current(actor_value,evaluation_value,link_value) then continue; end if;
    payload_value:=jsonb_build_object('app','parent','route','development','type','development_report','reportId',e.id,
      'notificationId',e.id,'parentLinkId',link_value,'playerId',e.player_id,'teamId',e.team_id,'clubName',club_name,'teamName',team_name);
    insert into public.parent_mobile_notification_events(auth_user_id,parent_link_id,club_id,team_id,intent_type,title,body,data,status,sent_at,dedupe_key)
    select l.auth_user_id,l.id,e.club_id,e.team_id,'parent_message',concat_ws(' | ',club_name,team_name,'Development report'),
      'A new development report is ready to view.',payload_value,'sent',now(),'parent_message:'||l.id::text||':'||e.id::text
    from public.parent_player_links l where l.id=link_value on conflict(dedupe_key) do nothing;
    select id into inbox_value from public.parent_mobile_notification_events where dedupe_key='parent_message:'||link_value::text||':'||e.id::text;
    inbox_count:=inbox_count+1;
    insert into app_private.coach_assessment_notification_deliveries(actor_id,evaluation_id,parent_link_id,installation_id,auth_user_id,claimed_token,inbox_event_id)
    select actor_value,e.id,l.id,i.installation_id,l.auth_user_id,i.expo_push_token,inbox_value
    from public.parent_player_links l join public.parent_mobile_push_installations i on i.auth_user_id=l.auth_user_id and i.club_id=l.club_id
      and i.enabled and i.status='active' and i.detail_level<>'off' and i.expo_push_token is not null
    where l.id=link_value
    on conflict(evaluation_id,parent_link_id,installation_id) do update set claimed_token=excluded.claimed_token
      where app_private.coach_assessment_notification_deliveries.completed_at is null
        and (app_private.coach_assessment_notification_deliveries.leased_until is null or app_private.coach_assessment_notification_deliveries.leased_until<now());
  end loop;
  update app_private.coach_assessment_notification_deliveries d set completed_at=now(),outcome='skipped',lease_id=null,leased_until=null
    where d.actor_id=actor_value and d.evaluation_id=e.id and d.completed_at is null
      and (d.leased_until is null or d.leased_until<now()) and not app_private.coach_assessment_device_is_current(d.id);
  with chosen as (
    select d.id from app_private.coach_assessment_notification_deliveries d
    where d.actor_id=actor_value and d.evaluation_id=e.id and d.parent_link_id=any(selected_links_value)
      and d.completed_at is null and (d.leased_until is null or d.leased_until<now())
      and app_private.coach_assessment_device_is_current(d.id)
    order by d.id for update skip locked limit 12
  ), leased as (
    update app_private.coach_assessment_notification_deliveries d set lease_id=gen_random_uuid(),leased_until=now()+interval '2 minutes',attempts=d.attempts+1
    from chosen c where d.id=c.id returning d.*
  ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'lease',lease_id,'to',claimed_token,'parentLinkId',parent_link_id,
    'teamId',e.team_id,'clubName',club_name,'teamName',team_name)), '[]'::jsonb) into claimed from leased;
  select count(*) into remaining_count from app_private.coach_assessment_notification_deliveries
    where actor_id=actor_value and evaluation_id=e.id and parent_link_id=any(selected_links_value) and completed_at is null;
  return jsonb_build_object('inboxRecipients',inbox_count,'remaining',remaining_count,'deliveries',claimed);
end;
$$;
alter function public.claim_coach_assessment_notifications(uuid,uuid,uuid[]) owner to postgres;
revoke all on function public.claim_coach_assessment_notifications(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.claim_coach_assessment_notifications(uuid,uuid,uuid[]) to service_role;

create function public.coach_assessment_notification_is_current(delivery_value uuid,lease_value uuid)
returns boolean language sql security definer set search_path = '' as $$
  select exists(select 1 from app_private.coach_assessment_notification_deliveries d where d.id=delivery_value
    and d.lease_id=lease_value and d.leased_until>now() and d.completed_at is null
    and app_private.coach_assessment_device_is_current(d.id));
$$;
alter function public.coach_assessment_notification_is_current(uuid,uuid) owner to postgres;
revoke all on function public.coach_assessment_notification_is_current(uuid,uuid) from public,anon,authenticated;
grant execute on function public.coach_assessment_notification_is_current(uuid,uuid) to service_role;

create function public.complete_coach_assessment_notification(delivery_value uuid,lease_value uuid,delivered_value boolean,invalid_value boolean default false,skipped_value boolean default false)
returns boolean language plpgsql security definer set search_path = '' as $$
declare d app_private.coach_assessment_notification_deliveries%rowtype; current_value boolean;
begin
  select * into d from app_private.coach_assessment_notification_deliveries where id=delivery_value for update;
  if d.id is null or lease_value is null or d.lease_id is distinct from lease_value
    or d.leased_until is null or d.leased_until<=now() or d.completed_at is not null
    or delivered_value is null or invalid_value is null or skipped_value is null then return false; end if;
  current_value:=app_private.coach_assessment_device_is_current(d.id);
  if invalid_value then
    update public.parent_mobile_push_installations set enabled=false,status='revoked',expo_push_token=null,updated_at=now()
      where installation_id=d.installation_id and auth_user_id=d.auth_user_id and expo_push_token=d.claimed_token;
  end if;
  update app_private.coach_assessment_notification_deliveries set
    completed_at=case when delivered_value or invalid_value or skipped_value or not current_value then now() else null end,
    outcome=case when invalid_value then 'invalid_device' when skipped_value or not current_value then 'skipped' when delivered_value then 'sent' else 'retry' end,
    lease_id=null,leased_until=null where id=d.id;
  return true;
end;
$$;
alter function public.complete_coach_assessment_notification(uuid,uuid,boolean,boolean,boolean) owner to postgres;
revoke all on function public.complete_coach_assessment_notification(uuid,uuid,boolean,boolean,boolean) from public,anon,authenticated;
grant execute on function public.complete_coach_assessment_notification(uuid,uuid,boolean,boolean,boolean) to service_role;
-- END COACH ASSESSMENT PARENT NOTIFICATIONS
