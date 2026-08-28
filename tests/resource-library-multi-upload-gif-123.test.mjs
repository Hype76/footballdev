import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const pageUrl = new URL('../src/pages/ResourceLibraryPage.jsx', import.meta.url)
const domainUrl = new URL('../src/lib/domain/resource-library.js', import.meta.url)
const migrationUrl = new URL('../supabase/migrations/20260828111801_resource_library_gif_multi_upload.sql', import.meta.url)

test('Team Resources provides drag and drop, multi-select, review, removal, and retry-safe progress', async () => {
  const page = await readFile(pageUrl, 'utf8')

  assert.match(page, /type="file"[\s\S]*multiple[\s\S]*accept=\{resourceLibraryFileAccept\}/)
  assert.match(page, /\.gif[\s\S]*image\/gif/)
  assert.match(page, /data-testid="resource-file-drop-zone"/)
  assert.match(page, /onDragOver=\{\(event\) =>/)
  assert.match(page, /onDrop=\{\(event\) =>/)
  assert.match(page, /queueUploadFiles\(event\.dataTransfer\.files\)/)
  assert.match(page, /getDefaultResourceTitle/)
  assert.match(page, /updateQueuedFileTitle/)
  assert.match(page, /removeQueuedFile/)
  assert.match(page, /for \(const \[index, queuedFile\] of uploadDraft\.files\.entries\(\)\)/)
  assert.match(page, /setUploadDraft\(\(current\) => \(\{ \.\.\.current, files: failedFiles \}\)\)/)
  assert.match(page, /remain ready to retry/)
})

test('GIF validation is exact and failed row creation removes the unlinked storage object', async () => {
  const domain = await readFile(domainUrl, 'utf8')

  assert.match(domain, /RESOURCE_LIBRARY_ALLOWED_MIME_TYPES[\s\S]*'image\/gif'/)
  assert.match(domain, /\['gif', 'image\/gif'\]/)
  assert.match(domain, /mimeType !== expectedMimeType/)
  assert.match(domain, /\.remove\(\[storagePath\]\)/)
  assert.match(domain, /Could not remove the unlinked Resource Library upload/)
})

test('GIF migration extends the private Resource Library allowlist without changing files or access policies', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /if current_mime_types is null then[\s\S]*raise exception/)
  assert.match(migration, /array_append\(current_mime_types, 'image\/gif'\)/)
  assert.match(migration, /application\/vnd\.footballplayer\.formation-board\+json/)
  assert.match(migration, /drop constraint if exists resource_library_items_mime_check/)
  assert.match(migration, /validate constraint resource_library_items_mime_check/)
  assert.doesNotMatch(migration, /delete\s+from/i)
  assert.doesNotMatch(migration, /drop\s+table/i)
  assert.doesNotMatch(migration, /create\s+policy|drop\s+policy|alter\s+policy/i)
  assert.doesNotMatch(migration, /\bpublic\s*=/i)
  assert.doesNotMatch(migration, /file_size_limit\s*=/i)
})
