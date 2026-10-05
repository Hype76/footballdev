-- PROPOSAL ONLY. Not in the active migration directory. Do not apply before
-- product approval, isolated database permission tests and existing gate repair.
-- One optional URL per team; existing league names and RLS policies are retained.
alter table public.teams add column league_url text;
alter table public.teams add column league_link_enabled boolean not null default false;
comment on column public.teams.league_link_enabled is
  'Show the current league website to authorised Coaches, Parents and Players. Off retains the saved URL.';

alter table public.teams add constraint teams_league_url_check check (
  league_url is null or (
    char_length(league_url) between 1 and 2048
    and league_url = btrim(league_url)
    and league_url ~* '^https?://[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*(:[0-9]{1,5})?([/?#][^[:space:][:cntrl:]]*)?$'
    and position(chr(92) in league_url) = 0
    and coalesce(substring(lower(league_url) from '^https?://[^/:?#]+:([0-9]{1,5})')::integer, 443) between 1 and 65535
  )
);
comment on column public.teams.league_url is
  'Optional current league website URL. Null means no link. Independent of the league name.';

create function app_private.team_league_account_active()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from auth.users account
    where account.id = auth.uid() and account.deleted_at is null
      and (account.banned_until is null or account.banned_until <= now())
  );
$$;
revoke all on function app_private.team_league_account_active() from public, anon, authenticated, service_role;

-- Guard direct table writes too: a UI-only permission check or a setter RPC
-- alone would leave the new column writable through existing table privileges.
create function app_private.enforce_team_league_url_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.league_url is not distinct from old.league_url
    and new.league_link_enabled is not distinct from old.league_link_enabled then
    return new;
  end if;
  if tg_op = 'INSERT' and new.league_url is null and not new.league_link_enabled then return new; end if;

  if not app_private.team_league_account_active()
    or new.archived_at is not null or coalesce(new.status, 'active') <> 'active'
    or not exists (select 1 from public.clubs club where club.id = new.club_id
      and club.archived_at is null and coalesce(club.status, 'active') = 'active')
    or not coalesce(app_private.actor_can_manage_team_resource(auth.uid(), new.club_id, new.id, 50), false)
    or public.current_user_billing_staff_mutation_allowed(new.club_id) is not true
    or not exists (select 1 from public.team_staff assignment where assignment.team_id = new.id
      and assignment.user_id = auth.uid() and assignment.role_rank >= 50) then
    raise exception using errcode = '42501', message = 'Team Admin access is required for this team.';
  end if;
  new.league_url := nullif(btrim(new.league_url), '');
  return new;
end;
$$;
revoke all on function app_private.enforce_team_league_url_update() from public, anon, authenticated, service_role;
create trigger teams_enforce_league_url_update
before insert or update of league_url, league_link_enabled on public.teams
for each row execute function app_private.enforce_team_league_url_update();

-- New narrowly scoped APIs, using the repository's existing guarded RPC pattern.
-- No existing functions, table grants or RLS policies are replaced.
create function public.get_team_league_url(team_id_value uuid)
-- The trusted authority helper locks stored membership rows; keep this getter
-- volatile rather than asserting STABLE semantics around that helper.
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target_team public.teams%rowtype; can_edit boolean;
begin
  select team.* into target_team from public.teams team
  join public.clubs club on club.id = team.club_id
  where team.id = team_id_value and team.archived_at is null
    and coalesce(team.status, 'active') = 'active' and club.archived_at is null
    and coalesce(club.status, 'active') = 'active';
  if not app_private.team_league_account_active() or target_team.id is null
    or not coalesce(app_private.actor_can_manage_team_resource(auth.uid(), target_team.club_id, target_team.id, 20), false) then
    raise exception using errcode = '42501', message = 'Coach access is required for this team.';
  end if;
  can_edit := coalesce(app_private.actor_can_manage_team_resource(auth.uid(), target_team.club_id, target_team.id, 50), false)
    and public.current_user_billing_staff_mutation_allowed(target_team.club_id) is true
    and exists (select 1 from public.team_staff assignment where assignment.team_id = target_team.id
      and assignment.user_id = auth.uid() and assignment.role_rank >= 50);
  return jsonb_build_object('team_id', target_team.id, 'team_name', target_team.name,
    'league_url', case when can_edit or target_team.league_link_enabled then target_team.league_url else null end,
    'league_link_enabled', target_team.league_link_enabled, 'can_edit', can_edit);
end;
$$;

create function public.set_team_league_url(team_id_value uuid, url_value text, enabled_value boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target_team public.teams%rowtype;
  actor public.users%rowtype;
  normalized_url text := nullif(btrim(url_value), '');
begin
  select team.* into target_team from public.teams team
  where team.id = team_id_value and team.archived_at is null
    and coalesce(team.status, 'active') = 'active' for update;
  if not app_private.team_league_account_active() or target_team.id is null
    or not exists (select 1 from public.clubs club where club.id = target_team.club_id
      and club.archived_at is null and coalesce(club.status, 'active') = 'active')
    or not coalesce(app_private.actor_can_manage_team_resource(auth.uid(), target_team.club_id, target_team.id, 50), false)
    or public.current_user_billing_staff_mutation_allowed(target_team.club_id) is not true
    or not exists (select 1 from public.team_staff assignment where assignment.team_id = target_team.id
      and assignment.user_id = auth.uid() and assignment.role_rank >= 50) then
    raise exception using errcode = '42501', message = 'Team Admin access is required for this team.';
  end if;
  select profile.* into actor from public.users profile where profile.id = auth.uid();
  update public.teams team set league_url = normalized_url, league_link_enabled = coalesce(enabled_value, false),
    updated_at = timezone('utc', now()), updated_by = actor.id,
    updated_by_name = coalesce(nullif(actor.display_name, ''), nullif(actor.name, ''), actor.email, ''),
    updated_by_email = coalesce(actor.email, '')
  where team.id = target_team.id;
  -- Do not duplicate URL query credentials in audit metadata.
  insert into public.audit_logs(club_id, actor_id, action, entity_type, entity_id, metadata)
  values(target_team.club_id, actor.id, 'team_league_url_updated', 'team', target_team.id,
    jsonb_build_object('previouslySet', target_team.league_url is not null, 'currentlySet', normalized_url is not null,
      'previouslyEnabled', target_team.league_link_enabled, 'currentlyEnabled', coalesce(enabled_value, false)));
  return public.get_team_league_url(target_team.id);
end;
$$;

-- The caller supplies its selected relationship, never an arbitrary team ID.
-- Player accounts are represented by accepted fan_connections with type player.
-- Ordinary Fans are deliberately excluded pending a separate product decision.
create function public.get_parent_player_team_league_url(link_id_value uuid, link_type_value text)
returns table(team_id uuid, team_name text, league_url text, league_link_enabled boolean)
language plpgsql stable security definer set search_path = '' as $$
declare resolved_team_id uuid; resolved_club_id uuid;
begin
  if not app_private.team_league_account_active() then
    raise exception using errcode = '42501', message = 'Sign in to view the team league.';
  end if;
  if link_type_value = 'parent' then
    select player.team_id, player.club_id into resolved_team_id, resolved_club_id
    from public.parent_player_links link
    join public.players player on player.id = link.player_id and player.club_id = link.club_id
    where link.id = link_id_value and link.auth_user_id = auth.uid()
      and link.link_type = 'parent' and link.status = 'active'
      and player.archived_at is null and coalesce(player.status, 'active') <> 'archived'
      and (link.team_id is null or link.team_id = player.team_id)
      and public.current_user_can_access_parent_link(link.id, player.id);
  elsif link_type_value = 'player' then
    select player.team_id, player.club_id into resolved_team_id, resolved_club_id
    from public.fan_connections connection
    join public.players player on player.id = connection.player_id and player.club_id = connection.club_id
    where connection.id = link_id_value and connection.auth_user_id = auth.uid()
      and connection.relationship_type = 'player' and connection.status = 'active'
      and player.archived_at is null and coalesce(player.status, 'active') <> 'archived'
      and app_private.fan_scope_active(connection.parent_link_id, player.id, connection.club_id, connection.invited_by)
      and app_private.fan_account_active(auth.uid(), connection.club_id);
  else
    raise exception using errcode = '42501', message = 'Choose an authorised Parent or Player relationship.';
  end if;
  if resolved_team_id is null then
    raise exception using errcode = '42501', message = 'Choose an authorised Parent or Player relationship.';
  end if;
  return query select team.id, team.name,
    case when team.league_link_enabled then team.league_url else null end, team.league_link_enabled
  from public.teams team join public.clubs club on club.id = team.club_id
  where team.id = resolved_team_id and team.club_id = resolved_club_id and team.archived_at is null
    and coalesce(team.status, 'active') = 'active' and club.archived_at is null
    and coalesce(club.status, 'active') = 'active';
end;
$$;

alter function app_private.team_league_account_active() owner to postgres;
alter function app_private.enforce_team_league_url_update() owner to postgres;
alter function public.get_team_league_url(uuid) owner to postgres;
alter function public.set_team_league_url(uuid, text, boolean) owner to postgres;
alter function public.get_parent_player_team_league_url(uuid, text) owner to postgres;
revoke all on function public.get_team_league_url(uuid), public.set_team_league_url(uuid, text, boolean),
  public.get_parent_player_team_league_url(uuid, text) from public, anon, service_role;
grant execute on function public.get_team_league_url(uuid), public.set_team_league_url(uuid, text, boolean),
  public.get_parent_player_team_league_url(uuid, text) to authenticated;
