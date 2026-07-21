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

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const { createManageClubLogoHandler } = await import('../netlify/functions/manage-club-logo.js')

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

function responseHeaders(response) {
  return Object.fromEntries(
    Object.entries(response.headers || {}).map(([name, value]) => [name.toLowerCase(), value]),
  )
}

function assertSafeJsonResponse(response, expectedStatus) {
  const headers = responseHeaders(response)

  assert.equal(response.statusCode, expectedStatus)
  assert.equal(headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(headers['cache-control'], 'no-store, max-age=0')
  assert.equal(headers['x-content-type-options'], 'nosniff')
  assert.equal(headers['access-control-allow-origin'], undefined)
  assert.equal(Object.keys(headers).length, 3)
  assert.doesNotThrow(() => JSON.parse(response.body))
  assert.doesNotMatch(response.body, /stack|node_modules|netlify[\\/]functions|service-role|[A-Z]:\\\\/i)
}

function request(body = {}) {
  return {
    body: JSON.stringify({
      clubId: '00000000-0000-4000-8000-000000000001',
      dataBase64: 'fixture',
      fileName: 'badge.png',
      mimeType: 'image/png',
      ...body,
    }),
    headers: { authorization: 'Bearer fixture-token' },
    httpMethod: 'POST',
  }
}

function statusError(message, statusCode) {
  return Object.assign(new Error(message), { statusCode })
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
  assert.match(handlerSource, /authenticate = getAuthenticatedPlanProfile/)
  assert.match(handlerSource, /authenticate\(event, \{ clubId \}\)/)
  assert.match(handlerSource, /assertAuthority = assertClubLogoActorAuthority/)
  assert.match(handlerSource, /assertAuthority\(profile, clubId\)/)
  assert.match(handlerSource, /const objectPath = `\$\{clubId\}\/logos\/\$\{contentHash\}\.png`/)
  assert.match(handlerSource, /upsert: true/)
  assert.match(handlerSource, /\.update\(\{ logo_url: logoUrl \}\)/)
  assert.match(handlerSource, /previousObjectPath !== objectPath[\s\S]*\.remove\(\[objectPath\]\)/)
  assert.match(handlerSource, /previousObjectPath && previousObjectPath !== objectPath[\s\S]*\.remove\(\[previousObjectPath\]\)/)
  assert.doesNotMatch(handlerSource, /body\.(?:path|objectPath|storageKey)/)
})

test('every club logo JSON response uses one case-insensitive safe header boundary', async () => {
  const handlerSource = await readFile(handlerUrl, 'utf8')

  assert.equal((handlerSource.match(/headers:\s*\{/g) || []).length, 1)
  assert.equal((handlerSource.match(/return jsonResponse\(/g) || []).length, 4)
  assert.match(handlerSource, /'Content-Type': 'application\/json; charset=utf-8'/)
  assert.match(handlerSource, /'Cache-Control': 'no-store, max-age=0'/)
  assert.match(handlerSource, /'X-Content-Type-Options': 'nosniff'/)
  assert.doesNotMatch(handlerSource, /Access-Control-Allow-Origin/i)

  const sideEffects = []
  const logger = { error: (...args) => sideEffects.push(['log', ...args]) }
  const baseDependencies = {
    assertAuthority: () => ({ isOwnClubAdmin: true, isPlatformAdmin: false }),
    assertFeature: () => {},
    authenticate: async () => ({ role: 'admin' }),
    logger,
    replaceLogo: async () => ({
      contentType: 'image/png',
      height: 24,
      logoUrl: 'https://example.test/club-logos/logo.png',
      oldLogoCleanupDeferred: false,
      width: 32,
    }),
  }

  const wrongMethod = await createManageClubLogoHandler({
    ...baseDependencies,
    authenticate: async () => { throw new Error('authentication should not run') },
    replaceLogo: async () => { throw new Error('storage should not run') },
  })({ ...request(), httpMethod: 'GET' })
  assertSafeJsonResponse(wrongMethod, 405)
  assert.deepEqual(JSON.parse(wrongMethod.body), {
    success: false,
    message: 'Method Not Allowed',
  })

  const missingClub = await createManageClubLogoHandler({
    ...baseDependencies,
    authenticate: async () => { throw new Error('authentication should not run') },
    replaceLogo: async () => { throw new Error('storage should not run') },
  })(request({ clubId: '' }))
  assertSafeJsonResponse(missingClub, 400)

  const malformedInput = await createManageClubLogoHandler({
    ...baseDependencies,
    authenticate: async () => { throw new Error('authentication should not run') },
    replaceLogo: async () => { throw new Error('storage should not run') },
  })({ ...request(), body: '{' })
  assertSafeJsonResponse(malformedInput, 500)

  const signedOut = await createManageClubLogoHandler({
    ...baseDependencies,
    authenticate: async () => { throw statusError('Login is required.', 401) },
    replaceLogo: async () => { throw new Error('storage should not run') },
  })(request())
  assertSafeJsonResponse(signedOut, 401)

  const authorityDenied = await createManageClubLogoHandler({
    ...baseDependencies,
    assertAuthority: () => { throw statusError('Only an authorised club admin can change this club logo.', 403) },
    replaceLogo: async () => { throw new Error('storage should not run') },
  })(request())
  assertSafeJsonResponse(authorityDenied, 403)

  const validationFailures = [
    'Use a PNG, JPG, or WebP logo.',
    'Logo must be 2MB or smaller.',
    'The logo could not be decoded as a safe image.',
  ]

  for (const message of validationFailures) {
    const response = await createManageClubLogoHandler({
      ...baseDependencies,
      replaceLogo: async () => { throw statusError(message, 400) },
    })(request())
    assertSafeJsonResponse(response, 400)
  }

  const success = await createManageClubLogoHandler(baseDependencies)(request())
  assertSafeJsonResponse(success, 200)
  assert.deepEqual(JSON.parse(success.body), {
    success: true,
    contentType: 'image/png',
    height: 24,
    logoUrl: 'https://example.test/club-logos/logo.png',
    oldLogoCleanupDeferred: false,
    width: 32,
  })

  const internalFailure = await createManageClubLogoHandler({
    ...baseDependencies,
    replaceLogo: async () => { throw new Error() },
  })(request())
  assertSafeJsonResponse(internalFailure, 500)
  assert.deepEqual(JSON.parse(internalFailure.body), {
    success: false,
    message: 'The club logo could not be updated.',
  })
  assert.equal(sideEffects.filter(([type]) => type === 'log').length, 7)
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
