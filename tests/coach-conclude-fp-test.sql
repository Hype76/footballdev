-- Run inside a transaction and roll back. No delivery provider is called.
do $$ begin
  if not exists(select 1 from public.clubs where id='31e8bebc-07fb-4c8b-9ecc-2304d36415ed' and name like 'FP TEST%') then raise exception 'FP TEST boundary missing'; end if;
  if exists(select 1 from public.match_days where id::text like '9a090306-%') then raise exception 'FP TEST collision'; end if;
end $$;
select set_config('request.jwt.claim.sub','79716f3d-f312-4117-ad49-162207c96710',true);
select set_config('request.jwt.claims','{"sub":"79716f3d-f312-4117-ad49-162207c96710","role":"authenticated"}',true);
insert into public.match_days(id,club_id,team_id,opponent,match_date,home_away,parent_visible,request_scorer,enable_motm_poll,motm_notify_results_on_close,match_duration_minutes,parent_audience)
values('9a090306-0000-4000-8000-000000000001','31e8bebc-07fb-4c8b-9ecc-2304d36415ed','492cee77-d3c4-4e07-b31b-6abc07328d25','FP TEST coach conclude',timezone('Europe/London',now())::date,'home',true,false,false,false,8,'involved_players');
insert into public.players(id,club_id,team_id,player_name,section,status)
values('9a090306-0000-4000-8000-000000000002','31e8bebc-07fb-4c8b-9ecc-2304d36415ed','492cee77-d3c4-4e07-b31b-6abc07328d25','FP TEST scorer child','Squad','active');
insert into public.parent_player_links(id,club_id,team_id,player_id,email,auth_user_id,status)
values('9a090306-0000-4000-8000-000000000003','31e8bebc-07fb-4c8b-9ecc-2304d36415ed','492cee77-d3c4-4e07-b31b-6abc07328d25','9a090306-0000-4000-8000-000000000002','fp-test@example.invalid','0397797e-6b6e-4962-bb87-a4e2fd7c20eb','active');
insert into public.match_day_role_assignments(match_day_id,club_id,team_id,role,parent_link_id,auth_user_id,assigned_by)
values('9a090306-0000-4000-8000-000000000001','31e8bebc-07fb-4c8b-9ecc-2304d36415ed','492cee77-d3c4-4e07-b31b-6abc07328d25','scorer','9a090306-0000-4000-8000-000000000003','0397797e-6b6e-4962-bb87-a4e2fd7c20eb','79716f3d-f312-4117-ad49-162207c96710');
set local role authenticated;
select public.set_match_day_player_squad_decision_v2('9a090306-0000-4000-8000-000000000001','9a090306-0000-4000-8000-000000000002','selected',null);
select public.start_match_day('9a090306-0000-4000-8000-000000000001');
reset role;
update public.match_days set timer_started_at=now()-interval '5 minutes' where id='9a090306-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','0397797e-6b6e-4962-bb87-a4e2fd7c20eb',true);
select set_config('request.jwt.claims','{"sub":"0397797e-6b6e-4962-bb87-a4e2fd7c20eb","role":"authenticated"}',true);
set local role authenticated;
select public.set_match_day_timer_state('9a090306-0000-4000-8000-000000000001','half_time');
select public.set_match_day_timer_state('9a090306-0000-4000-8000-000000000001','resume');
do $$ declare result jsonb; begin
  select to_jsonb(e) into result from public.get_parent_portal_match_day_extended_state('9a090306-0000-4000-8000-000000000003') e where e.match_day_id='9a090306-0000-4000-8000-000000000001';
  if result is null or result->>'match_duration_minutes' is distinct from '8' or result->>'match_clock_mode' is distinct from 'fixed' then raise exception 'TEST FAILED parent clock settings missing'; end if;
  select to_jsonb(m) into result from public.get_parent_portal_match_days('9a090306-0000-4000-8000-000000000003') m where m.id='9a090306-0000-4000-8000-000000000001';
  if result is null or result->>'timer_elapsed_seconds' is distinct from '240' or result->>'status' is distinct from 'second_half' then raise exception 'TEST FAILED parent second half not four minutes'; end if;
  perform public.set_match_day_timer_state('9a090306-0000-4000-8000-000000000001','pause');
  result:=public.set_match_day_timer_state('9a090306-0000-4000-8000-000000000001','resume');
  if result->>'timerElapsedSeconds' is distinct from '240' then raise exception 'TEST FAILED parent pause/resume changed clock'; end if;
  if exists(select 1 from public.get_parent_portal_match_day_extended_state('9a090306-0000-4000-8000-000000000099')) then raise exception 'TEST FAILED foreign parent context exposed'; end if;
end $$;
select public.set_match_day_timer_state('9a090306-0000-4000-8000-000000000001','full_time');
do $$ begin
  begin perform public.set_match_day_timer_state('9a090306-0000-4000-8000-000000000001','conclude'); raise exception 'TEST FAILED parent concluded';
  exception when raise_exception then if sqlerrm like 'TEST FAILED%' then raise; end if; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','79716f3d-f312-4117-ad49-162207c96710',true);
select set_config('request.jwt.claims','{"sub":"79716f3d-f312-4117-ad49-162207c96710","role":"authenticated"}',true);
set local role authenticated;
do $$ declare result jsonb; begin
  result:=public.set_match_day_timer_state('9a090306-0000-4000-8000-000000000001','resume');
  if result->>'timerElapsedSeconds' is distinct from '240' then raise exception 'TEST FAILED coach restart changed clock'; end if;
  perform public.set_match_day_timer_state('9a090306-0000-4000-8000-000000000001','pause');
  result:=public.set_match_day_timer_state('9a090306-0000-4000-8000-000000000001','resume');
  if result->>'timerElapsedSeconds' is distinct from '240' then raise exception 'TEST FAILED coach pause/resume changed clock'; end if;
  if not exists(select 1 from public.match_days where id='9a090306-0000-4000-8000-000000000001' and match_duration_minutes=8 and timer_elapsed_seconds=240) then raise exception 'TEST FAILED coach readback lost clock'; end if;
  perform public.set_match_day_timer_state('9a090306-0000-4000-8000-000000000001','full_time');
  result:=public.set_match_day_timer_state('9a090306-0000-4000-8000-000000000001','conclude');
  if coalesce(result->>'concludedAt','')='' then raise exception 'TEST FAILED coach cannot conclude'; end if;
  if public.set_match_day_timer_state('9a090306-0000-4000-8000-000000000001','conclude')->>'alreadyConcluded'<>'true' then raise exception 'TEST FAILED conclusion not idempotent'; end if;
end $$;
reset role;
do $$ begin
  if not exists(select 1 from public.match_days where id='9a090306-0000-4000-8000-000000000001' and status='full_time' and concluded_at is not null and concluded_by='79716f3d-f312-4117-ad49-162207c96710') then raise exception 'TEST FAILED conclusion not persisted'; end if;
end $$;
select 'FP TEST eight-minute clock retained at four minutes through parent and coach restart; parent ended game and coach concluded safely; rollback required' as result;
