-- FP-V1-DEVELOPMENT-DRAFT-REFRESH-RACE-RECOVERY-28
-- Keep a server-authoritative revision on each private Development draft so
-- delayed or retried browser writes cannot replace a newer saved snapshot.

alter table public.evaluation_drafts
  add column if not exists client_save_version bigint not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.evaluation_drafts'::regclass
      and conname = 'evaluation_drafts_client_save_version_nonnegative'
  ) then
    alter table public.evaluation_drafts
      add constraint evaluation_drafts_client_save_version_nonnegative
      check (client_save_version >= 0);
  end if;
end
$$;

comment on column public.evaluation_drafts.client_save_version is
  'Monotonic browser revision used to reject stale Development draft writes.';
