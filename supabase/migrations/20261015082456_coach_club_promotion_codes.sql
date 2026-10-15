-- Server-managed codes and one lifetime referral redemption per workspace.
create table public.coach_club_promotion_codes (
  coach_user_id uuid unique references auth.users(id) on delete set null,
  code text primary key check (code ~ '^FP-[A-F0-9]{16}$'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.coach_club_promotion_redemptions (
  club_id uuid primary key references public.clubs(id) on delete cascade,
  -- Ordinary checkouts share the same lock so removing a code cannot open a second subscription.
  code text references public.coach_club_promotion_codes(code) on delete restrict,
  reservation_id uuid not null unique default gen_random_uuid(),
  selection jsonb not null,
  checkout_session_id text unique,
  checkout_expires_at timestamptz not null default (now() + interval '1 hour'),
  redeemed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.coach_club_promotion_codes enable row level security;
alter table public.coach_club_promotion_redemptions enable row level security;
revoke all on public.coach_club_promotion_codes, public.coach_club_promotion_redemptions from public, anon, authenticated;
grant select, insert, update on public.coach_club_promotion_codes, public.coach_club_promotion_redemptions to service_role;

create function public.ensure_coach_club_promotion_code(p_actor uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare v_code text;
begin
  if not exists (
    select 1 from public.users u
    join public.user_club_memberships m on m.auth_user_id = u.id and m.club_id = u.club_id and m.role = u.role and m.role_rank = u.role_rank
    join public.clubs c on c.id = u.club_id
    where u.id = p_actor and u.status = 'active' and u.role_rank >= 20
      and u.role not in ('parent', 'player', 'fan', 'super_admin')
      and c.status = 'active' and c.archived_at is null
  ) then raise exception 'Active Coach access is required.'; end if;
  insert into public.coach_club_promotion_codes(coach_user_id, code)
  values (p_actor, 'FP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)))
  on conflict (coach_user_id) do nothing;
  select code into v_code from public.coach_club_promotion_codes where coach_user_id = p_actor and active;
  if v_code is null then raise exception 'Your promotion code is unavailable.'; end if;
  return v_code;
end;
$$;

create function public.reserve_coach_club_promotion(p_actor uuid, p_club uuid, p_code text, p_selection jsonb, p_previous uuid default null)
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

create function public.complete_coach_club_promotion(p_club uuid, p_reservation uuid, p_session text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.clubs where id = p_club for update;
  update public.coach_club_promotion_redemptions set redeemed_at = coalesce(redeemed_at, now()), checkout_session_id = p_session
  where club_id = p_club and reservation_id = p_reservation
    and (checkout_session_id is null or checkout_session_id = p_session);
  if not found then raise exception 'Coach offer checkout does not match its club reservation.'; end if;
end;
$$;

revoke all on function public.ensure_coach_club_promotion_code(uuid), public.reserve_coach_club_promotion(uuid, uuid, text, jsonb, uuid), public.complete_coach_club_promotion(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.ensure_coach_club_promotion_code(uuid), public.reserve_coach_club_promotion(uuid, uuid, text, jsonb, uuid), public.complete_coach_club_promotion(uuid, uuid, text) to service_role;
