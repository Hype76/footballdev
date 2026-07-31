update public.analytics_events
set actor_role_family = 'club_admin'
where actor_role_at_event = 'admin'
  and actor_role_family = 'unknown';

create or replace function public.canonicalize_analytics_event_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.received_at := coalesce(new.received_at, timezone('utc', now()));
  new.actor_auth_user_id := coalesce(new.actor_auth_user_id, new.user_id);
  new.actor_profile_id := coalesce(new.actor_profile_id, new.user_id);
  new.actor_role_at_event := coalesce(nullif(new.actor_role_at_event, 'unknown'), new.role, 'unknown');
  new.actor_role_family := case
    when new.actor_role_at_event = 'super_admin' then 'platform_admin'
    when new.actor_role_at_event in ('admin', 'club_admin') then 'club_admin'
    when new.actor_role_at_event in ('parent', 'parent_portal') then 'parent'
    when new.actor_role_at_event = 'adult_player' then 'player'
    when new.actor_role_at_event in ('head_manager', 'manager', 'coach', 'assistant_coach') then 'staff'
    else 'unknown'
  end;
  new.event_category := case
    when new.event_name like 'auth.%' then 'authentication'
    when new.event_name in ('page.view', 'page.viewed', 'workspace.switch', 'child.switch', 'team.switch')
      then 'navigation'
    else 'meaningful_action'
  end;
  new.action_family := coalesce(nullif(new.action_family, 'unknown'), nullif(new.feature_key, ''), split_part(new.event_name, '.', 1));
  new.route_key := coalesce(nullif(new.route_key, ''), new.canonical_route, '');
  new.production_state := coalesce(nullif(new.production_state, ''), new.environment, 'production');
  new.internal_state := coalesce(new.internal_state, false) or new.actor_role_at_event = 'super_admin';
  new.page_view := coalesce(new.page_view, false) or new.event_name in ('page.view', 'page.viewed');
  new.idempotency_key := coalesce(nullif(new.idempotency_key, ''), new.client_event_id);
  new.schema_version := greatest(coalesce(new.schema_version, 1), 2);
  return new;
end;
$$;

comment on function public.canonicalize_analytics_event_insert() is
'Canonical analytics insert normalisation, including the repository admin alias for Club Admin.';
