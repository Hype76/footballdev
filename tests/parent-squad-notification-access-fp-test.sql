-- Run inside a transaction and roll back. Never call a notification provider.
do $$ begin
  if not exists(select 1 from public.clubs where id='31e8bebc-07fb-4c8b-9ecc-2304d36415ed' and name like 'FP TEST%') then raise exception 'FP TEST boundary missing'; end if;
  if exists(select 1 from public.match_days where id::text like '9a090304-%') then raise exception 'FP TEST collision'; end if;
end $$;
insert into public.match_days(id,club_id,team_id,opponent,match_date,home_away,parent_visible,parent_audience,request_scorer,enable_motm_poll,motm_notify_results_on_close)
values('9a090304-0000-4000-8000-000000000001','31e8bebc-07fb-4c8b-9ecc-2304d36415ed','492cee77-d3c4-4e07-b31b-6abc07328d25','FP TEST selected without invite',current_date+7,'home',true,'involved_players',false,false,false);
insert into public.players(id,club_id,team_id,player_name,section,status)
values('9a090304-0000-4000-8000-000000000002','31e8bebc-07fb-4c8b-9ecc-2304d36415ed','492cee77-d3c4-4e07-b31b-6abc07328d25','FP TEST selected child','Squad','active');
insert into public.parent_player_links(id,club_id,team_id,player_id,email,auth_user_id,status)
values('9a090304-0000-4000-8000-000000000004','31e8bebc-07fb-4c8b-9ecc-2304d36415ed','492cee77-d3c4-4e07-b31b-6abc07328d25','9a090304-0000-4000-8000-000000000002','fp-test-selection-access@example.invalid','0397797e-6b6e-4962-bb87-a4e2fd7c20eb','active');
select set_config('request.jwt.claim.sub','0397797e-6b6e-4962-bb87-a4e2fd7c20eb',true);
select set_config('request.jwt.claims','{"sub":"0397797e-6b6e-4962-bb87-a4e2fd7c20eb","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
  if exists(select 1 from public.get_parent_portal_match_days('9a090304-0000-4000-8000-000000000004') where id='9a090304-0000-4000-8000-000000000001') then raise exception 'TEST FAILED unrelated parent sees uninvited fixture'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','79716f3d-f312-4117-ad49-162207c96710',true);
select set_config('request.jwt.claims','{"sub":"79716f3d-f312-4117-ad49-162207c96710","role":"authenticated"}',true);
set local role authenticated;
select public.set_match_day_player_squad_decision_v2('9a090304-0000-4000-8000-000000000001','9a090304-0000-4000-8000-000000000002','selected',null);
reset role;
select set_config('request.jwt.claim.sub','0397797e-6b6e-4962-bb87-a4e2fd7c20eb',true);
select set_config('request.jwt.claims','{"sub":"0397797e-6b6e-4962-bb87-a4e2fd7c20eb","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.get_parent_portal_match_days('9a090304-0000-4000-8000-000000000004') where id='9a090304-0000-4000-8000-000000000001' and squad_decision_state='selected' and availability_status is null)<>1 then raise exception 'TEST FAILED selected player without invite cannot open match'; end if;
  if (select count(*) from public.get_parent_portal_confirmed_teams('9a090304-0000-4000-8000-000000000004') where match_day_id='9a090304-0000-4000-8000-000000000001' and cardinality(selected_player_names)=0)<>1 then raise exception 'TEST FAILED confirmed squad visibility differs'; end if;
  if not exists(select 1 from public.get_parent_portal_match_day_extended_state('9a090304-0000-4000-8000-000000000004') where match_day_id='9a090304-0000-4000-8000-000000000001') then raise exception 'TEST FAILED extended match inaccessible'; end if;
end $$;
reset role;
do $$ begin
  if exists(select 1 from public.match_day_player_availability where player_id='9a090304-0000-4000-8000-000000000002') then raise exception 'TEST FAILED selection changed attendance'; end if;
  if exists(select 1 from public.match_day_availability_requests where match_day_id='9a090304-0000-4000-8000-000000000001') or exists(select 1 from public.calendar_event_invites where match_day_id='9a090304-0000-4000-8000-000000000001') then raise exception 'TEST FAILED selection created invitation'; end if;
  if exists(select 1 from public.match_day_squad_notifications where parent_link_id='9a090304-0000-4000-8000-000000000004') then raise exception 'TEST FAILED selection sent message'; end if;
end $$;
insert into public.match_day_player_availability(match_day_id,club_id,team_id,player_id,player_name,status,selected_at)
values('9a090304-0000-4000-8000-000000000001','31e8bebc-07fb-4c8b-9ecc-2304d36415ed','492cee77-d3c4-4e07-b31b-6abc07328d25','9a090304-0000-4000-8000-000000000002','FP TEST selected child','available',now());
do $$ begin
  if not exists(select 1 from public.get_parent_portal_confirmed_teams('9a090304-0000-4000-8000-000000000004') where match_day_id='9a090304-0000-4000-8000-000000000001' and selected_player_names=array['FP TEST selected child']) then raise exception 'TEST FAILED confirmed selected player missing'; end if;
end $$;
update public.match_day_player_availability set status='unavailable' where player_id='9a090304-0000-4000-8000-000000000002';
do $$ begin
  if not exists(select 1 from public.get_parent_portal_match_days('9a090304-0000-4000-8000-000000000004') where id='9a090304-0000-4000-8000-000000000001' and availability_status='unavailable') then raise exception 'TEST FAILED attendance changed or hides selection'; end if;
end $$;
select set_config('request.jwt.claim.sub','79716f3d-f312-4117-ad49-162207c96710',true);
select set_config('request.jwt.claims','{"sub":"79716f3d-f312-4117-ad49-162207c96710","role":"authenticated"}',true);
set local role authenticated;
do $$ declare d public.match_day_player_squad_decisions%rowtype; begin
  select * into d from public.match_day_player_squad_decisions where player_id='9a090304-0000-4000-8000-000000000002';
  perform public.set_match_day_player_squad_decision_v2(d.match_day_id,d.player_id,'not_selected',d.decided_at);
end $$;
reset role;
select set_config('request.jwt.claim.sub','0397797e-6b6e-4962-bb87-a4e2fd7c20eb',true);
select set_config('request.jwt.claims','{"sub":"0397797e-6b6e-4962-bb87-a4e2fd7c20eb","role":"authenticated"}',true);
do $$ begin
  if exists(select 1 from public.get_parent_portal_match_days('9a090304-0000-4000-8000-000000000004') where id='9a090304-0000-4000-8000-000000000001') then raise exception 'TEST FAILED unnotified deselection grants access'; end if;
end $$;
select set_config('request.jwt.claim.sub','79716f3d-f312-4117-ad49-162207c96710',true);
select set_config('request.jwt.claims','{"sub":"79716f3d-f312-4117-ad49-162207c96710","role":"authenticated"}',true);
update public.parent_communication_preferences set communication_channel='both' where auth_user_id='0397797e-6b6e-4962-bb87-a4e2fd7c20eb';
set local role authenticated;
do $$ declare d public.match_day_player_squad_decisions%rowtype; begin
  select * into d from public.match_day_player_squad_decisions where player_id='9a090304-0000-4000-8000-000000000002';
  perform public.notify_match_day_squad_decision(d.match_day_id,d.player_id,d.decision_revision);
end $$;
reset role;
select set_config('request.jwt.claim.sub','0397797e-6b6e-4962-bb87-a4e2fd7c20eb',true);
select set_config('request.jwt.claims','{"sub":"0397797e-6b6e-4962-bb87-a4e2fd7c20eb","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
  if not exists(select 1 from public.get_parent_portal_match_days('9a090304-0000-4000-8000-000000000004') where id='9a090304-0000-4000-8000-000000000001' and squad_decision_state='not_selected' and availability_status='unavailable') then raise exception 'TEST FAILED notified deselection cannot open match'; end if;
end $$;
reset role;
do $$ begin
  update public.match_days set parent_visible=false where id='9a090304-0000-4000-8000-000000000001';
  if exists(select 1 from public.get_parent_portal_match_days('9a090304-0000-4000-8000-000000000004') where id='9a090304-0000-4000-8000-000000000001') then raise exception 'TEST FAILED hidden fixture exposed'; end if;
  update public.match_days set parent_visible=true,parent_audience='none' where id='9a090304-0000-4000-8000-000000000001';
  if exists(select 1 from public.get_parent_portal_match_days('9a090304-0000-4000-8000-000000000004') where id='9a090304-0000-4000-8000-000000000001') then raise exception 'TEST FAILED private audience exposed'; end if;
  update public.match_days set parent_audience='involved_players' where id='9a090304-0000-4000-8000-000000000001';
  update public.parent_player_links set status='revoked' where id='9a090304-0000-4000-8000-000000000004';
  if exists(select 1 from public.get_parent_portal_match_days('9a090304-0000-4000-8000-000000000004') where id='9a090304-0000-4000-8000-000000000001') then raise exception 'TEST FAILED revoked link exposed'; end if;
  update public.parent_player_links set status='active' where id='9a090304-0000-4000-8000-000000000004';
  perform set_config('request.jwt.claim.sub','79716f3d-f312-4117-ad49-162207c96710',true);
  perform set_config('request.jwt.claims','{"sub":"79716f3d-f312-4117-ad49-162207c96710","role":"authenticated"}',true);
  update public.players set status='archived' where id='9a090304-0000-4000-8000-000000000002';
  perform set_config('request.jwt.claim.sub','0397797e-6b6e-4962-bb87-a4e2fd7c20eb',true);
  perform set_config('request.jwt.claims','{"sub":"0397797e-6b6e-4962-bb87-a4e2fd7c20eb","role":"authenticated"}',true);
  if exists(select 1 from public.get_parent_portal_match_days('9a090304-0000-4000-8000-000000000004') where id='9a090304-0000-4000-8000-000000000001') then raise exception 'TEST FAILED archived player exposed'; end if;
  perform set_config('request.jwt.claim.sub','79716f3d-f312-4117-ad49-162207c96710',true);
  perform set_config('request.jwt.claims','{"sub":"79716f3d-f312-4117-ad49-162207c96710","role":"authenticated"}',true);
  update public.players set status='active' where id='9a090304-0000-4000-8000-000000000002';
end $$;
select set_config('request.jwt.claim.sub','79716f3d-f312-4117-ad49-162207c96710',true);
select set_config('request.jwt.claims','{"sub":"79716f3d-f312-4117-ad49-162207c96710","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
  if exists(select 1 from public.get_parent_portal_match_days('9a090304-0000-4000-8000-000000000004')) then raise exception 'TEST FAILED another account can read parent fixture'; end if;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform public.get_parent_portal_match_days('9a090304-0000-4000-8000-000000000004'); raise exception 'TEST FAILED anonymous access'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'FP TEST selection notification match access passed; caller must roll back' as result;
