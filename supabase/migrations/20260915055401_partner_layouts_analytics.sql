-- Partner publishing and analytics. All writes are guarded RPCs or service operations.
create table public.partner_layouts (
  app text primary key check (app in ('parent','coach')),
  draft jsonb not null default '{"items":[]}',
  published jsonb not null default '{"items":[]}',
  revision integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null
);
insert into public.partner_layouts(app) values ('parent'),('coach');
create table public.partner_versions (
  id bigint generated always as identity primary key,
  app text not null references public.partner_layouts(app),
  layout jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id) on delete set null
);
create table public.partner_assets (
  id uuid primary key default gen_random_uuid(),
  url text not null unique,
  created_at timestamptz not null default now()
);
create table public.partner_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  linked_analytics boolean not null default false,
  updated_at timestamptz not null default now()
);
create table public.partner_events (
  id uuid primary key,
  app text not null references public.partner_layouts(app),
  item_id uuid not null,
  item_title text not null,
  kind text not null check (kind in ('view','click')),
  platform text not null check (platform in ('ios','android','web')),
  user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index partner_events_app_time on public.partner_events(app,created_at desc);
create index partner_events_user on public.partner_events(user_id) where user_id is not null;
create table public.partner_reports (
  id uuid primary key default gen_random_uuid(),
  app text not null references public.partner_layouts(app),
  item_id uuid not null,
  item_title text not null,
  user_id uuid references public.users(id) on delete set null,
  reason text not null check (length(reason) between 3 and 1000),
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index partner_reports_user on public.partner_reports(user_id);
create index partner_reports_app_time on public.partner_reports(app,created_at desc);
alter table public.partner_layouts enable row level security;
alter table public.partner_versions enable row level security;
alter table public.partner_assets enable row level security;
alter table public.partner_preferences enable row level security;
alter table public.partner_events enable row level security;
alter table public.partner_reports enable row level security;
revoke all on public.partner_layouts,public.partner_versions,public.partner_assets,public.partner_preferences,public.partner_events,public.partner_reports from anon,authenticated;
grant all on public.partner_layouts,public.partner_versions,public.partner_assets,public.partner_preferences,public.partner_events,public.partner_reports to service_role;
grant usage,select on sequence public.partner_versions_id_seq to service_role;

create or replace function app_private.partner_actor(p_app text, p_admin boolean default false)
returns public.users language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor public.users;
begin
  select * into actor from public.users where id=auth.uid() and coalesce(status,'active')='active';
  if actor.id is null or p_app not in ('parent','coach') then raise exception 'Partner access denied' using errcode='42501'; end if;
  if p_admin and actor.role<>'super_admin' then raise exception 'Platform admin access required' using errcode='42501'; end if;
  if not p_admin and actor.role<>'super_admin' and not (
    (p_app='parent' and actor.role in ('parent_portal','adult_player','fan')) or
    (p_app='coach' and actor.role not in ('parent_portal','adult_player','fan') and actor.role_rank>=10)
  ) then raise exception 'Partner audience access denied' using errcode='42501'; end if;
  return actor;
end $$;
revoke all on function app_private.partner_actor(text,boolean) from public,anon,authenticated;

create or replace function app_private.validate_partner_layout(p_layout jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare item jsonb; other jsonb; seen uuid[]:='{}'; item_id uuid; x int; y int; w int; h int;
begin
  if jsonb_typeof(p_layout->'items') is distinct from 'array' or jsonb_array_length(p_layout->'items')>48 or octet_length(p_layout::text)>200000 then raise exception 'Invalid partner layout'; end if;
  for item in select value from jsonb_array_elements(p_layout->'items') loop
    item_id:=(item->>'id')::uuid;
    if item_id is null or item_id=any(seen) then raise exception 'Duplicate or missing image ID'; end if;
    seen:=array_append(seen,item_id);
    x:=(item->>'x')::int; y:=(item->>'y')::int; w:=(item->>'w')::int; h:=(item->>'h')::int;
    if x is null or y is null or w is null or h is null or x<0 or y<0 or w<1 or h<1 or x+w>4 or y+h>24 then raise exception 'Image is outside the grid'; end if;
    if length(trim(coalesce(item->>'title',''))) not between 1 and 120 or length(trim(coalesce(item->>'alt',''))) not between 1 and 500 then raise exception 'Add partner name and image description'; end if;
    if not exists(select 1 from public.partner_assets a where a.url=item->>'imageUrl') then raise exception 'Import or upload the image before saving'; end if;
    if coalesce(item->>'url','')<>'' and (length(item->>'url')>2048 or (item->>'url') !~ '^https://[A-Za-z0-9][A-Za-z0-9.-]+\.[A-Za-z]{2,}(:443)?([/?#][^[:space:]]*)?$') then raise exception 'Use a public HTTPS website address'; end if;
    if nullif(item->>'startsAt','')::timestamptz >= nullif(item->>'endsAt','')::timestamptz then raise exception 'Offer end must follow start'; end if;
    perform coalesce((item->>'hidden')::boolean,false),coalesce((item->>'sponsored')::boolean,false);
    for other in select value from jsonb_array_elements(p_layout->'items') where value->>'id'<>item->>'id' loop
      if x<(other->>'x')::int+(other->>'w')::int and x+w>(other->>'x')::int and y<(other->>'y')::int+(other->>'h')::int and y+h>(other->>'y')::int then raise exception 'Partner images overlap'; end if;
    end loop;
  end loop;
end $$;
revoke all on function app_private.validate_partner_layout(jsonb) from public,anon,authenticated;

create or replace function public.partner_admin(p_app text,p_action text default 'load',p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor public.users; current_layout public.partner_layouts; next_layout jsonb; result jsonb;
begin
  actor:=app_private.partner_actor(p_app,true);
  select * into current_layout from public.partner_layouts where app=p_app for update;
  if p_action in ('save','publish','restore','hide') then
    if (p_payload->>'revision')::int is distinct from current_layout.revision then raise exception 'This layout changed in another session. Reload before saving.'; end if;
    if p_action='restore' then
      select layout into next_layout from public.partner_versions where app=p_app and id=(p_payload->>'versionId')::bigint;
      if next_layout is null then raise exception 'Saved version not found'; end if;
    elsif p_action='hide' then
      next_layout:=jsonb_build_object('items',coalesce((select jsonb_agg(case when value->>'id'=p_payload->>'itemId' then value||'{"hidden":true}' else value end) from jsonb_array_elements(current_layout.published->'items')),'[]'));
    else next_layout:=p_payload->'layout'; end if;
    perform app_private.validate_partner_layout(next_layout);
    if p_action in ('publish','hide') then
      insert into public.partner_versions(app,layout,created_by) values(p_app,current_layout.published,actor.id);
      update public.partner_layouts set published=next_layout,draft=case when p_action='hide' then jsonb_build_object('items',coalesce((select jsonb_agg(case when value->>'id'=p_payload->>'itemId' then value||'{"hidden":true}' else value end) from jsonb_array_elements(draft->'items')),'[]')) else next_layout end,revision=revision+1,updated_at=now(),updated_by=actor.id where app=p_app;
      delete from public.partner_versions where app=p_app and id not in(select id from public.partner_versions where app=p_app order by id desc limit 20);
    else
      update public.partner_layouts set draft=next_layout,revision=revision+1,updated_at=now(),updated_by=actor.id where app=p_app;
    end if;
  elsif p_action='resolve' then
    update public.partner_reports set resolved=true where app=p_app and id=(p_payload->>'reportId')::uuid;
  elsif p_action<>'load' then raise exception 'Unknown partner operation'; end if;
  select to_jsonb(l) into result from public.partner_layouts l where app=p_app;
  return result||jsonb_build_object('versions',coalesce((select jsonb_agg(v order by v.id desc) from (select id,created_at from public.partner_versions where app=p_app order by id desc limit 20)v),'[]'),'reports',coalesce((select jsonb_agg(r order by r.created_at desc) from(select id,item_id,item_title,reason,created_at,resolved from public.partner_reports where app=p_app and not resolved order by created_at desc limit 100)r),'[]'));
end $$;
revoke all on function public.partner_admin(text,text,jsonb) from public,anon;
grant execute on function public.partner_admin(text,text,jsonb) to authenticated;

create or replace function public.partner_feed(p_app text)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare actor public.users;
begin
  actor:=app_private.partner_actor(p_app);
  return jsonb_build_object('items',coalesce((select jsonb_agg(item) from public.partner_layouts l cross join lateral jsonb_array_elements(l.published->'items') item where l.app=p_app and not coalesce((item->>'hidden')::boolean,false) and coalesce(nullif(item->>'startsAt','')::timestamptz,'-infinity')<=now() and coalesce(nullif(item->>'endsAt','')::timestamptz,'infinity')>now()),'[]'), 'linkedAnalytics',(select linked_analytics from public.partner_preferences where user_id=actor.id));
end $$;
revoke all on function public.partner_feed(text) from public,anon;
grant execute on function public.partner_feed(text) to authenticated;

create or replace function public.partner_preference(p_app text,p_allow boolean)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor public.users;
begin
  actor:=app_private.partner_actor(p_app);
  if p_allow is null then raise exception 'Choose an analytics preference'; end if;
  insert into public.partner_preferences(user_id,linked_analytics) values(actor.id,p_allow) on conflict(user_id) do update set linked_analytics=excluded.linked_analytics,updated_at=now();
  if not p_allow then update public.partner_events set user_id=null where user_id=actor.id; end if;
end $$;
revoke all on function public.partner_preference(text,boolean) from public,anon;
grant execute on function public.partner_preference(text,boolean) to authenticated;

create or replace function public.partner_interaction(p_app text,p_item_id uuid,p_kind text,p_platform text,p_event_id uuid,p_reason text default '')
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor public.users; item jsonb; linked boolean;
begin
  actor:=app_private.partner_actor(p_app);
  select value into item from public.partner_layouts l cross join lateral jsonb_array_elements(l.published->'items') where l.app=p_app and value->>'id'=p_item_id::text and not coalesce((value->>'hidden')::boolean,false) and coalesce(nullif(value->>'startsAt','')::timestamptz,'-infinity')<=now() and coalesce(nullif(value->>'endsAt','')::timestamptz,'infinity')>now();
  if item is null then return false; end if;
  if p_kind='report' then
    if (select count(*) from public.partner_reports where user_id=actor.id and created_at>now()-interval '1 hour')>=10 then raise exception 'Please try again later'; end if;
    insert into public.partner_reports(id,app,item_id,item_title,user_id,reason) values(p_event_id,p_app,p_item_id,item->>'title',actor.id,trim(p_reason)) on conflict(id) do nothing;
    return true;
  end if;
  if p_kind not in ('view','click') or p_platform not in ('ios','android','web') or p_event_id is null then raise exception 'Invalid partner event'; end if;
  if actor.role='super_admin' or actor.role='adult_player' or actor.name ilike '%FP TEST%' or actor.email ilike '%fptest%' or exists(select 1 from public.clubs where id=actor.club_id and name ilike '%FP TEST%') then return false; end if;
  if p_kind='click' and coalesce(item->>'url','')='' then return false; end if;
  -- Consent identifies an account only inside our service. No account data is sent to partners.
  select linked_analytics into linked from public.partner_preferences where user_id=actor.id;
  if coalesce(linked,false) and (select count(*) from public.partner_events where user_id=actor.id and created_at>now()-interval '1 minute')>=120 then return false; end if;
  insert into public.partner_events(id,app,item_id,item_title,kind,platform,user_id) values(p_event_id,p_app,p_item_id,item->>'title',p_kind,p_platform,case when linked then actor.id else null end) on conflict(id) do nothing;
  return true;
end $$;
revoke all on function public.partner_interaction(text,uuid,text,text,uuid,text) from public,anon;
grant execute on function public.partner_interaction(text,uuid,text,text,uuid,text) to authenticated;

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
    'activity',case when p_accounts then coalesce((select jsonb_agg(s) from(select e.item_title,e.created_at,e.platform,u.id as account_id,u.name as account_name from public.partner_events e join public.users u on u.id=e.user_id where e.app=p_app and e.kind='click' and e.created_at>=greatest(p_start,now()-interval '90 days') and e.created_at<p_end order by e.created_at desc,e.id limit 100 offset p_offset)s),'[]') else '[]'::jsonb end
  );
end $$;
revoke all on function public.partner_stats(text,timestamptz,timestamptz,boolean,integer) from public,anon;
grant execute on function public.partner_stats(text,timestamptz,timestamptz,boolean,integer) to authenticated;

-- Service-only daily retention, also removes resolved reports after 90 days.
create or replace function public.cleanup_partner_data()
returns void language sql security invoker set search_path=pg_catalog,public as $$
  delete from public.partner_events where created_at<now()-interval '90 days';
  delete from public.partner_reports where created_at<now()-interval '90 days';
$$;
revoke all on function public.cleanup_partner_data() from public,anon,authenticated;
grant execute on function public.cleanup_partner_data() to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('partner-images','partner-images',true,2097152,array['image/png']) on conflict(id) do nothing;
