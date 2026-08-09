-- FP-MOBILE-LIVE-QA-CROSSPRODUCT-CORRECTIVE-MASTER-34 Phase 34A.
-- Parent Chat operational authority is Team-assignment scoped. Club-wide
-- account authority must not enumerate child, Team, or Match chat rooms.

create or replace function public.parent_chat_staff_can_access_team(
  target_user_id uuid,
  target_club_id uuid,
  target_team_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user_id is not null
    and target_club_id is not null
    and target_team_id is not null
    and exists (
      select 1
      from public.users staff
      join public.user_club_memberships membership
        on membership.auth_user_id = staff.id
       and membership.club_id = staff.club_id
       and membership.role = staff.role
       and membership.role_rank = staff.role_rank
      join public.team_staff assignment
        on assignment.user_id = staff.id
       and assignment.team_id = target_team_id
      join public.teams team
        on team.id = assignment.team_id
       and team.club_id = target_club_id
       and team.archived_at is null
       and coalesce(team.status, 'active') = 'active'
      join public.clubs club
        on club.id = team.club_id
       and club.archived_at is null
       and coalesce(club.status, 'active') = 'active'
      where staff.id = target_user_id
        and staff.club_id = target_club_id
        and coalesce(staff.status, 'active') = 'active'
        and staff.role not in ('parent_portal', 'super_admin')
        and coalesce(staff.role_rank, 0) >= 20
    );
$$;

revoke all on function public.parent_chat_staff_can_access_team(uuid, uuid, uuid)
from public, anon;
grant execute on function public.parent_chat_staff_can_access_team(uuid, uuid, uuid)
to authenticated, service_role;

comment on function public.parent_chat_staff_can_access_team(uuid, uuid, uuid) is
  'Allows Parent Chat operational access only for an active staff profile, matching active Club membership, explicit Team assignment, and active non-archived Club and Team. Club-wide and Platform Admin roles do not bypass Team assignment.';

-- Stored membership rows are audit and unread-state metadata, never authority.
-- Reconcile them immediately so the visible membership state matches the new
-- server-authoritative rule without reading or changing any Chat message body.
do $$
declare
  room_record record;
begin
  for room_record in
    select room.id
    from public.parent_chat_rooms room
    order by room.id
  loop
    perform public.parent_chat_reconcile_room(room_record.id);
  end loop;
end;
$$;
