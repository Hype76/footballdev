-- FP-V1-DATA-TRANSFER-PORTABLE-DETECTION-RECOVERY-07 mandatory stop restore
-- Restore the private Data Transfer bucket to the prior XLSX-only upload allowlist.
-- RLS, storage access, retention, object data, privacy, and size limits remain unchanged.

update storage.buckets
set allowed_mime_types = array[
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]::text[]
where id = 'data-transfer-private';
