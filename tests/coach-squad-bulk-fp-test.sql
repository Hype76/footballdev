-- Run after coach-squad-notify-fp-test.sql, in the same transaction, then roll back.
-- This test never invokes a push provider.
update public.parent_player_links set receives_communications=false where id='9a090303-0000-4000-8000-000000000004';
set local role authenticated;
do $$ declare d public.match_day_player_squad_decisions%rowtype; missing public.match_day_player_squad_decisions%rowtype; items jsonb; r jsonb; begin
  select * into d from public.match_day_player_squad_decisions where player_id='9a090303-0000-4000-8000-000000000002';
  perform public.set_match_day_player_squad_decision_v2(d.match_day_id,d.player_id,'selected',d.decided_at);
  select * into d from public.match_day_player_squad_decisions where id=d.id;
  select * into missing from public.match_day_player_squad_decisions where player_id='9a090303-0000-4000-8000-000000000003';
  items:=jsonb_build_array(jsonb_build_object('playerId',d.player_id,'revision',d.decision_revision),jsonb_build_object('playerId',missing.player_id,'revision',missing.decision_revision));
  r:=public.notify_match_day_squad_decisions(d.match_day_id,items);
  if (select count(*) from jsonb_array_elements(r->'results') x where x->>'sent'='true')<>1
    or (select count(*) from jsonb_array_elements(r->'results') x where x->>'sent'='false' and x->>'message' like 'No contact details%')<>1
    or jsonb_array_length(r->'notificationIds')<>1 then raise exception 'TEST FAILED mixed batch or legacy default blocked'; end if;
  r:=public.notify_match_day_squad_decisions(d.match_day_id,items);
  if jsonb_array_length(r->'notificationIds')<>0 or not exists(select 1 from jsonb_array_elements(r->'results') x where x->>'alreadySent'='true') then raise exception 'TEST FAILED repeat batch duplicated notification'; end if;
  begin perform public.notify_match_day_squad_decisions(d.match_day_id,jsonb_build_array(items->0,items->0)); raise exception 'TEST FAILED duplicate players accepted';
  exception when raise_exception then if sqlerrm like 'TEST FAILED%' then raise; end if; end;
  begin perform public.notify_match_day_squad_decisions(d.match_day_id,'[]'::jsonb); raise exception 'TEST FAILED empty batch accepted';
  exception when raise_exception then if sqlerrm like 'TEST FAILED%' then raise; end if; end;
  perform public.set_match_day_player_squad_decision_v2(d.match_day_id,d.player_id,'not_selected',d.decided_at);
end $$;
reset role;
update public.parent_communication_preferences set communication_channel='email' where auth_user_id='0397797e-6b6e-4962-bb87-a4e2fd7c20eb';
set local role authenticated;
do $$ declare d public.match_day_player_squad_decisions%rowtype; r jsonb; begin
  select * into d from public.match_day_player_squad_decisions where player_id='9a090303-0000-4000-8000-000000000002';
  r:=public.notify_match_day_squad_decisions(d.match_day_id,jsonb_build_array(jsonb_build_object('playerId',d.player_id,'revision',d.decision_revision)));
  if r#>>'{results,0,sent}'<>'true' then raise exception 'TEST FAILED email preference not honoured'; end if;
  perform public.set_match_day_player_squad_decision_v2(d.match_day_id,d.player_id,'selected',d.decided_at);
end $$;
reset role;
update public.parent_communication_preferences set communication_channel='both' where auth_user_id='0397797e-6b6e-4962-bb87-a4e2fd7c20eb';
insert into public.guardians(id,club_id,transfer_reference,first_name,last_name)
values('9a090303-0000-4000-8000-000000000005','31e8bebc-07fb-4c8b-9ecc-2304d36415ed','FP TEST BULK NOTIFY','FP TEST','Guardian');
update public.parent_player_links set guardian_id='9a090303-0000-4000-8000-000000000005' where id='9a090303-0000-4000-8000-000000000004';
set local role authenticated;
do $$ declare d public.match_day_player_squad_decisions%rowtype; r jsonb; begin
  select * into d from public.match_day_player_squad_decisions where player_id='9a090303-0000-4000-8000-000000000002';
  r:=public.notify_match_day_squad_decisions(d.match_day_id,jsonb_build_array(jsonb_build_object('playerId',d.player_id,'revision',d.decision_revision)));
  if r#>>'{results,0,sent}'<>'false' or d.notified_at is not null then raise exception 'TEST FAILED explicit guardian opt-out ignored'; end if;
end $$;
reset role;
do $$ begin
  if has_function_privilege('anon','public.notify_match_day_squad_decisions(uuid,jsonb)','execute') then raise exception 'TEST FAILED anonymous batch permission'; end if;
  if (select count(*) from public.match_day_squad_notifications n join public.match_day_player_squad_decisions d on d.id=n.decision_id where d.match_day_id='9a090303-0000-4000-8000-000000000001')<>4 then raise exception 'TEST FAILED final receipt count'; end if;
  if (select count(*) from public.parent_mobile_notification_events where parent_link_id='9a090303-0000-4000-8000-000000000004')<>1 then raise exception 'TEST FAILED final inbox count'; end if;
end $$;
-- Installed linked accounts count even when the Player contact snapshot is different.
update public.players set parent_email='old-contact@example.invalid',parent_contacts='[]'::jsonb,contact_type='parent'
where id='9a090303-0000-4000-8000-000000000002';
insert into public.parent_mobile_app_installations(installation_id,auth_user_id,platform)
values('9a090303-0000-4000-8000-000000000006','0397797e-6b6e-4962-bb87-a4e2fd7c20eb','ios'),
('9a090303-0000-4000-8000-000000000007','0397797e-6b6e-4962-bb87-a4e2fd7c20eb','android');
set local role authenticated;
do $$ declare row record; begin
  select * into row from public.get_team_parent_app_installation_status('492cee77-d3c4-4e07-b31b-6abc07328d25') where player_id='9a090303-0000-4000-8000-000000000002';
  if row.parent_contact_count<>2 or row.installed_contact_count<>1 then raise exception 'TEST FAILED linked account missing or devices double counted'; end if;
  if exists(select 1 from public.get_team_parent_app_installation_status('84217e7a-8979-4922-b00a-565252a59892')) then raise exception 'TEST FAILED installation counts leaked across clubs'; end if;
end $$;
reset role;
update public.parent_player_links set status='revoked' where id='9a090303-0000-4000-8000-000000000004';
set local role authenticated;
do $$ declare row record; begin
  select * into row from public.get_team_parent_app_installation_status('492cee77-d3c4-4e07-b31b-6abc07328d25') where player_id='9a090303-0000-4000-8000-000000000002';
  if row.parent_contact_count<>1 or row.installed_contact_count<>0 then raise exception 'TEST FAILED revoked link counted as installed'; end if;
end $$;
reset role;
select 'FP TEST bulk notifications, opt-outs and linked app indicators passed; caller must roll back' as result;
