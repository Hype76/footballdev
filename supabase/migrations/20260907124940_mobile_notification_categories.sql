-- App-scoped account preferences survive installation refresh and context changes.
-- Missing rows intentionally use score/cards and enabled independent categories.
create table public.mobile_notification_preferences (
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  app text not null check (app in ('coach', 'parent')),
  game_day text not null default 'scores_cards' check (game_day in ('off', 'scores_cards', 'full')),
  invites boolean not null default true,
  chats boolean not null default true,
  resources boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (auth_user_id, app)
);
alter table public.mobile_notification_preferences enable row level security;
revoke all on public.mobile_notification_preferences from public, anon, authenticated;
grant select on public.mobile_notification_preferences to authenticated;
grant all on public.mobile_notification_preferences to service_role;
create policy mobile_notification_preferences_read_own on public.mobile_notification_preferences
  for select to authenticated using (auth_user_id = (select auth.uid()));

create or replace function public.set_mobile_notification_preference(app_value text, key_value text, value_json jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  saved public.mobile_notification_preferences;
begin
  if actor is null then raise exception 'Sign in before changing notifications'; end if;
  if app_value is null or app_value not in ('coach','parent') then raise exception 'Invalid app'; end if;
  if key_value is null or key_value not in ('gameDay','invites','chats','resources') then raise exception 'Invalid notification category'; end if;
  if value_json is null then raise exception 'Invalid notification choice'; end if;
  if key_value = 'gameDay' then
    if jsonb_typeof(value_json) <> 'string' or value_json #>> '{}' not in ('off','scores_cards','full') then raise exception 'Invalid Game Day choice'; end if;
  elsif jsonb_typeof(value_json) <> 'boolean' then raise exception 'Invalid notification switch'; end if;

  insert into public.mobile_notification_preferences(auth_user_id, app) values(actor, app_value)
  on conflict (auth_user_id, app) do nothing;
  update public.mobile_notification_preferences set
    game_day = case when key_value = 'gameDay' then value_json #>> '{}' else game_day end,
    invites = case when key_value = 'invites' then (value_json #>> '{}')::boolean else invites end,
    chats = case when key_value = 'chats' then (value_json #>> '{}')::boolean else chats end,
    resources = case when key_value = 'resources' then (value_json #>> '{}')::boolean else resources end,
    updated_at = now()
  where auth_user_id = actor and app = app_value returning * into saved;
  return jsonb_build_object('gameDay',saved.game_day,'invites',saved.invites,'chats',saved.chats,'resources',saved.resources);
end;
$$;
revoke all on function public.set_mobile_notification_preference(text,text,jsonb) from public, anon;
grant execute on function public.set_mobile_notification_preference(text,text,jsonb) to authenticated;
