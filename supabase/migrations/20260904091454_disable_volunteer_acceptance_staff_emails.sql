create or replace function public.notify_staff_on_volunteer_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  role_change record;
  parent_link_row public.parent_player_links%rowtype;
  parent_display_name text;
  role_label text;
begin
  for role_change in
    select *
    from (values
      ('scorer'::text, old.volunteer_scorer_response, new.volunteer_scorer_response),
      ('linesman'::text, old.volunteer_linesman_response, new.volunteer_linesman_response),
      ('referee'::text, old.volunteer_referee_response, new.volunteer_referee_response)
    ) response_change(role_type, previous_response, next_response)
  loop
    if coalesce(role_change.previous_response, 'no_response') = 'yes'
      or coalesce(role_change.next_response, 'no_response') <> 'yes' then
      continue;
    end if;

    begin
      select parent_link.*
      into parent_link_row
      from public.parent_player_links parent_link
      where parent_link.id = new.parent_link_id
        and parent_link.club_id = new.club_id
        and parent_link.player_id = new.player_id
        and parent_link.status = 'active'
      limit 1;

      parent_display_name := coalesce(
        nullif(btrim(new.recipient_name), ''),
        nullif(btrim(parent_link_row.email), ''),
        nullif(btrim(new.recipient_email), ''),
        'A parent or guardian'
      );
      role_label := initcap(role_change.role_type);

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
        metadata
      )
      values (
        new.club_id,
        new.team_id,
        new.match_day_id,
        new.player_id,
        parent_link_row.auth_user_id,
        parent_display_name,
        'Parent volunteer',
        'volunteer_role_accepted',
        concat(parent_display_name, ' accepted ', lower(role_label)),
        jsonb_build_object('response', coalesce(role_change.previous_response, 'no_response')),
        jsonb_build_object('response', role_change.next_response),
        jsonb_build_object(
          'source', 'match_day_availability_response_transition',
          'requestId', new.id,
          'parentLinkId', new.parent_link_id,
          'role', role_change.role_type,
          'emailSuppressed', true,
          'suppressionReason', 'staff_volunteer_acceptance_email_disabled',
          'queuedNotificationCount', 0,
          'failedNotificationCount', 0
        )
      );
    exception when others then
      null;
    end;
  end loop;

  return new;
exception when others then
  return new;
end;
$$;

revoke all on function public.notify_staff_on_volunteer_acceptance() from public, anon, authenticated;
grant execute on function public.notify_staff_on_volunteer_acceptance() to service_role;

comment on function public.notify_staff_on_volunteer_acceptance() is
  'Records volunteer acceptance for Match Day visibility without sending staff confirmation emails.';
