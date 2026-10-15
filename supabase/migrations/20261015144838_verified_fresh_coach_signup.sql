-- Explicit email-verified fresh starts never restore a deleted workspace.
create table app_private.fresh_coach_signup_requests (
  id uuid primary key,
  email text not null check (email = lower(btrim(email))),
  display_name text not null check (length(display_name) between 1 and 100),
  team_name text not null check (length(team_name) between 1 and 120),
  user_id uuid,
  code_digest text,
  state text not null default 'queued' check (state in ('queued','sending','sent','claimed','complete','ineligible','failed','superseded')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  club_id uuid,
  expires_at timestamptz not null default now() + interval '10 minutes',
  created_at timestamptz not null default now()
);
alter table app_private.fresh_coach_signup_requests enable row level security;
revoke all on app_private.fresh_coach_signup_requests from public, anon, authenticated;
grant usage on schema app_private to service_role;
create index fresh_coach_signup_requests_email_idx on app_private.fresh_coach_signup_requests(email, created_at);

-- This lifetime exclusion has no foreign keys to deletable accounts or clubs.
create table app_private.coach_club_promotion_returners (
  user_id uuid not null,
  email_sha256 text not null,
  recorded_at timestamptz not null default now(),
  primary key (user_id, email_sha256)
);
alter table app_private.coach_club_promotion_returners enable row level security;
revoke all on app_private.coach_club_promotion_returners from public, anon, authenticated;
grant select, insert on app_private.coach_club_promotion_returners to service_role;
create index coach_club_promotion_returners_email_idx on app_private.coach_club_promotion_returners(email_sha256);
-- A different administrator or later ownership change cannot reset a fresh club's exclusion.
create table app_private.coach_club_promotion_returning_clubs (
  club_id uuid primary key,
  recorded_at timestamptz not null default now()
);
alter table app_private.coach_club_promotion_returning_clubs enable row level security;
revoke all on app_private.coach_club_promotion_returning_clubs from public, anon, authenticated;
grant select, insert on app_private.coach_club_promotion_returning_clubs to service_role;
insert into app_private.coach_club_promotion_returners(user_id, email_sha256)
select distinct d.user_id, encode(sha256(convert_to(lower(btrim(a.email)), 'UTF8')), 'hex')
from app_private.deleted_workspace_access d join auth.users a on a.id = d.user_id
where nullif(btrim(a.email), '') is not null
on conflict do nothing;

create function app_private.record_coach_club_promotion_returner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.club_id is not null and nullif(btrim(old.email), '') is not null then
    insert into app_private.coach_club_promotion_returners(user_id, email_sha256)
    values (old.id, encode(sha256(convert_to(lower(btrim(old.email)), 'UTF8')), 'hex'))
    on conflict do nothing;
  end if;
  return old;
end;
$$;
revoke all on function app_private.record_coach_club_promotion_returner() from public, anon, authenticated;
create trigger users_record_coach_club_promotion_returner before delete on public.users
for each row execute function app_private.record_coach_club_promotion_returner();

create function public.get_fresh_coach_signup_candidate(p_email text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', a.id, 'email', lower(btrim(a.email)))
  from auth.users a
  where lower(btrim(a.email)) = lower(btrim(p_email)) and a.email_confirmed_at is not null
    and exists (select 1 from app_private.deleted_workspace_access d where d.user_id = a.id)
    and not exists (select 1 from public.users u where u.id = a.id)
    and not exists (select 1 from public.user_club_memberships m join public.clubs c on c.id = m.club_id
      where m.auth_user_id = a.id and c.status = 'active' and c.archived_at is null)
  limit 1;
$$;

create function public.is_returning_coach_signup_actor(p_actor uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from app_private.deleted_workspace_access d where d.user_id = p_actor)
    or exists (select 1 from app_private.coach_club_promotion_returners r where r.user_id = p_actor
      or r.email_sha256 = (select encode(sha256(convert_to(lower(btrim(a.email)), 'UTF8')), 'hex') from auth.users a where a.id = p_actor));
$$;
revoke all on function public.is_returning_coach_signup_actor(uuid) from public, anon, authenticated;
grant execute on function public.is_returning_coach_signup_actor(uuid) to service_role;

create function public.queue_fresh_coach_signup(p_id uuid, p_email text, p_name text, p_team text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(lower(btrim(p_email)), 151048));
  update app_private.fresh_coach_signup_requests set state = 'superseded'
  where email = lower(btrim(p_email)) and state in ('queued','sending','sent');
  insert into app_private.fresh_coach_signup_requests(id, email, display_name, team_name)
  values (p_id, lower(btrim(p_email)), btrim(p_name), btrim(p_team));
  delete from app_private.fresh_coach_signup_requests where created_at < now() - interval '24 hours';
end;
$$;

create function public.claim_fresh_coach_signup_code(p_id uuid, p_digest text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r app_private.fresh_coach_signup_requests;
begin
  select * into r from app_private.fresh_coach_signup_requests where id = p_id for update;
  if not found or r.state <> 'sent' or r.expires_at <= now() or r.attempts >= 5 then return null; end if;
  update app_private.fresh_coach_signup_requests set attempts = attempts + 1 where id = p_id;
  if r.code_digest is distinct from p_digest then return null; end if;
  update app_private.fresh_coach_signup_requests set state = 'claimed' where id = p_id;
  return jsonb_build_object('id', r.id, 'user_id', r.user_id, 'email', r.email, 'display_name', r.display_name, 'team_name', r.team_name);
end;
$$;

create function public.claim_fresh_coach_signup_delivery(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r app_private.fresh_coach_signup_requests;
begin
  update app_private.fresh_coach_signup_requests set state = 'sending'
  where id = p_id and state = 'queued' and expires_at > now() returning * into r;
  if not found then return null; end if;
  return jsonb_build_object('id', r.id, 'email', r.email, 'team_name', r.team_name);
end;
$$;

create function public.mark_fresh_coach_signup_delivery(p_id uuid, p_state text, p_actor uuid default null, p_digest text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_state not in ('sent','ineligible','failed') then raise exception 'Invalid delivery state.'; end if;
  if p_state = 'sent' and (p_actor is null or p_digest !~ '^[a-f0-9]{64}$') then raise exception 'Invalid delivery identity.'; end if;
  update app_private.fresh_coach_signup_requests set state = p_state,
    user_id = case when p_state = 'sent' then p_actor else user_id end,
    code_digest = case when p_state = 'sent' then p_digest else null end
  where id = p_id and (state = 'sending' or (p_state = 'failed' and state = 'sent')) and expires_at > now();
  return found;
end;
$$;

create function public.complete_fresh_coach_signup(p_id uuid, p_actor uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r app_private.fresh_coach_signup_requests; v_club uuid; v_team uuid; v_name text; i integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text, 151049));
  select * into r from app_private.fresh_coach_signup_requests where id = p_id for update;
  if not found or r.user_id is distinct from p_actor then raise exception 'Fresh signup could not be verified.'; end if;
  if r.state = 'complete' then return r.club_id; end if;
  if r.state <> 'claimed' or r.expires_at <= now() then raise exception 'Request a new verification code.'; end if;
  if public.get_fresh_coach_signup_candidate(r.email)->>'id' is distinct from p_actor::text then
    raise exception 'This account cannot start a fresh team. Please sign in.';
  end if;
  for i in 0..9 loop
    v_name := r.team_name || case when i = 0 then '' else ' (' || (i + 1)::text || ')' end;
    begin
      insert into public.clubs(name, plan_key, plan_status, is_plan_comped, matchday_free_forever, plan_updated_at)
      values (v_name, 'matchday', 'active', false, true, now()) returning id into v_club;
      exit;
    exception when unique_violation then
      if i = 9 then raise exception 'Choose another team name and try again.'; end if;
    end;
  end loop;
  insert into public.users(id, email, username, name, display_name, club_name, reply_to_email, role, role_label, role_rank, club_id, force_password_change)
  values (p_actor, r.email, r.display_name, r.display_name, r.display_name, v_name, r.email, 'head_manager', 'Team Admin', 70, v_club, false);
  insert into public.user_club_memberships(auth_user_id, email, username, name, role, role_label, role_rank, club_id, updated_at)
  values (p_actor, r.email, r.display_name, r.display_name, 'head_manager', 'Team Admin', 70, v_club, now());
  perform public.seed_default_club_roles_for_actor(v_club, p_actor, 'signup_workspace');
  update public.clubs set workspace_owner_user_id = p_actor where id = v_club;
  insert into public.teams(club_id, name, created_by, created_by_email, created_by_name, updated_by, updated_by_email, updated_by_name)
  values (v_club, v_name, p_actor, r.email, r.display_name, p_actor, r.email, r.display_name) returning id into v_team;
  insert into public.team_staff(team_id, user_id, role_key, updated_by)
  values (v_team, p_actor, 'head_manager', p_actor);
  insert into app_private.coach_club_promotion_returners(user_id, email_sha256)
  values (p_actor, encode(sha256(convert_to(r.email, 'UTF8')), 'hex')) on conflict do nothing;
  insert into app_private.coach_club_promotion_returning_clubs(club_id) values (v_club) on conflict do nothing;
  update app_private.fresh_coach_signup_requests set state = 'complete', club_id = v_club, code_digest = null where id = p_id;
  return v_club;
end;
$$;

revoke all on function public.get_fresh_coach_signup_candidate(text), public.queue_fresh_coach_signup(uuid,text,text,text),
  public.claim_fresh_coach_signup_code(uuid,text), public.complete_fresh_coach_signup(uuid,uuid),
  public.claim_fresh_coach_signup_delivery(uuid), public.mark_fresh_coach_signup_delivery(uuid,text,uuid,text) from public, anon, authenticated;
grant execute on function public.get_fresh_coach_signup_candidate(text), public.queue_fresh_coach_signup(uuid,text,text,text),
  public.claim_fresh_coach_signup_code(uuid,text), public.complete_fresh_coach_signup(uuid,uuid),
  public.claim_fresh_coach_signup_delivery(uuid), public.mark_fresh_coach_signup_delivery(uuid,text,uuid,text) to service_role;

create or replace function public.reserve_coach_club_promotion(p_actor uuid, p_club uuid, p_code text, p_selection jsonb, p_previous uuid default null)
returns public.coach_club_promotion_redemptions language plpgsql security invoker set search_path = '' as $$
declare v_club public.clubs; v_row public.coach_club_promotion_redemptions;
begin
  select * into v_club from public.clubs where id = p_club for update;
  if not found or v_club.archived_at is not null or v_club.status <> 'active' then
    raise exception 'An active club account is required.';
  end if;
  if not exists (select 1 from public.users where id = p_actor and club_id = p_club and status = 'active') then
    raise exception 'Active club access is required.';
  end if;
  if p_code is not null and (exists (select 1 from app_private.coach_club_promotion_returning_clubs c where c.club_id = p_club)
    or exists (select 1 from app_private.deleted_workspace_access d where d.user_id = p_actor)
    or exists (select 1 from app_private.coach_club_promotion_returners r
      where r.user_id = p_actor or r.email_sha256 = (select encode(sha256(convert_to(lower(btrim(u.email)), 'UTF8')), 'hex') from public.users u where u.id = p_actor))) then
    raise exception 'This introductory Coach offer cannot be used again after a previous account was removed.';
  end if;
  if p_code is not null and (p_selection->>'planKey' is distinct from 'club' or p_selection->>'billingCycle' is distinct from 'monthly') then
    raise exception 'Coach codes apply to monthly Club subscriptions only.';
  end if;
  if p_code is not null and (v_club.stripe_subscription_id is not null or exists (
    select 1 from public.stripe_checkout_records r where r.club_id = p_club
      or lower(r.customer_email) = (select lower(email) from public.users where id = p_actor)
  )) then raise exception 'This offer is for new paid clubs only.'; end if;
  if p_code is not null and not exists (
    select 1 from public.coach_club_promotion_codes pc
    join public.users u on u.id = pc.coach_user_id
    join public.user_club_memberships m on m.auth_user_id = u.id and m.club_id = u.club_id and m.role = u.role and m.role_rank = u.role_rank
    join public.clubs c on c.id = u.club_id
    where pc.code = p_code and pc.active and u.status = 'active' and u.role_rank >= 20
      and u.role not in ('parent', 'player', 'fan', 'super_admin')
      and c.status = 'active' and c.archived_at is null
  ) then raise exception 'That promotion code is invalid or unavailable.'; end if;
  select * into v_row from public.coach_club_promotion_redemptions where club_id = p_club;
  if found then
    if v_row.redeemed_at is not null then raise exception 'This club has already used its initial checkout. Use Plan access to manage the subscription.'; end if;
    if p_previous is not null and p_previous = v_row.reservation_id then
      -- The server checks the previous Stripe session is expired before rotating.
      update public.coach_club_promotion_redemptions set code = p_code, selection = p_selection,
        reservation_id = gen_random_uuid(), checkout_session_id = null, checkout_expires_at = now() + interval '1 hour', created_at = now()
      where club_id = p_club returning * into v_row;
    end if;
    return v_row;
  end if;
  insert into public.coach_club_promotion_redemptions(club_id, code, selection)
  values (p_club, p_code, p_selection) returning * into v_row;
  return v_row;
end;
$$;
