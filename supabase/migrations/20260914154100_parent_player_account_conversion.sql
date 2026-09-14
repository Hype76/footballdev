create or replace function public.set_fan_player_account(connection_id_value uuid, player_account_value boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare connection public.fan_connections%rowtype;
begin
  select * into connection from public.fan_connections where id = connection_id_value for update;
  if auth.uid() is null or connection.id is null or connection.invited_by <> auth.uid()
    or connection.status <> 'active' or player_account_value is null
    or not app_private.fan_scope_active(connection.parent_link_id, connection.player_id, connection.club_id, connection.invited_by)
    or not app_private.fan_account_active(connection.auth_user_id, connection.club_id) then
    raise exception using errcode = '42501', message = 'Only the active inviting Parent can change this accepted account.';
  end if;
  update public.fan_connections
  set relationship_type = case when player_account_value then 'player' else 'fan' end,
    permissions = case when player_account_value then permissions || '{"schedule":true}'::jsonb else permissions end,
    updated_at = now()
  where id = connection_id_value;
end;
$$;
revoke all on function public.set_fan_player_account(uuid,boolean) from public, anon;
grant execute on function public.set_fan_player_account(uuid,boolean) to authenticated;
