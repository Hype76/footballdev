-- Paid standalone Team workspaces receive team colours independently of the promotion.
create function app_private.paid_team_colour_entitled(club_value uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.clubs c where c.id=club_value
    and c.status='active' and c.archived_at is null
    and public.canonical_subscription_plan_key(c.plan_key)='team'
    and public.can_use_plan_feature(c.id,'basicLogoBranding'))
$$;
revoke all on function app_private.paid_team_colour_entitled(uuid) from public,anon,authenticated,service_role;

create or replace function public.get_team_branding_display(team_value uuid,club_value uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.clubs; e app_private.first_250_branding_entries;
  b app_private.first_250_team_branding; promotion_allowed boolean:=false;
  logo_allowed boolean; colour_allowed boolean; paid_club boolean;
begin
  if auth.uid() is null or not exists(select 1 from auth.users a where a.id=auth.uid()
    and a.email_confirmed_at is not null and (a.banned_until is null or a.banned_until<=clock_timestamp())) then
    raise exception 'branding_actor_denied' using errcode='42501'; end if;
  if not (coalesce(public.current_user_can_access_team(club_value,team_value),false)
    or coalesce(public.current_user_can_access_parent_team(team_value),false)
    or exists(select 1 from jsonb_array_elements(public.list_fan_connections()) f
      where f->>'team_id'=team_value::text and f->>'club_id'=club_value::text
        and f->>'status'='active' and f->>'is_owner'='false'
        and f->>'relationship_type' in ('fan','player'))
    or exists(select 1 from public.get_own_adult_player_account_state() a
      where a.team_id=team_value and a.club_id=club_value and a.access_granted)) then
    raise exception 'branding_actor_denied' using errcode='42501';
  end if;
  select c0.* into c from public.clubs c0 join public.teams t on t.club_id=c0.id
    where c0.id=club_value and t.id=team_value and c0.status='active' and c0.archived_at is null
      and t.status='active' and t.archived_at is null;
  if not found then raise exception 'branding_actor_denied' using errcode='42501'; end if;
  select * into e from app_private.first_250_branding_entries where team_id=team_value and club_id=club_value;
  promotion_allowed:=coalesce(e.state in ('grandfathered','permanent')
    or (e.state='provisional' and e.started_at<=clock_timestamp() and e.deadline_at>clock_timestamp()),false);
  logo_allowed:=public.can_use_plan_feature(club_value,'basicLogoBranding');
  colour_allowed:=public.can_use_plan_feature(club_value,'customColoursBranding') or app_private.paid_team_colour_entitled(club_value);
  paid_club:=public.workspace_scope_for_plan_key(c.plan_key)='club' and logo_allowed and colour_allowed;
  if paid_club then
    return jsonb_build_object('teamId',team_value,'clubId',club_value,'source','paid_club',
      'logoAllowed',true,'coloursAllowed',true,'logoUrl',coalesce(c.logo_url,''),
      'accent',coalesce(c.theme_accent,''),'buttonStyle',coalesce(c.theme_button_style,'solid'));
  end if;
  if (not exists(select 1 from app_private.first_250_branding_offer where release_enabled)
    or (select count(*) from app_private.first_250_branding_entries where cohort='existing_39')<>39)
    and not app_private.paid_team_colour_entitled(club_value) then return null; end if;
  select * into b from app_private.first_250_team_branding where team_id=team_value and club_id=club_value;
  -- Non-participants preserve their existing display behaviour exactly.
  if e.team_id is null and b.team_id is null then return null; end if;
  return jsonb_build_object('teamId',team_value,'clubId',club_value,'source','team',
    'logoAllowed',logo_allowed or promotion_allowed,'coloursAllowed',colour_allowed or promotion_allowed,
    'baseLogoAllowed',logo_allowed,'baseColoursAllowed',colour_allowed,
    'expiresAt',case when e.state='provisional' then e.deadline_at else null end,
    'logoUrl',case when logo_allowed or promotion_allowed then coalesce(b.logo_url,'') else '' end,
    'accent',case when colour_allowed or promotion_allowed then coalesce(b.theme_accent,'') else '' end,
    'buttonStyle',coalesce(b.theme_button_style,'solid'));
end;
$$;

create or replace function public.save_first_250_team_branding(actor_value uuid,team_value uuid,club_value uuid,
  logo_value text,accent_value text,button_value text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare e app_private.first_250_branding_entries; promo boolean;
begin
  if auth.role() is distinct from 'service_role'
    or not app_private.branding_actor_can_manage(actor_value,club_value,team_value) then
    raise exception 'branding_actor_denied' using errcode='42501';
  end if;
  if not exists(select 1 from app_private.first_250_branding_offer where release_enabled) and not app_private.paid_team_colour_entitled(club_value) then
    raise exception 'branding_offer_not_active'; end if;
  select * into e from app_private.first_250_branding_entries where team_id=team_value and club_id=club_value for update;
  if not app_private.branding_actor_can_manage(actor_value,club_value,team_value) then
    raise exception 'branding_actor_denied' using errcode='42501'; end if;
  promo:=coalesce(e.state in ('grandfathered','permanent')
    or (e.state='provisional' and e.deadline_at>clock_timestamp()),false);
  if (logo_value is not null and not (promo or public.can_use_plan_feature(club_value,'basicLogoBranding')))
    or ((accent_value is not null or button_value is not null)
      and not (promo or public.can_use_plan_feature(club_value,'customColoursBranding') or app_private.paid_team_colour_entitled(club_value))) then
    raise exception 'branding_not_entitled' using errcode='42501'; end if;
  if logo_value is not null and logo_value !~ ('^https://[^/]+/storage/v1/object/public/club-logos/teams/'
    || team_value::text || '/logos/[0-9a-f]{64}\.png$') then raise exception 'branding_logo_invalid'; end if;
  insert into app_private.first_250_team_branding(team_id,club_id,logo_url,theme_accent,theme_button_style)
    values(team_value,club_value,logo_value,accent_value,button_value)
    on conflict(team_id) do update set logo_url=coalesce(excluded.logo_url,first_250_team_branding.logo_url),
      theme_accent=coalesce(excluded.theme_accent,first_250_team_branding.theme_accent),
      theme_button_style=coalesce(excluded.theme_button_style,first_250_team_branding.theme_button_style),updated_at=clock_timestamp()
    where first_250_team_branding.club_id=excluded.club_id;
  if not found then raise exception 'branding_reservation_conflict'; end if;
  return true;
end;
$$;

create or replace function public.read_first_250_team_branding_management(actor_value uuid,team_value uuid,club_value uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e app_private.first_250_branding_entries; b app_private.first_250_team_branding;
  progress jsonb; promo boolean;
begin
  if auth.role() is distinct from 'service_role'
    or not app_private.branding_actor_can_manage(actor_value,club_value,team_value) then
    raise exception 'branding_actor_denied' using errcode='42501'; end if;
  if (not exists(select 1 from app_private.first_250_branding_offer where release_enabled)
    or (select count(*) from app_private.first_250_branding_entries where cohort='existing_39')<>39)
    and not app_private.paid_team_colour_entitled(club_value) then
    return jsonb_build_object('enabled',false); end if;
  progress:=app_private.observe_first_250_branding_team(team_value,club_value);
  if not app_private.branding_actor_can_manage(actor_value,club_value,team_value) then
    raise exception 'branding_actor_denied' using errcode='42501'; end if;
  select * into e from app_private.first_250_branding_entries where team_id=team_value and club_id=club_value;
  select * into b from app_private.first_250_team_branding where team_id=team_value and club_id=club_value;
  promo:=coalesce(e.state in ('grandfathered','permanent')
    or (e.state='provisional' and e.started_at<=clock_timestamp() and e.deadline_at>clock_timestamp()),false);
  return jsonb_build_object('enabled',true,'teamId',team_value,'clubId',club_value,
    'paidTeam',app_private.paid_team_colour_entitled(club_value),
    'claimAllowed',e.slot is null and exists(select 1 from public.clubs c where c.id=club_value
      and public.canonical_subscription_plan_key(c.plan_key)='matchday'),
    'state',coalesce(e.state,'unclaimed'),'cohort',e.cohort,'deadlineAt',e.deadline_at,
    'extensionUsed',coalesce(e.extension_used,false),
    'playersWithAcceptedParent',coalesce((select players_with_parent from app_private.first_250_branding_observations where slot=e.slot),(progress->>'playersWithAcceptedParent')::integer,0),
    'completedMatches',coalesce((select completed_matches from app_private.first_250_branding_observations where slot=e.slot),(progress->>'completedMatches')::integer,0),
    'termsVersion',(select terms_version from app_private.first_250_branding_offer where singleton),
    'logoAllowed',promo or public.can_use_plan_feature(club_value,'basicLogoBranding'),
    'coloursAllowed',promo or public.can_use_plan_feature(club_value,'customColoursBranding') or app_private.paid_team_colour_entitled(club_value),
    'logoUrl',coalesce(b.logo_url,''),'accent',coalesce(b.theme_accent,''),
    'buttonStyle',coalesce(b.theme_button_style,'solid'));
end;
$$;

create or replace function public.read_parent_invite_branding(team_value uuid, club_value uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.clubs; e app_private.first_250_branding_entries;
  b app_private.first_250_team_branding; promotion_allowed boolean := false;
  logo_allowed boolean; colour_allowed boolean; paid_club boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'parent_invite_branding_service_only' using errcode = '42501';
  end if;
  select c0.* into c from public.clubs c0 join public.teams t on t.club_id = c0.id
    where c0.id = club_value and t.id = team_value and c0.status = 'active' and c0.archived_at is null
      and t.status = 'active' and t.archived_at is null;
  if not found then raise exception 'parent_invite_branding_scope_denied' using errcode = '42501'; end if;
  logo_allowed := public.can_use_plan_feature(club_value, 'basicLogoBranding');
  colour_allowed := public.can_use_plan_feature(club_value, 'customColoursBranding') or app_private.paid_team_colour_entitled(club_value);
  paid_club := public.workspace_scope_for_plan_key(c.plan_key) = 'club' and logo_allowed and colour_allowed;
  if paid_club then
    return jsonb_build_object('teamId', team_value, 'clubId', club_value, 'source', 'paid_club',
      'logoAllowed', true, 'coloursAllowed', true, 'logoUrl', coalesce(c.logo_url, ''),
      'accent', coalesce(c.theme_accent, ''), 'buttonStyle', coalesce(c.theme_button_style, 'solid'));
  end if;
  if (not exists(select 1 from app_private.first_250_branding_offer where release_enabled)
    or (select count(*) from app_private.first_250_branding_entries where cohort = 'existing_39') <> 39)
    and not app_private.paid_team_colour_entitled(club_value) then return null; end if;
  select * into e from app_private.first_250_branding_entries where team_id = team_value and club_id = club_value;
  promotion_allowed := coalesce(e.state in ('grandfathered', 'permanent')
    or (e.state = 'provisional' and e.started_at <= clock_timestamp() and e.deadline_at > clock_timestamp()), false);
  select * into b from app_private.first_250_team_branding where team_id = team_value and club_id = club_value;
  if e.team_id is null and b.team_id is null then return null; end if;
  return jsonb_build_object('teamId', team_value, 'clubId', club_value, 'source', 'team',
    'logoAllowed', logo_allowed or promotion_allowed, 'coloursAllowed', colour_allowed or promotion_allowed,
    'baseLogoAllowed', logo_allowed, 'baseColoursAllowed', colour_allowed,
    'expiresAt', case when e.state = 'provisional' then e.deadline_at else null end,
    'logoUrl', case when logo_allowed or promotion_allowed then coalesce(b.logo_url, '') else '' end,
    'accent', case when colour_allowed or promotion_allowed then coalesce(b.theme_accent, '') else '' end,
    'buttonStyle', coalesce(b.theme_button_style, 'solid'));
end;
$$;
