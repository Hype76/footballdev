-- Add adult delivery after the existing authorized Calendar command has resolved its players.
alter function public.notify_calendar_event_parents(uuid, text, uuid, uuid, uuid[])
  rename to notify_calendar_event_parents_before_adult_dispatch;
revoke all on function public.notify_calendar_event_parents_before_adult_dispatch(uuid, text, uuid, uuid, uuid[])
  from public, anon, authenticated;

create function public.is_adult_calendar_notification_current(player_value uuid, club_value uuid, team_value uuid, email_value text)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.adult_player_contact_is_current(player_value, club_value, team_value, email_value)
$$;
revoke all on function public.is_adult_calendar_notification_current(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.is_adult_calendar_notification_current(uuid,uuid,uuid,text) to service_role;

create function public.notify_calendar_event_parents(calendar_event_id_value uuid, event_action_value text,
  match_day_id_value uuid, notification_request_token_value uuid, player_ids_value uuid[] default '{}'::uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  result_value jsonb; command_row public.calendar_event_notification_commands; event_row public.calendar_events;
  recipient record; notification_id uuid; queue_id uuid; adult_eligible integer := 0; adult_queued integer := 0;
  adult_failed integer := 0; adult_duplicate integer := 0; already_parent boolean; result_total jsonb;
begin
  result_value := public.notify_calendar_event_parents_before_adult_dispatch(calendar_event_id_value,
    event_action_value, match_day_id_value, notification_request_token_value, player_ids_value);
  if result_value ? 'adultDispatchVersion' then return result_value; end if;
  if calendar_event_id_value is null or match_day_id_value is not null then return result_value; end if;
  select * into command_row from public.calendar_event_notification_commands
    where id = nullif(result_value->>'notificationCommandId','')::uuid and requested_by = auth.uid() for update;
  if command_row.id is null then return result_value; end if;
  -- A duplicate command must retain its completed counts and never enqueue again.
  if command_row.result ? 'adultDispatchVersion' then return command_row.result; end if;
  select * into event_row from public.calendar_events where id = calendar_event_id_value
    and club_id = command_row.club_id and team_id = command_row.team_id and cancelled_at is null;
  if event_row.id is null or event_row.event_type in ('training','match_day') then return result_value; end if;

  for recipient in
    select distinct on (i.player_id) i.id as invite_id, i.player_id, lower(btrim(a.email)) as email
    from public.calendar_event_invites i
    join public.adult_player_account_links l on l.player_id=i.player_id and l.club_id=i.club_id and l.team_id=i.team_id
    join auth.users a on a.id=l.user_id
    where i.calendar_event_id=event_row.id and i.club_id=command_row.club_id and i.team_id=command_row.team_id
      and i.player_id=any(command_row.player_ids) and i.invite_status <> 'cancelled' and i.cancelled_at is null
      and app_private.adult_player_contact_is_current(i.player_id,i.club_id,i.team_id,a.email)
    order by i.player_id, l.verified_at, l.id
  loop
    adult_eligible := adult_eligible + 1;
    select exists(select 1 from public.parent_player_links p join auth.users a on a.id=p.auth_user_id
      left join public.users u on u.id=p.auth_user_id
      where p.id=(select parent_link_id from public.calendar_event_invites where id=recipient.invite_id)
        and p.player_id=recipient.player_id and p.club_id=command_row.club_id and p.team_id=command_row.team_id
        and p.status='active' and coalesce(u.status,'active')='active'
        and a.deleted_at is null and a.email_confirmed_at is not null
        and (a.banned_until is null or a.banned_until <= now())
        and lower(btrim(a.email))=lower(btrim(p.email))) into already_parent;
    update public.calendar_event_invites set recipient_type=case when already_parent then 'parent_and_player' else 'player' end,
      player_contact_email=recipient.email where id=recipient.invite_id;
    notification_id := null; queue_id := null;
    insert into public.calendar_event_notification_events
      (club_id,team_id,calendar_event_id,notification_command_id,event_revision,notification_type,event_action_type,
       parent_link_id,player_id,recipient_email,idempotency_key,portal_state,response_requirement,status,requested_by)
    values (command_row.club_id,command_row.team_id,event_row.id,command_row.id,command_row.event_revision,
      command_row.notification_type,'informational',null,recipient.player_id,recipient.email,
      concat('calendar-notify-command:',command_row.id,':',recipient.email),'ready','informational','pending',command_row.requested_by)
    on conflict (notification_command_id,lower(recipient_email)) where notification_command_id is not null do nothing
    returning id into notification_id;
    if notification_id is null then adult_duplicate := adult_duplicate+1; continue; end if;
    begin
      insert into public.scheduled_email_queue(club_id,team_id,created_by,to_email,subject,status,scheduled_at,payload)
      values (command_row.club_id,command_row.team_id,command_row.requested_by,recipient.email,
        'Your Calendar invitation','scheduled',timezone('utc',now()),
        jsonb_build_object('requiredFeature','parentEmails','visibleInEmailQueue',true,
          'resendPayload',jsonb_build_object('to',jsonb_build_array(recipient.email),'subject','Your Calendar invitation','html','<p>Calendar invitation</p>'),
          'communicationLog',jsonb_build_object('metadata',jsonb_build_object('source','calendar_adult_event_notification',
            'notificationCommandId',command_row.id,'calendarEventId',event_row.id)))) returning id into queue_id;
      update public.calendar_event_notification_events set status='queued',email_queue_id=queue_id,updated_at=timezone('utc',now()) where id=notification_id;
      adult_queued := adult_queued+1;
    exception when others then
      update public.calendar_event_notification_events set status='failed',last_error=left(sqlerrm,1000),updated_at=timezone('utc',now()) where id=notification_id;
      adult_failed := adult_failed+1;
    end;
  end loop;
  result_total := result_value || jsonb_build_object('adultDispatchVersion',1,'adultEligibleRecipientCount',adult_eligible,
    'adultQueuedCount',adult_queued,'adultFailedCount',adult_failed,'adultDuplicateCount',adult_duplicate,
    'eligibleRecipientCount',coalesce((result_value->>'eligibleRecipientCount')::int,0)+adult_eligible,
    'queuedCount',coalesce((result_value->>'queuedCount')::int,0)+adult_queued,
    'failedCount',coalesce((result_value->>'failedCount')::int,0)+adult_failed,
    'duplicateCount',coalesce((result_value->>'duplicateCount')::int,0)+adult_duplicate,
    'finalState',case when adult_failed>0 then 'portal_ready_email_partial' when adult_queued>0 then 'portal_ready_email_queued' else result_value->>'finalState' end);
  update public.calendar_event_notification_commands set result=result_total where id=command_row.id;
  return result_total;
end;
$$;
revoke all on function public.notify_calendar_event_parents(uuid,text,uuid,uuid,uuid[]) from public, anon;
grant execute on function public.notify_calendar_event_parents(uuid,text,uuid,uuid,uuid[]) to authenticated, service_role;
