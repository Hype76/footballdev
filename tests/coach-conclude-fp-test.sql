-- Run inside a transaction and roll back. No delivery provider is called.
do $$ begin
  if not exists(select 1 from public.clubs where id='31e8bebc-07fb-4c8b-9ecc-2304d36415ed' and name like 'FP TEST%') then raise exception 'FP TEST boundary missing'; end if;
  if exists(select 1 from public.match_days where id::text like '9a090306-%') then raise exception 'FP TEST collision'; end if;
end $$;
select set_config('request.jwt.claim.sub','79716f3d-f312-4117-ad49-162207c96710',true);
select set_config('request.jwt.claims','{"sub":"79716f3d-f312-4117-ad49-162207c96710","role":"authenticated"}',true);
insert into public.match_days(id,club_id,team_id,opponent,match_date,home_away,parent_visible,request_scorer,enable_motm_poll,motm_notify_results_on_close)
values('9a090306-0000-4000-8000-000000000001','31e8bebc-07fb-4c8b-9ecc-2304d36415ed','492cee77-d3c4-4e07-b31b-6abc07328d25','FP TEST coach conclude',timezone('Europe/London',now())::date,'home',true,false,false,false);
insert into public.players(id,club_id,team_id,player_name,section,status)
values('9a090306-0000-4000-8000-000000000002','31e8bebc-07fb-4c8b-9ecc-2304d36415ed','492cee77-d3c4-4e07-b31b-6abc07328d25','FP TEST scorer child','Squad','active');
insert into public.parent_player_links(id,club_id,team_id,player_id,email,auth_user_id,status)
values('9a090306-0000-4000-8000-000000000003','31e8bebc-07fb-4c8b-9ecc-2304d36415ed','492cee77-d3c4-4e07-b31b-6abc07328d25','9a090306-0000-4000-8000-000000000002','fp-test@example.invalid','0397797e-6b6e-4962-bb87-a4e2fd7c20eb','active');
insert into public.match_day_role_assignments(match_day_id,club_id,team_id,role,parent_link_id,auth_user_id,assigned_by)
values('9a090306-0000-4000-8000-000000000001','31e8bebc-07fb-4c8b-9ecc-2304d36415ed','492cee77-d3c4-4e07-b31b-6abc07328d25','scorer','9a090306-0000-4000-8000-000000000003','0397797e-6b6e-4962-bb87-a4e2fd7c20eb','79716f3d-f312-4117-ad49-162207c96710');
set local role authenticated;
select public.start_match_day('9a090306-0000-4000-8000-000000000001');
reset role;
select set_config('request.jwt.claim.sub','0397797e-6b6e-4962-bb87-a4e2fd7c20eb',true);
select set_config('request.jwt.claims','{"sub":"0397797e-6b6e-4962-bb87-a4e2fd7c20eb","role":"authenticated"}',true);
set local role authenticated;
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
  result:=public.set_match_day_timer_state('9a090306-0000-4000-8000-000000000001','conclude');
  if coalesce(result->>'concludedAt','')='' then raise exception 'TEST FAILED coach cannot conclude'; end if;
  if public.set_match_day_timer_state('9a090306-0000-4000-8000-000000000001','conclude')->>'alreadyConcluded'<>'true' then raise exception 'TEST FAILED conclusion not idempotent'; end if;
end $$;
reset role;
do $$ begin
  if not exists(select 1 from public.match_days where id='9a090306-0000-4000-8000-000000000001' and status='full_time' and concluded_at is not null and concluded_by='79716f3d-f312-4117-ad49-162207c96710') then raise exception 'TEST FAILED conclusion not persisted'; end if;
end $$;
select 'FP TEST parent ended game, coach concluded and repeated safely; rollback required' as result;
