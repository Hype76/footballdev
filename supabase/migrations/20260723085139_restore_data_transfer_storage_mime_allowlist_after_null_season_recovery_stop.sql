-- FP-V1-DATA-TRANSFER-NULL-SEASON-RECOVERY-05 critical-stop restoration.
-- Restore the last known-good XLSX-only allowlist without changing privacy, size, RLS, access, retention, or objects.

update storage.buckets
set allowed_mime_types = array[
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]::text[]
where id = 'data-transfer-private';
