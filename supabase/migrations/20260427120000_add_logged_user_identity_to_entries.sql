alter table public.evaluations
  add column if not exists created_by_name text,
  add column if not exists created_by_email text,
  add column if not exists updated_by uuid references public.users (id) on delete set null,
  add column if not exists updated_by_name text,
  add column if not exists updated_by_email text;

alter table public.players
  add column if not exists created_by uuid references public.users (id) on delete set null,
  add column if not exists created_by_name text,
  add column if not exists created_by_email text,
  add column if not exists updated_by uuid references public.users (id) on delete set null,
  add column if not exists updated_by_name text,
  add column if not exists updated_by_email text;

alter table public.teams
  add column if not exists created_by uuid references public.users (id) on delete set null,
  add column if not exists created_by_name text,
  add column if not exists created_by_email text,
  add column if not exists updated_by uuid references public.users (id) on delete set null,
  add column if not exists updated_by_name text,
  add column if not exists updated_by_email text;

alter table public.assessment_sessions
  add column if not exists created_by_name text,
  add column if not exists created_by_email text,
  add column if not exists updated_by uuid references public.users (id) on delete set null,
  add column if not exists updated_by_name text,
  add column if not exists updated_by_email text;

alter table public.assessment_session_players
  add column if not exists created_by uuid references public.users (id) on delete set null,
  add column if not exists created_by_name text,
  add column if not exists created_by_email text,
  add column if not exists updated_by uuid references public.users (id) on delete set null,
  add column if not exists updated_by_name text,
  add column if not exists updated_by_email text;

alter table public.communication_logs
  add column if not exists user_name text,
  add column if not exists user_email text;

alter table public.audit_logs
  add column if not exists actor_name text,
  add column if not exists actor_email text;

alter table public.platform_feedback
  add column if not exists created_by_name text,
  add column if not exists created_by_email text,
  add column if not exists updated_by uuid references public.users (id) on delete set null,
  add column if not exists updated_by_name text,
  add column if not exists updated_by_email text;

alter table public.platform_feedback_comments
  add column if not exists created_by_name text,
  add column if not exists created_by_email text;

alter table public.form_fields
  add column if not exists created_by uuid references public.users (id) on delete set null,
  add column if not exists created_by_name text,
  add column if not exists created_by_email text,
  add column if not exists updated_by uuid references public.users (id) on delete set null,
  add column if not exists updated_by_name text,
  add column if not exists updated_by_email text;

alter table public.club_roles
  add column if not exists created_by uuid references public.users (id) on delete set null,
  add column if not exists created_by_name text,
  add column if not exists created_by_email text,
  add column if not exists updated_by uuid references public.users (id) on delete set null,
  add column if not exists updated_by_name text,
  add column if not exists updated_by_email text;

alter table public.club_user_invites
  add column if not exists created_by_name text,
  add column if not exists created_by_email text,
  add column if not exists updated_by uuid references public.users (id) on delete set null,
  add column if not exists updated_by_name text,
  add column if not exists updated_by_email text;

update public.evaluations e
set
  created_by_name = coalesce(nullif(e.created_by_name, ''), nullif(u.username, ''), nullif(u.name, ''), u.email),
  created_by_email = coalesce(nullif(e.created_by_email, ''), u.email)
from public.users u
where e.coach_id = u.id
  and (
    e.created_by_name is null
    or e.created_by_name = ''
    or e.created_by_email is null
    or e.created_by_email = ''
  );

update public.assessment_sessions s
set
  created_by_name = coalesce(nullif(s.created_by_name, ''), nullif(u.username, ''), nullif(u.name, ''), u.email),
  created_by_email = coalesce(nullif(s.created_by_email, ''), u.email)
from public.users u
where s.created_by = u.id
  and (
    s.created_by_name is null
    or s.created_by_name = ''
    or s.created_by_email is null
    or s.created_by_email = ''
  );

update public.communication_logs l
set
  user_name = coalesce(nullif(l.user_name, ''), nullif(u.username, ''), nullif(u.name, ''), u.email),
  user_email = coalesce(nullif(l.user_email, ''), u.email)
from public.users u
where l.user_id = u.id
  and (
    l.user_name is null
    or l.user_name = ''
    or l.user_email is null
    or l.user_email = ''
  );

update public.audit_logs l
set
  actor_name = coalesce(nullif(l.actor_name, ''), nullif(u.username, ''), nullif(u.name, ''), u.email),
  actor_email = coalesce(nullif(l.actor_email, ''), u.email)
from public.users u
where l.actor_id = u.id
  and (
    l.actor_name is null
    or l.actor_name = ''
    or l.actor_email is null
    or l.actor_email = ''
  );

update public.platform_feedback f
set
  created_by_name = coalesce(nullif(f.created_by_name, ''), nullif(u.username, ''), nullif(u.name, ''), u.email),
  created_by_email = coalesce(nullif(f.created_by_email, ''), u.email)
from public.users u
where f.created_by = u.id
  and (
    f.created_by_name is null
    or f.created_by_name = ''
    or f.created_by_email is null
    or f.created_by_email = ''
  );

update public.platform_feedback_comments c
set
  created_by_name = coalesce(nullif(c.created_by_name, ''), nullif(u.username, ''), nullif(u.name, ''), u.email),
  created_by_email = coalesce(nullif(c.created_by_email, ''), u.email)
from public.users u
where c.created_by = u.id
  and (
    c.created_by_name is null
    or c.created_by_name = ''
    or c.created_by_email is null
    or c.created_by_email = ''
  );
