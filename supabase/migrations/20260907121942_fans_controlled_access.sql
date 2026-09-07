-- Fans never create Parent authority. All writes pass through bounded RPCs.
create schema if not exists app_private;
create table public.fan_connections (
  id uuid primary key default gen_random_uuid(),
  parent_link_id uuid not null references public.parent_player_links(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  club_id uuid not null references public.clubs(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  name text not null check (length(btrim(name)) between 1 and 120),
  email text not null check (length(email) <= 254 and email = lower(btrim(email)) and email ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'),
  relationship_type text not null default 'fan' check (relationship_type in ('fan', 'player')),
  permissions jsonb not null default '{"schedule":false,"game_day":true,"development":false,"resources":false}',
  status text not null default 'pending' check (status in ('pending', 'active', 'cancelled', 'revoked', 'removed')),
  invite_token uuid not null unique default gen_random_uuid(),
  request_id uuid not null default gen_random_uuid(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz not null default now(),
  notifications_enabled boolean not null default true,
  email_sent_at timestamptz,
  constraint fan_permissions_shape check (
    jsonb_typeof(permissions) = 'object'
    and permissions ?& array['schedule','game_day','development','resources']
    and permissions - array['schedule','game_day','development','resources'] = '{}'::jsonb
    and jsonb_typeof(permissions->'schedule') = 'boolean'
    and jsonb_typeof(permissions->'game_day') = 'boolean'
    and jsonb_typeof(permissions->'development') = 'boolean'
    and jsonb_typeof(permissions->'resources') = 'boolean'
    and ((permissions->>'schedule')::boolean or (permissions->>'game_day')::boolean or (permissions->>'development')::boolean)
    and (not (permissions->>'resources')::boolean or (permissions->>'development')::boolean)
  ),
  unique(invited_by, request_id)
);
create index fan_connections_actor on public.fan_connections(auth_user_id, status);
create index fan_connections_parent on public.fan_connections(parent_link_id, created_at desc);
create unique index fan_connections_active_identity on public.fan_connections(parent_link_id, email, relationship_type) where status = 'active';
alter table public.fan_connections enable row level security;
revoke all on public.fan_connections from public, anon, authenticated;
grant all on public.fan_connections to service_role;

create table public.fan_devices (
  token text primary key check (token ~ '^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$'),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now()
);
alter table public.fan_devices enable row level security;
revoke all on public.fan_devices from public, anon, authenticated;
grant all on public.fan_devices to service_role;

create table public.fan_notifications (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.fan_connections(id) on delete cascade,
  match_id uuid not null references public.match_days(id) on delete cascade,
  event_key text not null,
  title text not null,
  body text not null,
  push_sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique(connection_id, event_key)
);
alter table public.fan_notifications enable row level security;
revoke all on public.fan_notifications from public, anon, authenticated;
grant all on public.fan_notifications to service_role;

create or replace function app_private.fan_parent_active(link_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (
    select 1 from public.parent_player_links l
    join public.players p on p.id = l.player_id and p.club_id = l.club_id
    join public.clubs c on c.id = l.club_id
    where l.id = link_id and l.link_type = 'parent' and l.status = 'active' and l.auth_user_id is not null
      and coalesce(p.status, 'active') <> 'archived' and p.archived_at is null
      and coalesce(c.status, 'active') = 'active'
      and not exists (select 1 from public.users u where u.id = l.auth_user_id and u.status = 'suspended' and (u.role = 'parent_portal' or u.club_id = l.club_id))
  );
$$;
revoke all on function app_private.fan_parent_active(uuid) from public, anon, authenticated;

create or replace function app_private.fan_account_active(actor uuid, target_club uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select actor is not null and exists(select 1 from auth.users where id=actor and email_confirmed_at is not null)
    and not exists(select 1 from public.users where id=actor and status='suspended' and (role='parent_portal' or club_id=target_club));
$$;
revoke all on function app_private.fan_account_active(uuid,uuid) from public,anon,authenticated;

create or replace function app_private.fan_scope_active(link_id uuid, child_id uuid, target_club uuid, owner_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select app_private.fan_parent_active(link_id) and exists(
    select 1 from public.parent_player_links l join public.players p on p.id=l.player_id
    where l.id=link_id and l.player_id=child_id and l.club_id=target_club and l.auth_user_id=owner_id
      and (l.team_id is null or l.team_id=p.team_id)
  );
$$;
revoke all on function app_private.fan_scope_active(uuid,uuid,uuid,uuid) from public,anon,authenticated;

create or replace function public.create_fan_invitation(parent_link_id_value uuid, name_value text, email_value text, permissions_value jsonb, request_id_value uuid)
returns public.fan_connections language plpgsql security definer set search_path = pg_catalog, public as $$
declare parent_row public.parent_player_links%rowtype; result public.fan_connections%rowtype;
begin
  if auth.uid() is null or request_id_value is null then raise exception using errcode='42501', message='Sign in before inviting a Fan.'; end if;
  select * into parent_row from public.parent_player_links where id=parent_link_id_value and auth_user_id=auth.uid() for update;
  if parent_row.id is null or not app_private.fan_parent_active(parent_row.id) then raise exception using errcode='42501', message='Only an active Parent can invite Fans for this child.'; end if;
  if lower(btrim(email_value)) = lower(coalesce(auth.jwt()->>'email','')) then raise exception 'Use the invited person''s email address.'; end if;
  select * into result from public.fan_connections where invited_by=auth.uid() and request_id=request_id_value;
  if result.id is not null then
    if result.parent_link_id<>parent_link_id_value or result.name<>btrim(name_value) or result.email<>lower(btrim(email_value)) or result.permissions<>permissions_value then raise exception 'This invitation request has already been used.'; end if;
    return result;
  end if;
  if exists(select 1 from public.fan_connections where parent_link_id=parent_row.id and email=lower(btrim(email_value)) and status='active') then raise exception 'This person already has access. Edit their permissions instead.'; end if;
  if (select count(*) from public.fan_connections where invited_by=auth.uid() and created_at>now()-interval '1 hour')>=30 then raise exception 'Please wait before creating more invitations.'; end if;
  insert into public.fan_connections(parent_link_id,player_id,club_id,invited_by,name,email,permissions,request_id)
    values(parent_row.id,parent_row.player_id,parent_row.club_id,auth.uid(),btrim(name_value),lower(btrim(email_value)),permissions_value,request_id_value) returning * into result;
  return result;
end; $$;

create or replace function public.accept_fan_invitation(token_value uuid)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare target public.fan_connections%rowtype; existing_id uuid;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='Sign in to accept this invitation.'; end if;
  select * into target from public.fan_connections where invite_token=token_value for update;
  if target.id is null or target.relationship_type<>'fan' or target.email<>lower(coalesce(auth.jwt()->>'email','')) or not app_private.fan_scope_active(target.parent_link_id,target.player_id,target.club_id,target.invited_by)
    or not app_private.fan_account_active(auth.uid(),target.club_id)
    then raise exception using errcode='42501',message='This invitation is not available for this verified email address.'; end if;
  if target.status='active' and target.auth_user_id=auth.uid() then return target.id; end if;
  if target.status<>'pending' or target.expires_at<=now() then raise exception 'This invitation has expired or been cancelled.'; end if;
  -- Serialize concurrent invitations to the same child without cancelling other pending invitations.
  perform 1 from public.parent_player_links where id=target.parent_link_id for update;
  select id into existing_id from public.fan_connections where parent_link_id=target.parent_link_id and email=target.email and status='active' and relationship_type=target.relationship_type;
  if existing_id is not null then raise exception 'You already follow this child. Ask the Parent to edit your existing access.'; end if;
  update public.fan_connections set status='active',auth_user_id=auth.uid(),accepted_at=now(),updated_at=now() where id=target.id;
  return target.id;
end; $$;

create or replace function public.manage_fan_connection(connection_id_value uuid, action_value text, permissions_value jsonb default null)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare target public.fan_connections%rowtype;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='Sign in before changing Fan access.'; end if;
  select * into target from public.fan_connections where id=connection_id_value for update;
  if target.id is null then raise exception using errcode='42501',message='Fan access is unavailable.'; end if;
  if action_value in ('remove','notifications_on','notifications_off') then
    if target.auth_user_id is distinct from auth.uid() or target.status<>'active' then raise exception using errcode='42501',message='Only the Fan can change this setting.'; end if;
    if action_value='remove' then
      update public.fan_connections set status='removed',ended_at=now(),notifications_enabled=false,updated_at=now() where id=target.id;
    else
      update public.fan_connections set notifications_enabled=(action_value='notifications_on'),updated_at=now() where id=target.id;
    end if;
  else
    if target.invited_by<>auth.uid() or not app_private.fan_scope_active(target.parent_link_id,target.player_id,target.club_id,target.invited_by) then raise exception using errcode='42501',message='Only the inviting Parent can change this access.'; end if;
    if action_value='permissions' and target.status in ('active','pending') then
      update public.fan_connections set permissions=permissions_value,updated_at=now() where id=target.id;
    elsif action_value='revoke' and target.status in ('active','pending') then
      update public.fan_connections set status=case when status='pending' then 'cancelled' else 'revoked' end,ended_at=now(),notifications_enabled=false,updated_at=now() where id=target.id;
    else raise exception 'This Fan action is not available.'; end if;
  end if;
  if action_value in ('remove','revoke','permissions') then delete from public.fan_notifications where connection_id=target.id; end if;
end; $$;

create or replace function public.list_fan_connections()
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',f.id,'parent_link_id',f.parent_link_id,'player_id',f.player_id,'club_id',f.club_id,
    'player_name',p.player_name,'club_name',c.name,'team_id',p.team_id,'team_name',t.name,
    'name',f.name,'email',f.email,'relationship_type',f.relationship_type,'permissions',f.permissions,
    'status',case when f.status='pending' and f.expires_at<=now() then 'expired' else f.status end,
    'created_at',f.created_at,'expires_at',f.expires_at,'accepted_at',f.accepted_at,'updated_at',f.updated_at,
    'notifications_enabled',f.notifications_enabled,'is_owner',f.invited_by=auth.uid(),
    'invite_token',case when f.invited_by=auth.uid() and f.status='pending' and f.expires_at>now() then f.invite_token end
  ) order by f.created_at desc),'[]'::jsonb)
  from public.fan_connections f join public.players p on p.id=f.player_id join public.clubs c on c.id=f.club_id
  left join public.teams t on t.id=p.team_id
  where auth.uid() is not null and app_private.fan_scope_active(f.parent_link_id,f.player_id,f.club_id,f.invited_by)
    and (f.invited_by=auth.uid() or (f.auth_user_id=auth.uid() and f.status='active'))
    and not exists(select 1 from public.users u where u.id=auth.uid() and u.status='suspended' and (u.role='parent_portal' or u.club_id=f.club_id));
$$;

create or replace function public.get_platform_fan_stats()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.users where id=auth.uid() and role='super_admin' and status='active') then raise exception using errcode='42501',message='Platform Admin access is required.'; end if;
  select jsonb_build_object(
    'uniqueFans',count(distinct auth_user_id) filter(where status='active' and relationship_type='fan' and app_private.fan_scope_active(parent_link_id,player_id,club_id,invited_by) and app_private.fan_account_active(auth_user_id,club_id)),
    'fanConnections',count(*) filter(where status='active' and relationship_type='fan' and app_private.fan_scope_active(parent_link_id,player_id,club_id,invited_by) and app_private.fan_account_active(auth_user_id,club_id)),
    'uniquePlayers',count(distinct auth_user_id) filter(where status='active' and relationship_type='player' and app_private.fan_scope_active(parent_link_id,player_id,club_id,invited_by) and app_private.fan_account_active(auth_user_id,club_id)),
    'playerConnections',count(*) filter(where status='active' and relationship_type='player' and app_private.fan_scope_active(parent_link_id,player_id,club_id,invited_by) and app_private.fan_account_active(auth_user_id,club_id)),
    'uniqueAccounts',count(distinct auth_user_id) filter(where status='active' and app_private.fan_scope_active(parent_link_id,player_id,club_id,invited_by) and app_private.fan_account_active(auth_user_id,club_id)),
    'pending',count(*) filter(where status='pending' and expires_at>now()),
    'expired',count(*) filter(where status='pending' and expires_at<=now()),
    'accepted',count(*) filter(where accepted_at is not null),
    'cancelled',count(*) filter(where status='cancelled'),
    'revoked',count(*) filter(where status='revoked'),
    'removed',count(*) filter(where status='removed')
  ) into result from public.fan_connections;
  return result;
end; $$;

-- Retain legacy accepted relationships as view-only Fans, preserving shared read access.
-- Legacy token-only invitations are cancelled: all new invitations require name and email.
insert into public.fan_connections(id,parent_link_id,player_id,club_id,invited_by,auth_user_id,name,email,permissions,status,accepted_at)
select distinct on (parent.id,lower(btrim(u.email))) f.id,parent.id,f.player_id,f.club_id,parent.auth_user_id,f.auth_user_id,
  left(coalesce(nullif(btrim(u.raw_user_meta_data->>'display_name'),''),nullif(btrim(u.raw_user_meta_data->>'name'),''),'Existing Fan'),120),
  lower(btrim(u.email)),'{"schedule":true,"game_day":true,"development":true,"resources":true}'::jsonb,'active',coalesce(f.accepted_at,now())
from public.parent_player_links f join public.parent_player_links parent on parent.id=f.parent_link_id
join auth.users u on u.id=f.auth_user_id
where f.link_type='family' and f.status='active' and parent.player_id=f.player_id and parent.club_id=f.club_id and app_private.fan_parent_active(parent.id)
  and u.email_confirmed_at is not null
  and u.email ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
order by parent.id,lower(btrim(u.email)),f.accepted_at desc nulls last,f.id;
update public.parent_player_links set status='revoked',updated_at=now() where link_type='family' and status<>'revoked';
-- Retire the old broad family-link creator, including calls from older clients.
create or replace function public.create_own_family_share_link(target_parent_link_id uuid)
returns public.parent_player_links language plpgsql security definer set search_path=pg_catalog,public as $$
begin raise exception 'Update the app and use Fans to create an invitation with a name, email and selected access.'; end; $$;

revoke all on function public.create_fan_invitation(uuid,text,text,jsonb,uuid) from public,anon;
revoke all on function public.accept_fan_invitation(uuid) from public,anon;
revoke all on function public.manage_fan_connection(uuid,text,jsonb) from public,anon;
revoke all on function public.list_fan_connections() from public,anon;
revoke all on function public.get_platform_fan_stats() from public,anon;
grant execute on function public.create_fan_invitation(uuid,text,text,jsonb,uuid), public.accept_fan_invitation(uuid), public.manage_fan_connection(uuid,text,jsonb), public.list_fan_connections(), public.get_platform_fan_stats() to authenticated;

create or replace function public.get_fan_invitation(token_value uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  select jsonb_build_object('name',f.name,'email',f.email,'player_name',p.player_name,'permissions',f.permissions,'expires_at',f.expires_at)
  into result from public.fan_connections f join public.players p on p.id=f.player_id
  where auth.uid() is not null and f.invite_token=token_value and f.relationship_type='fan'
    and f.email=lower(coalesce(auth.jwt()->>'email',''))
    and ((f.status='pending' and f.expires_at>now()) or (f.status='active' and f.auth_user_id=auth.uid()))
    and app_private.fan_scope_active(f.parent_link_id,f.player_id,f.club_id,f.invited_by);
  if result is null then raise exception using errcode='42501',message='This invitation is not available for this email address, or has expired.'; end if;
  return result;
end; $$;
revoke all on function public.get_fan_invitation(uuid) from public,anon;
grant execute on function public.get_fan_invitation(uuid) to authenticated;


-- Old clients cannot restore the retired broad family authority.
create or replace function app_private.reject_legacy_family_access()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if new.link_type='family' and new.status<>'revoked' then
    raise exception 'Use Fans invitations with selected viewing permissions.';
  end if;
  return new;
end; $$;
revoke all on function app_private.reject_legacy_family_access() from public,anon,authenticated;
create trigger reject_legacy_family_access before insert or update on public.parent_player_links
for each row execute function app_private.reject_legacy_family_access();
