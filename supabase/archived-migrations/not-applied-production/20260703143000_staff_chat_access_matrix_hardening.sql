create or replace function public.is_staff_chat_club_wide_staff(target_user_id uuid, target_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.id = target_user_id
      and u.club_id = target_club_id
      and u.role not in ('parent_portal', 'super_admin')
      and coalesce(u.role_rank, 0) >= 70
  );
$$;

create or replace function public.current_user_can_use_club_staff_chat(target_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and public.current_user_club_id() = target_club_id
    and public.current_user_role() not in ('parent_portal', 'super_admin')
    and public.current_user_role_rank() >= 70;
$$;

create or replace function public.staff_chat_user_can_access_team(
  target_user_id uuid,
  target_team_id uuid,
  target_club_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_team_id is not null
    and exists (
      select 1
      from public.teams t
      where t.id = target_team_id
        and t.club_id = target_club_id
    )
    and exists (
      select 1
      from public.users u
      join public.team_staff ts on ts.user_id = u.id
      where u.id = target_user_id
        and u.club_id = target_club_id
        and u.role not in ('parent_portal', 'super_admin')
        and coalesce(u.role_rank, 0) >= 20
        and ts.team_id = target_team_id
    );
$$;

create or replace function public.staff_chat_user_can_join_conversation(
  target_conversation_id uuid,
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_chat_conversations scc
    where scc.id = target_conversation_id
      and public.is_staff_chat_staff(target_user_id, scc.club_id)
      and (
        (scc.type = 'club_staff' and public.is_staff_chat_club_wide_staff(target_user_id, scc.club_id))
        or (scc.type = 'team_staff' and public.staff_chat_user_can_access_team(target_user_id, scc.team_id, scc.club_id))
        or scc.type in ('group', 'direct')
      )
  );
$$;

create or replace function public.is_staff_chat_member(
  target_conversation_id uuid,
  target_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_chat_members scm
    where scm.conversation_id = target_conversation_id
      and scm.user_id = target_user_id
      and scm.archived_at is null
      and public.staff_chat_user_can_join_conversation(target_conversation_id, target_user_id)
  );
$$;

create or replace function public.can_read_staff_chat_conversation(target_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff_chat_conversations scc
    join public.staff_chat_members scm on scm.conversation_id = scc.id
      and scm.club_id = scc.club_id
      and scm.user_id = auth.uid()
    where scc.id = target_conversation_id
      and scc.club_id = public.current_user_club_id()
      and scm.archived_at is null
      and public.current_user_can_use_staff_chat(scc.club_id)
      and public.staff_chat_user_can_join_conversation(scc.id, auth.uid())
      and (
        scc.type <> 'direct'
        or (
          select count(distinct direct_members.user_id)
          from public.staff_chat_members direct_members
          where direct_members.conversation_id = scc.id
            and direct_members.club_id = scc.club_id
            and direct_members.archived_at is null
        ) = 2
      )
  );
$$;

create or replace function public.create_staff_chat_conversation(
  conversation_type text,
  title_value text default '',
  team_id_value uuid default null,
  member_ids uuid[] default '{}'::uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_club_id uuid := public.current_user_club_id();
  normalized_type text := btrim(coalesce(conversation_type, ''));
  normalized_title text := btrim(coalesce(title_value, ''));
  final_member_ids uuid[] := '{}'::uuid[];
  invalid_member_count integer := 0;
  new_conversation_id uuid;
  direct_key_value text;
begin
  if not public.current_user_can_use_staff_chat(current_club_id) then
    raise exception 'Staff Chat is only available to authorised staff.';
  end if;

  if normalized_type not in ('club_staff', 'team_staff', 'group', 'direct') then
    raise exception 'Unsupported Staff Chat conversation type.';
  end if;

  if normalized_type = 'club_staff' and not public.current_user_can_use_club_staff_chat(current_club_id) then
    raise exception 'Club Staff Chat is only available to club-wide staff.';
  end if;

  if normalized_type = 'team_staff' then
    if team_id_value is null then
      raise exception 'Choose a team for Team Staff Chat.';
    end if;

    if not public.staff_chat_user_can_access_team(auth.uid(), team_id_value, current_club_id) then
      raise exception 'This account cannot create Staff Chat for that team.';
    end if;

    select coalesce(array_agg(u.id order by u.name nulls last, u.email), '{}'::uuid[])
    into final_member_ids
    from public.users u
    where public.is_staff_chat_staff(u.id, current_club_id)
      and public.staff_chat_user_can_access_team(u.id, team_id_value, current_club_id);
  elsif normalized_type = 'club_staff' then
    select coalesce(array_agg(u.id order by u.name nulls last, u.email), '{}'::uuid[])
    into final_member_ids
    from public.users u
    where public.is_staff_chat_club_wide_staff(u.id, current_club_id);
  else
    select coalesce(array_agg(distinct selected_member_id), '{}'::uuid[])
    into final_member_ids
    from unnest(coalesce(member_ids, '{}'::uuid[]) || auth.uid()) as selected_members(selected_member_id);
  end if;

  if array_length(final_member_ids, 1) is null or array_length(final_member_ids, 1) = 0 then
    raise exception 'No authorised staff members were found for this Staff Chat.';
  end if;

  select count(*)
  into invalid_member_count
  from unnest(final_member_ids) as selected_members(member_id)
  where not public.is_staff_chat_staff(member_id, current_club_id)
    or (
      normalized_type = 'club_staff'
      and not public.is_staff_chat_club_wide_staff(member_id, current_club_id)
    )
    or (
      normalized_type = 'team_staff'
      and not public.staff_chat_user_can_access_team(member_id, team_id_value, current_club_id)
    );

  if invalid_member_count > 0 then
    raise exception 'Staff Chat members must be authorised staff in the permitted chat scope.';
  end if;

  if normalized_type = 'direct' and array_length(final_member_ids, 1) <> 2 then
    raise exception 'Direct Messages must include exactly two authorised staff members.';
  end if;

  if normalized_type = 'group' and array_length(final_member_ids, 1) < 2 then
    raise exception 'Group Chat needs at least two authorised staff members.';
  end if;

  if normalized_type = 'direct' then
    select string_agg(member_id::text, ':' order by member_id::text)
    into direct_key_value
    from unnest(final_member_ids) as selected_members(member_id);

    select scc.id
    into new_conversation_id
    from public.staff_chat_conversations scc
    where scc.club_id = current_club_id
      and scc.type = 'direct'
      and scc.direct_key = direct_key_value
      and exists (
        select 1
        from public.staff_chat_members scm
        where scm.conversation_id = scc.id
          and scm.user_id = auth.uid()
      )
    limit 1;

    if new_conversation_id is not null then
      update public.staff_chat_members
      set archived_at = null
      where staff_chat_members.conversation_id = new_conversation_id
        and user_id = auth.uid();

      return new_conversation_id;
    end if;
  end if;

  if normalized_type = 'team_staff' and normalized_title = '' then
    select t.name || ' Staff'
    into normalized_title
    from public.teams t
    where t.id = team_id_value
      and t.club_id = current_club_id;
  end if;

  insert into public.staff_chat_conversations (
    club_id,
    team_id,
    type,
    title,
    direct_key,
    created_by,
    created_by_name,
    created_by_email
  )
  select
    current_club_id,
    case when normalized_type = 'team_staff' then team_id_value else null end,
    normalized_type,
    case
      when normalized_type = 'club_staff' then coalesce(nullif(normalized_title, ''), 'Club Staff')
      when normalized_type = 'direct' then ''
      when normalized_type = 'group' then coalesce(nullif(normalized_title, ''), 'Staff group')
      else coalesce(nullif(normalized_title, ''), 'Team Staff')
    end,
    direct_key_value,
    auth.uid(),
    coalesce(nullif(u.name, ''), u.email, ''),
    coalesce(u.email, '')
  from public.users u
  where u.id = auth.uid()
  returning id into new_conversation_id;

  insert into public.staff_chat_members (
    conversation_id,
    club_id,
    user_id,
    added_by,
    last_read_at
  )
  select
    new_conversation_id,
    current_club_id,
    member_id,
    auth.uid(),
    case when member_id = auth.uid() then timezone('utc', now()) else null end
  from unnest(final_member_ids) as selected_members(member_id)
  on conflict (conversation_id, user_id) do nothing;

  return new_conversation_id;
end;
$$;

drop policy if exists staff_chat_conversations_select_member on public.staff_chat_conversations;
create policy staff_chat_conversations_select_member
on public.staff_chat_conversations
for select
to authenticated
using (
  public.can_read_staff_chat_conversation(id)
);

drop policy if exists staff_chat_conversations_insert_staff on public.staff_chat_conversations;
create policy staff_chat_conversations_insert_staff
on public.staff_chat_conversations
for insert
to authenticated
with check (
  public.current_user_can_use_staff_chat(club_id)
  and created_by = auth.uid()
  and (
    (
      type = 'club_staff'
      and team_id is null
      and public.current_user_can_use_club_staff_chat(club_id)
    )
    or (
      type = 'team_staff'
      and team_id is not null
      and public.staff_chat_user_can_access_team(auth.uid(), team_id, club_id)
    )
    or (
      type in ('group', 'direct')
      and team_id is null
    )
  )
);

drop policy if exists staff_chat_conversations_update_member on public.staff_chat_conversations;
create policy staff_chat_conversations_update_member
on public.staff_chat_conversations
for update
to authenticated
using (
  public.can_read_staff_chat_conversation(id)
)
with check (
  public.current_user_can_use_staff_chat(club_id)
  and (
    (
      type = 'club_staff'
      and team_id is null
      and public.current_user_can_use_club_staff_chat(club_id)
    )
    or (
      type = 'team_staff'
      and team_id is not null
      and public.staff_chat_user_can_access_team(auth.uid(), team_id, club_id)
    )
    or (
      type in ('group', 'direct')
      and team_id is null
    )
  )
);

drop policy if exists staff_chat_members_select_member on public.staff_chat_members;
create policy staff_chat_members_select_member
on public.staff_chat_members
for select
to authenticated
using (
  public.can_read_staff_chat_conversation(conversation_id)
);

drop policy if exists staff_chat_members_insert_creator on public.staff_chat_members;
create policy staff_chat_members_insert_creator
on public.staff_chat_members
for insert
to authenticated
with check (
  added_by = auth.uid()
  and public.current_user_can_use_staff_chat(club_id)
  and public.staff_chat_user_can_join_conversation(conversation_id, user_id)
  and exists (
    select 1
    from public.staff_chat_conversations scc
    where scc.id = staff_chat_members.conversation_id
      and scc.club_id = staff_chat_members.club_id
      and (
        scc.created_by = auth.uid()
        or public.can_read_staff_chat_conversation(scc.id)
      )
      and (
        (
          scc.type = 'club_staff'
          and public.current_user_can_use_club_staff_chat(scc.club_id)
        )
        or (
          scc.type = 'team_staff'
          and public.staff_chat_user_can_access_team(auth.uid(), scc.team_id, scc.club_id)
        )
        or scc.type in ('group', 'direct')
      )
  )
);

drop policy if exists staff_chat_members_update_self on public.staff_chat_members;
create policy staff_chat_members_update_self
on public.staff_chat_members
for update
to authenticated
using (
  user_id = auth.uid()
  and public.can_read_staff_chat_conversation(conversation_id)
)
with check (
  user_id = auth.uid()
  and public.can_read_staff_chat_conversation(conversation_id)
);

drop policy if exists staff_chat_messages_select_member on public.staff_chat_messages;
create policy staff_chat_messages_select_member
on public.staff_chat_messages
for select
to authenticated
using (
  public.can_read_staff_chat_conversation(conversation_id)
);

drop policy if exists staff_chat_messages_insert_member on public.staff_chat_messages;
create policy staff_chat_messages_insert_member
on public.staff_chat_messages
for insert
to authenticated
with check (
  sender_id = auth.uid()
  and public.current_user_can_use_staff_chat(club_id)
  and public.can_read_staff_chat_conversation(conversation_id)
  and deleted_at is null
  and deleted_by is null
);

drop policy if exists staff_chat_messages_update_sender_or_oversight on public.staff_chat_messages;
create policy staff_chat_messages_update_sender_or_oversight
on public.staff_chat_messages
for update
to authenticated
using (
  public.can_read_staff_chat_conversation(conversation_id)
  and (
    sender_id = auth.uid()
    or public.current_user_role_rank() >= 50
  )
)
with check (
  public.can_read_staff_chat_conversation(conversation_id)
  and club_id = public.current_user_club_id()
);

revoke all on function public.is_staff_chat_club_wide_staff(uuid, uuid) from public;
revoke all on function public.current_user_can_use_club_staff_chat(uuid) from public;
revoke all on function public.staff_chat_user_can_join_conversation(uuid, uuid) from public;
revoke all on function public.is_staff_chat_staff(uuid, uuid) from public;
revoke all on function public.current_user_can_use_staff_chat(uuid) from public;
revoke all on function public.staff_chat_user_can_access_team(uuid, uuid, uuid) from public;
revoke all on function public.is_staff_chat_member(uuid, uuid) from public;
revoke all on function public.can_read_staff_chat_conversation(uuid) from public;
revoke all on function public.create_staff_chat_conversation(text, text, uuid, uuid[]) from public;

revoke execute on function public.is_staff_chat_club_wide_staff(uuid, uuid) from anon;
revoke execute on function public.current_user_can_use_club_staff_chat(uuid) from anon;
revoke execute on function public.staff_chat_user_can_join_conversation(uuid, uuid) from anon;
revoke execute on function public.is_staff_chat_staff(uuid, uuid) from anon;
revoke execute on function public.current_user_can_use_staff_chat(uuid) from anon;
revoke execute on function public.staff_chat_user_can_access_team(uuid, uuid, uuid) from anon;
revoke execute on function public.is_staff_chat_member(uuid, uuid) from anon;
revoke execute on function public.can_read_staff_chat_conversation(uuid) from anon;
revoke execute on function public.create_staff_chat_conversation(text, text, uuid, uuid[]) from anon;

grant execute on function public.is_staff_chat_club_wide_staff(uuid, uuid) to authenticated, service_role;
grant execute on function public.current_user_can_use_club_staff_chat(uuid) to authenticated, service_role;
grant execute on function public.staff_chat_user_can_join_conversation(uuid, uuid) to authenticated, service_role;
grant execute on function public.is_staff_chat_staff(uuid, uuid) to authenticated, service_role;
grant execute on function public.current_user_can_use_staff_chat(uuid) to authenticated, service_role;
grant execute on function public.staff_chat_user_can_access_team(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.is_staff_chat_member(uuid, uuid) to authenticated, service_role;
grant execute on function public.can_read_staff_chat_conversation(uuid) to authenticated, service_role;
grant execute on function public.create_staff_chat_conversation(text, text, uuid, uuid[]) to authenticated, service_role;
