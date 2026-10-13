-- Server-only PDF copies support explicit authorised Open PDF requests.
alter table public.development_parent_reports
  add column if not exists pdf_artifact jsonb not null default '{}'::jsonb;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('development-pdfs-private', 'development-pdfs-private', false, 5242880, array['application/pdf']::text[])
on conflict (id) do update
set public = false, file_size_limit = 5242880, allowed_mime_types = array['application/pdf']::text[];
