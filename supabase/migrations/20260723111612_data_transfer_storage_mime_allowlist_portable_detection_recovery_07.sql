-- FP-V1-DATA-TRANSFER-PORTABLE-DETECTION-RECOVERY-07
-- Forward-only upload allowlist repair for the existing private Data Transfer bucket.
-- RLS, storage access, retention, object data, privacy, and size limits remain unchanged.

update storage.buckets
set allowed_mime_types = array[
  'text/csv',
  'text/tab-separated-values',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.spreadsheet'
]::text[]
where id = 'data-transfer-private';
