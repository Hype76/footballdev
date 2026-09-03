-- Run after the squad/bulk FP TEST scripts in the same rollback transaction.
select set_config('request.jwt.claim.sub','79716f3d-f312-4117-ad49-162207c96710',true);
select set_config('request.jwt.claims','{"sub":"79716f3d-f312-4117-ad49-162207c96710","role":"authenticated"}',true);
insert into public.players(id,club_id,team_id,player_name,section,status,parent_email,parent_contacts,contact_type)
values('9a090305-0000-4000-8000-000000000001','31e8bebc-07fb-4c8b-9ecc-2304d36415ed','492cee77-d3c4-4e07-b31b-6abc07328d25','FP TEST email only','Squad','active','fp-test-fallback@example.invalid','[]','parent');
set local role authenticated;
select public.set_match_day_player_squad_decision_v2('9a090303-0000-4000-8000-000000000001','9a090305-0000-4000-8000-000000000001','selected',null);
do $$ declare flags record; d public.match_day_player_squad_decisions%rowtype; r jsonb; begin
  select * into flags from public.get_match_day_squad_notification_contacts('9a090303-0000-4000-8000-000000000001') where player_id='9a090305-0000-4000-8000-000000000001';
  if flags.can_notify is not true or flags.email_recipient_count<>1 or flags.app_recipient_count<>0 then raise exception 'TEST FAILED unsigned parent email flags'; end if;
  select * into d from public.match_day_player_squad_decisions where player_id='9a090305-0000-4000-8000-000000000001';
  r:=public.notify_match_day_squad_decision(d.match_day_id,d.player_id,d.decision_revision);
  if r->>'sent'<>'true' or jsonb_array_length(r->'notificationIds')<>1 then raise exception 'TEST FAILED email fallback not queued'; end if;
  if public.notify_match_day_squad_decision(d.match_day_id,d.player_id,d.decision_revision)->>'alreadySent'<>'true' then raise exception 'TEST FAILED duplicate email'; end if;
end $$;
reset role;
do $$ declare n public.match_day_squad_notifications%rowtype; begin
  select n1.* into n from public.match_day_squad_notifications n1 join public.match_day_player_squad_decisions d on d.id=n1.decision_id where d.player_id='9a090305-0000-4000-8000-000000000001';
  if n.delivery_channel<>'email' or n.recipient_email<>'fp-test-fallback@example.invalid' or n.parent_link_id is not null then raise exception 'TEST FAILED email recipient'; end if;
  if public.claim_squad_notification_push(n.id) is null then raise exception 'TEST FAILED email worker cannot claim'; end if;
  if public.claim_squad_notification_push(n.id) is not null then raise exception 'TEST FAILED duplicate email claim'; end if;
end $$;
select set_config('request.jwt.claim.sub','0397797e-6b6e-4962-bb87-a4e2fd7c20eb',true);
select set_config('request.jwt.claims','{"sub":"0397797e-6b6e-4962-bb87-a4e2fd7c20eb","role":"authenticated"}',true);
set local role authenticated;
do $$ begin
  begin perform public.get_match_day_squad_notification_contacts('9a090303-0000-4000-8000-000000000001'); raise exception 'TEST FAILED parent read coach contact flags';
  exception when raise_exception then if sqlerrm like 'TEST FAILED%' then raise; end if; end;
end $$;
reset role;
select 'FP TEST unsigned-parent email, idempotency, claim and access checks passed; rollback required' as result;
