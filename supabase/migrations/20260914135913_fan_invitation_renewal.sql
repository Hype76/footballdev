alter table public.fan_connections
  add column if not exists renewal_request_id uuid,
  add column if not exists renewed_at timestamptz;

create or replace function public.renew_fan_invitation(connection_id_value uuid, request_id_value uuid)
returns public.fan_connections
language plpgsql security definer set search_path = ''
as $$
declare invitation public.fan_connections%rowtype;
begin
  if auth.uid() is null or request_id_value is null then
    raise exception using errcode='42501', message='Sign in before renewing an invitation.';
  end if;
  select * into invitation from public.fan_connections
    where id=connection_id_value and invited_by=auth.uid() for update;
  if invitation.id is null or invitation.relationship_type <> 'fan'
    or invitation.status <> 'pending'
    or not app_private.fan_scope_active(invitation.parent_link_id,invitation.player_id,invitation.club_id,invitation.invited_by) then
    raise exception using errcode='42501', message='This Fan invitation cannot be renewed.';
  end if;
  if invitation.renewal_request_id = request_id_value then return invitation; end if;
  if invitation.renewed_at > now()-interval '1 minute' then
    raise exception 'Please wait one minute before renewing this invitation again.';
  end if;
  update public.fan_connections
    set invite_token=gen_random_uuid(), expires_at=now()+interval '24 hours',
        email_sent_at=null, renewal_request_id=request_id_value, renewed_at=now(), updated_at=now()
    where id=invitation.id returning * into invitation;
  return invitation;
end;
$$;
revoke all on function public.renew_fan_invitation(uuid,uuid) from public,anon;
grant execute on function public.renew_fan_invitation(uuid,uuid) to authenticated;
