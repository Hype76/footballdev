-- Explicit Player self contacts may coexist with independent Parent contacts.
-- Keep the same verified age, active club/team and single-self-email eligibility.
create or replace function app_private.adult_player_setup_email(player_row public.players)
returns text
language sql stable
set search_path = ''
as $$
  select case
    when count(distinct lower(btrim(contact->>'email'))) = 1 then min(lower(btrim(contact->>'email')))
  end
  from jsonb_array_elements(case when jsonb_typeof(to_jsonb(player_row.parent_contacts)) = 'array'
    then to_jsonb(player_row.parent_contacts) else '[]'::jsonb end) contact
  where contact->>'type' = 'self'
    and btrim(contact->>'email') ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
    and player_row.status = 'active'
    and player_row.archived_at is null
    and player_row.contact_type in ('self', 'both')
    and player_row.date_of_birth <= (current_date - interval '18 years')::date
    and exists (select 1 from public.teams t where t.id = player_row.team_id
      and t.club_id = player_row.club_id and t.status = 'active')
    and exists (select 1 from public.clubs c where c.id = player_row.club_id
      and coalesce(c.status, 'active') = 'active' and c.archived_at is null);
$$;

create or replace function public.list_adult_player_setup_resend_targets(actor_id uuid, target_team_id uuid)
returns jsonb
language plpgsql volatile
security definer
set search_path = ''
as $$
declare
  team_row public.teams;
  targets jsonb;
begin
  select * into team_row from public.teams where id = target_team_id;
  if team_row.id is null
    or not coalesce(app_private.actor_can_manage_team_resource(actor_id, team_row.club_id, team_row.id, 50), false)
  then return jsonb_build_object('state', 'denied'); end if;
  select coalesce(jsonb_agg(p.id order by p.id), '[]'::jsonb) into targets
  from public.players p
  left join app_private.adult_player_setup_invites i on i.player_id = p.id
  where p.team_id = team_row.id and p.club_id = team_row.club_id
    and p.contact_type in ('self', 'both') and p.archived_at is null
    and app_private.adult_player_setup_email(p) is not null
    and i.accepted_at is null
    and (i.sent_at is null or i.sent_at <= now() - interval '5 minutes')
    and not exists (select 1 from public.adult_player_account_links a where a.player_id = p.id and a.status = 'active');
  return jsonb_build_object('state', 'ready', 'player_ids', targets);
end;
$$;
