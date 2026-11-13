create index live_match_changes_pending_match_idx
on private.live_match_changes(match_day_id, id desc) where completed_at is null;

-- Each delivery reads the latest confirmed score. Older queue entries for
-- that fixture can be completed once a newer snapshot has been delivered.
create or replace function public.claim_live_match_changes(batch_size integer default 20)
returns table(change_id bigint, match_day_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  candidate record;
begin
  if auth.role() <> 'service_role' then raise exception 'Service access is required.' using errcode = '42501'; end if;
  for candidate in
    with newest as (
      select distinct on (c.match_day_id) c.id, c.match_day_id
      from private.live_match_changes c
      where c.completed_at is null and c.changed_at >= now() - interval '8 hours'
      order by c.match_day_id, c.id desc
    )
      select c.id, c.match_day_id
      from private.live_match_changes c
      join newest n on n.id = c.id
      where c.next_attempt_at <= now() and c.completed_at is null
        and not exists (
          select 1 from private.live_match_changes active
          where active.match_day_id = c.match_day_id and active.completed_at is null
            and active.claimed_at >= now() - interval '2 minutes'
        )
      order by c.changed_at desc, c.id desc
      limit least(greatest(coalesce(batch_size, 20), 1), 50)
  loop
    -- Lock the fixture key even if another worker sees a different queue row.
    if pg_try_advisory_xact_lock(hashtextextended('live_match_delivery:' || candidate.match_day_id::text, 0)) then
      return query
        update private.live_match_changes c
        set claimed_at = now(), attempts = c.attempts + 1
        where c.id = candidate.id and c.completed_at is null and c.next_attempt_at <= now()
          and not exists (
            select 1 from private.live_match_changes active
            where active.match_day_id = candidate.match_day_id and active.completed_at is null
              and (active.id > candidate.id or active.claimed_at >= now() - interval '2 minutes')
          )
        returning c.id, c.match_day_id;
    end if;
  end loop;
end;
$$;

create or replace function public.complete_live_match_change(change_id_value bigint, successful boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Service access is required.' using errcode = '42501'; end if;
  if successful then
    update private.live_match_changes c
    set completed_at = now(), claimed_at = null
    from private.live_match_changes delivered
    where delivered.id = change_id_value and delivered.match_day_id = c.match_day_id
      and c.id <= delivered.id and c.completed_at is null;
  else
    update private.live_match_changes c
    set claimed_at = null, next_attempt_at = now() + make_interval(secs => least(power(2, least(c.attempts, 8))::integer, 300))
    where c.id = change_id_value and c.completed_at is null;
  end if;
end;
$$;

-- Requeue as soon as a remote-started activity supplies its first or rotated
-- update token. The delivery worker checks the current scope before sending.
create function private.queue_attached_live_match_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.platform = 'ios' and new.activity_token is not null
    and new.activity_token is distinct from old.activity_token
    and exists (
      select 1 from public.match_days m where m.id = new.match_day_id
        and (m.concluded_at is null or m.concluded_at >= now() - interval '8 hours')
    ) then
    insert into private.live_match_changes(match_day_id) values (new.match_day_id);
  end if;
  return new;
end;
$$;
revoke all on function private.queue_attached_live_match_activity() from public, anon, authenticated;

create trigger queue_attached_live_match_activity
after update of activity_token on private.live_match_follows
for each row execute function private.queue_attached_live_match_activity();

-- Allow an authenticated late handoff to deliver a recent final score.
create or replace function public.attach_live_match_activity(follow_id_value uuid, activity_token_value text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  target private.live_match_follows%rowtype;
  match_row public.match_days%rowtype;
  fan public.fan_connections%rowtype;
begin
  if auth.uid() is null or length(activity_token_value) not between 64 and 256
    or activity_token_value !~ '^[0-9a-fA-F]+$' then
    raise exception 'Invalid live match request.' using errcode = '22023';
  end if;
  select * into target from private.live_match_follows where id = follow_id_value
    and user_id = auth.uid() and session_id = nullif(auth.jwt()->>'session_id', '')::uuid
    and platform = 'ios' and start_token is not null for update;
  if target.id is null then return false; end if;
  if exists (select 1 from private.live_match_follows existing where existing.id <> target.id
    and existing.user_id = target.user_id and existing.match_day_id = target.match_day_id
    and existing.app_role = target.app_role and existing.activity_token = lower(activity_token_value)) then return false; end if;
  select * into match_row from public.match_days where id = target.match_day_id;
  if match_row.id is null or match_row.deleted_at is not null or match_row.previous_hidden_at is not null
    or match_row.status in ('cancelled', 'postponed')
    or match_row.concluded_at < now() - interval '8 hours' then return false; end if;
  if target.app_role = 'coach' then
    if not coalesce(public.can_read_match_day(match_row.team_id), false)
      or public.current_user_role() in ('parent_portal', 'adult_player') then return false; end if;
  elsif target.parent_link_id is not null then
    if not exists (select 1 from public.get_parent_portal_match_days(target.parent_link_id) visible
      where visible.id = target.match_day_id) then return false; end if;
  else
    select * into fan from public.fan_connections where id = target.fan_connection_id
      and auth_user_id = target.user_id;
    if fan.id is null or fan.status <> 'active' or not fan.notifications_enabled
      or fan.permissions->>'game_day' <> 'true' or fan.club_id <> match_row.club_id
      or not exists (select 1 from public.players p where p.id = fan.player_id and p.team_id = match_row.team_id)
      or not app_private.fan_scope_active(fan.parent_link_id, fan.player_id, fan.club_id, fan.invited_by)
      or not app_private.fan_account_active(target.user_id, fan.club_id) then return false; end if;
  end if;
  update private.live_match_follows set activity_token = lower(activity_token_value), updated_at = now()
    where id = follow_id_value;
  return true;
end;
$$;

-- A Club Admin acts under their own identity for active teams in their club.
-- Keep the existing assignment checks for other staff and retain all grants.
do $migration$
declare
  signature text;
  definition text;
  before_clause text;
  after_clause text;
begin
  for signature, before_clause, after_clause in
    values
      ('public.apply_coach_match_day_command(uuid,uuid,text,jsonb,timestamptz,timestamptz,uuid)',
       $old$or public.current_user_role() in ('super_admin','admin','parent_portal','adult_player') then$old$,
       $new$or public.current_user_role() in ('super_admin','parent_portal','adult_player') then$new$),
      ('public.apply_coach_match_day_command_v2(uuid,uuid,text,jsonb,timestamptz,timestamptz,uuid)',
       $old$or public.current_user_role() in ('super_admin','admin','parent_portal','adult_player') then$old$,
       $new$or public.current_user_role() in ('super_admin','parent_portal','adult_player') then$new$),
      ('public.save_match_day_final_report(uuid,text)',
       $old$coalesce(public.current_user_role(), '') in ('admin', 'parent_portal', 'super_admin')$old$,
       $new$coalesce(public.current_user_role(), '') in ('parent_portal', 'adult_player', 'super_admin')$new$),
      ('public.delete_match_day_fixture_for_team(uuid,uuid)',
       $old$or coalesce(public.current_user_role(), '') in ('admin', 'super_admin', 'parent_portal', 'adult_player')
    or not app_private.actor_can_manage_team_resource(actor_id, fixture.club_id, p_team_id, 20)
    or not exists (
      select 1 from public.team_staff assignment
      where assignment.team_id = p_team_id and assignment.user_id = actor_id and assignment.role_rank >= 30
    )$old$,
       $new$or coalesce(public.current_user_role(), '') in ('super_admin', 'parent_portal', 'adult_player')
    or not coalesce(public.can_manage_match_day(p_team_id), false)
    or not app_private.actor_can_manage_team_resource(actor_id, fixture.club_id, p_team_id, 20)
    or not (
      coalesce(public.current_user_has_club_wide_authority(fixture.club_id), false)
      or exists (
        select 1 from public.team_staff assignment
        where assignment.team_id = p_team_id and assignment.user_id = actor_id and assignment.role_rank >= 30
      )
    )$new$),
      ('public.save_coach_concluded_match_event(uuid,timestamptz,uuid,uuid,text,jsonb)',
       $old$or not exists (select 1 from public.team_staff s where s.team_id = fixture.team_id and s.user_id = actor and s.role_rank >= 30)$old$,
       $new$or not (
      coalesce(public.current_user_has_club_wide_authority(fixture.club_id), false)
      or exists (select 1 from public.team_staff s where s.team_id = fixture.team_id and s.user_id = actor and s.role_rank >= 30)
    )$new$),
      ('public.delete_previous_match_day(uuid)',
       $old$actor_role in ('admin', 'parent_portal', 'super_admin')
    or actor_role_rank < 50
    or actor_club_id is null
    or match_row.club_id <> actor_club_id
    or match_row.team_id is null
    or not exists (
      select 1
      from public.team_staff assignment
      where assignment.team_id = match_row.team_id
        and assignment.user_id = actor_user_id
    )$old$,
       $new$actor_role in ('parent_portal', 'adult_player', 'super_admin')
    or actor_role_rank < 50
    or actor_club_id is null
    or match_row.club_id is distinct from actor_club_id
    or not coalesce(public.can_manage_match_day(match_row.team_id), false)
    or not (
      coalesce(public.current_user_has_club_wide_authority(match_row.club_id), false)
      or exists (
        select 1 from public.team_staff assignment
        where assignment.team_id = match_row.team_id and assignment.user_id = actor_user_id
      )
    )$new$),
      ('public.delete_previous_match_day_v2(uuid)',
       $old$actor_role in ('admin', 'parent_portal', 'super_admin')
    or actor_role_rank < 50
    or actor_club_id is null
    or match_row.club_id <> actor_club_id
    or match_row.team_id is null
    or not exists (
      select 1
      from public.team_staff assignment
      where assignment.team_id = match_row.team_id
        and assignment.user_id = actor_user_id
    )$old$,
       $new$actor_role in ('parent_portal', 'adult_player', 'super_admin')
    or actor_role_rank < 50
    or actor_club_id is null
    or match_row.club_id is distinct from actor_club_id
    or not coalesce(public.can_manage_match_day(match_row.team_id), false)
    or not (
      coalesce(public.current_user_has_club_wide_authority(match_row.club_id), false)
      or exists (
        select 1 from public.team_staff assignment
        where assignment.team_id = match_row.team_id and assignment.user_id = actor_user_id
      )
    )$new$)
  loop
    definition := replace(pg_get_functiondef(signature::regprocedure), E'\r\n', E'\n');
    if position(before_clause in definition) = 0 then
      raise exception 'Expected Match Day authority check missing from %', signature;
    end if;
    execute replace(definition, before_clause, after_clause);
  end loop;
end;
$migration$;

alter policy match_day_final_reports_staff_select_scoped on public.match_day_final_reports
using (
  coalesce(public.current_user_role(), '') not in ('parent_portal', 'adult_player', 'super_admin')
  and coalesce(public.current_user_role_rank(), 0) >= 20
  and club_id = public.current_user_club_id()
  and exists (
    select 1 from public.match_days match_day
    where match_day.id = match_day_final_reports.match_day_id
      and match_day.club_id = match_day_final_reports.club_id
      and match_day.team_id is not distinct from match_day_final_reports.team_id
      and match_day.status = 'full_time'
      and public.can_read_match_day(match_day.team_id)
  )
);

create or replace function app_private.formation_board_team_role_rank(
  actor_id uuid,
  target_team_id uuid,
  target_club_id uuid
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(authority.role_rank), 0)::integer
  from (
    select 70 as role_rank
    from public.teams team
    where team.id = target_team_id and team.club_id = target_club_id
      and team.status = 'active' and team.archived_at is null
      and actor_id = (select auth.uid())
      and public.current_user_has_club_wide_authority(team.club_id)
      and public.current_user_can_access_team(team.club_id, team.id)
    union all
    select assignment.role_rank
    from public.team_staff assignment
    join public.users actor on actor.id = assignment.user_id
    join public.teams team on team.id = assignment.team_id
    where assignment.user_id = actor_id
      and assignment.team_id = target_team_id
      and actor.status = 'active'
      and team.status = 'active'
      and team.club_id = target_club_id
      and (
        actor.club_id = target_club_id
        or exists (
          select 1
          from public.user_club_memberships membership
          where membership.auth_user_id = actor_id and membership.club_id = target_club_id
        )
      )
      and assignment.role_key in ('head_manager', 'manager', 'coach', 'assistant_coach')
  ) authority;
$$;

-- Optional address for the Club profile. Existing profiles keep an empty field.
alter table public.clubs add column contact_address text
  check (char_length(contact_address) <= 500);
