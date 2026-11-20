-- Player installations never borrow a Parent link or Parent delivery authority.
create table public.adult_player_mobile_push_installations (
  installation_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  adult_link_id uuid not null references public.adult_player_account_links(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  expo_push_token text unique,
  platform text not null check(platform in ('ios','android')),
  detail_level text not null default 'minimal' check(detail_level in ('minimal','detailed')),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  check(expo_push_token is null or (length(expo_push_token) <= 512 and expo_push_token ~ '^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$')),
  check(not enabled or expo_push_token is not null)
);
create index adult_player_mobile_push_link_idx on public.adult_player_mobile_push_installations(adult_link_id) where enabled;
alter table public.adult_player_mobile_push_installations enable row level security;
revoke all on public.adult_player_mobile_push_installations from public, anon, authenticated;
grant select, update on public.adult_player_mobile_push_installations to service_role;

-- A native token may retain both roles for the same authenticated person.
-- A different account takes ownership and revokes the previous account.
-- The transaction lock serializes Parent/Player registration of the same token.
create function app_private.fence_shared_parent_player_push_token() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.expo_push_token is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.expo_push_token, 74012));
  if tg_table_name='adult_player_mobile_push_installations' then
    update public.parent_mobile_push_installations set enabled=false,status='revoked',expo_push_token=null,
      auth_user_id=null,parent_link_id=null,club_id=null,team_id=null,updated_at=now()
      where expo_push_token=new.expo_push_token and auth_user_id is distinct from new.user_id;
  else
    delete from public.adult_player_mobile_push_installations where expo_push_token=new.expo_push_token and user_id is distinct from new.auth_user_id;
  end if;
  return new;
end; $$;
revoke all on function app_private.fence_shared_parent_player_push_token() from public,anon,authenticated,service_role;
create trigger adult_player_shared_push_token before insert or update of expo_push_token on public.adult_player_mobile_push_installations
  for each row execute function app_private.fence_shared_parent_player_push_token();
create trigger parent_shared_player_push_token before insert or update of expo_push_token on public.parent_mobile_push_installations
  for each row execute function app_private.fence_shared_parent_player_push_token();

create function public.own_adult_player_push_installation(action_value text, installation_id_value uuid,
  expected_link_id_value uuid default null, token_value text default null, platform_value text default null,
  detail_value text default 'minimal', enabled_value boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor record; device public.adult_player_mobile_push_installations; detail text;
begin
  if auth.uid() is null then raise exception 'Sign in before changing Player notifications.'; end if;
  if action_value not in ('get','register','update','delete') or installation_id_value is null then raise exception 'Invalid Player notification request.'; end if;
  select * into device from public.adult_player_mobile_push_installations where installation_id = installation_id_value for update;
  if device.user_id is not null and device.user_id <> auth.uid() then raise exception 'PARENT_MOBILE_INSTALLATION_OWNED'; end if;
  -- Sign-out revocation remains possible after a club revokes Player access.
  if action_value = 'delete' then
    delete from public.adult_player_mobile_push_installations where installation_id = installation_id_value and user_id = auth.uid();
    return jsonb_build_object('enabled',false,'registered',false);
  end if;
  select * into actor from app_private.own_adult_player_portal_context();
  if actor.link_id is null or expected_link_id_value is distinct from actor.link_id
    or not public.can_use_plan_feature(actor.club_id, 'parentPortal') then raise exception 'Verified adult Player access is required.'; end if;
  detail := case when detail_value = 'detailed' then 'detailed' else 'minimal' end;
  if action_value = 'register' then
    if platform_value not in ('ios','android') or token_value is null or length(token_value) > 512
      or token_value !~ '^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$' then raise exception 'Invalid Player push token.'; end if;
    -- A token cannot retain authority for another Player on this installation.
    delete from public.adult_player_mobile_push_installations where expo_push_token = token_value and installation_id <> installation_id_value;
    insert into public.adult_player_mobile_push_installations(installation_id,user_id,adult_link_id,club_id,team_id,expo_push_token,platform,detail_level,enabled)
      values(installation_id_value,auth.uid(),actor.link_id,actor.club_id,actor.team_id,token_value,platform_value,detail,true)
      on conflict(installation_id) do update set adult_link_id=excluded.adult_link_id,club_id=excluded.club_id,team_id=excluded.team_id,
        expo_push_token=excluded.expo_push_token,platform=excluded.platform,detail_level=excluded.detail_level,enabled=true,updated_at=now()
      where adult_player_mobile_push_installations.user_id=auth.uid()
      returning * into device;
    if device.installation_id is null then raise exception 'PARENT_MOBILE_INSTALLATION_OWNED'; end if;
  elsif action_value = 'update' then
    update public.adult_player_mobile_push_installations set detail_level=detail,enabled=enabled_value,updated_at=now()
      where installation_id=installation_id_value and user_id=auth.uid() and adult_link_id=actor.link_id
        and club_id=actor.club_id and team_id=actor.team_id and (not enabled_value or expo_push_token is not null)
      returning * into device;
    if device.installation_id is null then raise exception 'Enable Player notifications on this device first.'; end if;
  end if;
  return jsonb_build_object('enabled',coalesce(device.enabled,false) and device.adult_link_id=actor.link_id and device.team_id=actor.team_id,
    'registered',device.expo_push_token is not null and device.adult_link_id=actor.link_id and device.team_id=actor.team_id,
    'detailLevel',coalesce(device.detail_level,detail),'platform',device.platform);
end; $$;
revoke all on function public.own_adult_player_push_installation(text,uuid,uuid,text,text,text,boolean) from public,anon;
grant execute on function public.own_adult_player_push_installation(text,uuid,uuid,text,text,text,boolean) to authenticated;

create table public.adult_player_mobile_push_intents (
  id bigint generated always as identity primary key,
  installation_id uuid not null references public.adult_player_mobile_push_installations(installation_id) on delete cascade,
  kind text not null check(kind in ('chat','invitation')),
  source_id text not null,
  status text not null default 'pending' check(status in ('pending','processing','sent','failed','skipped')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  unique(installation_id,kind,source_id)
);
create index adult_player_push_intents_due_idx on public.adult_player_mobile_push_intents(available_at,id) where status in ('pending','failed','processing');
alter table public.adult_player_mobile_push_intents enable row level security;
revoke all on public.adult_player_mobile_push_intents from public,anon,authenticated;
grant select,update on public.adult_player_mobile_push_intents to service_role;

create function app_private.enqueue_adult_player_mobile_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare item jsonb := to_jsonb(new); source text; target_player uuid; target_team uuid; target_club uuid;
begin
  if tg_table_name = 'parent_chat_messages' then
    if new.deleted_at is not null then return new; end if;
    insert into public.adult_player_mobile_push_intents(installation_id,kind,source_id)
      select device.installation_id,'chat',new.id::text
      from public.adult_player_mobile_push_installations device
      join public.parent_chat_rooms room on room.id=new.room_id and room.club_id=device.club_id and room.team_id=device.team_id
      where device.enabled and device.expo_push_token is not null and device.user_id is distinct from new.sender_id
      on conflict do nothing;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    -- Responses and subsequent bookkeeping must never resend an invitation.
    if tg_table_name = 'calendar_event_invites' then
      if (new.invite_status is not distinct from old.invite_status and new.notify_requested is not distinct from old.notify_requested) or new.invite_status <> 'active' then return new; end if;
    else
      if new.status is not distinct from old.status or new.status not in ('pending','sent') then return new; end if;
    end if;
  end if;
  if tg_table_name = 'calendar_event_invites' then
    if item->>'recipient_type' not in ('player','parent_and_player') or item->>'invite_status' <> 'active' or item->>'notify_requested' <> 'true' then return new; end if;
    source := 'calendar:' || new.id;
  else
    if item->>'recipient_type' <> 'player' or item->>'parent_link_id' is not null or item->>'status' not in ('pending','sent') then return new; end if;
    source := case when tg_table_name='training_availability_request_players' then 'training:' else 'match:' end || new.id;
  end if;
  target_player := (item->>'player_id')::uuid; target_team := (item->>'team_id')::uuid; target_club := (item->>'club_id')::uuid;
  insert into public.adult_player_mobile_push_intents(installation_id,kind,source_id)
    select device.installation_id,'invitation',source
    from public.adult_player_mobile_push_installations device
    join public.adult_player_account_links link on link.id=device.adult_link_id and link.user_id=device.user_id and link.player_id=target_player
    where device.club_id=target_club and device.team_id=target_team and device.enabled and device.expo_push_token is not null
    on conflict do nothing;
  return new;
end; $$;
revoke all on function app_private.enqueue_adult_player_mobile_push() from public,anon,authenticated,service_role;
create trigger adult_player_chat_push after insert on public.parent_chat_messages for each row execute function app_private.enqueue_adult_player_mobile_push();
create trigger adult_player_calendar_push after insert or update of invite_status,notify_requested on public.calendar_event_invites for each row execute function app_private.enqueue_adult_player_mobile_push();
create trigger adult_player_training_push after insert or update of status on public.training_availability_request_players for each row execute function app_private.enqueue_adult_player_mobile_push();
create trigger adult_player_match_push after insert or update of status on public.match_day_availability_requests for each row execute function app_private.enqueue_adult_player_mobile_push();

-- This private worker helper evaluates the same authenticated Player access rules
-- as the app. Function-local claim settings restore automatically on return/error.
-- No caller can invoke it; only the service-only claim function below can use it.
create function app_private.adult_player_push_payload(device public.adult_player_mobile_push_installations, kind_value text, source_value text)
returns jsonb language plpgsql security definer set search_path = ''
set request.jwt.claim.sub = '' set request.jwt.claims = '{}' as $$
declare actor record; message_row record; invitation record; data_value jsonb; title_value text; body_value text;
begin
  perform set_config('request.jwt.claim.sub',device.user_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',device.user_id)::text,true);
  select * into actor from app_private.own_adult_player_portal_context();
  if actor.link_id is distinct from device.adult_link_id or actor.club_id is distinct from device.club_id or actor.team_id is distinct from device.team_id
    or not device.enabled or device.expo_push_token is null or not public.can_use_plan_feature(device.club_id,'parentPortal') then return null; end if;
  if kind_value = 'chat' then
    select message.*,room.team_id into message_row from public.parent_chat_messages message
      join public.parent_chat_rooms room on room.id=message.room_id
      where message.id=source_value::uuid and message.deleted_at is null and message.sender_id is distinct from device.user_id
        and message.created_at >= actor.history_cutoff;
    if message_row.id is null or not app_private.own_adult_player_chat_can_access(message_row.room_id)
      or exists(select 1 from public.adult_player_chat_preferences preference where preference.adult_link_id=device.adult_link_id
        and preference.room_id=message_row.room_id and (preference.notifications_muted or preference.last_read_at >= message_row.created_at)) then return null; end if;
    title_value := 'Football Player Chat'; body_value := 'A new Chat update is available.';
    data_value := jsonb_build_object('route','chat','roomId',message_row.room_id,'messageId',message_row.id,'type','player_chat');
  else
    if source_value like 'calendar:%' and not exists(select 1 from public.calendar_event_invites invite where invite.id=split_part(source_value,':',2)::uuid and invite.notify_requested) then return null; end if;
    select * into invitation from public.get_own_adult_player_invitation_state() where invitation_id=source_value;
    if invitation.invitation_id is null or invitation.event_start <= now()
      or (invitation.invitation_type <> 'calendar_information' and not invitation.can_respond)
      or (invitation.invitation_type = 'calendar_information' and invitation.lock_reason <> 'This event is for information. No response is required.')
      or not public.can_use_plan_feature(device.club_id,case when invitation.invitation_type='match_attendance' then 'matchDay' else 'teamCalendar' end) then return null; end if;
    title_value := 'Football Player Invitation'; body_value := 'A new invitation is ready to view.';
    data_value := jsonb_build_object('route','invites','invitationId',source_value,'type','player_invitation');
  end if;
  return jsonb_build_object('to',device.expo_push_token,'title',title_value,'body',body_value,'sound','default',
    'data',data_value || jsonb_build_object('app','player','userId',device.user_id,'adultLinkId',device.adult_link_id,'teamId',device.team_id,'clubId',device.club_id));
end; $$;
revoke all on function app_private.adult_player_push_payload(public.adult_player_mobile_push_installations,text,text) from public,anon,authenticated,service_role;

create function public.claim_adult_player_mobile_push_intents(batch_size_value integer default 50)
returns table(intent_id bigint,installation_id uuid,payload jsonb)
language plpgsql security definer set search_path = '' as $$
declare candidate record; device public.adult_player_mobile_push_installations; result jsonb;
begin
  for candidate in select intent.* from public.adult_player_mobile_push_intents intent
    where intent.attempts < 5 and intent.created_at > now()-interval '1 day' and intent.available_at <= now()
      and (intent.status in ('pending','failed') or (intent.status='processing' and intent.locked_at < now()-interval '5 minutes'))
    order by intent.id for update skip locked limit greatest(1,least(coalesce(batch_size_value,50),100))
  loop
    select * into device from public.adult_player_mobile_push_installations where adult_player_mobile_push_installations.installation_id=candidate.installation_id;
    result := app_private.adult_player_push_payload(device,candidate.kind,candidate.source_id);
    update public.adult_player_mobile_push_intents set status=case when result is null then 'skipped' else 'processing' end,
      attempts=attempts+1,locked_at=case when result is null then null else now() end where id=candidate.id;
    if result is not null then intent_id:=candidate.id; installation_id:=candidate.installation_id; payload:=result; return next; end if;
  end loop;
end; $$;
revoke all on function public.claim_adult_player_mobile_push_intents(integer) from public,anon,authenticated;
grant execute on function public.claim_adult_player_mobile_push_intents(integer) to service_role;
