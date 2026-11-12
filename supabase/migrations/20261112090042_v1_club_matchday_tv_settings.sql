create table public.club_matchday_tv_links (
  slug text primary key,
  club_id uuid references public.clubs(id) on delete set null,
  constraint club_matchday_tv_links_owner_key unique (club_id, slug),
  constraint club_matchday_tv_links_slug_check check (
    length(slug) <= 63
    and slug collate "C" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    and length(regexp_replace(slug collate "C", '[^a-z]', '', 'g')) >= 4
    and slug collate "C" !~ '^[a-z0-9-]{21}[aqgw]$'
    and slug not in (
      'admin', 'api', 'app', 'assets', 'auth', 'club-admin', 'club-matchday-tv', 'club-settings',
      'coach', 'dashboard', 'favicon', 'health', 'help', 'home', 'index', 'login', 'logout',
      'manifest', 'matchday', 'netlify', 'parent', 'preview', 'privacy', 'robots', 'settings',
      'sign-in', 'sign-out', 'sign-up', 'sitemap', 'status', 'support', 'terms', 'viewer'
    )
  )
);

create table public.club_matchday_tv_settings (
  club_id uuid primary key references public.clubs(id) on delete cascade,
  slug text,
  preferences jsonb not null check (
    jsonb_typeof(preferences) = 'object' and octet_length(preferences::text) <= 5200000
  ),
  revision integer not null check (revision > 0),
  foreign key (club_id, slug) references public.club_matchday_tv_links(club_id, slug) on delete cascade
);

alter table public.club_matchday_tv_links enable row level security;
alter table public.club_matchday_tv_settings enable row level security;
revoke all on public.club_matchday_tv_links, public.club_matchday_tv_settings from public, anon, authenticated;
grant select, insert on public.club_matchday_tv_links to service_role;
grant select, insert, update on public.club_matchday_tv_settings to service_role;

-- The server authorizes the active own-club Club Admin before calling this function.
-- Keep prior slugs so a renamed link continues to resolve to its original club.
create function public.save_club_matchday_tv_settings(
  p_club_id uuid,
  p_slug text,
  p_preferences jsonb,
  p_revision integer
) returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  previous public.club_matchday_tv_settings;
  next_slug text;
  next_revision integer;
begin
  -- Serialize saves for one club before testing its revision.
  perform 1 from public.clubs where id = p_club_id for update;
  if not found then
    raise exception 'Club unavailable' using errcode = '23503';
  end if;

  select * into previous from public.club_matchday_tv_settings where club_id = p_club_id;
  if coalesce(previous.revision, 0) is distinct from p_revision then
    raise exception 'Display settings changed' using errcode = 'PT409';
  end if;

  next_slug := coalesce(p_slug, previous.slug);
  if next_slug is not null then
    insert into public.club_matchday_tv_links (slug, club_id)
      values (next_slug, p_club_id)
      on conflict (slug) do nothing;

    if not exists (
      select 1 from public.club_matchday_tv_links where slug = next_slug and club_id = p_club_id
    ) then
      raise exception 'Link ending already taken' using errcode = '23505';
    end if;
  end if;

  next_revision := coalesce(previous.revision, 0) + 1;
  insert into public.club_matchday_tv_settings (club_id, slug, preferences, revision)
    values (p_club_id, next_slug, p_preferences, next_revision)
    on conflict (club_id) do update
      set slug = excluded.slug, preferences = excluded.preferences, revision = excluded.revision;
  return next_revision;
end;
$$;

revoke execute on function public.save_club_matchday_tv_settings(uuid, text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.save_club_matchday_tv_settings(uuid, text, jsonb, integer) to service_role;
