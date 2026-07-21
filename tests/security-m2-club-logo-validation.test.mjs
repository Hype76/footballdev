import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import sharp from 'sharp'
import {
  CLUB_LOGO_ALLOWED_EXTENSIONS,
  CLUB_LOGO_ALLOWED_MIME_TYPES,
  CLUB_LOGO_MAX_BYTES,
  CLUB_LOGO_MAX_HEIGHT,
  CLUB_LOGO_MAX_PIXELS,
  CLUB_LOGO_MAX_WIDTH,
  decodeClubLogoBase64,
  validateAndNormalizeClubLogo,
} from '../netlify/functions/lib/_club-logo-validation.js'
import { assertClubLogoActorAuthority } from '../netlify/functions/lib/_club-logo-authority.js'

const migrationUrl = new URL('../supabase/migrations/20260721161858_m2_database_function_and_club_logo_hardening.sql', import.meta.url)
const browserActionsUrl = new URL('../src/lib/domain/club-settings-actions.js', import.meta.url)
const handlerUrl = new URL('../netlify/functions/manage-club-logo.js', import.meta.url)

async function fixture(format = 'png', width = 32, height = 24) {
  const pipeline = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 4, g: 120, b: 87, alpha: 1 },
    },
  })

  return pipeline[format]().toBuffer()
}

test('club logo limits and allowlists are explicit', () => {
  assert.equal(CLUB_LOGO_MAX_BYTES, 2 * 1024 * 1024)
  assert.equal(CLUB_LOGO_MAX_WIDTH, 2048)
  assert.equal(CLUB_LOGO_MAX_HEIGHT, 2048)
  assert.equal(CLUB_LOGO_MAX_PIXELS, 2048 * 2048)
  assert.deepEqual(CLUB_LOGO_ALLOWED_MIME_TYPES, ['image/jpeg', 'image/png', 'image/webp'])
  assert.deepEqual(CLUB_LOGO_ALLOWED_EXTENSIONS, ['.jpeg', '.jpg', '.png', '.webp'])
})

test('PNG, JPEG, and WebP inputs decode and normalize to one PNG', async () => {
  const cases = [
    ['png', 'image/png', 'badge.png'],
    ['jpeg', 'image/jpeg', 'badge.jpg'],
    ['webp', 'image/webp', 'badge.webp'],
  ]

  for (const [format, mimeType, fileName] of cases) {
    const result = await validateAndNormalizeClubLogo({
      buffer: await fixture(format),
      declaredMimeType: mimeType,
      fileName,
    })

    assert.equal(result.contentType, 'image/png')
    assert.equal(result.width, 32)
    assert.equal(result.height, 24)
    assert.equal((await sharp(result.buffer).metadata()).format, 'png')
  }
})

test('oversized bytes, dimensions, and malformed base64 fail closed', async () => {
  assert.throws(() => decodeClubLogoBase64('not base64'), /not valid image data/i)
  assert.throws(
    () => decodeClubLogoBase64(Buffer.alloc(CLUB_LOGO_MAX_BYTES + 1).toString('base64')),
    /2MB or smaller/i,
  )

  await assert.rejects(
    validateAndNormalizeClubLogo({
      buffer: await fixture('png', CLUB_LOGO_MAX_WIDTH + 1, 1),
      declaredMimeType: 'image/png',
      fileName: 'badge.png',
    }),
    /dimensions/i,
  )
})

test('MIME, extension, SVG, HTML, and magic-byte mismatches are rejected', async () => {
  const png = await fixture('png')

  await assert.rejects(
    validateAndNormalizeClubLogo({ buffer: png, declaredMimeType: 'image/jpeg', fileName: 'badge.jpg' }),
    /does not match/i,
  )
  await assert.rejects(
    validateAndNormalizeClubLogo({ buffer: png, declaredMimeType: 'image/png', fileName: 'badge.svg' }),
    /filename/i,
  )
  await assert.rejects(
    validateAndNormalizeClubLogo({ buffer: Buffer.from('<svg><script>alert(1)</script></svg>'), declaredMimeType: 'image/svg+xml', fileName: 'badge.svg' }),
    /PNG, JPG, or WebP/i,
  )
  await assert.rejects(
    validateAndNormalizeClubLogo({ buffer: Buffer.from('<html>not an image</html>'), declaredMimeType: 'image/png', fileName: 'badge.png' }),
    /decoded as a safe image/i,
  )
})

test('appended polyglot content is rejected before normalization', async () => {
  const pngPolyglot = Buffer.concat([await fixture('png'), Buffer.from('<script>alert(1)</script>')])
  const jpegPolyglot = Buffer.concat([await fixture('jpeg'), Buffer.from('<html>active</html>')])

  await assert.rejects(
    validateAndNormalizeClubLogo({ buffer: pngPolyglot, declaredMimeType: 'image/png', fileName: 'badge.png' }),
    /extra or invalid/i,
  )
  await assert.rejects(
    validateAndNormalizeClubLogo({ buffer: jpegPolyglot, declaredMimeType: 'image/jpeg', fileName: 'badge.jpg' }),
    /extra or invalid/i,
  )
})

test('browser caller sends bytes to the server boundary and cannot choose the storage key', async () => {
  const [browserSource, handlerSource] = await Promise.all([
    readFile(browserActionsUrl, 'utf8'),
    readFile(handlerUrl, 'utf8'),
  ])

  assert.match(browserSource, /\/\.netlify\/functions\/manage-club-logo/)
  assert.doesNotMatch(browserSource, /storage\.from\(CLUB_LOGOS_BUCKET\)\.upload/)
  assert.doesNotMatch(browserSource, /objectPath/)
  assert.match(handlerSource, /getAuthenticatedPlanProfile\(event, \{ clubId \}\)/)
  assert.match(handlerSource, /assertClubLogoActorAuthority\(profile, clubId\)/)
  assert.match(handlerSource, /const objectPath = `\$\{clubId\}\/logos\/\$\{contentHash\}\.png`/)
  assert.match(handlerSource, /upsert: true/)
  assert.match(handlerSource, /\.update\(\{ logo_url: logoUrl \}\)/)
  assert.match(handlerSource, /previousObjectPath !== objectPath[\s\S]*\.remove\(\[objectPath\]\)/)
  assert.match(handlerSource, /previousObjectPath && previousObjectPath !== objectPath[\s\S]*\.remove\(\[previousObjectPath\]\)/)
  assert.doesNotMatch(handlerSource, /body\.(?:path|objectPath|storageKey)/)
})

test('server authority matrix ignores caller role and rank claims and fails closed', () => {
  const clubId = '00000000-0000-4000-8000-000000000001'
  const otherClubId = '00000000-0000-4000-8000-000000000002'
  const baseProfile = {
    accountStatus: 'active',
    clubId,
    clubStatus: 'active',
    role: 'admin',
    roleRank: 90,
  }

  assert.deepEqual(assertClubLogoActorAuthority(baseProfile, clubId), {
    isOwnClubAdmin: true,
    isPlatformAdmin: false,
  })
  assert.deepEqual(assertClubLogoActorAuthority({ ...baseProfile, clubId: '', role: 'super_admin', roleRank: 100 }, otherClubId), {
    isOwnClubAdmin: false,
    isPlatformAdmin: true,
  })

  const deniedProfiles = [
    null,
    { ...baseProfile, role: 'user', roleRank: 10 },
    { ...baseProfile, role: 'parent_portal', roleRank: 0 },
    { ...baseProfile, role: 'coach', roleRank: 20 },
    { ...baseProfile, role: 'manager', roleRank: 50 },
    { ...baseProfile, role: 'team_admin', roleRank: 80 },
    { ...baseProfile, clubId: otherClubId },
    { ...baseProfile, accountStatus: 'suspended' },
    { ...baseProfile, clubStatus: 'suspended' },
    { ...baseProfile, role: 'super_admin', roleRank: 99 },
  ]

  for (const profile of deniedProfiles) {
    assert.throws(() => assertClubLogoActorAuthority(profile, clubId), /authorised club admin/i)
  }
})

test('migration removes listing and direct writes while setting bucket constraints', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /revoke execute on function %I\.%I\(%s\) from anon/i)
  assert.match(migration, /target\.prosecdef[\s\S]*from public/i)
  assert.match(migration, /target\.trigger_only[\s\S]*from public, authenticated, service_role/i)
  assert.match(migration, /resource_library_link_resource_manage_allowed[\s\S]*to authenticated, service_role/i)
  assert.match(migration, /resource_library_link_resource_view_allowed[\s\S]*to authenticated, service_role/i)
  assert.equal((migration.match(/grant execute on function public\.(?:confirm|get|submit)_[^(]+\([^;]+to anon, authenticated;/g) || []).length, 6)
  assert.match(migration, /file_size_limit = 2097152/i)
  assert.match(migration, /allowed_mime_types = array\['image\/jpeg', 'image\/png', 'image\/webp'\]/i)
  assert.match(migration, /drop policy if exists club_logos_public_read/i)
  assert.match(migration, /drop policy if exists club_logos_manager_insert/i)
  assert.match(migration, /drop policy if exists club_logos_manager_update/i)
  assert.match(migration, /drop policy if exists club_logos_manager_delete/i)
  assert.doesNotMatch(migration, /create policy club_logos_public_read/i)
})
