-- Keep the existing RPC compatible with installed apps. Expired invitations are
-- cancelled and hidden atomically, retaining history and preventing renewal.
create or replace function public.delete_cancelled_fan_invitation(connection_id_value uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.fan_connections%rowtype;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='Sign in to delete an invitation.';
  end if;
  select * into target from public.fan_connections where id=connection_id_value for update;
  if target.id is null or target.invited_by<>auth.uid()
    or not app_private.fan_scope_active(target.parent_link_id,target.player_id,target.club_id,target.invited_by) then
    raise exception using errcode='42501',message='Only the inviting Parent can delete this invitation.';
  end if;
  if target.relationship_type<>'fan' or not (
    target.status='cancelled' or (target.status='pending' and target.expires_at<=now())
  ) then
    raise exception using errcode='42501',message='Only cancelled or expired Fan invitations can be deleted.';
  end if;
  if target.owner_deleted_at is null then
    update public.fan_connections set status='cancelled',
      ended_at=coalesce(ended_at,now()),notifications_enabled=false,
      owner_deleted_at=now(),updated_at=now() where id=target.id;
  end if;
end;
$$;
revoke all on function public.delete_cancelled_fan_invitation(uuid) from public, anon;
grant execute on function public.delete_cancelled_fan_invitation(uuid) to authenticated;
