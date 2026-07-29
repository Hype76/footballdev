create table if not exists public.development_parent_reports (
  evaluation_id uuid primary key
    references public.evaluations(id) on delete cascade,
  club_id uuid not null
    references public.clubs(id) on delete cascade,
  report_snapshot jsonb not null,
  finalized_at timestamptz not null default now(),
  finalized_by uuid
    references auth.users(id) on delete set null
);

create index if not exists development_parent_reports_club_idx
  on public.development_parent_reports (club_id, finalized_at desc);

alter table public.development_parent_reports enable row level security;

revoke all on table public.development_parent_reports from anon, authenticated;
grant select, insert, update, delete on table public.development_parent_reports to service_role;

comment on table public.development_parent_reports is
  'Service-only parent-facing Development report snapshots. Historical evaluations without a row are reconstructed at request time.';
