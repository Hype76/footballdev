-- FP-V1-DATA-TRANSFER-RELEASE-REVALIDATE-04B critical-stop rollback.
-- Restore the last-known-good private Data Transfer bucket policy.

update storage.buckets
set allowed_mime_types = array[
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]::text[]
where id = 'data-transfer-private';
