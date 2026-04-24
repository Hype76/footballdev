create table if not exists public.platform_feedback (
  id uuid primary key default gen_random_uuid(),
  club_id uuid references public.clubs (id) on delete set null,
  created_by uuid references public.users (id) on delete set null,
  message text not null,
  status text not null default 'open',
  admin_note text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.platform_feedback_votes (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.platform_feedback (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  unique (feedback_id, user_id)
);

create index if not exists platform_feedback_status_created_idx
on public.platform_feedback (status, created_at desc);

create index if not exists platform_feedback_club_id_idx
on public.platform_feedback (club_id);

grant select, insert, update, delete on public.platform_feedback to authenticated;
grant select, insert, delete on public.platform_feedback_votes to authenticated;

alter table public.platform_feedback enable row level security;
alter table public.platform_feedback_votes enable row level security;

drop policy if exists platform_feedback_select_authenticated on public.platform_feedback;
create policy platform_feedback_select_authenticated
on public.platform_feedback
for select
to authenticated
using (true);

drop policy if exists platform_feedback_insert_authenticated on public.platform_feedback;
create policy platform_feedback_insert_authenticated
on public.platform_feedback
for insert
to authenticated
with check (
  public.current_user_role() = 'super_admin'
  or (
    created_by = auth.uid()
    and club_id = public.current_user_club_id()
  )
);

drop policy if exists platform_feedback_update_owner_or_admin on public.platform_feedback;
drop policy if exists platform_feedback_update_admin on public.platform_feedback;
create policy platform_feedback_update_admin
on public.platform_feedback
for update
to authenticated
using (
  public.current_user_role() = 'super_admin'
)
with check (
  public.current_user_role() = 'super_admin'
);

drop policy if exists platform_feedback_delete_owner_or_admin on public.platform_feedback;
drop policy if exists platform_feedback_delete_admin on public.platform_feedback;
create policy platform_feedback_delete_admin
on public.platform_feedback
for delete
to authenticated
using (
  public.current_user_role() = 'super_admin'
);

drop policy if exists platform_feedback_votes_select_authenticated on public.platform_feedback_votes;
create policy platform_feedback_votes_select_authenticated
on public.platform_feedback_votes
for select
to authenticated
using (true);

drop policy if exists platform_feedback_votes_insert_authenticated on public.platform_feedback_votes;
create policy platform_feedback_votes_insert_authenticated
on public.platform_feedback_votes
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists platform_feedback_votes_delete_owner_or_admin on public.platform_feedback_votes;
create policy platform_feedback_votes_delete_owner_or_admin
on public.platform_feedback_votes
for delete
to authenticated
using (
  public.current_user_role() = 'super_admin'
  or user_id = auth.uid()
);
