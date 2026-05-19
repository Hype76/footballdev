alter table public.club_user_invites
  add column if not exists invite_token uuid not null default gen_random_uuid(),
  add column if not exists team_id uuid references public.teams (id) on delete set null,
  add column if not exists expires_at timestamptz,
  add column if not exists invite_sent_at timestamptz;

update public.club_user_invites
set expires_at = coalesce(expires_at, created_at + interval '7 days')
where accepted_at is null;

create unique index if not exists club_user_invites_invite_token_key
on public.club_user_invites (invite_token);

create index if not exists club_user_invites_pending_expiry_idx
on public.club_user_invites (club_id, email, expires_at)
where accepted_at is null;
