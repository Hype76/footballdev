insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'tester-feedback-attachments',
  'tester-feedback-attachments',
  false,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.tester_feedback_reports
  add column if not exists screenshot_storage_bucket text,
  add column if not exists screenshot_storage_path text,
  add column if not exists screenshot_original_filename text,
  add column if not exists screenshot_mime_type text,
  add column if not exists screenshot_file_size integer,
  add column if not exists screenshot_uploaded_by uuid references public.users(id) on delete set null,
  add column if not exists screenshot_uploaded_at timestamptz,
  add column if not exists feedback_email_status text not null default '',
  add column if not exists feedback_email_sent_at timestamptz,
  add column if not exists feedback_email_error text not null default '';

alter table public.tester_feedback_reports
  drop constraint if exists tester_feedback_reports_screenshot_bucket_check,
  add constraint tester_feedback_reports_screenshot_bucket_check
    check (
      screenshot_storage_bucket is null
      or screenshot_storage_bucket = 'tester-feedback-attachments'
    );

alter table public.tester_feedback_reports
  drop constraint if exists tester_feedback_reports_screenshot_mime_check,
  add constraint tester_feedback_reports_screenshot_mime_check
    check (
      screenshot_mime_type is null
      or screenshot_mime_type in ('image/png', 'image/jpeg', 'image/webp')
    );

alter table public.tester_feedback_reports
  drop constraint if exists tester_feedback_reports_screenshot_size_check,
  add constraint tester_feedback_reports_screenshot_size_check
    check (
      screenshot_file_size is null
      or (screenshot_file_size > 0 and screenshot_file_size <= 5242880)
    );

alter table public.tester_feedback_reports
  drop constraint if exists tester_feedback_reports_screenshot_metadata_check,
  add constraint tester_feedback_reports_screenshot_metadata_check
    check (
      (
        screenshot_storage_bucket is null
        and screenshot_storage_path is null
        and screenshot_original_filename is null
        and screenshot_mime_type is null
        and screenshot_file_size is null
        and screenshot_uploaded_by is null
        and screenshot_uploaded_at is null
      )
      or (
        screenshot_storage_bucket = 'tester-feedback-attachments'
        and screenshot_storage_path like 'tester-feedback/%'
        and screenshot_original_filename is not null
        and screenshot_mime_type in ('image/png', 'image/jpeg', 'image/webp')
        and screenshot_file_size > 0
        and screenshot_file_size <= 5242880
        and screenshot_uploaded_by is not null
        and screenshot_uploaded_at is not null
      )
    );

alter table public.tester_feedback_reports
  drop constraint if exists tester_feedback_reports_feedback_email_status_check,
  add constraint tester_feedback_reports_feedback_email_status_check
    check (
      feedback_email_status in ('', 'sent', 'failed', 'not_configured')
    );

create index if not exists tester_feedback_reports_attachment_idx
  on public.tester_feedback_reports (screenshot_storage_bucket, screenshot_storage_path)
  where screenshot_storage_path is not null;

create index if not exists tester_feedback_reports_feedback_email_status_idx
  on public.tester_feedback_reports (feedback_email_status)
  where feedback_email_status <> '';
