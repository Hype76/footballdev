-- Service-only display lookup. Sending functions authorise the invitation first.
-- No invitation, branding entry, offer clock or observation is changed here.
create function public.read_parent_invite_branding(team_value uuid, club_value uuid)
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
  colour_allowed := public.can_use_plan_feature(club_value, 'customColoursBranding');
  paid_club := public.workspace_scope_for_plan_key(c.plan_key) = 'club' and logo_allowed and colour_allowed;
  if paid_club then
    return jsonb_build_object('teamId', team_value, 'clubId', club_value, 'source', 'paid_club',
      'logoAllowed', true, 'coloursAllowed', true, 'logoUrl', coalesce(c.logo_url, ''),
      'accent', coalesce(c.theme_accent, ''), 'buttonStyle', coalesce(c.theme_button_style, 'solid'));
  end if;
  if not exists(select 1 from app_private.first_250_branding_offer where release_enabled)
    or (select count(*) from app_private.first_250_branding_entries where cohort = 'existing_39') <> 39 then return null; end if;
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
revoke all on function public.read_parent_invite_branding(uuid, uuid) from public, anon, authenticated;
grant execute on function public.read_parent_invite_branding(uuid, uuid) to service_role;
