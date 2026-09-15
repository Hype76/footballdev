-- Parent identity comes from Auth and an authorised relationship, not a staff profile.
alter table public.partner_preferences drop constraint partner_preferences_user_id_fkey;
alter table public.partner_preferences add constraint partner_preferences_user_id_fkey foreign key(user_id) references auth.users(id) on delete cascade;
alter table public.partner_events drop constraint partner_events_user_id_fkey;
alter table public.partner_events add constraint partner_events_user_id_fkey foreign key(user_id) references auth.users(id) on delete set null;
alter table public.partner_reports drop constraint partner_reports_user_id_fkey;
alter table public.partner_reports add constraint partner_reports_user_id_fkey foreign key(user_id) references auth.users(id) on delete set null;

create or replace function app_private.partner_actor(p_app text, p_admin boolean default false)
returns public.users language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare
  actor public.users;
  account auth.users;
  audience_club uuid;
  audience_role text;
begin
  if auth.uid() is null or p_app is null or p_app not in ('parent','coach') then
    raise exception 'Partner access denied' using errcode='42501';
  end if;
  select * into account from auth.users where id=auth.uid() and deleted_at is null
    and (banned_until is null or banned_until<=now());
  if account.id is null then raise exception 'Partner access denied' using errcode='42501'; end if;
  select * into actor from public.users where id=account.id;

  if p_admin then
    if actor.id is null or actor.role is distinct from 'super_admin' or coalesce(actor.status,'active')<>'active' then
      raise exception 'Platform admin access denied' using errcode='42501';
    end if;
    return actor;
  end if;
  if actor.role='super_admin' and coalesce(actor.status,'active')='active' then return actor; end if;
  if p_app='coach' then
    if actor.id is null or coalesce(actor.status,'active')<>'active'
      or actor.role in ('parent_portal','adult_player','fan') or coalesce(actor.role_rank,0)<10 then
      raise exception 'Partner audience access denied' using errcode='42501';
    end if;
    return actor;
  end if;

  select l.club_id,'parent_portal' into audience_club,audience_role
  from public.parent_player_links l
  where l.auth_user_id=account.id and l.link_type='parent' and l.status='active'
    and public.current_user_can_access_parent_link(l.id,l.player_id)
  order by l.id limit 1;
  if audience_role is null then
    select f.club_id,case when f.relationship_type='player' then 'adult_player' else 'fan' end
      into audience_club,audience_role
    from public.fan_connections f
    where f.auth_user_id=account.id and f.status='active'
      and app_private.fan_scope_active(f.parent_link_id,f.player_id,f.club_id,f.invited_by)
      and app_private.fan_account_active(account.id,f.club_id)
    order by (f.relationship_type='fan') desc,f.id limit 1;
  end if;
  if audience_role is null then raise exception 'Partner audience access denied' using errcode='42501'; end if;

  -- Populate the existing internal return shape without creating or changing profiles.
  actor.id:=account.id;
  actor.email:=account.email;
  actor.name:=coalesce(nullif(actor.name,''),nullif(account.raw_user_meta_data->>'name',''),nullif(account.raw_user_meta_data->>'display_name',''),'Parent account');
  actor.role:=case when actor.role in ('super_admin','adult_player') then actor.role else audience_role end;
  actor.club_id:=audience_club;
  return actor;
end $$;
revoke all on function app_private.partner_actor(text,boolean) from public,anon,authenticated;

create or replace function public.partner_stats(p_app text,p_start timestamptz,p_end timestamptz,p_accounts boolean default false,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  perform app_private.partner_actor(p_app,true);
  if p_start is null or p_end is null or p_start>=p_end or p_end-p_start>interval '91 days' or p_offset<0 then raise exception 'Choose a date range of up to 90 days'; end if;
  return jsonb_build_object(
    'summary',(select jsonb_build_object('views',count(*) filter(where kind='view'),'clicks',count(*) filter(where kind='click'),'accounts',count(distinct user_id) filter(where kind='click')) from public.partner_events where app=p_app and created_at>=greatest(p_start,now()-interval '90 days') and created_at<p_end),
    'offers',coalesce((select jsonb_agg(s) from(select item_id,max(item_title) as title,count(*) filter(where kind='view') as views,count(*) filter(where kind='click') as clicks,count(distinct user_id) filter(where kind='click') as accounts from public.partner_events where app=p_app and created_at>=greatest(p_start,now()-interval '90 days') and created_at<p_end group by item_id order by count(*) filter(where kind='click') desc)s),'[]'),
    'hours',coalesce((select jsonb_agg(s order by s.hour) from(select extract(hour from created_at at time zone 'Europe/London')::int as hour,count(*) as clicks from public.partner_events where app=p_app and kind='click' and created_at>=greatest(p_start,now()-interval '90 days') and created_at<p_end group by 1)s),'[]'),
    'platforms',coalesce((select jsonb_agg(s) from(select platform,count(*) filter(where kind='click') as clicks,count(*) filter(where kind='view') as views from public.partner_events where app=p_app and created_at>=greatest(p_start,now()-interval '90 days') and created_at<p_end group by platform)s),'[]'),
    'activity',case when p_accounts then coalesce((select jsonb_agg(s) from(select e.item_title,e.created_at,e.platform,a.id as account_id,coalesce(nullif(u.name,''),nullif(a.raw_user_meta_data->>'name',''),nullif(a.raw_user_meta_data->>'display_name',''),'Parent account') as account_name from public.partner_events e join auth.users a on a.id=e.user_id left join public.users u on u.id=a.id where e.app=p_app and e.kind='click' and e.created_at>=greatest(p_start,now()-interval '90 days') and e.created_at<p_end order by e.created_at desc,e.id limit 100 offset p_offset)s),'[]') else '[]'::jsonb end
  );
end $$;
revoke all on function public.partner_stats(text,timestamptz,timestamptz,boolean,integer) from public,anon;
grant execute on function public.partner_stats(text,timestamptz,timestamptz,boolean,integer) to authenticated;
