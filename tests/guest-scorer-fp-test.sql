-- Run inside a transaction and roll back. Never invoke application delivery from this test.
do $$ begin
  if not exists(select 1 from public.clubs where id='31e8bebc-07fb-4c8b-9ecc-2304d36415ed' and name like 'FP TEST%')
    then raise exception 'FP TEST boundary missing'; end if;
  if exists(select 1 from public.match_days where id::text like '9a090208-%') then raise exception 'FP TEST id collision'; end if;
end $$;

insert into public.match_days(id,club_id,team_id,opponent,match_date,home_away,parent_visible,match_duration_minutes,request_scorer,enable_motm_poll,motm_notify_results_on_close)
values ('9a090208-0000-4000-8000-000000000001','31e8bebc-07fb-4c8b-9ecc-2304d36415ed','492cee77-d3c4-4e07-b31b-6abc07328d25','FP TEST guest scorer',timezone('Europe/London',now())::date,'away',false,10,false,false,false),
('9a090208-0000-4000-8000-000000000002','31e8bebc-07fb-4c8b-9ecc-2304d36415ed','492cee77-d3c4-4e07-b31b-6abc07328d25','FP TEST other fixture',timezone('Europe/London',now())::date,'home',false,10,false,false,false);

insert into public.match_day_player_squad_decisions(match_day_id,club_id,team_id,player_id,status) values
('9a090208-0000-4000-8000-000000000001','31e8bebc-07fb-4c8b-9ecc-2304d36415ed','492cee77-d3c4-4e07-b31b-6abc07328d25','f9dd1339-7622-4db7-ad91-a8f6cc6ed102','selected'),
('9a090208-0000-4000-8000-000000000001','31e8bebc-07fb-4c8b-9ecc-2304d36415ed','492cee77-d3c4-4e07-b31b-6abc07328d25','07ce1fad-371d-42e7-ba88-3b64f3e548ab','selected');

select set_config('request.jwt.claim.sub','79716f3d-f312-4117-ad49-162207c96710',true);
select set_config('request.jwt.claims','{"sub":"79716f3d-f312-4117-ad49-162207c96710","role":"authenticated"}',true);
set local role authenticated;
select public.manage_match_day_guest_scorer('9a090208-0000-4000-8000-000000000001','create',repeat('a',64));
do $$ begin
  begin perform public.guest_match_day_scoring(repeat('a',64),'claim','{}'); raise exception 'TEST FAILED guest RPC publicly callable';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.match_day_guest_sessions; raise exception 'TEST FAILED guest table publicly readable';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.guest_match_day_scoring(repeat('a',64),'claim',jsonb_build_object('name','FP TEST guest','sessionHash',repeat('b',64)));
do $$ begin
  if (public.guest_match_day_scoring(repeat('b',64),'read')->>'status')<>'pending' then raise exception 'TEST FAILED pending'; end if;
  begin perform public.guest_match_day_scoring(repeat('b',64),'start','{}','9a090208-0000-4000-8000-000000000010'); raise exception 'TEST FAILED unapproved write';
  exception when raise_exception then if sqlerrm like 'TEST FAILED%' then raise; end if; end;
  begin perform public.guest_match_day_scoring(repeat('a',64),'claim',jsonb_build_object('name','Second guest','sessionHash',repeat('c',64))); raise exception 'TEST FAILED QR reused';
  exception when raise_exception then if sqlerrm like 'TEST FAILED%' then raise; end if; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','79716f3d-f312-4117-ad49-162207c96710',true);
select set_config('request.jwt.claims','{"sub":"79716f3d-f312-4117-ad49-162207c96710","role":"authenticated"}',true);
set local role authenticated;
do $$ declare s jsonb; begin
  s:=public.manage_match_day_guest_scorer('9a090208-0000-4000-8000-000000000001','status');
  perform public.manage_match_day_guest_scorer('9a090208-0000-4000-8000-000000000001','approve',null,(s->>'id')::uuid);
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
do $$ declare r jsonb; goal jsonb; replay jsonb; event_id text; begin
  r:=public.guest_match_day_scoring(repeat('b',64),'read');
  if r->>'status'<>'approved' or r#>>'{match,id}'<>'9a090208-0000-4000-8000-000000000001' then raise exception 'TEST FAILED approved scope'; end if;
  if r::text like '%parentLink%' or r::text like '%email%' or r::text like '%auth_user%' or r::text like '%staffNotes%' then raise exception 'TEST FAILED private fields'; end if;
  perform public.guest_match_day_scoring(repeat('b',64),'start','{}','9a090208-0000-4000-8000-000000000010');
  if (r#>>'{match,matchDurationMinutes}')::int<>10 or not (r->'match' ? 'clubLogoUrl') then raise exception 'TEST FAILED guest match settings'; end if;
  r:=public.guest_match_day_scoring(repeat('b',64),'event','{"eventType":"yellow_card","teamSide":"club","minute":4,"stoppageMinute":1,"playerName":"FP TEST Player One"}','9a090208-0000-4000-8000-000000000021');
  event_id:=r#>>'{match,events,0,id}';
  if r#>>'{match,events,0,eventType}'<>'yellow_card' or (r#>>'{match,events,0,stoppageMinute}')::int<>1 then raise exception 'TEST FAILED yellow card'; end if;
  replay:=public.guest_match_day_scoring(repeat('b',64),'event','{"eventType":"yellow_card","teamSide":"club","minute":4,"stoppageMinute":1,"playerName":"FP TEST Player One"}','9a090208-0000-4000-8000-000000000021');
  if (replay->>'duplicate')::boolean is not true then raise exception 'TEST FAILED card replay'; end if;
  begin perform public.guest_match_day_scoring(repeat('b',64),'event','{"eventType":"red_card","teamSide":"club","minute":4,"playerName":"FP TEST Player One"}','9a090208-0000-4000-8000-000000000021'); raise exception 'TEST FAILED conflicting card replay';
  exception when raise_exception then if sqlerrm like 'TEST FAILED%' then raise; end if; end;
  perform public.guest_match_day_scoring(repeat('b',64),'event','{"eventType":"red_card","teamSide":"club","minute":4,"playerName":"FP TEST Adult Player"}','9a090208-0000-4000-8000-000000000022');
  perform public.guest_match_day_scoring(repeat('b',64),'event','{"eventType":"substitution","teamSide":"club","minute":4,"playerName":"FP TEST Player One","playerOnName":"FP TEST Adult Player"}','9a090208-0000-4000-8000-000000000023');
  perform public.guest_match_day_scoring(repeat('b',64),'remove_event',jsonb_build_object('eventId',event_id),'9a090208-0000-4000-8000-000000000024');
  begin perform public.guest_match_day_scoring(repeat('b',64),'event','{"eventType":"red_card","teamSide":"club","minute":4,"playerName":"Unselected person"}','9a090208-0000-4000-8000-000000000025'); raise exception 'TEST FAILED unselected participant';
  exception when raise_exception then if sqlerrm like 'TEST FAILED%' then raise; end if; end;
  goal:=jsonb_build_object('teamSide','opponent','scorerName','FP TEST own goal','assistName','Must clear','minute',10,'stoppageMinute',5,'isOwnGoal',true);
  r:=public.guest_match_day_scoring(repeat('b',64),'goal',goal,'9a090208-0000-4000-8000-000000000011');
  if (r#>>'{match,homeScore}')::int<>1 or (r#>>'{match,awayScore}')::int<>0 then raise exception 'TEST FAILED away score'; end if;
  replay:=public.guest_match_day_scoring(repeat('b',64),'goal',goal,'9a090208-0000-4000-8000-000000000011');
  if (replay->>'duplicate')::boolean is not true or (replay#>>'{match,homeScore}')::int<>1 then raise exception 'TEST FAILED replay'; end if;
  begin perform public.guest_match_day_scoring(repeat('b',64),'goal',goal||'{"scorerName":"Changed"}','9a090208-0000-4000-8000-000000000011'); raise exception 'TEST FAILED conflicting replay';
  exception when raise_exception then if sqlerrm like 'TEST FAILED%' then raise; end if; end;
  event_id:=r#>>'{match,events,0,id}';
  perform public.guest_match_day_scoring(repeat('b',64),'correct_goal',goal||jsonb_build_object('eventId',event_id,'scorerName','FP TEST corrected','reason','Wrong name'),'9a090208-0000-4000-8000-000000000012');
  perform public.guest_match_day_scoring(repeat('b',64),'remove_goal',jsonb_build_object('eventId',event_id,'reason','Duplicate entry'),'9a090208-0000-4000-8000-000000000013');
  r:=public.guest_match_day_scoring(repeat('b',64),'score','{"homeScore":2,"awayScore":1,"reason":"Optional reason"}','9a090208-0000-4000-8000-000000000014');
  if (r#>>'{match,homeScore}')::int<>2 then raise exception 'TEST FAILED corrected score'; end if;
  begin perform public.guest_match_day_scoring(repeat('b',64),'timer','{"action":"conclude"}','9a090208-0000-4000-8000-000000000015'); raise exception 'TEST FAILED guest conclude';
  exception when raise_exception then if sqlerrm like 'TEST FAILED%' then raise; end if; end;
  perform public.guest_match_day_scoring(repeat('b',64),'timer','{"action":"half_time"}','9a090208-0000-4000-8000-000000000016');
  r:=public.guest_match_day_scoring(repeat('b',64),'timer','{"action":"resume"}','9a090208-0000-4000-8000-000000000017');
  if (r#>>'{match,timerElapsedSeconds}')::int<>300 then raise exception 'TEST FAILED 10 minute second half clock'; end if;
  r:=public.guest_match_day_scoring(repeat('b',64),'timer','{"action":"full_time"}','9a090208-0000-4000-8000-000000000018');
  if r->>'status'<>'finished' then raise exception 'TEST FAILED full time'; end if;
  r:=public.claim_guest_match_notification(repeat('b',64),'9a090208-0000-4000-8000-000000000018');
  if r#>>'{details,action}'<>'full_time' then raise exception 'TEST FAILED review notification'; end if;
  perform public.claim_guest_match_notification(repeat('b',64),'9a090208-0000-4000-8000-000000000018',true);
  if public.claim_guest_match_notification(repeat('b',64),'9a090208-0000-4000-8000-000000000018') is not null then raise exception 'TEST FAILED duplicate notification'; end if;
  if public.guest_match_day_scoring(repeat('b',64),'read')->>'status'<>'finished' then raise exception 'TEST FAILED finished scope'; end if;
  begin perform public.guest_match_day_scoring(repeat('b',64),'goal',goal,'9a090208-0000-4000-8000-000000000019'); raise exception 'TEST FAILED write after full time';
  exception when raise_exception then if sqlerrm like 'TEST FAILED%' then raise; end if; end;
end $$;
reset role;
do $$ begin
  if not exists(select 1 from public.match_days where id='9a090208-0000-4000-8000-000000000001' and status='full_time' and concluded_at is null and home_score=2 and away_score=1) then raise exception 'TEST FAILED coach review state'; end if;
  if not exists(select 1 from public.match_day_events where match_day_id='9a090208-0000-4000-8000-000000000001' and created_by is null and created_by_name='FP TEST guest' and scorer_name='FP TEST corrected' and is_own_goal and assist_name='' and stoppage_minute=5 and event_status='voided') then raise exception 'TEST FAILED guest attribution'; end if;
  if not exists(select 1 from public.match_days where id='9a090208-0000-4000-8000-000000000002' and status='scheduled' and home_score=0) then raise exception 'TEST FAILED other fixture mutated'; end if;
end $$;
-- Revoke after a second approval and prove the old session is unusable.
select set_config('request.jwt.claim.sub','79716f3d-f312-4117-ad49-162207c96710',true);
select set_config('request.jwt.claims','{"sub":"79716f3d-f312-4117-ad49-162207c96710","role":"authenticated"}',true);
select public.manage_match_day_guest_scorer('9a090208-0000-4000-8000-000000000002','create',repeat('d',64));
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select public.guest_match_day_scoring(repeat('d',64),'claim',jsonb_build_object('name','FP TEST replacement','sessionHash',repeat('e',64)));
select set_config('request.jwt.claim.sub','79716f3d-f312-4117-ad49-162207c96710',true);
select set_config('request.jwt.claims','{"sub":"79716f3d-f312-4117-ad49-162207c96710","role":"authenticated"}',true);
do $$ declare s jsonb; begin
  s:=public.manage_match_day_guest_scorer('9a090208-0000-4000-8000-000000000002','status');
  perform public.manage_match_day_guest_scorer('9a090208-0000-4000-8000-000000000002','approve',null,(s->>'id')::uuid);
  perform public.manage_match_day_guest_scorer('9a090208-0000-4000-8000-000000000002','revoke',null,(s->>'id')::uuid);
end $$;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$ begin
  begin perform public.guest_match_day_scoring(repeat('e',64),'read'); raise exception 'TEST FAILED revoked session read';
  exception when raise_exception then if sqlerrm like 'TEST FAILED%' then raise; end if; end;
end $$;

-- The service endpoint must still enforce expiry, even with a previously valid capability.
update public.match_day_guest_sessions set status='approved',expires_at=now()-interval '1 second'
where match_day_id='9a090208-0000-4000-8000-000000000002';
do $$ begin
  begin perform public.guest_match_day_scoring(repeat('e',64),'read'); raise exception 'TEST FAILED expired session read';
  exception when raise_exception then if sqlerrm like 'TEST FAILED%' then raise; end if; end;
end $$;
