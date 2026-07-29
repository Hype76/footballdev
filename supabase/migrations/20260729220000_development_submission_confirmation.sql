create table if not exists public.development_submission_operations (
  operation_id uuid primary key,
  evaluation_id uuid not null,
  club_id uuid not null
    references public.clubs(id) on delete cascade,
  team_id uuid
    references public.teams(id) on delete set null,
  player_id uuid
    references public.players(id) on delete set null,
  actor_id uuid not null
    references auth.users(id) on delete cascade,
  send_mode text not null
    check (send_mode in ('none', 'now', 'scheduled')),
  scheduled_at timestamptz,
  attach_pdf boolean not null default false,
  include_attendance boolean not null default false,
  selected_parent_link_ids jsonb not null default '[]'::jsonb,
  selected_response_count integer not null default 0
    check (selected_response_count >= 0),
  reminder_date date,
  confirmation_hash text not null,
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists development_submission_operations_club_confirmed_idx
  on public.development_submission_operations (club_id, confirmed_at desc);

create index if not exists development_submission_operations_evaluation_idx
  on public.development_submission_operations (evaluation_id);

alter table public.development_submission_operations enable row level security;

revoke all on table public.development_submission_operations from anon, authenticated;
grant select, insert, update, delete on table public.development_submission_operations to service_role;

comment on table public.development_submission_operations is
  'Service-only proof that a staff member completed the final Development submission review before any Development email output was created.';

create unique index if not exists communication_logs_next_assessment_reminder_once_idx
  on public.communication_logs (
    club_id,
    evaluation_id,
    (metadata->>'dueDate')
  )
  where channel = 'reminder'
    and action = 'next_assessment_reminder_set'
    and evaluation_id is not null
    and coalesce(metadata->>'dueDate', '') <> '';

create unique index if not exists communication_logs_development_output_once_idx
  on public.communication_logs (
    action,
    (metadata->>'developmentOutputKey')
  )
  where channel = 'email'
    and action in ('parent_email_scheduled', 'parent_email_sent')
    and coalesce(metadata->>'developmentOutputKey', '') <> '';
