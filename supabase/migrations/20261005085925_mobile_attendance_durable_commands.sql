-- Local candidate only. Requires full installed-schema and concurrency review before activation.
begin;
-- BEGIN REVIEWED ATTENDANCE COMMAND CONTRACT
-- LOCAL CONTRACT DRAFT ONLY. Not a migration; never apply or release implicitly.
-- Existing authoritative mutations remain the only answer writers called here.
-- Three revision triggers also cover legacy writers and preserve delete/reinsert ABA.
create table public.mobile_attendance_answer_revisions (
  target_key text primary key,
  revision bigint not null default 0 check (revision >= 0)
);
create table public.mobile_attendance_commands (
  command_id uuid primary key,
  actor_id uuid not null,
  route text not null,
  target jsonb not null,
  expected jsonb not null,
  response text not null,
  outcome jsonb not null,
  completed_at timestamptz not null default now()
);
alter table public.mobile_attendance_answer_revisions enable row level security;
alter table public.mobile_attendance_answer_revisions force row level security;
alter table public.mobile_attendance_commands enable row level security;
alter table public.mobile_attendance_commands force row level security;
revoke all on public.mobile_attendance_answer_revisions, public.mobile_attendance_commands from public, anon, authenticated;

create function public.mobile_attendance_revision_internal() returns trigger
language plpgsql security definer set search_path = '' as $$
declare old_key text; new_key text; target text; old_value jsonb; new_value jsonb;
begin
  if tg_op <> 'INSERT' then old_value := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then new_value := to_jsonb(new); end if;
  if tg_table_name = 'match_day_player_availability' then
    old_key := 'match:' || (old_value ->> 'match_day_id') || ':' || (old_value ->> 'player_id');
    new_key := 'match:' || (new_value ->> 'match_day_id') || ':' || (new_value ->> 'player_id');
    -- Attendance revisions exclude transport/volunteer and delivery bookkeeping.
    old_value := jsonb_build_array(old_value -> 'status', old_value -> 'selected_at', old_value -> 'selected_by_parent_link_id', old_value -> 'selected_by_request_id', old_value -> 'selected_by_name', old_value -> 'selected_by_email');
    new_value := jsonb_build_array(new_value -> 'status', new_value -> 'selected_at', new_value -> 'selected_by_parent_link_id', new_value -> 'selected_by_request_id', new_value -> 'selected_by_name', new_value -> 'selected_by_email');
  elsif tg_table_name = 'training_availability_responses' then
    old_key := 'training:' || (old_value ->> 'request_id') || ':' || (old_value ->> 'player_id');
    new_key := 'training:' || (new_value ->> 'request_id') || ':' || (new_value ->> 'player_id');
    old_value := jsonb_build_array(old_value -> 'status', old_value -> 'responded_at', old_value -> 'parent_link_id', old_value -> 'request_player_id', old_value -> 'responded_by_name', old_value -> 'responded_by_email', old_value -> 'note');
    new_value := jsonb_build_array(new_value -> 'status', new_value -> 'responded_at', new_value -> 'parent_link_id', new_value -> 'request_player_id', new_value -> 'responded_by_name', new_value -> 'responded_by_email', new_value -> 'note');
  elsif tg_table_name = 'training_coach_attendance' then
    old_key := 'coach:' || (old_value ->> 'id'); new_key := 'coach:' || (new_value ->> 'id');
    old_value := jsonb_build_array(old_value -> 'status', old_value -> 'responded_at');
    new_value := jsonb_build_array(new_value -> 'status', new_value -> 'responded_at');
  else raise exception 'Unknown attendance revision table.'; end if;
  if tg_op = 'UPDATE' and old_key = new_key and old_value is not distinct from new_value then return new; end if;
  for target in select distinct k from unnest(array[old_key,new_key]) k where k is not null order by k loop
    -- Legacy writes participate without changing their RPC signatures.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mobile-attendance:' || target, 0));
    insert into public.mobile_attendance_answer_revisions(target_key,revision) values (target,1)
    on conflict (target_key) do update set revision = mobile_attendance_answer_revisions.revision + 1;
  end loop;
  if tg_op = 'DELETE' then return old; else return new; end if;
end; $$;
revoke all on function public.mobile_attendance_revision_internal() from public, anon, authenticated;
create trigger mobile_attendance_match_revision before insert or update or delete on public.match_day_player_availability for each row execute function public.mobile_attendance_revision_internal();
create trigger mobile_attendance_training_revision before insert or update or delete on public.training_availability_responses for each row execute function public.mobile_attendance_revision_internal();
create trigger mobile_attendance_coach_revision before insert or update or delete on public.training_coach_attendance for each row execute function public.mobile_attendance_revision_internal();

-- The legacy staff-training RPC resolves the newest occurrence request internally.
-- All legacy occurrence inserts/moves/cancellations must share this guard so its
-- resolution cannot change between the wrapper's exact-target check and call.
create function public.mobile_attendance_occurrence_guard_internal() returns trigger
language plpgsql security definer set search_path='' as $$
declare old_key text; new_key text; key text;
begin
  if tg_op<>'INSERT' then old_key:=old.calendar_event_id::text||':'||old.occurrence_date::text; end if;
  if tg_op<>'DELETE' then new_key:=new.calendar_event_id::text||':'||new.occurrence_date::text; end if;
  for key in select distinct k from unnest(array[old_key,new_key]) k where k is not null order by k loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mobile-attendance-occurrence:'||key,0));
  end loop;
  if tg_op='DELETE' then return old; else return new; end if;
end; $$;
revoke all on function public.mobile_attendance_occurrence_guard_internal() from public,anon,authenticated;
create trigger mobile_attendance_occurrence_guard before insert or update or delete on public.training_availability_requests for each row execute function public.mobile_attendance_occurrence_guard_internal();

-- Resolve current read authority and exact canonical scope, never accepting caller actor/Club/team.
-- Snapshot preparation performs SELECTs only. Original mutation RPCs recheck all write gates.
create function public.mobile_attendance_target_internal(route_value text,target_value jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
<<target_scope>>
declare actor public.users%rowtype; link public.parent_player_links%rowtype; fixture public.match_days%rowtype;
  event public.calendar_events%rowtype; request public.training_availability_requests%rowtype;
  recipient public.training_availability_request_players%rowtype; match_request public.match_day_availability_requests%rowtype;
  attendance public.training_coach_attendance%rowtype; parent_id uuid; player_id uuid; team_id uuid; club_id uuid;
  canonical jsonb; key text; answer_status text := 'pending'; answer_at timestamptz; revision_value bigint;
begin
  if auth.uid() is null or jsonb_typeof(target_value) is distinct from 'object' then raise exception 'Authenticated attendance target is required.' using errcode='42501'; end if;
  if route_value in ('parent_match','parent_training') then
    parent_id := (target_value ->> 'parentLinkId')::uuid;
    select * into link from public.parent_player_links where id=parent_id and auth_user_id=auth.uid() and status='active';
    if link.id is null or public.current_user_can_access_parent_link(link.id,link.player_id) is not true then raise exception 'Current Parent authority is required.' using errcode='42501'; end if;
    player_id:=link.player_id; team_id:=link.team_id; club_id:=link.club_id;
    if route_value='parent_match' then
      select r.* into match_request from public.match_day_availability_requests r where r.id=(target_value ->> 'requestId')::uuid and r.player_id=link.player_id and r.club_id=link.club_id and r.team_id=link.team_id;
      if match_request.id is null then raise exception 'Parent request scope changed.' using errcode='42501'; end if;
      select r.* into fixture from public.match_days r where r.id=match_request.match_day_id and r.club_id=link.club_id;
      if fixture.id is null or fixture.parent_visible is not true or fixture.parent_audience='none' then raise exception 'Parent fixture scope changed.' using errcode='42501'; end if;
      canonical:=jsonb_build_object('parentLinkId',link.id,'requestId',match_request.id,'eventId',fixture.id,'playerId',player_id,'teamId',team_id,'clubId',club_id);
    else
      select r.* into recipient from public.training_availability_request_players r where r.id=(target_value ->> 'requestPlayerId')::uuid and r.player_id=link.player_id and r.club_id=link.club_id and r.team_id=link.team_id;
      if recipient.id is null then raise exception 'Parent training scope changed.' using errcode='42501'; end if;
      select r.* into request from public.training_availability_requests r where r.id=recipient.request_id and r.club_id=link.club_id and r.team_id=link.team_id;
      if request.id is null then raise exception 'Parent occurrence scope changed.' using errcode='42501'; end if;
      canonical:=jsonb_build_object('parentLinkId',link.id,'requestPlayerId',recipient.id,'requestId',request.id,'eventId',request.calendar_event_id,'occurrenceDate',request.occurrence_date,'playerId',player_id,'teamId',team_id,'clubId',club_id);
    end if;
  elsif route_value in ('coach_player_match','coach_player_training','coach_self_training') then
    select * into actor from public.users where id=auth.uid();
    if actor.id is null or coalesce(actor.status,'active')<>'active' or actor.role is null or actor.role='parent_portal' or coalesce(actor.role_rank,0)<20 then raise exception 'Current Coach authority is required.' using errcode='42501'; end if;
    if route_value='coach_self_training' then
      select * into attendance from public.training_coach_attendance where id=(target_value ->> 'attendanceId')::uuid and coach_user_id=auth.uid();
      if attendance.id is null or actor.club_id is distinct from attendance.club_id or actor.role not in ('assistant_coach','coach','manager','head_manager','admin') or not exists(select 1 from public.team_staff s where s.user_id=actor.id and s.team_id=attendance.team_id and coalesce(s.role_rank,0)>=20) then raise exception 'Own Coach attendance authority is required.' using errcode='42501'; end if;
      team_id:=attendance.team_id; club_id:=attendance.club_id;
      canonical:=jsonb_build_object('attendanceId',attendance.id,'requestId',attendance.request_id,'eventId',attendance.calendar_event_id,'occurrenceDate',attendance.occurrence_date,'teamId',team_id,'clubId',club_id);
    elsif route_value='coach_player_match' then
      select * into fixture from public.match_days where id=(target_value ->> 'eventId')::uuid;
      if fixture.id is null or public.can_manage_match_day(fixture.team_id) is not true or (actor.role<>'super_admin' and actor.club_id is distinct from fixture.club_id) then raise exception 'Coach fixture authority is required.' using errcode='42501'; end if;
      team_id:=fixture.team_id; club_id:=fixture.club_id; player_id:=(target_value ->> 'playerId')::uuid;
      canonical:=jsonb_build_object('eventId',fixture.id,'playerId',player_id,'teamId',team_id,'clubId',club_id);
    else
      select * into event from public.calendar_events where id=(target_value ->> 'eventId')::uuid and event_type='training';
      if event.id is null or public.current_user_can_access_team(event.club_id,event.team_id) is not true or (actor.role<>'super_admin' and actor.club_id is distinct from event.club_id) then raise exception 'Coach training authority is required.' using errcode='42501'; end if;
      if target_value ? 'requestId' then
        -- Replays resolve their original exact request even after its response window closes.
        select r.* into request from public.training_availability_requests r where r.id=(target_value->>'requestId')::uuid and r.calendar_event_id=event.id and r.club_id=event.club_id and r.team_id=event.team_id and r.occurrence_date=(target_value ->> 'occurrenceDate')::date;
      else
        select r.* into request from public.training_availability_requests r where r.calendar_event_id=event.id and r.club_id=event.club_id and r.team_id=event.team_id and r.occurrence_date=(target_value ->> 'occurrenceDate')::date and r.status<>'cancelled' and r.occurrence_starts_at>now() order by r.created_at desc limit 1;
      end if;
      if request.id is null then raise exception 'Training occurrence request changed. Prepare again.'; end if;
      team_id:=event.team_id; club_id:=event.club_id; player_id:=(target_value ->> 'playerId')::uuid;
      canonical:=jsonb_build_object('eventId',event.id,'playerId',player_id,'occurrenceDate',request.occurrence_date,'requestId',request.id,'teamId',team_id,'clubId',club_id);
    end if;
    if route_value<>'coach_self_training' and not exists(select 1 from public.players p where p.id=target_scope.player_id and p.club_id=target_scope.club_id and p.team_id=target_scope.team_id and coalesce(p.status,'active')<>'archived') then raise exception 'Coach Player scope changed.' using errcode='42501'; end if;
  else raise exception 'Unsupported mobile attendance route.'; end if;
  if route_value in ('parent_match','coach_player_match') then
    key:='match:'||fixture.id::text||':'||player_id::text;
    select a.status,a.selected_at into answer_status,answer_at from public.match_day_player_availability a where a.match_day_id=fixture.id and a.player_id=target_scope.player_id;
  elsif route_value='coach_self_training' then
    key:='coach:'||attendance.id::text; answer_status:=attendance.status; answer_at:=attendance.responded_at;
  else
    key:='training:'||request.id::text||':'||player_id::text;
    select a.status,a.responded_at into answer_status,answer_at from public.training_availability_responses a where a.request_id=request.id and a.player_id=target_scope.player_id;
  end if;
  select revision into revision_value from public.mobile_attendance_answer_revisions where target_key=key;
  return jsonb_build_object('route',route_value,'target',canonical,'key',key,'baseline',jsonb_build_object('revision',coalesce(revision_value,0)::text,'status',coalesce(answer_status,'pending'),'respondedAt',answer_at));
end; $$;
revoke all on function public.mobile_attendance_target_internal(text,jsonb) from public,anon,authenticated;

create function public.prepare_mobile_attendance_command(route_value text,target_value jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare value jsonb;
begin value:=public.mobile_attendance_target_internal(route_value,target_value); return value-'key'; end; $$;
revoke all on function public.prepare_mobile_attendance_command(text,jsonb) from public,anon;
grant execute on function public.prepare_mobile_attendance_command(text,jsonb) to authenticated;

create function public.prepare_mobile_attendance_choices(choices_value jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare choice jsonb; result jsonb:='[]'; prepared jsonb; ordinal integer:=0;
begin
  if auth.uid() is null or jsonb_typeof(choices_value) is distinct from 'array' or jsonb_array_length(choices_value)>200 then raise exception 'Authenticated batch of at most 200 choices is required.' using errcode='42501'; end if;
  for choice in select value from jsonb_array_elements(choices_value) loop
    ordinal:=ordinal+1;
    begin prepared:=public.prepare_mobile_attendance_command(choice->>'route',choice->'target');
      result:=result||jsonb_build_array(prepared);
    exception when others then result:=result||jsonb_build_array(null); end;
  end loop;
  return result;
end; $$;
revoke all on function public.prepare_mobile_attendance_choices(jsonb) from public,anon;
grant execute on function public.prepare_mobile_attendance_choices(jsonb) to authenticated;

create function public.apply_mobile_attendance_command(command_id_value uuid,route_value text,target_value jsonb,expected_value jsonb,response_value text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare resolved jsonb; locked jsonb; previous public.mobile_attendance_commands%rowtype; result jsonb; original_result jsonb; revision_value bigint; key text; target jsonb;
begin
  if auth.uid() is null or command_id_value is null or response_value is null or response_value not in ('available','unavailable','maybe') or (route_value like 'coach_%' and response_value='maybe') or jsonb_typeof(expected_value) is distinct from 'object' or coalesce(expected_value->>'revision','') !~ '^[0-9]+$' or not(expected_value ? 'status' and expected_value ? 'respondedAt') then raise exception 'An authenticated exact attendance command and original prepared baseline are required.' using errcode='42501'; end if;
  resolved:=public.mobile_attendance_target_internal(route_value,target_value); key:=resolved->>'key'; target:=resolved->'target';
  if target_value is distinct from target then raise exception 'Use the exact prepared attendance target.' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mobile-attendance-command:'||command_id_value::text,0));
  if route_value in ('parent_training','coach_player_training','coach_self_training') then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mobile-attendance-occurrence:'||(target->>'eventId')||':'||(target->>'occurrenceDate'),0));
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mobile-attendance:'||key,0));
  -- Freeze source pointers before delegating: exact request must not move to a
  -- different fixture/Player while a prepared command is being applied.
  if route_value='parent_match' then perform 1 from public.match_day_availability_requests where id=(target->>'requestId')::uuid for update; end if;
  if route_value='parent_training' then perform 1 from public.training_availability_request_players where id=(target->>'requestPlayerId')::uuid for update; end if;
  if route_value in ('parent_training','coach_player_training') then perform 1 from public.training_availability_requests where id=(target->>'requestId')::uuid for update; end if;
  if route_value in ('parent_match','coach_player_match') then perform 1 from public.match_days where id=(target->>'eventId')::uuid for update; end if;
  -- Lock actual canonical rows before CAS; missing rows are serialized by revision triggers.
  if route_value in ('parent_match','coach_player_match') then perform 1 from public.match_day_player_availability where match_day_id=(target->>'eventId')::uuid and player_id=(target->>'playerId')::uuid for update;
  elsif route_value='coach_self_training' then perform 1 from public.training_coach_attendance where id=(target->>'attendanceId')::uuid for update;
  else perform 1 from public.training_availability_responses where request_id=(target->>'requestId')::uuid and player_id=(target->>'playerId')::uuid for update; end if;
  locked:=public.mobile_attendance_target_internal(route_value,target_value);
  if locked->'target' is distinct from target then raise exception 'Attendance target changed. Prepare again.'; end if;
  select * into previous from public.mobile_attendance_commands where command_id=command_id_value for update;
  if previous.command_id is not null then
    if previous.actor_id is distinct from auth.uid() or previous.route is distinct from route_value or previous.target is distinct from target or previous.expected is distinct from expected_value or previous.response is distinct from response_value then raise exception 'Attendance command key belongs to another action.' using errcode='42501'; end if;
    return previous.outcome||jsonb_build_object('duplicate',true,'current',locked->'baseline');
  end if;
  insert into public.mobile_attendance_answer_revisions(target_key,revision) values(key,0) on conflict do nothing;
  select revision into revision_value from public.mobile_attendance_answer_revisions where target_key=key for update;
  if revision_value is distinct from (expected_value->>'revision')::bigint or locked#>>'{baseline,status}' is distinct from expected_value->>'status' or (locked#>>'{baseline,respondedAt}')::timestamptz is distinct from (expected_value->>'respondedAt')::timestamptz
    or (route_value='coach_player_training' and (select r.id from public.training_availability_requests r where r.calendar_event_id=(target->>'eventId')::uuid and r.club_id=(target->>'clubId')::uuid and r.team_id=(target->>'teamId')::uuid and r.occurrence_date=(target->>'occurrenceDate')::date and r.status<>'cancelled' and r.occurrence_starts_at>now() order by r.created_at desc limit 1) is distinct from (target->>'requestId')::uuid) then
    result:=jsonb_build_object('commandId',command_id_value,'outcome','conflict','duplicate',false,'current',locked->'baseline');
  else
    if route_value='parent_match' then original_result:=public.respond_parent_portal_match_day_invitation((target->>'parentLinkId')::uuid,(target->>'requestId')::uuid,'attendance',null,response_value);
    elsif route_value='parent_training' then original_result:=public.respond_parent_portal_training_invitation((target->>'parentLinkId')::uuid,(target->>'requestPlayerId')::uuid,response_value);
    elsif route_value='coach_self_training' then original_result:=public.submit_own_training_coach_attendance((target->>'attendanceId')::uuid,response_value);
    elsif response_value='available' then original_result:=public.accept_event_player_availability_on_behalf(case when route_value='coach_player_match' then 'match' else 'training' end,(target->>'eventId')::uuid,(target->>'playerId')::uuid,(target->>'occurrenceDate')::date);
    else original_result:=public.mark_event_player_unavailable_on_behalf(case when route_value='coach_player_match' then 'match' else 'training' end,(target->>'eventId')::uuid,(target->>'playerId')::uuid,(target->>'occurrenceDate')::date); end if;
    if original_result is null then raise exception 'Authoritative attendance mutation returned no result.'; end if;
    locked:=public.mobile_attendance_target_internal(route_value,target_value);
    result:=jsonb_build_object('commandId',command_id_value,'outcome','saved','duplicate',false,'current',locked->'baseline','result',original_result);
  end if;
  insert into public.mobile_attendance_commands(command_id,actor_id,route,target,expected,response,outcome) values(command_id_value,auth.uid(),route_value,target,expected_value,response_value,result);
  return result;
end; $$;
revoke all on function public.apply_mobile_attendance_command(uuid,text,jsonb,jsonb,text) from public,anon;
grant execute on function public.apply_mobile_attendance_command(uuid,text,jsonb,jsonb,text) to authenticated;

-- BEGIN REVIEWED LEGACY INTENT CONTRACT
-- LOCAL RELEASE DEPENDENCY DRAFT. Install base command draft first in one migration transaction.
-- Exact original bodies plus entry lock and successful intent stamp only.
-- Signatures, defaults, security, grants, answers, timestamps and side effects preserved.
DO $$ BEGIN
if not exists(select 1 from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure('public.respond_parent_portal_match_day_invitation(uuid,uuid,text,text,text)') and prosecdef and md5(replace(prosrc,chr(13)||chr(10),chr(10)))='d6cbe241717a9d546bf8eb06b7fb1896') then raise exception 'Original attendance RPC changed: respond_parent_portal_match_day_invitation. Rebase and review this draft.'; end if;
if not exists(select 1 from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure('public.respond_parent_portal_training_invitation(uuid,uuid,text)') and prosecdef and md5(replace(prosrc,chr(13)||chr(10),chr(10)))='57287d8749a07c53bbd4faa830056751') then raise exception 'Original attendance RPC changed: respond_parent_portal_training_invitation. Rebase and review this draft.'; end if;
if not exists(select 1 from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure('public.accept_event_player_availability_on_behalf(text,uuid,uuid,date)') and prosecdef and md5(replace(prosrc,chr(13)||chr(10),chr(10)))='634219c7d1d4e34894812a2354bfd359') then raise exception 'Original attendance RPC changed: accept_event_player_availability_on_behalf. Rebase and review this draft.'; end if;
if not exists(select 1 from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure('public.mark_event_player_unavailable_on_behalf(text,uuid,uuid,date)') and prosecdef and md5(replace(prosrc,chr(13)||chr(10),chr(10)))='dd2586a2da78cb45dea74687084a00d2') then raise exception 'Original attendance RPC changed: mark_event_player_unavailable_on_behalf. Rebase and review this draft.'; end if;
if not exists(select 1 from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure('public.submit_own_training_coach_attendance(uuid,text)') and prosecdef and md5(replace(prosrc,chr(13)||chr(10),chr(10)))='06d610a50e1ed611c64cc0ea6af9d4e4') then raise exception 'Original attendance RPC changed: submit_own_training_coach_attendance. Rebase and review this draft.'; end if;
if not exists(select 1 from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure('public.submit_match_day_availability_response(text,text,text,text,text,boolean,boolean,integer)') and prosecdef and md5(replace(prosrc,chr(13)||chr(10),chr(10)))='a686016907d7b567c296fd2de1cf448d') then raise exception 'Original attendance RPC changed: submit_match_day_availability_response. Rebase and review this draft.'; end if;
if not exists(select 1 from pg_catalog.pg_proc where oid=pg_catalog.to_regprocedure('public.submit_training_availability_response(text,text,text)') and prosecdef and md5(replace(prosrc,chr(13)||chr(10),chr(10)))='c0b337046552e9b11f316ab45c35838b') then raise exception 'Original attendance RPC changed: submit_training_availability_response. Rebase and review this draft.'; end if;
END $$;
-- These helpers expose no client API. Existing RPC authority remains decisive.
create function public.mobile_attendance_resolve_intent_internal(route_value text,target_value jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare key text;
begin
  if route_value='parent_match' then
    select 'match:'||r.match_day_id::text||':'||r.player_id::text into key from public.match_day_availability_requests r where r.id=(target_value->>'requestId')::uuid;
  elsif route_value='token_match' then
    select 'match:'||r.match_day_id::text||':'||r.player_id::text into key from public.match_day_availability_requests r where r.token_hash=target_value->>'tokenHash';
  elsif route_value='parent_training' then
    select 'training:'||r.request_id::text||':'||r.player_id::text into key from public.training_availability_request_players r where r.id=(target_value->>'requestPlayerId')::uuid;
  elsif route_value='token_training' then
    select 'training:'||r.request_id::text||':'||r.player_id::text into key from public.training_availability_request_players r where r.token_hash=target_value->>'tokenHash';
  elsif route_value='coach_self_training' then
    select 'coach:'||r.id::text into key from public.training_coach_attendance r where r.id=(target_value->>'attendanceId')::uuid;
  elsif route_value='coach_player' and target_value->>'eventType'='match' then
    key:='match:'||(target_value->>'eventId')||':'||(target_value->>'playerId');
  elsif route_value='coach_player' and target_value->>'eventType'='training' then
    select 'training:'||r.id::text||':'||(target_value->>'playerId') into key from public.training_availability_requests r
    join public.calendar_events e on e.id=r.calendar_event_id and e.club_id=r.club_id and e.team_id=r.team_id
    where r.calendar_event_id=(target_value->>'eventId')::uuid and r.occurrence_date=(target_value->>'occurrenceDate')::date
      and r.status<>'cancelled' and r.occurrence_starts_at>now() order by r.created_at desc limit 1;
  end if;
  return key;
end; $$;
revoke all on function public.mobile_attendance_resolve_intent_internal(text,jsonb) from public,anon,authenticated;

create function public.mobile_attendance_lock_intent_internal(route_value text,target_value jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare key text; occurrence_key text;
begin
  -- Occurrence guard always precedes answer guard, including the command wrapper.
  if route_value='coach_player' and target_value->>'eventType'='training' then
    occurrence_key:=(target_value->>'eventId')||':'||(target_value->>'occurrenceDate');
  elsif route_value in ('parent_training','token_training') then
    select r.calendar_event_id::text||':'||r.occurrence_date::text into occurrence_key
    from public.training_availability_requests r join public.training_availability_request_players p on p.request_id=r.id
    where (route_value='parent_training' and p.id=(target_value->>'requestPlayerId')::uuid)
      or (route_value='token_training' and p.token_hash=target_value->>'tokenHash');
  elsif route_value='coach_self_training' then
    select r.calendar_event_id::text||':'||r.occurrence_date::text into occurrence_key from public.training_coach_attendance r where r.id=(target_value->>'attendanceId')::uuid;
  end if;
  if occurrence_key is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mobile-attendance-occurrence:'||occurrence_key,0));
  end if;
  key:=public.mobile_attendance_resolve_intent_internal(route_value,target_value);
  if key is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mobile-attendance:'||key,0));
    -- Source pointers can have changed while waiting for the first answer lock.
    if public.mobile_attendance_resolve_intent_internal(route_value,target_value) is distinct from key then
      raise exception 'Attendance target changed. Refresh before responding.';
    end if;
  end if;
  return key;
end; $$;
revoke all on function public.mobile_attendance_lock_intent_internal(text,jsonb) from public,anon,authenticated;

create function public.mobile_attendance_record_intent_internal(route_value text,target_value jsonb,expected_key text,actual_key text) returns void
language plpgsql security definer set search_path='' as $$
begin
  -- Call only after an original successful return site. Failed authority/window
  -- checks never reach this point and transaction rollback includes the stamp.
  if expected_key is null or actual_key is distinct from expected_key or public.mobile_attendance_resolve_intent_internal(route_value,target_value) is distinct from expected_key then
    raise exception 'Attendance target changed. Refresh before responding.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('mobile-attendance:'||expected_key,0));
  insert into public.mobile_attendance_answer_revisions(target_key,revision) values(expected_key,1)
  on conflict(target_key) do update set revision=mobile_attendance_answer_revisions.revision+1;
end; $$;
revoke all on function public.mobile_attendance_record_intent_internal(text,jsonb,text,text) from public,anon,authenticated;


create or replace function public.respond_parent_portal_match_day_invitation(
  parent_link_id_value uuid,
  request_id_value uuid,
  response_kind_value text,
  role_type_value text,
  response_value text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  mobile_intent_key text;
  link_row public.parent_player_links%rowtype;
  request_row public.match_day_availability_requests%rowtype;
  match_row public.match_days%rowtype;
  response_row record;
  normalized_kind text := lower(trim(coalesce(response_kind_value, '')));
  normalized_role text := lower(trim(coalesce(role_type_value, '')));
  normalized_response text := lower(trim(coalesce(response_value, '')));
  owns_contact_offer boolean := false;
begin
  if auth.uid() is not null and (normalized_kind = 'attendance') then
    mobile_intent_key := public.mobile_attendance_lock_intent_internal('parent_match',jsonb_build_object('requestId',request_id_value));
  end if;
  if auth.uid() is null then
    raise exception 'Login is required before changing this response.';
  end if;

  select link.*
  into link_row
  from public.parent_player_links link
  where link.id = parent_link_id_value
    and link.auth_user_id = auth.uid()
    and link.status = 'active'
  limit 1;

  if link_row.id is null then
    raise exception 'This parent portal link is not available.';
  end if;

  select request.*
  into request_row
  from public.match_day_availability_requests request
  where request.id = request_id_value
    and request.club_id = link_row.club_id
    and request.team_id = link_row.team_id
    and request.player_id = link_row.player_id
  for update;

  if request_row.id is null then
    raise exception 'This invitation is not available for this player.';
  end if;

  owns_contact_offer := request_row.parent_link_id = link_row.id or (
    request_row.parent_link_id is null
    and coalesce(link_row.email, '') <> ''
    and lower(request_row.recipient_email) = lower(link_row.email)
  );

  select match_day.*
  into match_row
  from public.match_days match_day
  where match_day.id = request_row.match_day_id
    and match_day.club_id = link_row.club_id
    and (match_day.team_id is null or match_day.team_id = link_row.team_id)
    and match_day.parent_visible is true
    and match_day.parent_audience <> 'none'
  limit 1;

  if match_row.id is null then
    raise exception 'This fixture is not available in the Parent Portal.';
  end if;

  if request_row.status = 'expired' or request_row.expires_at <= now() then
    raise exception 'The response deadline has passed.';
  end if;

  if match_row.status in ('cancelled', 'postponed', 'full_time')
    or match_row.concluded_at is not null
    or (match_row.match_date is not null and match_row.match_date < timezone('Europe/London', now())::date) then
    raise exception 'This fixture has closed and responses cannot be changed.';
  end if;

  if normalized_kind = 'attendance' then
    if normalized_response not in ('available', 'unavailable', 'maybe') then
      raise exception 'Choose a valid attendance response.';
    end if;
  elsif normalized_kind = 'role' then
    if owns_contact_offer is false then
      raise exception 'This Match Day role offer belongs to another parent contact.';
    end if;

    if normalized_role not in ('scorer', 'linesman', 'referee') or normalized_response not in ('yes', 'no') then
      raise exception 'Choose a valid Match Day role response.';
    end if;

    if (normalized_role = 'scorer' and coalesce(match_row.request_scorer, false) is false)
      or (normalized_role = 'linesman' and coalesce(match_row.request_linesman, false) is false)
      or (normalized_role = 'referee' and coalesce(match_row.request_referee, false) is false) then
      raise exception 'This Match Day role was not offered.';
    end if;

    if exists (
      select 1
      from public.match_day_role_assignments assignment
      where assignment.match_day_id = match_row.id
        and assignment.role = normalized_role
    ) then
      raise exception 'Coaches have completed the selection for this role.';
    end if;
  else
    raise exception 'Choose a valid response type.';
  end if;

  select response.*
  into response_row
  from public.submit_match_day_availability_response(
    request_row.token_hash,
    case when normalized_kind = 'attendance' then normalized_response else '' end,
    case when normalized_kind = 'role' and normalized_role = 'scorer' then normalized_response else null end,
    case when normalized_kind = 'role' and normalized_role = 'linesman' then normalized_response else null end,
    case when normalized_kind = 'role' and normalized_role = 'referee' then normalized_response else null end,
    null,
    null,
    null
  ) response
  limit 1;

  if response_row.request_id is null then
    raise exception 'The response could not be saved.';
  end if;

  if normalized_kind = 'attendance' then perform public.mobile_attendance_record_intent_internal('parent_match',jsonb_build_object('requestId',request_id_value),mobile_intent_key,'match:'||request_row.match_day_id::text||':'||request_row.player_id::text); end if;

  return jsonb_build_object(
    'requestId', response_row.request_id,
    'responseKind', normalized_kind,
    'roleType', nullif(normalized_role, ''),
    'responseState', normalized_response,
    'respondedAt', coalesce(response_row.responded_at, response_row.volunteer_responded_at)
  );
end;
$$;

create or replace function public.respond_parent_portal_training_invitation(
  parent_link_id_value uuid,
  request_player_id_value uuid,
  response_value text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  mobile_intent_key text;
  link_row public.parent_player_links%rowtype;
  request_player_row public.training_availability_request_players%rowtype;
  request_row public.training_availability_requests%rowtype;
  event_row public.calendar_events%rowtype;
  response_row public.training_availability_responses%rowtype;
  normalized_response text := lower(btrim(coalesce(response_value, '')));
  actor_name text;
  response_changed boolean := false;
begin
  if auth.uid() is not null and (true) then
    mobile_intent_key := public.mobile_attendance_lock_intent_internal('parent_training',jsonb_build_object('requestPlayerId',request_player_id_value));
  end if;
  if auth.uid() is null then
    raise exception 'Login is required before changing this response.';
  end if;
  if normalized_response not in ('available', 'unavailable', 'maybe') then
    raise exception 'Choose a valid training attendance response.';
  end if;
  select link.* into link_row
  from public.parent_player_links link
  where link.id = parent_link_id_value;
  if link_row.id is null
    or not public.current_user_can_access_parent_link(link_row.id, link_row.player_id)
    or not exists (select 1 from public.players player where player.id = link_row.player_id and player.team_id = link_row.team_id)
    or not exists (select 1 from public.clubs club where club.id = link_row.club_id and coalesce(club.status, 'active') = 'active') then
    raise exception using errcode = '42501', message = 'This parent portal link is not available.';
  end if;

  select request_player.* into request_player_row
  from public.training_availability_request_players request_player
  where request_player.id = request_player_id_value
    and request_player.club_id = link_row.club_id
    and request_player.team_id = link_row.team_id
    and request_player.player_id = link_row.player_id;
  if request_player_row.id is null then
    raise exception using errcode = '42501', message = 'This invitation is not available for this player.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    concat('reusable_rsvp:training:', request_player_row.request_id::text, ':', request_player_row.player_id::text), 0
  ));
  select request.* into request_row
  from public.training_availability_requests request
  where request.id = request_player_row.request_id
    and request.club_id = link_row.club_id and request.team_id = link_row.team_id
  for update;
  select event.* into event_row
  from public.calendar_events event
  where event.id = request_player_row.calendar_event_id
    and event.id = request_row.calendar_event_id
    and event.club_id = link_row.club_id and event.team_id = link_row.team_id
    and event.event_type = 'training'
  for update;
  select request_player.* into request_player_row
  from public.training_availability_request_players request_player
  where request_player.id = request_player_id_value
  for update;

  if request_row.id is null or event_row.id is null then
    raise exception 'This training invitation is not available.';
  end if;
  if request_row.status in ('cancelled', 'expired')
    or request_player_row.status in ('cancelled', 'expired')
    or event_row.cancelled_at is not null
    or request_row.occurrence_starts_at <= now()
    or coalesce(request_player_row.response_deadline_at, request_row.occurrence_starts_at) < now() then
    raise exception 'This training response window has closed.';
  end if;

  select response.* into response_row
  from public.training_availability_responses response
  where response.request_id = request_row.id and response.player_id = link_row.player_id
  for update;
  select coalesce(nullif(btrim(actor.raw_user_meta_data ->> 'display_name'), ''),
    nullif(btrim(actor.raw_user_meta_data ->> 'name'), ''), 'Parent') into actor_name
  from auth.users actor where actor.id = auth.uid();
  actor_name := coalesce(actor_name, 'Parent');

  if response_row.id is null then
    insert into public.training_availability_responses (
      request_player_id, request_id, club_id, team_id, calendar_event_id, player_id,
      parent_link_id, status, note, responded_by_name, responded_by_email, responded_at
    ) values (
      request_player_row.id, request_row.id, link_row.club_id, link_row.team_id,
      event_row.id, link_row.player_id, link_row.id, normalized_response, '',
      actor_name, coalesce(link_row.email, ''), timezone('utc', now())
    ) returning * into response_row;
    response_changed := true;
  elsif response_row.status is distinct from normalized_response then
    update public.training_availability_responses response
    set request_player_id = request_player_row.id, parent_link_id = link_row.id,
        status = normalized_response, note = '', responded_by_name = actor_name,
        responded_by_email = coalesce(link_row.email, ''), responded_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where response.id = response_row.id
    returning * into response_row;
    response_changed := true;
  end if;

  update public.training_availability_request_players recipient
  set status = 'responded', responded_at = response_row.responded_at, updated_at = timezone('utc', now())
  where recipient.request_id = request_row.id and recipient.player_id = link_row.player_id
    and recipient.club_id = link_row.club_id and recipient.team_id = link_row.team_id
    and recipient.calendar_event_id = event_row.id and recipient.status not in ('cancelled', 'expired');

  if true then perform public.mobile_attendance_record_intent_internal('parent_training',jsonb_build_object('requestPlayerId',request_player_id_value),mobile_intent_key,'training:'||response_row.request_id::text||':'||link_row.player_id::text); end if;

  return jsonb_build_object('requestPlayerId', request_player_row.id,
    'responseState', response_row.status, 'respondedAt', response_row.responded_at, 'changed', response_changed);
end;
$$;

create or replace function public.accept_event_player_availability_on_behalf(
  event_type_value text,
  event_id_value uuid,
  player_id_value uuid,
  occurrence_date_value date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  mobile_intent_key text;
  normalized_event_type text := lower(btrim(coalesce(event_type_value, '')));
  actor_id uuid := auth.uid();
  actor_profile public.users%rowtype;
  actor_name text := '';
  actor_email text := '';
  response_time timestamptz := timezone('utc', now());
  player_row public.players%rowtype;
  match_row public.match_days%rowtype;
  current_match_response public.match_day_player_availability%rowtype;
  calendar_event_row public.calendar_events%rowtype;
  training_request_row public.training_availability_requests%rowtype;
  training_request_player_row public.training_availability_request_players%rowtype;
  current_training_response public.training_availability_responses%rowtype;
  previous_status text := 'pending';
begin
  if auth.uid() is not null and (true) then
    mobile_intent_key := public.mobile_attendance_lock_intent_internal('coach_player',jsonb_build_object('eventType',normalized_event_type,'eventId',event_id_value,'playerId',player_id_value,'occurrenceDate',occurrence_date_value));
  end if;
  if actor_id is null then
    raise exception using
      errcode = '42501',
      message = 'Sign in as authorised team staff to accept on behalf of a player.';
  end if;

  select profile.*
  into actor_profile
  from public.users profile
  where profile.id = actor_id
    and coalesce(profile.status, 'active') = 'active'
  limit 1;

  if actor_profile.id is null
    or actor_profile.role = 'parent_portal'
    or coalesce(actor_profile.role_rank, 0) < 20 then
    raise exception using
      errcode = '42501',
      message = 'Authorised team staff access is required.';
  end if;

  actor_name := coalesce(
    nullif(btrim(actor_profile.name), ''),
    nullif(btrim(actor_profile.username), ''),
    nullif(btrim(actor_profile.email), ''),
    'Team staff'
  );
  actor_email := coalesce(nullif(lower(btrim(actor_profile.email)), ''), '');

  if normalized_event_type = 'match' then
    select match_day.*
    into match_row
    from public.match_days match_day
    where match_day.id = event_id_value
      and match_day.deleted_at is null
      and coalesce(match_day.status, 'scheduled') not in ('cancelled', 'full_time', 'postponed')
    for update;

    if match_row.id is null then
      raise exception 'This Match Day fixture is not available for responses.';
    end if;

    if not public.can_manage_match_day(match_row.team_id)
      or (
        actor_profile.role <> 'super_admin'
        and actor_profile.club_id is distinct from match_row.club_id
      ) then
      raise exception using
        errcode = '42501',
        message = 'You cannot manage this Match Day fixture.';
    end if;

    select player.*
    into player_row
    from public.players player
    where player.id = player_id_value
      and player.club_id = match_row.club_id
      and player.team_id = match_row.team_id
      and coalesce(player.status, 'active') <> 'archived'
    limit 1;

    if player_row.id is null then
      raise exception using
        errcode = '42501',
        message = 'This player is outside the fixture team scope.';
    end if;

    if not exists (
      select 1
      from public.match_day_availability_requests request
      where request.match_day_id = match_row.id
        and request.club_id = match_row.club_id
        and request.team_id = match_row.team_id
        and request.player_id = player_row.id
        and coalesce(request.status, 'pending') not in ('cancelled', 'expired')
        and request.sent_at is not null
        and request.expires_at >= response_time
        and request.token_revoked_at is null
    ) and not exists (
      select 1 from public.match_day_player_squad_decisions decision
      where decision.match_day_id = match_row.id
        and decision.club_id = match_row.club_id
        and decision.team_id = match_row.team_id
        and decision.player_id = player_row.id
        and decision.status = 'selected'
    ) and not exists (
      select 1 from public.calendar_event_invites invite
      where invite.match_day_id = match_row.id
        and invite.club_id = match_row.club_id
        and invite.team_id = match_row.team_id
        and invite.player_id = player_row.id
        and invite.invite_status <> 'cancelled'
    ) then
      raise exception 'This player is not attached to this Match Day fixture.';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        concat('staff_availability:match:', match_row.id::text, ':', player_row.id::text),
        0
      )
    );

    select availability.*
    into current_match_response
    from public.match_day_player_availability availability
    where availability.match_day_id = match_row.id
      and availability.player_id = player_row.id
    for update;

    previous_status := coalesce(nullif(current_match_response.status, ''), 'pending');

    if previous_status = 'available' then
      if true then perform public.mobile_attendance_record_intent_internal('coach_player',jsonb_build_object('eventType',normalized_event_type,'eventId',event_id_value,'playerId',player_id_value,'occurrenceDate',occurrence_date_value),mobile_intent_key,case when normalized_event_type='match' then 'match:'||match_row.id::text||':'||player_row.id::text else 'training:'||training_request_row.id::text||':'||player_row.id::text end); end if;
      return jsonb_build_object(
        'changed', false,
        'eventId', match_row.id,
        'eventType', 'match',
        'playerId', player_row.id,
        'previousStatus', previous_status,
        'responseStatus', 'available',
        'respondedAt', current_match_response.selected_at,
        'source', 'staff_on_behalf'
      );
    end if;

    insert into public.match_day_player_availability (
      match_day_id,
      club_id,
      team_id,
      player_id,
      player_name,
      status,
      selected_by_parent_link_id,
      selected_by_request_id,
      selected_by_name,
      selected_by_email,
      selected_at,
      updated_at
    )
    values (
      match_row.id,
      match_row.club_id,
      match_row.team_id,
      player_row.id,
      coalesce(nullif(player_row.player_name, ''), 'Player'),
      'available',
      null,
      null,
      actor_name,
      actor_email,
      response_time,
      response_time
    )
    on conflict (match_day_id, player_id)
    do update
    set status = 'available',
        player_name = excluded.player_name,
        selected_by_parent_link_id = null,
        selected_by_request_id = null,
        selected_by_name = excluded.selected_by_name,
        selected_by_email = excluded.selected_by_email,
        selected_at = excluded.selected_at,
        updated_at = excluded.updated_at;

    insert into public.match_day_player_availability_history (
      match_day_id,
      club_id,
      team_id,
      player_id,
      request_id,
      parent_link_id,
      player_name,
      previous_status,
      status,
      selected_by_name,
      selected_by_email
    )
    values (
      match_row.id,
      match_row.club_id,
      match_row.team_id,
      player_row.id,
      null,
      null,
      coalesce(nullif(player_row.player_name, ''), 'Player'),
      previous_status,
      'available',
      actor_name,
      actor_email
    );

    insert into public.match_day_event_log (
      club_id,
      team_id,
      match_day_id,
      player_id,
      actor_user_id,
      actor_display_name,
      actor_role,
      event_type,
      event_label,
      previous_value,
      new_value,
      metadata,
      created_at
    )
    values (
      match_row.club_id,
      match_row.team_id,
      match_row.id,
      player_row.id,
      actor_id,
      actor_name,
      coalesce(nullif(actor_profile.role_label, ''), actor_profile.role, 'staff'),
      'player_availability_changed',
      'Staff accepted on behalf of player',
      jsonb_build_object('availabilityStatus', previous_status),
      jsonb_build_object('availabilityStatus', 'available'),
      jsonb_build_object('source', 'staff_on_behalf'),
      response_time
    );

    insert into public.audit_logs (
      club_id,
      actor_id,
      action,
      entity_type,
      entity_id,
      metadata,
      created_at
    )
    values (
      match_row.club_id,
      actor_id,
      'event_player_availability_accepted_on_behalf',
      'match_day',
      match_row.id,
      jsonb_build_object(
        'eventId', match_row.id,
        'eventType', 'match',
        'teamId', match_row.team_id,
        'playerId', player_row.id,
        'previousStatus', previous_status,
        'newStatus', 'available',
        'source', 'staff_on_behalf'
      ),
      response_time
    );

    if true then perform public.mobile_attendance_record_intent_internal('coach_player',jsonb_build_object('eventType',normalized_event_type,'eventId',event_id_value,'playerId',player_id_value,'occurrenceDate',occurrence_date_value),mobile_intent_key,case when normalized_event_type='match' then 'match:'||match_row.id::text||':'||player_row.id::text else 'training:'||training_request_row.id::text||':'||player_row.id::text end); end if;

    return jsonb_build_object(
      'changed', true,
      'eventId', match_row.id,
      'eventType', 'match',
      'playerId', player_row.id,
      'previousStatus', previous_status,
      'responseStatus', 'available',
      'respondedAt', response_time,
      'source', 'staff_on_behalf'
    );
  end if;

  if normalized_event_type = 'training' then
    if occurrence_date_value is null then
      raise exception 'Choose a training occurrence before accepting on behalf of a player.';
    end if;

    select event.*
    into calendar_event_row
    from public.calendar_events event
    where event.id = event_id_value
      and event.event_type = 'training'
      and event.team_id is not null
      and event.cancelled_at is null
    limit 1;

    if calendar_event_row.id is null then
      raise exception 'This training event is not available for responses.';
    end if;

    if not public.current_user_can_access_team(calendar_event_row.club_id, calendar_event_row.team_id)
      or (
        actor_profile.role <> 'super_admin'
        and actor_profile.club_id is distinct from calendar_event_row.club_id
      ) then
      raise exception using
        errcode = '42501',
        message = 'You cannot manage this training event.';
    end if;

    select player.*
    into player_row
    from public.players player
    where player.id = player_id_value
      and player.club_id = calendar_event_row.club_id
      and player.team_id = calendar_event_row.team_id
      and coalesce(player.status, 'active') <> 'archived'
    limit 1;

    if player_row.id is null then
      raise exception using
        errcode = '42501',
        message = 'This player is outside the training team scope.';
    end if;

    select request.*
    into training_request_row
    from public.training_availability_requests request
    where request.calendar_event_id = calendar_event_row.id
      and request.club_id = calendar_event_row.club_id
      and request.team_id = calendar_event_row.team_id
      and request.occurrence_date = occurrence_date_value
      and request.status <> 'cancelled'
      and request.occurrence_starts_at > response_time
    order by request.created_at desc
    limit 1
    for update;

    if training_request_row.id is null then
      raise exception 'This training response window is not active.';
    end if;

    select request_player.*
    into training_request_player_row
    from public.training_availability_request_players request_player
    where request_player.request_id = training_request_row.id
      and request_player.calendar_event_id = calendar_event_row.id
      and request_player.club_id = calendar_event_row.club_id
      and request_player.team_id = calendar_event_row.team_id
      and request_player.player_id = player_row.id
      and request_player.status not in ('cancelled', 'expired')
    order by request_player.created_at desc
    limit 1
    for update;

    if training_request_player_row.id is null then
      raise exception 'This player does not have an active training availability invitation.';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        concat('staff_availability:training:', training_request_row.id::text, ':', player_row.id::text),
        0
      )
    );

    select response.*
    into current_training_response
    from public.training_availability_responses response
    where response.request_id = training_request_row.id
      and response.player_id = player_row.id
    for update;

    previous_status := coalesce(nullif(current_training_response.status, ''), 'pending');

    if previous_status = 'available' then
      if true then perform public.mobile_attendance_record_intent_internal('coach_player',jsonb_build_object('eventType',normalized_event_type,'eventId',event_id_value,'playerId',player_id_value,'occurrenceDate',occurrence_date_value),mobile_intent_key,case when normalized_event_type='match' then 'match:'||match_row.id::text||':'||player_row.id::text else 'training:'||training_request_row.id::text||':'||player_row.id::text end); end if;
      return jsonb_build_object(
        'changed', false,
        'eventId', calendar_event_row.id,
        'eventType', 'training',
        'occurrenceDate', occurrence_date_value,
        'playerId', player_row.id,
        'previousStatus', previous_status,
        'responseStatus', 'available',
        'respondedAt', current_training_response.responded_at,
        'source', 'staff_on_behalf'
      );
    end if;

    insert into public.training_availability_responses (
      request_player_id,
      request_id,
      club_id,
      team_id,
      calendar_event_id,
      player_id,
      parent_link_id,
      status,
      note,
      responded_by_name,
      responded_by_email,
      responded_at,
      updated_at
    )
    values (
      training_request_player_row.id,
      training_request_row.id,
      calendar_event_row.club_id,
      calendar_event_row.team_id,
      calendar_event_row.id,
      player_row.id,
      null,
      'available',
      '',
      actor_name,
      actor_email,
      response_time,
      response_time
    )
    on conflict (request_id, player_id)
    do update
    set request_player_id = excluded.request_player_id,
        parent_link_id = null,
        status = 'available',
        note = '',
        responded_by_name = excluded.responded_by_name,
        responded_by_email = excluded.responded_by_email,
        responded_at = excluded.responded_at,
        updated_at = excluded.updated_at;

    update public.training_availability_request_players request_player
    set status = 'responded',
        responded_at = response_time,
        updated_at = response_time
    where request_player.id = training_request_player_row.id;

    insert into public.audit_logs (
      club_id,
      actor_id,
      action,
      entity_type,
      entity_id,
      metadata,
      created_at
    )
    values (
      calendar_event_row.club_id,
      actor_id,
      'event_player_availability_accepted_on_behalf',
      'calendar_event',
      calendar_event_row.id,
      jsonb_build_object(
        'eventId', calendar_event_row.id,
        'eventType', 'training',
        'occurrenceDate', occurrence_date_value,
        'teamId', calendar_event_row.team_id,
        'playerId', player_row.id,
        'previousStatus', previous_status,
        'newStatus', 'available',
        'source', 'staff_on_behalf'
      ),
      response_time
    );

    if true then perform public.mobile_attendance_record_intent_internal('coach_player',jsonb_build_object('eventType',normalized_event_type,'eventId',event_id_value,'playerId',player_id_value,'occurrenceDate',occurrence_date_value),mobile_intent_key,case when normalized_event_type='match' then 'match:'||match_row.id::text||':'||player_row.id::text else 'training:'||training_request_row.id::text||':'||player_row.id::text end); end if;

    return jsonb_build_object(
      'changed', true,
      'eventId', calendar_event_row.id,
      'eventType', 'training',
      'occurrenceDate', occurrence_date_value,
      'playerId', player_row.id,
      'previousStatus', previous_status,
      'responseStatus', 'available',
      'respondedAt', response_time,
      'source', 'staff_on_behalf'
    );
  end if;

  raise exception 'Accept on behalf supports Match Day and training invitations only.';
end;
$$;

create or replace function public.mark_event_player_unavailable_on_behalf(
  event_type_value text,
  event_id_value uuid,
  player_id_value uuid,
  occurrence_date_value date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  mobile_intent_key text;
  normalized_event_type text := lower(btrim(coalesce(event_type_value, '')));
  actor_id uuid := auth.uid();
  actor_profile public.users%rowtype;
  actor_name text := '';
  actor_email text := '';
  response_time timestamptz := timezone('utc', now());
  player_row public.players%rowtype;
  match_row public.match_days%rowtype;
  current_match_response public.match_day_player_availability%rowtype;
  calendar_event_row public.calendar_events%rowtype;
  training_request_row public.training_availability_requests%rowtype;
  training_request_player_row public.training_availability_request_players%rowtype;
  current_training_response public.training_availability_responses%rowtype;
  previous_status text := 'pending';
begin
  if auth.uid() is not null and (true) then
    mobile_intent_key := public.mobile_attendance_lock_intent_internal('coach_player',jsonb_build_object('eventType',normalized_event_type,'eventId',event_id_value,'playerId',player_id_value,'occurrenceDate',occurrence_date_value));
  end if;
  if actor_id is null then
    raise exception using
      errcode = '42501',
      message = 'Sign in as authorised team staff to mark a player unavailable.';
  end if;

  select profile.*
  into actor_profile
  from public.users profile
  where profile.id = actor_id
    and coalesce(profile.status, 'active') = 'active'
  limit 1;

  if actor_profile.id is null
    or actor_profile.role = 'parent_portal'
    or coalesce(actor_profile.role_rank, 0) < 20 then
    raise exception using
      errcode = '42501',
      message = 'Authorised team staff access is required.';
  end if;

  actor_name := coalesce(
    nullif(btrim(actor_profile.name), ''),
    nullif(btrim(actor_profile.username), ''),
    nullif(btrim(actor_profile.email), ''),
    'Team staff'
  );
  actor_email := coalesce(nullif(lower(btrim(actor_profile.email)), ''), '');

  if normalized_event_type = 'match' then
    select fixture.*
    into match_row
    from public.match_days fixture
    where fixture.id = event_id_value
      and fixture.deleted_at is null
      and coalesce(fixture.status, 'scheduled') not in ('cancelled', 'full_time', 'postponed')
    for update;

    if match_row.id is null then
      raise exception 'This Match Day fixture is not available for responses.';
    end if;

    if not public.can_manage_match_day(match_row.team_id)
      or (
        actor_profile.role <> 'super_admin'
        and actor_profile.club_id is distinct from match_row.club_id
      ) then
      raise exception using
        errcode = '42501',
        message = 'You cannot manage this Match Day fixture.';
    end if;

    select player.*
    into player_row
    from public.players player
    where player.id = player_id_value
      and player.club_id = match_row.club_id
      and player.team_id = match_row.team_id
      and coalesce(player.status, 'active') <> 'archived'
    limit 1;

    if player_row.id is null then
      raise exception using
        errcode = '42501',
        message = 'This player is outside the fixture team scope.';
    end if;

    if not exists (
      select 1
      from public.match_day_availability_requests request
      where request.match_day_id = match_row.id
        and request.club_id = match_row.club_id
        and request.team_id = match_row.team_id
        and request.player_id = player_row.id
        and coalesce(request.status, 'pending') not in ('cancelled', 'expired')
        and request.sent_at is not null
        and request.expires_at >= response_time
        and request.token_revoked_at is null
    ) then
      raise exception 'This player does not have an active Match Day availability invitation.';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        concat('staff_availability:match:', match_row.id::text, ':', player_row.id::text),
        0
      )
    );

    select availability.*
    into current_match_response
    from public.match_day_player_availability availability
    where availability.match_day_id = match_row.id
      and availability.player_id = player_row.id
    for update;

    previous_status := coalesce(nullif(current_match_response.status, ''), 'pending');

    if previous_status = 'unavailable' then
      if true then perform public.mobile_attendance_record_intent_internal('coach_player',jsonb_build_object('eventType',normalized_event_type,'eventId',event_id_value,'playerId',player_id_value,'occurrenceDate',occurrence_date_value),mobile_intent_key,case when normalized_event_type='match' then 'match:'||match_row.id::text||':'||player_row.id::text else 'training:'||training_request_row.id::text||':'||player_row.id::text end); end if;
      return jsonb_build_object(
        'changed', false,
        'eventId', match_row.id,
        'eventType', 'match',
        'playerId', player_row.id,
        'previousStatus', previous_status,
        'responseStatus', 'unavailable',
        'respondedAt', current_match_response.selected_at,
        'source', 'staff_on_behalf'
      );
    end if;

    insert into public.match_day_player_availability (
      match_day_id,
      club_id,
      team_id,
      player_id,
      player_name,
      status,
      selected_by_parent_link_id,
      selected_by_request_id,
      selected_by_name,
      selected_by_email,
      selected_at,
      updated_at
    )
    values (
      match_row.id,
      match_row.club_id,
      match_row.team_id,
      player_row.id,
      coalesce(nullif(player_row.player_name, ''), 'Player'),
      'unavailable',
      null,
      null,
      actor_name,
      actor_email,
      response_time,
      response_time
    )
    on conflict (match_day_id, player_id)
    do update
    set status = 'unavailable',
        player_name = excluded.player_name,
        selected_by_parent_link_id = null,
        selected_by_request_id = null,
        selected_by_name = excluded.selected_by_name,
        selected_by_email = excluded.selected_by_email,
        selected_at = excluded.selected_at,
        updated_at = excluded.updated_at;

    insert into public.match_day_player_availability_history (
      match_day_id,
      club_id,
      team_id,
      player_id,
      request_id,
      parent_link_id,
      player_name,
      previous_status,
      status,
      selected_by_name,
      selected_by_email
    )
    values (
      match_row.id,
      match_row.club_id,
      match_row.team_id,
      player_row.id,
      null,
      null,
      coalesce(nullif(player_row.player_name, ''), 'Player'),
      previous_status,
      'unavailable',
      actor_name,
      actor_email
    );

    insert into public.match_day_event_log (
      club_id,
      team_id,
      match_day_id,
      player_id,
      actor_user_id,
      actor_display_name,
      actor_role,
      event_type,
      event_label,
      previous_value,
      new_value,
      metadata,
      created_at
    )
    values (
      match_row.club_id,
      match_row.team_id,
      match_row.id,
      player_row.id,
      actor_id,
      actor_name,
      coalesce(nullif(actor_profile.role_label, ''), actor_profile.role, 'staff'),
      'player_availability_changed',
      'Staff marked player unavailable',
      jsonb_build_object('availabilityStatus', previous_status),
      jsonb_build_object('availabilityStatus', 'unavailable'),
      jsonb_build_object('source', 'staff_on_behalf'),
      response_time
    );

    insert into public.audit_logs (
      club_id,
      actor_id,
      action,
      entity_type,
      entity_id,
      metadata,
      created_at
    )
    values (
      match_row.club_id,
      actor_id,
      'event_player_availability_marked_unavailable_on_behalf',
      'match_day',
      match_row.id,
      jsonb_build_object(
        'eventId', match_row.id,
        'eventType', 'match',
        'teamId', match_row.team_id,
        'playerId', player_row.id,
        'previousStatus', previous_status,
        'newStatus', 'unavailable',
        'source', 'staff_on_behalf'
      ),
      response_time
    );

    if true then perform public.mobile_attendance_record_intent_internal('coach_player',jsonb_build_object('eventType',normalized_event_type,'eventId',event_id_value,'playerId',player_id_value,'occurrenceDate',occurrence_date_value),mobile_intent_key,case when normalized_event_type='match' then 'match:'||match_row.id::text||':'||player_row.id::text else 'training:'||training_request_row.id::text||':'||player_row.id::text end); end if;

    return jsonb_build_object(
      'changed', true,
      'eventId', match_row.id,
      'eventType', 'match',
      'playerId', player_row.id,
      'previousStatus', previous_status,
      'responseStatus', 'unavailable',
      'respondedAt', response_time,
      'source', 'staff_on_behalf'
    );
  end if;

  if normalized_event_type = 'training' then
    if occurrence_date_value is null then
      raise exception 'Choose a training occurrence before marking a player unavailable.';
    end if;

    select event.*
    into calendar_event_row
    from public.calendar_events event
    where event.id = event_id_value
      and event.event_type = 'training'
      and event.team_id is not null
      and event.cancelled_at is null
    limit 1;

    if calendar_event_row.id is null then
      raise exception 'This training event is not available for responses.';
    end if;

    if not public.current_user_can_access_team(calendar_event_row.club_id, calendar_event_row.team_id)
      or (
        actor_profile.role <> 'super_admin'
        and actor_profile.club_id is distinct from calendar_event_row.club_id
      ) then
      raise exception using
        errcode = '42501',
        message = 'You cannot manage this training event.';
    end if;

    select player.*
    into player_row
    from public.players player
    where player.id = player_id_value
      and player.club_id = calendar_event_row.club_id
      and player.team_id = calendar_event_row.team_id
      and coalesce(player.status, 'active') <> 'archived'
    limit 1;

    if player_row.id is null then
      raise exception using
        errcode = '42501',
        message = 'This player is outside the training team scope.';
    end if;

    select request.*
    into training_request_row
    from public.training_availability_requests request
    where request.calendar_event_id = calendar_event_row.id
      and request.club_id = calendar_event_row.club_id
      and request.team_id = calendar_event_row.team_id
      and request.occurrence_date = occurrence_date_value
      and request.status <> 'cancelled'
      and request.occurrence_starts_at > response_time
    order by request.created_at desc
    limit 1
    for update;

    if training_request_row.id is null then
      raise exception 'This training response window is not active.';
    end if;

    select request_player.*
    into training_request_player_row
    from public.training_availability_request_players request_player
    where request_player.request_id = training_request_row.id
      and request_player.calendar_event_id = calendar_event_row.id
      and request_player.club_id = calendar_event_row.club_id
      and request_player.team_id = calendar_event_row.team_id
      and request_player.player_id = player_row.id
      and request_player.status not in ('cancelled', 'expired')
    order by request_player.created_at desc
    limit 1
    for update;

    if training_request_player_row.id is null then
      raise exception 'This player does not have an active training availability invitation.';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        concat('staff_availability:training:', training_request_row.id::text, ':', player_row.id::text),
        0
      )
    );

    select response.*
    into current_training_response
    from public.training_availability_responses response
    where response.request_id = training_request_row.id
      and response.player_id = player_row.id
    for update;

    previous_status := coalesce(nullif(current_training_response.status, ''), 'pending');

    if previous_status = 'unavailable' then
      if true then perform public.mobile_attendance_record_intent_internal('coach_player',jsonb_build_object('eventType',normalized_event_type,'eventId',event_id_value,'playerId',player_id_value,'occurrenceDate',occurrence_date_value),mobile_intent_key,case when normalized_event_type='match' then 'match:'||match_row.id::text||':'||player_row.id::text else 'training:'||training_request_row.id::text||':'||player_row.id::text end); end if;
      return jsonb_build_object(
        'changed', false,
        'eventId', calendar_event_row.id,
        'eventType', 'training',
        'occurrenceDate', occurrence_date_value,
        'playerId', player_row.id,
        'previousStatus', previous_status,
        'responseStatus', 'unavailable',
        'respondedAt', current_training_response.responded_at,
        'source', 'staff_on_behalf'
      );
    end if;

    insert into public.training_availability_responses (
      request_player_id,
      request_id,
      club_id,
      team_id,
      calendar_event_id,
      player_id,
      parent_link_id,
      status,
      note,
      responded_by_name,
      responded_by_email,
      responded_at,
      updated_at
    )
    values (
      training_request_player_row.id,
      training_request_row.id,
      calendar_event_row.club_id,
      calendar_event_row.team_id,
      calendar_event_row.id,
      player_row.id,
      null,
      'unavailable',
      '',
      actor_name,
      actor_email,
      response_time,
      response_time
    )
    on conflict (request_id, player_id)
    do update
    set request_player_id = excluded.request_player_id,
        parent_link_id = null,
        status = 'unavailable',
        note = '',
        responded_by_name = excluded.responded_by_name,
        responded_by_email = excluded.responded_by_email,
        responded_at = excluded.responded_at,
        updated_at = excluded.updated_at;

    update public.training_availability_request_players request_player
    set status = 'responded',
        responded_at = response_time,
        updated_at = response_time
    where request_player.id = training_request_player_row.id;

    insert into public.audit_logs (
      club_id,
      actor_id,
      action,
      entity_type,
      entity_id,
      metadata,
      created_at
    )
    values (
      calendar_event_row.club_id,
      actor_id,
      'event_player_availability_marked_unavailable_on_behalf',
      'calendar_event',
      calendar_event_row.id,
      jsonb_build_object(
        'eventId', calendar_event_row.id,
        'eventType', 'training',
        'occurrenceDate', occurrence_date_value,
        'teamId', calendar_event_row.team_id,
        'playerId', player_row.id,
        'previousStatus', previous_status,
        'newStatus', 'unavailable',
        'source', 'staff_on_behalf'
      ),
      response_time
    );

    if true then perform public.mobile_attendance_record_intent_internal('coach_player',jsonb_build_object('eventType',normalized_event_type,'eventId',event_id_value,'playerId',player_id_value,'occurrenceDate',occurrence_date_value),mobile_intent_key,case when normalized_event_type='match' then 'match:'||match_row.id::text||':'||player_row.id::text else 'training:'||training_request_row.id::text||':'||player_row.id::text end); end if;

    return jsonb_build_object(
      'changed', true,
      'eventId', calendar_event_row.id,
      'eventType', 'training',
      'occurrenceDate', occurrence_date_value,
      'playerId', player_row.id,
      'previousStatus', previous_status,
      'responseStatus', 'unavailable',
      'respondedAt', response_time,
      'source', 'staff_on_behalf'
    );
  end if;

  raise exception 'Mark unavailable supports Match Day and training invitations only.';
end;
$$;

create or replace function public.submit_own_training_coach_attendance(
  attendance_id_value uuid,
  status_value text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  mobile_intent_key text;
  actor_id uuid := auth.uid();
  normalized_status text := lower(btrim(coalesce(status_value, '')));
  attendance_row public.training_coach_attendance%rowtype;
  previous_status text;
  response_time timestamptz := timezone('utc', now());
begin
  if auth.uid() is not null and (true) then
    mobile_intent_key := public.mobile_attendance_lock_intent_internal('coach_self_training',jsonb_build_object('attendanceId',attendance_id_value));
  end if;
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Sign in to respond to this training invitation.';
  end if;
  if normalized_status not in ('available', 'unavailable') then
    raise exception 'Choose Attending or Not attending.';
  end if;

  select attendance.* into attendance_row
  from public.training_coach_attendance attendance
  where attendance.id = attendance_id_value
    and attendance.coach_user_id = actor_id
  for update;

  if attendance_row.id is null then
    raise exception using errcode = '42501', message = 'This training invitation is not assigned to your Coach account.';
  end if;
  if attendance_row.occurrence_starts_at <= response_time
    or not exists (
      select 1 from public.training_availability_requests request
      join public.calendar_events event on event.id = request.calendar_event_id
      where request.id = attendance_row.request_id
        and request.status <> 'cancelled'
        and event.event_type = 'training'
        and event.cancelled_at is null
    ) then
    raise exception 'This training invitation is no longer open.';
  end if;
  if not exists (
    select 1
    from public.users app_user
    join public.team_staff assignment
      on assignment.user_id = app_user.id
     and assignment.team_id = attendance_row.team_id
     and coalesce(assignment.role_rank, 0) >= 20
    where app_user.id = actor_id
      and app_user.club_id = attendance_row.club_id
      and coalesce(app_user.status, 'active') = 'active'
      and app_user.role in ('assistant_coach', 'coach', 'manager', 'head_manager', 'admin')
  ) then
    raise exception using errcode = '42501', message = 'Active Team Coach access is required.';
  end if;

  previous_status := attendance_row.status;
  if previous_status = normalized_status then
    if true then perform public.mobile_attendance_record_intent_internal('coach_self_training',jsonb_build_object('attendanceId',attendance_id_value),mobile_intent_key,'coach:'||attendance_row.id::text); end if;
    return jsonb_build_object(
      'attendanceId', attendance_row.id,
      'changed', false,
      'previousStatus', previous_status,
      'respondedAt', attendance_row.responded_at,
      'status', normalized_status
    );
  end if;

  update public.training_coach_attendance
  set status = normalized_status,
      responded_at = response_time,
      updated_at = response_time
  where id = attendance_row.id;

  insert into public.audit_logs (
    club_id, actor_id, action, entity_type, entity_id, metadata, created_at
  ) values (
    attendance_row.club_id,
    actor_id,
    'training_coach_attendance_updated',
    'calendar_event',
    attendance_row.calendar_event_id,
    jsonb_build_object(
      'attendanceId', attendance_row.id,
      'occurrenceDate', attendance_row.occurrence_date,
      'previousStatus', previous_status,
      'newStatus', normalized_status,
      'teamId', attendance_row.team_id
    ),
    response_time
  );

  if true then perform public.mobile_attendance_record_intent_internal('coach_self_training',jsonb_build_object('attendanceId',attendance_id_value),mobile_intent_key,'coach:'||attendance_row.id::text); end if;

  return jsonb_build_object(
    'attendanceId', attendance_row.id,
    'changed', true,
    'previousStatus', previous_status,
    'respondedAt', response_time,
    'status', normalized_status
  );
end;
$$;

create or replace function public.submit_match_day_availability_response(
  token_hash_value text,
  status_value text,
  volunteer_scorer_response_value text default null,
  volunteer_linesman_response_value text default null,
  volunteer_referee_response_value text default null,
  transport_needs_lift_value boolean default null,
  transport_can_offer_lift_value boolean default null,
  transport_seats_offered_value integer default null
)
returns table (
  request_id uuid,
  player_name text,
  response_status text,
  responded_at timestamptz,
  volunteer_scorer_response text,
  volunteer_linesman_response text,
  volunteer_referee_response text,
  volunteer_responded_at timestamptz,
  transport_needs_lift boolean,
  transport_can_offer_lift boolean,
  transport_seats_offered integer,
  transport_responded_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  mobile_intent_key text;
  normalized_token_hash text := lower(btrim(coalesce(token_hash_value, '')));
  normalized_status text := lower(btrim(coalesce(status_value, '')));
  scorer_response text := lower(btrim(coalesce(volunteer_scorer_response_value, '')));
  linesman_response text := lower(btrim(coalesce(volunteer_linesman_response_value, '')));
  referee_response text := lower(btrim(coalesce(volunteer_referee_response_value, '')));
  request_row public.match_day_availability_requests%rowtype;
  current_response public.match_day_player_availability%rowtype;
  legacy_result record;
  availability_changed boolean := false;
  volunteer_changed boolean := false;
  transport_changed boolean := false;
  next_transport_needs_lift boolean := false;
  next_transport_can_offer_lift boolean := false;
  next_transport_seats_offered integer := 0;
begin
  if (normalized_status in ('available','unavailable','maybe')) and public.is_match_day_action_token_current_internal(normalized_token_hash) then
    mobile_intent_key := public.mobile_attendance_lock_intent_internal('token_match',jsonb_build_object('tokenHash',normalized_token_hash));
  end if;
  if scorer_response not in ('yes', 'no') then scorer_response := null; end if;
  if linesman_response not in ('yes', 'no') then linesman_response := null; end if;
  if referee_response not in ('yes', 'no') then referee_response := null; end if;

  if normalized_status not in ('available', 'unavailable', 'maybe')
    and scorer_response is null
    and linesman_response is null
    and referee_response is null
    and transport_needs_lift_value is null
    and transport_can_offer_lift_value is null
    and transport_seats_offered_value is null then
    return;
  end if;

  if not public.is_match_day_action_token_current_internal(normalized_token_hash) then
    return;
  end if;

  select request.*
  into request_row
  from public.match_day_availability_requests request
  where request.token_hash = normalized_token_hash
  limit 1;

  if request_row.id is null then return; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      concat('reusable_rsvp:match:', request_row.match_day_id::text, ':', request_row.player_id::text),
      0
    )
  );

  if not public.is_match_day_action_token_current_internal(normalized_token_hash) then
    return;
  end if;

  select availability.*
  into current_response
  from public.match_day_player_availability availability
  where availability.match_day_id = request_row.match_day_id
    and availability.player_id = request_row.player_id
    and availability.club_id = request_row.club_id
    and availability.team_id = request_row.team_id
  for update;

  availability_changed := normalized_status in ('available', 'unavailable', 'maybe')
    and coalesce(current_response.status, 'pending') is distinct from normalized_status;

  volunteer_changed :=
    (scorer_response is not null and coalesce(request_row.volunteer_scorer_response, 'no_response') is distinct from scorer_response)
    or (linesman_response is not null and coalesce(request_row.volunteer_linesman_response, 'no_response') is distinct from linesman_response)
    or (referee_response is not null and coalesce(request_row.volunteer_referee_response, 'no_response') is distinct from referee_response);

  next_transport_needs_lift := coalesce(transport_needs_lift_value, request_row.transport_needs_lift, false);
  next_transport_can_offer_lift := coalesce(transport_can_offer_lift_value, request_row.transport_can_offer_lift, false);
  next_transport_seats_offered := case
    when next_transport_can_offer_lift then greatest(coalesce(transport_seats_offered_value, request_row.transport_seats_offered, 0), 0)
    else 0
  end;

  transport_changed :=
    (transport_needs_lift_value is not null or transport_can_offer_lift_value is not null or transport_seats_offered_value is not null)
    and (
      coalesce(request_row.transport_needs_lift, false) is distinct from next_transport_needs_lift
      or coalesce(request_row.transport_can_offer_lift, false) is distinct from next_transport_can_offer_lift
      or coalesce(request_row.transport_seats_offered, 0) is distinct from next_transport_seats_offered
    );

  if not availability_changed and not volunteer_changed and not transport_changed then
    request_id := request_row.id;
    player_name := request_row.player_name;
    response_status := coalesce(current_response.status, nullif(request_row.status, 'pending'), request_row.status);
    responded_at := coalesce(current_response.selected_at, request_row.responded_at);
    volunteer_scorer_response := coalesce(request_row.volunteer_scorer_response, 'no_response');
    volunteer_linesman_response := coalesce(request_row.volunteer_linesman_response, 'no_response');
    volunteer_referee_response := coalesce(request_row.volunteer_referee_response, 'no_response');
    volunteer_responded_at := request_row.volunteer_responded_at;
    transport_needs_lift := coalesce(request_row.transport_needs_lift, false);
    transport_can_offer_lift := coalesce(request_row.transport_can_offer_lift, false);
    transport_seats_offered := coalesce(request_row.transport_seats_offered, 0);
    transport_responded_at := request_row.transport_responded_at;
    if normalized_status in ('available','unavailable','maybe') then perform public.mobile_attendance_record_intent_internal('token_match',jsonb_build_object('tokenHash',normalized_token_hash),mobile_intent_key,'match:'||request_row.match_day_id::text||':'||request_row.player_id::text); end if;
    return next;
    return;
  end if;

  select *
  into legacy_result
  from public.submit_match_day_availability_response_26a_legacy(
    normalized_token_hash,
    case when availability_changed then normalized_status else null end,
    case when scorer_response is not null and coalesce(request_row.volunteer_scorer_response, 'no_response') is distinct from scorer_response then scorer_response else null end,
    case when linesman_response is not null and coalesce(request_row.volunteer_linesman_response, 'no_response') is distinct from linesman_response then linesman_response else null end,
    case when referee_response is not null and coalesce(request_row.volunteer_referee_response, 'no_response') is distinct from referee_response then referee_response else null end,
    case when transport_changed then next_transport_needs_lift else null end,
    case when transport_changed then next_transport_can_offer_lift else null end,
    case when transport_changed then next_transport_seats_offered else null end
  );

  if legacy_result.request_id is null then return; end if;

  request_id := legacy_result.request_id;
  player_name := legacy_result.player_name;
  response_status := case when availability_changed then legacy_result.response_status else coalesce(current_response.status, legacy_result.response_status) end;
  responded_at := case when availability_changed then legacy_result.responded_at else coalesce(current_response.selected_at, legacy_result.responded_at) end;
  volunteer_scorer_response := legacy_result.volunteer_scorer_response;
  volunteer_linesman_response := legacy_result.volunteer_linesman_response;
  volunteer_referee_response := legacy_result.volunteer_referee_response;
  volunteer_responded_at := legacy_result.volunteer_responded_at;
  transport_needs_lift := legacy_result.transport_needs_lift;
  transport_can_offer_lift := legacy_result.transport_can_offer_lift;
  transport_seats_offered := legacy_result.transport_seats_offered;
  transport_responded_at := legacy_result.transport_responded_at;
  if normalized_status in ('available','unavailable','maybe') then perform public.mobile_attendance_record_intent_internal('token_match',jsonb_build_object('tokenHash',normalized_token_hash),mobile_intent_key,'match:'||request_row.match_day_id::text||':'||request_row.player_id::text); end if;
  return next;
end;
$$;

create or replace function public.submit_training_availability_response(
  token_hash_value text,
  status_value text,
  note_value text default ''
)
returns table (
  request_player_id uuid,
  request_id uuid,
  player_name text,
  response_status text,
  response_note text,
  responded_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  mobile_intent_key text;
  normalized_token_hash text := lower(btrim(coalesce(token_hash_value, '')));
  normalized_status text := lower(btrim(coalesce(status_value, '')));
  normalized_note text := left(btrim(coalesce(note_value, '')), 1000);
  request_player_row public.training_availability_request_players%rowtype;
  response_row public.training_availability_responses%rowtype;
  actor_name text := '';
  actor_email text := '';
begin
  if (true) and public.is_training_availability_token_current_internal(normalized_token_hash) then
    mobile_intent_key := public.mobile_attendance_lock_intent_internal('token_training',jsonb_build_object('tokenHash',normalized_token_hash));
  end if;
  if normalized_status not in ('available', 'unavailable', 'maybe') then return; end if;
  if not public.is_training_availability_token_current_internal(normalized_token_hash) then return; end if;

  select recipient.*
  into request_player_row
  from public.training_availability_request_players recipient
  where recipient.token_hash = normalized_token_hash
  limit 1;

  if request_player_row.id is null then return; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      concat('reusable_rsvp:training:', request_player_row.request_id::text, ':', request_player_row.player_id::text),
      0
    )
  );

  if not public.is_training_availability_token_current_internal(normalized_token_hash) then return; end if;

  select recipient.*
  into request_player_row
  from public.training_availability_request_players recipient
  where recipient.token_hash = normalized_token_hash
  for update;

  select response.*
  into response_row
  from public.training_availability_responses response
  where response.request_id = request_player_row.request_id
    and response.player_id = request_player_row.player_id
    and response.club_id = request_player_row.club_id
    and response.team_id = request_player_row.team_id
    and response.calendar_event_id = request_player_row.calendar_event_id
  for update;

  actor_email := coalesce(request_player_row.recipient_email, '');
  actor_name := coalesce(nullif(request_player_row.recipient_name, ''), nullif(actor_email, ''), 'Parent');

  if response_row.id is null then
    insert into public.training_availability_responses (
      request_player_id, request_id, club_id, team_id, calendar_event_id, player_id,
      parent_link_id, status, note, responded_by_name, responded_by_email, responded_at
    ) values (
      request_player_row.id, request_player_row.request_id, request_player_row.club_id,
      request_player_row.team_id, request_player_row.calendar_event_id, request_player_row.player_id,
      request_player_row.parent_link_id, normalized_status, normalized_note,
      actor_name, actor_email, timezone('utc', now())
    )
    returning * into response_row;
  elsif response_row.status is distinct from normalized_status
    or coalesce(response_row.note, '') is distinct from normalized_note then
    update public.training_availability_responses response
    set request_player_id = request_player_row.id,
        parent_link_id = request_player_row.parent_link_id,
        status = normalized_status,
        note = normalized_note,
        responded_by_name = actor_name,
        responded_by_email = actor_email,
        responded_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where response.id = response_row.id
    returning * into response_row;
  end if;

  update public.training_availability_request_players recipient
  set status = 'responded',
      responded_at = response_row.responded_at,
      updated_at = timezone('utc', now())
  where recipient.request_id = request_player_row.request_id
    and recipient.player_id = request_player_row.player_id
    and recipient.club_id = request_player_row.club_id
    and recipient.team_id = request_player_row.team_id
    and recipient.calendar_event_id = request_player_row.calendar_event_id
    and recipient.status not in ('cancelled', 'expired');

  request_player_id := request_player_row.id;
  request_id := response_row.request_id;
  player_name := request_player_row.player_name;
  response_status := response_row.status;
  response_note := response_row.note;
  responded_at := response_row.responded_at;
  if true then perform public.mobile_attendance_record_intent_internal('token_training',jsonb_build_object('tokenHash',normalized_token_hash),mobile_intent_key,'training:'||response_row.request_id::text||':'||request_player_row.player_id::text); end if;
  return next;
end;
$$;

-- END REVIEWED ATTENDANCE CONTRACTS
commit;
