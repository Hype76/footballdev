create table if not exists public.staff_chat_conversations (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  type text not null,
  title text not null default '',
  direct_key text,
  created_by uuid not null references public.users (id),
  created_by_name text not null default '',
  created_by_email text not null default '',
  last_message_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint staff_chat_conversations_type_check check (type in ('club_staff', 'team_staff', 'group', 'direct')),
  constraint staff_chat_conversations_team_scope_check check (
    (type = 'team_staff' and team_id is not null)
    or (type <> 'team_staff' and team_id is null)
  )
);

create unique index if not exists staff_chat_conversations_id_club_id_key
on public.staff_chat_conversations (id, club_id);

create unique index if not exists staff_chat_direct_unique_key
on public.staff_chat_conversations (club_id, direct_key)
where type = 'direct' and direct_key is not null;

create index if not exists staff_chat_conversations_club_updated_idx
on public.staff_chat_conversations (club_id, updated_at desc);

create index if not exists staff_chat_conversations_team_idx
on public.staff_chat_conversations (team_id);

create table if not exists public.staff_chat_members (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  club_id uuid not null,
  user_id uuid not null references public.users (id) on delete cascade,
  added_by uuid not null references public.users (id),
  last_read_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  constraint staff_chat_members_conversation_fkey
    foreign key (conversation_id, club_id)
    references public.staff_chat_conversations (id, club_id)
    on delete cascade
);

create unique index if not exists staff_chat_members_conversation_user_key
on public.staff_chat_members (conversation_id, user_id);

create index if not exists staff_chat_members_user_idx
on public.staff_chat_members (user_id, archived_at);

create table if not exists public.staff_chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  club_id uuid not null,
  sender_id uuid not null references public.users (id),
  body text not null,
  deleted_at timestamptz,
  deleted_by uuid references public.users (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint staff_chat_messages_conversation_fkey
    foreign key (conversation_id, club_id)
    references public.staff_chat_conversations (id, club_id)
    on delete cascade,
  constraint staff_chat_messages_body_check check (
    char_length(btrim(body)) > 0 and char_length(body) <= 5000
  )
);

create index if not exists staff_chat_messages_conversation_created_idx
on public.staff_chat_messages (conversation_id, created_at);

revoke all on public.staff_chat_conversations from public;
revoke all on public.staff_chat_members from public;
revoke all on public.staff_chat_messages from public;
revoke all on public.staff_chat_conversations from anon;
revoke all on public.staff_chat_members from anon;
revoke all on public.staff_chat_messages from anon;
revoke all on public.staff_chat_conversations from authenticated;
revoke all on public.staff_chat_members from authenticated;
revoke all on public.staff_chat_messages from authenticated;

grant select, insert, update on public.staff_chat_conversations to authenticated;
grant select, insert, update on public.staff_chat_members to authenticated;
grant select, insert, update on public.staff_chat_messages to authenticated;

alter table public.staff_chat_conversations enable row level security;
alter table public.staff_chat_members enable row level security;
alter table public.staff_chat_messages enable row level security;

create or replace function public.is_staff_chat_staff(target_user_id uuid, target_club_id uuid)
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
      and coalesce(u.role_rank, 0) >= 20
  );
$$;

create or replace function public.current_user_can_use_staff_chat(target_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and public.current_user_club_id() = target_club_id
    and public.current_user_role() not in ('parent_portal', 'super_admin')
    and public.current_user_role_rank() >= 20;
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
      where u.id = target_user_id
        and u.club_id = target_club_id
        and u.role not in ('parent_portal', 'super_admin')
        and coalesce(u.role_rank, 0) >= 20
        and (
          coalesce(u.role_rank, 0) >= 50
          or exists (
            select 1
            from public.team_staff ts
            where ts.team_id = target_team_id
              and ts.user_id = target_user_id
          )
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
    join public.staff_chat_conversations scc on scc.id = scm.conversation_id
    where scm.conversation_id = target_conversation_id
      and scm.user_id = target_user_id
      and public.current_user_can_use_staff_chat(scc.club_id)
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
    from public.staff_chat_members scm
    join public.staff_chat_conversations scc on scc.id = scm.conversation_id
    where scm.conversation_id = target_conversation_id
      and scm.user_id = auth.uid()
      and scc.club_id = public.current_user_club_id()
      and public.current_user_can_use_staff_chat(scc.club_id)
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
    where public.is_staff_chat_staff(u.id, current_club_id);
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
      normalized_type = 'team_staff'
      and not public.staff_chat_user_can_access_team(member_id, team_id_value, current_club_id)
    );

  if invalid_member_count > 0 then
    raise exception 'Staff Chat members must be authorised staff in the permitted club scope.';
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

create or replace function public.mark_staff_chat_conversation_read(conversation_id_value uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_read_staff_chat_conversation(conversation_id_value) then
    raise exception 'Staff Chat conversation is not available.';
  end if;

  update public.staff_chat_members
  set last_read_at = timezone('utc', now())
  where conversation_id = conversation_id_value
    and user_id = auth.uid();
end;
$$;

create or replace function public.archive_staff_chat_conversation(conversation_id_value uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_read_staff_chat_conversation(conversation_id_value) then
    raise exception 'Staff Chat conversation is not available.';
  end if;

  update public.staff_chat_members
  set archived_at = timezone('utc', now())
  where conversation_id = conversation_id_value
    and user_id = auth.uid();
end;
$$;

create or replace function public.delete_staff_chat_message(message_id_value uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_conversation_id uuid;
  target_sender_id uuid;
begin
  select conversation_id, sender_id
  into target_conversation_id, target_sender_id
  from public.staff_chat_messages
  where id = message_id_value
    and club_id = public.current_user_club_id()
    and deleted_at is null;

  if target_conversation_id is null then
    raise exception 'Staff Chat message is not available.';
  end if;

  if not public.can_read_staff_chat_conversation(target_conversation_id) then
    raise exception 'Staff Chat message is not available.';
  end if;

  if target_sender_id <> auth.uid() and public.current_user_role_rank() < 50 then
    raise exception 'Only the sender or a club oversight role can delete this Staff Chat message.';
  end if;

  update public.staff_chat_messages
  set body = 'Message deleted',
      deleted_at = timezone('utc', now()),
      deleted_by = auth.uid(),
      updated_at = timezone('utc', now())
  where id = message_id_value;
end;
$$;

create or replace function public.touch_staff_chat_conversation_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.staff_chat_conversations
  set last_message_at = new.created_at,
      updated_at = timezone('utc', now())
  where id = new.conversation_id
    and club_id = new.club_id;

  update public.staff_chat_members
  set last_read_at = new.created_at
  where conversation_id = new.conversation_id
    and user_id = new.sender_id;

  return new;
end;
$$;

drop trigger if exists staff_chat_messages_touch_conversation on public.staff_chat_messages;
create trigger staff_chat_messages_touch_conversation
after insert on public.staff_chat_messages
for each row execute function public.touch_staff_chat_conversation_on_message();

drop policy if exists staff_chat_conversations_select_member on public.staff_chat_conversations;
create policy staff_chat_conversations_select_member
on public.staff_chat_conversations
for select
to authenticated
using (
  public.current_user_can_use_staff_chat(club_id)
  and exists (
    select 1
    from public.staff_chat_members scm
    where scm.conversation_id = staff_chat_conversations.id
      and scm.user_id = auth.uid()
  )
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
    (type = 'team_staff' and team_id is not null and public.staff_chat_user_can_access_team(auth.uid(), team_id, club_id))
    or (type <> 'team_staff' and team_id is null)
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
    (type = 'team_staff' and team_id is not null and public.staff_chat_user_can_access_team(auth.uid(), team_id, club_id))
    or (type <> 'team_staff' and team_id is null)
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
  and public.is_staff_chat_staff(user_id, club_id)
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
        scc.type <> 'team_staff'
        or public.staff_chat_user_can_access_team(staff_chat_members.user_id, scc.team_id, scc.club_id)
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

revoke all on function public.is_staff_chat_staff(uuid, uuid) from public;
revoke all on function public.current_user_can_use_staff_chat(uuid) from public;
revoke all on function public.staff_chat_user_can_access_team(uuid, uuid, uuid) from public;
revoke all on function public.is_staff_chat_member(uuid, uuid) from public;
revoke all on function public.can_read_staff_chat_conversation(uuid) from public;
revoke all on function public.create_staff_chat_conversation(text, text, uuid, uuid[]) from public;
revoke all on function public.mark_staff_chat_conversation_read(uuid) from public;
revoke all on function public.archive_staff_chat_conversation(uuid) from public;
revoke all on function public.delete_staff_chat_message(uuid) from public;
revoke all on function public.touch_staff_chat_conversation_on_message() from public;

revoke execute on function public.is_staff_chat_staff(uuid, uuid) from anon;
revoke execute on function public.current_user_can_use_staff_chat(uuid) from anon;
revoke execute on function public.staff_chat_user_can_access_team(uuid, uuid, uuid) from anon;
revoke execute on function public.is_staff_chat_member(uuid, uuid) from anon;
revoke execute on function public.can_read_staff_chat_conversation(uuid) from anon;
revoke execute on function public.create_staff_chat_conversation(text, text, uuid, uuid[]) from anon;
revoke execute on function public.mark_staff_chat_conversation_read(uuid) from anon;
revoke execute on function public.archive_staff_chat_conversation(uuid) from anon;
revoke execute on function public.delete_staff_chat_message(uuid) from anon;
revoke execute on function public.touch_staff_chat_conversation_on_message() from anon;

grant execute on function public.is_staff_chat_staff(uuid, uuid) to authenticated, service_role;
grant execute on function public.current_user_can_use_staff_chat(uuid) to authenticated, service_role;
grant execute on function public.staff_chat_user_can_access_team(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.is_staff_chat_member(uuid, uuid) to authenticated, service_role;
grant execute on function public.can_read_staff_chat_conversation(uuid) to authenticated, service_role;
grant execute on function public.create_staff_chat_conversation(text, text, uuid, uuid[]) to authenticated, service_role;
grant execute on function public.mark_staff_chat_conversation_read(uuid) to authenticated, service_role;
grant execute on function public.archive_staff_chat_conversation(uuid) to authenticated, service_role;
grant execute on function public.delete_staff_chat_message(uuid) to authenticated, service_role;
grant execute on function public.touch_staff_chat_conversation_on_message() to authenticated, service_role;
