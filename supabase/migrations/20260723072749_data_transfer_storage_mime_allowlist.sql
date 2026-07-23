-- FP-V1-DATA-TRANSFER-MIME-ERROR-REPAIR-04A
-- Non-destructive policy repair for the existing private Data Transfer bucket.

update storage.buckets
set allowed_mime_types = array[
  'text/csv',
  'text/tab-separated-values',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.oasis.opendocument.spreadsheet'
]::text[]
where id = 'data-transfer-private';
