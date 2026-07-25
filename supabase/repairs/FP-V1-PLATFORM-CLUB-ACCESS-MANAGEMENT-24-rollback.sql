-- Prepared repair procedure only.
-- Do not run during the forward release.
-- Use only if the application is rolled back to a commit that still requires
-- the legacy club_user_invites (club_id, email) conflict target.

begin;

do $$
begin
  if exists (
    select 1
    from public.club_user_invite_teams grouped
    group by grouped.invite_id
    having count(*) > 1
  ) then
    raise exception using
      errcode = '55000',
      message = 'rollback_repair_blocked_by_multi_team_invitation';
  end if;

  if exists (
    select 1
    from public.platform_access_assignment_history
    where state = 'removed'
  ) then
    raise exception using
      errcode = '55000',
      message = 'rollback_repair_blocked_by_removed_access_state';
  end if;
end;
$$;

create table if not exists public.club_user_invites_rollback_archive
as select * from public.club_user_invites with no data;

alter table public.club_user_invites_rollback_archive
  add column if not exists archived_at timestamptz not null default timezone('utc', now());

with ranked as (
  select
    invite.id,
    row_number() over (
      partition by invite.club_id, lower(invite.email)
      order by
        case when invite.status = 'pending' then 0 else 1 end,
        invite.created_at desc,
        invite.id desc
    ) as position
  from public.club_user_invites invite
),
archive_candidates as (
  select invite.*
  from public.club_user_invites invite
  join ranked on ranked.id = invite.id
  where ranked.position > 1
)
insert into public.club_user_invites_rollback_archive
select archive_candidates.*, timezone('utc', now())
from archive_candidates
where not exists (
  select 1
  from public.club_user_invites_rollback_archive archived
  where archived.id = archive_candidates.id
);

delete from public.club_user_invites invite
using (
  select
    ranked.id
  from (
    select
      candidate.id,
      row_number() over (
        partition by candidate.club_id, lower(candidate.email)
        order by
          case when candidate.status = 'pending' then 0 else 1 end,
          candidate.created_at desc,
          candidate.id desc
      ) as position
    from public.club_user_invites candidate
  ) ranked
  where ranked.position > 1
) archive_candidates
where invite.id = archive_candidates.id;

drop index if exists public.club_user_invites_one_active_identity_key;

create unique index if not exists club_user_invites_club_id_email_key
on public.club_user_invites (club_id, email);

do $$
begin
  if exists (
    select 1
    from public.club_user_invites
    group by club_id, lower(email)
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'rollback_repair_uniqueness_verification_failed';
  end if;
end;
$$;

commit;
