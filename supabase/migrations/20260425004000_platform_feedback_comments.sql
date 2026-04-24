create table if not exists public.platform_feedback_comments (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.platform_feedback (id) on delete cascade,
  created_by uuid references public.users (id) on delete set null,
  message text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists platform_feedback_comments_feedback_id_idx
on public.platform_feedback_comments (feedback_id, created_at desc);

grant select, insert, update, delete on public.platform_feedback_comments to authenticated;

alter table public.platform_feedback_comments enable row level security;

insert into public.platform_feedback_comments (feedback_id, created_by, message, created_at)
select pf.id, null, pf.admin_note, coalesce(pf.updated_at, timezone('utc', now()))
from public.platform_feedback pf
where nullif(trim(pf.admin_note), '') is not null
  and not exists (
    select 1
    from public.platform_feedback_comments pfc
    where pfc.feedback_id = pf.id
      and pfc.message = pf.admin_note
  );

drop policy if exists platform_feedback_comments_select_authenticated on public.platform_feedback_comments;
create policy platform_feedback_comments_select_authenticated
on public.platform_feedback_comments
for select
to authenticated
using (true);

drop policy if exists platform_feedback_comments_insert_admin on public.platform_feedback_comments;
create policy platform_feedback_comments_insert_admin
on public.platform_feedback_comments
for insert
to authenticated
with check (
  public.current_user_role() = 'super_admin'
  and created_by = auth.uid()
);

drop policy if exists platform_feedback_comments_update_admin on public.platform_feedback_comments;
create policy platform_feedback_comments_update_admin
on public.platform_feedback_comments
for update
to authenticated
using (public.current_user_role() = 'super_admin')
with check (public.current_user_role() = 'super_admin');

drop policy if exists platform_feedback_comments_delete_admin on public.platform_feedback_comments;
create policy platform_feedback_comments_delete_admin
on public.platform_feedback_comments
for delete
to authenticated
using (public.current_user_role() = 'super_admin');
