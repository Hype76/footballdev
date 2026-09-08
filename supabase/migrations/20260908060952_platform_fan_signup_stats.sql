-- Aggregate identity and invitation state only. Never return recipient or child data.
create or replace function public.get_platform_fan_stats()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  if auth.uid() is null or not exists(select 1 from public.users where id=auth.uid() and role='super_admin' and status='active') then
    raise exception using errcode='42501',message='Platform Admin access is required.';
  end if;

  with connections as materialized (
    select f.*,
      app_private.fan_scope_active(f.parent_link_id,f.player_id,f.club_id,f.invited_by) as scope_active,
      f.status='active' and f.auth_user_id is not null
        and app_private.fan_scope_active(f.parent_link_id,f.player_id,f.club_id,f.invited_by)
        and app_private.fan_account_active(f.auth_user_id,f.club_id) as access_active
    from public.fan_connections f
  ), pending as (
    select f.id,
      case
        when not f.scope_active or exists(
          select 1 from connections accepted where accepted.parent_link_id=f.parent_link_id
            and accepted.email=f.email and accepted.relationship_type='fan' and accepted.status='active'
        ) then 'unavailable'
        when account_state.accounts=0 then 'noAccount'
        when not account_state.account_active then 'unavailable'
        when account_state.confirmed then 'readyToAccept'
        else 'emailUnconfirmed'
      end as signup_stage
    from connections f
    cross join lateral (
      select count(*) as accounts,
        coalesce(bool_or(not exists(
          select 1 from public.users profile where profile.id=u.id and profile.status='suspended'
            and (profile.role='parent_portal' or profile.club_id=f.club_id)
        )),false) as account_active,
        coalesce(bool_or(u.email_confirmed_at is not null and app_private.fan_account_active(u.id,f.club_id)),false) as confirmed
      from auth.users u where lower(u.email)=f.email
    ) account_state
    where f.relationship_type='fan' and f.status='pending' and f.expires_at>now()
  )
  select jsonb_build_object(
    'uniqueFans',count(distinct auth_user_id) filter(where access_active and relationship_type='fan'),
    'fanConnections',count(*) filter(where access_active and relationship_type='fan'),
    'uniquePlayers',count(distinct auth_user_id) filter(where access_active and relationship_type='player'),
    'playerConnections',count(*) filter(where access_active and relationship_type='player'),
    'uniqueAccounts',count(distinct auth_user_id) filter(where access_active),
    -- Keep the original cross-type totals for older clients.
    'pending',count(*) filter(where status='pending' and expires_at>now()),
    'expired',count(*) filter(where status='pending' and expires_at<=now()),
    'accepted',count(*) filter(where accepted_at is not null),
    'cancelled',count(*) filter(where status='cancelled'),
    'revoked',count(*) filter(where status='revoked'),
    'removed',count(*) filter(where status='removed'),
    'fanInvitations',jsonb_build_object(
      'total',count(*) filter(where relationship_type='fan'),
      'pending',count(*) filter(where relationship_type='fan' and status='pending' and expires_at>now()),
      'accepted',count(*) filter(where relationship_type='fan' and accepted_at is not null),
      'expired',count(*) filter(where relationship_type='fan' and status='pending' and expires_at<=now()),
      'cancelled',count(*) filter(where relationship_type='fan' and status='cancelled'),
      'revoked',count(*) filter(where relationship_type='fan' and status='revoked'),
      'removed',count(*) filter(where relationship_type='fan' and status='removed')
    ),
    'fanSignup',(select jsonb_build_object(
      'noAccount',count(*) filter(where signup_stage='noAccount'),
      'emailUnconfirmed',count(*) filter(where signup_stage='emailUnconfirmed'),
      'readyToAccept',count(*) filter(where signup_stage='readyToAccept'),
      'unavailable',count(*) filter(where signup_stage='unavailable')
    ) from pending),
    'fanNotifications',jsonb_build_object(
      'enabledAccounts',count(distinct auth_user_id) filter(where access_active and relationship_type='fan' and permissions->>'game_day'='true' and notifications_enabled),
      'registeredAccounts',count(distinct auth_user_id) filter(where access_active and relationship_type='fan' and permissions->>'game_day'='true' and notifications_enabled
        and exists(select 1 from public.fan_devices d where d.auth_user_id=connections.auth_user_id))
    ),
    'generatedAt',now()
  ) into result from connections;
  return result;
end; $$;
revoke all on function public.get_platform_fan_stats() from public,anon;
grant execute on function public.get_platform_fan_stats() to authenticated;
