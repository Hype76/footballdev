alter table public.match_days
  add column if not exists shirt_choice text not null default 'home';

alter table public.match_days
  drop constraint if exists match_days_shirt_choice_check;

alter table public.match_days
  add constraint match_days_shirt_choice_check
  check (shirt_choice in ('home', 'away'));

comment on column public.match_days.shirt_choice is
  'Required fixture shirt selection. home means Home shirts and away means Away shirts.';

create or replace function public.get_parent_portal_match_shirt_choices(parent_link_id_value uuid)
returns table (
  match_day_id uuid,
  shirt_choice text
)
language sql
stable
security definer
set search_path = ''
as $$
  with authorised_match_days as (
    select portal_match.id as match_day_id
    from public.get_parent_portal_match_days(parent_link_id_value) portal_match

    union

    select invitation.event_id as match_day_id
    from public.get_parent_portal_invitation_state(parent_link_id_value) invitation
    where invitation.source_event_type = 'match_day'
      and invitation.event_id is not null
  )
  select match_day.id, match_day.shirt_choice
  from authorised_match_days authorised
  join public.match_days match_day on match_day.id = authorised.match_day_id
  where match_day.deleted_at is null;
$$;

comment on function public.get_parent_portal_match_shirt_choices(uuid) is
  'Returns shirt choices only for Match Day records already authorised by the Parent Portal match or invitation read models.';

revoke all on function public.get_parent_portal_match_shirt_choices(uuid) from public;
revoke all on function public.get_parent_portal_match_shirt_choices(uuid) from anon;
grant execute on function public.get_parent_portal_match_shirt_choices(uuid) to authenticated;
grant execute on function public.get_parent_portal_match_shirt_choices(uuid) to service_role;

create or replace function public.get_match_day_availability_shirt_choice(token_hash_value text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select match_day.shirt_choice
  from public.match_day_availability_requests request
  join public.match_days match_day on match_day.id = request.match_day_id
  where request.token_hash = lower(btrim(coalesce(token_hash_value, '')))
    and public.is_match_day_action_token_current_internal(lower(btrim(coalesce(token_hash_value, ''))))
  limit 1;
$$;

comment on function public.get_match_day_availability_shirt_choice(text) is
  'Returns only the shirt choice for a current Match Day availability token.';

revoke all on function public.get_match_day_availability_shirt_choice(text) from public;
grant execute on function public.get_match_day_availability_shirt_choice(text) to anon;
grant execute on function public.get_match_day_availability_shirt_choice(text) to authenticated;
grant execute on function public.get_match_day_availability_shirt_choice(text) to service_role;
