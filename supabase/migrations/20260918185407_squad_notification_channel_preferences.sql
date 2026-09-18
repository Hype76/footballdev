-- Honour each linked Parent account's selected communication channels.
-- `both` creates independent app and email receipts. Every active linked account
-- has an app inbox route, even when no phone or browser push device is active.
alter table public.match_day_squad_notifications
  drop constraint if exists match_day_squad_notifications_decision_id_decision_revision_key;

create or replace function private.squad_notification_recipients(club_id_value uuid,team_id_value uuid,player_id_value uuid)
returns table(recipient_key text,parent_link_id uuid,auth_user_id uuid,recipient_email text,delivery_channel text,has_contact boolean)
language sql stable security definer set search_path = '' as $$
  with current_player as (
    select p.id from public.players p where p.id=player_id_value and p.club_id=club_id_value
      and p.team_id=team_id_value and coalesce(p.status,'active')<>'archived' and p.archived_at is null
      and exists(select 1 from public.player_team_memberships m where m.player_id=p.id and m.club_id=club_id_value
        and m.team_id=team_id_value and m.status='active' and m.ended_at is null)
  ), linked as (
    select l.id as parent_link_id,l.auth_user_id,
      lower(btrim(case when l.auth_user_id is not null then coalesce(a.email,'') else coalesce(l.email,'') end)) as email,
      (l.guardian_id is null or coalesce(l.receives_communications,true)) as communication_allowed,
      (l.auth_user_id is null or (a.id is not null and a.deleted_at is null
        and (a.banned_until is null or a.banned_until<=now())
        and not exists(select 1 from public.users u where u.id=l.auth_user_id and coalesce(u.status,'active')<>'active'))) as account_allowed,
      (l.auth_user_id is not null) as installed,
      coalesce(p.communication_channel,'both') as preference
    from current_player cp join public.parent_player_links l on l.player_id=cp.id
      and l.club_id=club_id_value and l.team_id=team_id_value and l.link_type='parent' and l.status='active'
    left join auth.users a on a.id=l.auth_user_id
    left join public.parent_communication_preferences p on p.auth_user_id=l.auth_user_id
  ), configured as (
    select null::uuid as parent_link_id,a.id as auth_user_id,r.recipient_email as email,
      true as communication_allowed,
      (a.id is null or (a.deleted_at is null and (a.banned_until is null or a.banned_until<=now())
        and not exists(select 1 from public.users u where u.id=a.id and coalesce(u.status,'active')<>'active'))) as account_allowed,
      false as installed,coalesce(p.communication_channel,'both') as preference
    from current_player cp
    cross join lateral public.event_player_eligible_recipients(club_id_value,team_id_value,array[cp.id]) r
    left join lateral (select u.id,u.deleted_at,u.banned_until from auth.users u
      where lower(btrim(u.email))=r.recipient_email order by u.id limit 1) a on true
    left join public.parent_communication_preferences p on p.auth_user_id=a.id
    where r.recipient_type=public.canonical_calendar_invite_recipient_type('parent')
      and not exists(select 1 from public.parent_player_links l where l.player_id=cp.id
        and l.club_id=club_id_value and l.team_id=team_id_value and l.link_type='parent'
        and l.status in ('active','revoked') and (lower(btrim(coalesce(l.email,'')))=r.recipient_email
          or (a.id is not null and l.auth_user_id=a.id)))
  ), contacts as (
    select * from linked union all select * from configured
  ), channels as (
    select c.*,
      (c.email ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$' or (c.parent_link_id is not null and c.auth_user_id is not null)) as has_contact,
      case when not c.communication_allowed or not c.account_allowed then null
        when c.parent_link_id is not null and c.auth_user_id is not null and c.preference in ('app','both') then 'app'
        when c.email ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$' and c.preference in ('email','both') then 'email'
        else null end as channel
    from contacts c
  ), recipients as (
    select distinct on (coalesce(c.auth_user_id::text,nullif(c.email,''),c.parent_link_id::text)) c.*
    from channels c
    order by coalesce(c.auth_user_id::text,nullif(c.email,''),c.parent_link_id::text),
      (c.channel is not null) desc,c.parent_link_id nulls last,c.email
  ), deliveries as (
    select case when r.channel='app' then 'link:' || r.parent_link_id::text else 'email:' || r.email end as recipient_key,
      r.parent_link_id,r.auth_user_id,r.email,r.channel,r.has_contact
    from recipients r
    union all
    select 'email:' || r.email,r.parent_link_id,r.auth_user_id,r.email,'email',r.has_contact
    from recipients r
    where r.channel='app' and r.preference='both'
      and r.email ~* '^[^[:space:]@<>]+@[^[:space:]@<>]+[.][^[:space:]@<>]+$'
  )
  select d.recipient_key,d.parent_link_id,d.auth_user_id,d.email,d.channel,d.has_contact
  from deliveries d;
$$;
revoke all on function private.squad_notification_recipients(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.squad_notification_recipients(uuid,uuid,uuid) to service_role;
