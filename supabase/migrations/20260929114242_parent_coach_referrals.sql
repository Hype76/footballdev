create table public.parent_coach_referrals (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete cascade,
  recipient_digest text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  provider_id text
);
alter table public.parent_coach_referrals enable row level security;
revoke all on public.parent_coach_referrals from public, anon, authenticated;
grant select, insert, update, delete on public.parent_coach_referrals to service_role;
create index parent_coach_referrals_actor_date on public.parent_coach_referrals(actor_id, created_at);
create index parent_coach_referrals_recipient_date on public.parent_coach_referrals(recipient_digest, created_at);

create function public.reserve_parent_coach_referral(p_actor uuid, p_digest text, p_payload jsonb)
returns public.parent_coach_referrals
language plpgsql security definer set search_path = public, pg_temp as $$
declare result public.parent_coach_referrals;
begin
  -- Service-only reservation. Serialise both sender and recipient limits.
  perform pg_advisory_xact_lock(hashtextextended('coach-referral:' || p_actor::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('coach-referral-recipient:' || p_digest, 0));
  select * into result from public.parent_coach_referrals
    where actor_id = p_actor and recipient_digest = p_digest and created_at > now() - interval '24 hours'
    order by created_at desc limit 1;
  if found then return result; end if;
  if (select count(*) from public.parent_coach_referrals where actor_id = p_actor and created_at > now() - interval '24 hours') >= 3
    or (select count(*) from public.parent_coach_referrals where recipient_digest = p_digest and created_at > now() - interval '24 hours') >= 1 then
    raise exception 'Please wait 24 hours before sending another Coach invitation.' using errcode = 'P0001';
  end if;
  insert into public.parent_coach_referrals(actor_id, recipient_digest, payload)
    values (p_actor, p_digest, p_payload) returning * into result;
  return result;
end;
$$;
revoke all on function public.reserve_parent_coach_referral(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.reserve_parent_coach_referral(uuid, text, jsonb) to service_role;
