-- Run only inside a transaction, then roll back. Never call a push provider.
do $$ begin
  if not exists(select 1 from public.clubs where id='31e8bebc-07fb-4c8b-9ecc-2304d36415ed' and name like 'FP TEST%') then raise exception 'FP TEST boundary missing'; end if;
  if exists(select 1 from public.match_days where id::text like '9a090303-%') then raise exception 'FP TEST collision'; end if;
end $$;
insert into public.match_days(id,club_id,team_id,opponent,match_date,home_away,parent_visible,request_scorer,enable_motm_poll,motm_notify_results_on_close)
values('9a090303-0000-4000-8000-000000000001','31e8bebc-07fb-4c8b-9ecc-2304d36415ed','492cee77-d3c4-4e07-b31b-6abc07328d25','FP TEST squad notification',current_date+7,'home',true,false,false,false);
insert into public.players(id,club_id,team_id,player_name,section,status)
values('9a090303-0000-4000-8000-000000000002','31e8bebc-07fb-4c8b-9ecc-2304d36415ed','492cee77-d3c4-4e07-b31b-6abc07328d25','FP TEST Alex','Squad','active'),
('9a090303-0000-4000-8000-000000000003','31e8bebc-07fb-4c8b-9ecc-2304d36415ed','492cee77-d3c4-4e07-b31b-6abc07328d25','FP TEST no parent','Squad','active');
insert into public.parent_player_links(id,club_id,team_id,player_id,email,auth_user_id,status,receives_communications)
values('9a090303-0000-4000-8000-000000000004','31e8bebc-07fb-4c8b-9ecc-2304d36415ed','492cee77-d3c4-4e07-b31b-6abc07328d25','9a090303-0000-4000-8000-000000000002','fp-test-squad@example.invalid','0397797e-6b6e-4962-bb87-a4e2fd7c20eb','active',true);
insert into public.parent_mobile_app_installations(installation_id,auth_user_id,platform) values('9a090303-0000-4000-8000-000000000008','0397797e-6b6e-4962-bb87-a4e2fd7c20eb','ios');
update public.parent_communication_preferences set communication_channel='both' where auth_user_id='0397797e-6b6e-4962-bb87-a4e2fd7c20eb';
select set_config('request.jwt.claim.sub','79716f3d-f312-4117-ad49-162207c96710',true);
select set_config('request.jwt.claims','{"sub":"79716f3d-f312-4117-ad49-162207c96710","role":"authenticated"}',true);
set local role authenticated;
select public.set_match_day_player_squad_decision_v2('9a090303-0000-4000-8000-000000000001','9a090303-0000-4000-8000-000000000002','selected',null);
do $$ declare d public.match_day_player_squad_decisions%rowtype; r jsonb; detail jsonb; begin
  select * into d from public.match_day_player_squad_decisions where player_id='9a090303-0000-4000-8000-000000000002';
  if d.notified_at is not null then raise exception 'TEST FAILED saving decision notified parent'; end if;
  r:=public.notify_match_day_squad_decision(d.match_day_id,d.player_id,d.decision_revision);
  if r->>'sent'<>'true' or jsonb_array_length(r->'notificationIds')<>1 then raise exception 'TEST FAILED initial notify'; end if;
  if public.notify_match_day_squad_decision(d.match_day_id,d.player_id,d.decision_revision)->>'alreadySent'<>'true' then raise exception 'TEST FAILED duplicate notification'; end if;
  detail:=public.get_staff_match_day_detail(active_team_id_value=>d.team_id,target_match_day_id_value=>d.match_day_id);
  if not exists(select 1 from jsonb_array_elements(detail->'match_day_player_squad_decisions') row where row->>'decision_revision'=d.decision_revision::text and row->>'notified_at' is not null) then raise exception 'TEST FAILED sent state missing on reload'; end if;
  begin perform 1 from public.match_day_squad_notifications; raise exception 'TEST FAILED receipt table readable'; exception when insufficient_privilege then null; end;
  begin perform public.claim_squad_notification_push('9a090303-0000-4000-8000-000000000001'); raise exception 'TEST FAILED public push claim'; exception when insufficient_privilege then null; end;
  perform public.set_match_day_player_squad_decision_v2(d.match_day_id,d.player_id,'not_selected',d.decided_at);
  begin perform public.notify_match_day_squad_decision(d.match_day_id,d.player_id,d.decision_revision); raise exception 'TEST FAILED stale decision sent';
  exception when raise_exception then if sqlerrm like 'TEST FAILED%' then raise; end if; end;
  select * into d from public.match_day_player_squad_decisions where id=d.id;
  if d.notified_at is not null then raise exception 'TEST FAILED changed decision stayed sent'; end if;
  perform public.notify_match_day_squad_decision(d.match_day_id,d.player_id,d.decision_revision);
end $$;
reset role;
do $$ declare receipt_row public.match_day_squad_notifications%rowtype; r jsonb; begin
  if (select count(*) from public.match_day_squad_notifications n join public.match_day_player_squad_decisions d on d.id=n.decision_id where d.match_day_id='9a090303-0000-4000-8000-000000000001')<>2 then raise exception 'TEST FAILED receipt count'; end if;
  if (select count(*) from public.parent_mobile_notification_events where parent_link_id='9a090303-0000-4000-8000-000000000004' and data->>'matchDayId'='9a090303-0000-4000-8000-000000000001')<>1 then raise exception 'TEST FAILED inbox duplicated'; end if;
  if not exists(select 1 from public.parent_mobile_notification_events where parent_link_id='9a090303-0000-4000-8000-000000000004' and body like '%has not been selected%Thank you for your support.%') then raise exception 'TEST FAILED sensitive copy'; end if;
  if not exists(select 1 from public.parent_mobile_notification_events where parent_link_id='9a090303-0000-4000-8000-000000000004' and position(to_char(current_date+7,'Dy FMDD Mon') in body)>0) then raise exception 'TEST FAILED notification date'; end if;
  for receipt_row in select n.* from public.match_day_squad_notifications n join public.match_day_player_squad_decisions d on d.id=n.decision_id where d.match_day_id='9a090303-0000-4000-8000-000000000001' order by n.created_at,n.id loop
    r:=public.claim_squad_notification_push(receipt_row.id);
    if receipt_row.body like '%has not been selected%' then
      if r is null then raise exception 'TEST FAILED current push claim'; end if;
      if public.claim_squad_notification_push(receipt_row.id) is not null then raise exception 'TEST FAILED concurrent push claim'; end if;
    elsif r is not null then raise exception 'TEST FAILED obsolete decision push'; end if;
  end loop;
end $$;
select set_config('request.jwt.claim.sub','0397797e-6b6e-4962-bb87-a4e2fd7c20eb',true);
select set_config('request.jwt.claims','{"sub":"0397797e-6b6e-4962-bb87-a4e2fd7c20eb","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
  begin perform public.notify_match_day_squad_decision('9a090303-0000-4000-8000-000000000001','9a090303-0000-4000-8000-000000000002',gen_random_uuid()); raise exception 'TEST FAILED parent may notify';
  exception when raise_exception then if sqlerrm like 'TEST FAILED%' then raise; end if; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','79716f3d-f312-4117-ad49-162207c96710',true);
select set_config('request.jwt.claims','{"sub":"79716f3d-f312-4117-ad49-162207c96710","role":"authenticated"}',true);
set local role authenticated;
do $$ declare d public.match_day_player_squad_decisions%rowtype; begin
  perform public.set_match_day_player_squad_decision_v2('9a090303-0000-4000-8000-000000000001','9a090303-0000-4000-8000-000000000003','selected',null);
  select * into d from public.match_day_player_squad_decisions where player_id='9a090303-0000-4000-8000-000000000003';
  begin perform public.notify_match_day_squad_decision(d.match_day_id,d.player_id,d.decision_revision); raise exception 'TEST FAILED no recipient marked sent';
  exception when raise_exception then if sqlerrm like 'TEST FAILED%' then raise; end if; end;
  if exists(select 1 from public.match_day_player_squad_decisions where id=d.id and notified_at is not null) then raise exception 'TEST FAILED empty recipient state'; end if;
end $$;
reset role;
select 'FP TEST squad notification checks passed; caller must roll back' as result;
