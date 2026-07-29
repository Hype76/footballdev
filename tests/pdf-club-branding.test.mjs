import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import sharp from 'sharp'

import {
  preparePdfClubLogo,
  resolveManagedClubLogoObjectPath,
  resolvePdfBranding,
} from '../netlify/functions/lib/_pdf-branding.js'
import {
  PDF_BRANDING_SOURCES,
  PDF_PLATFORM_ATTRIBUTION,
  validatePdfBranding,
} from '../src/lib/pdf-branding.js'
import {
  buildParentMessagePdfDocument,
  renderPdfDocumentHtml,
} from '../src/lib/pdf-document.js'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

const STORAGE_ORIGIN = 'https://example.supabase.co'

function activeProfile(overrides = {}) {
  return {
    id: 'actor-a',
    clubId: 'club-a',
    role: 'admin',
    roleRank: 100,
    ...overrides,
  }
}

function logoUrl(clubId, fileName = 'logo.png') {
  return `${STORAGE_ORIGIN}/storage/v1/object/public/club-logos/${clubId}/logos/${fileName}`
}

function createStorage({ blob, error = null, delayUntilAbort = false, calls = [] } = {}) {
  return {
    from(bucket) {
      assert.equal(bucket, 'club-logos')
      return {
        download(path, _options, requestOptions) {
          calls.push(path)

          if (delayUntilAbort) {
            return new Promise((resolve, reject) => {
              requestOptions?.signal?.addEventListener('abort', () => {
                reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
              }, { once: true })
            })
          }

          return Promise.resolve({ data: blob || null, error })
        },
      }
    },
  }
}

function createDatabase({
  club = {
    id: 'club-a',
    name: 'Club Alpha',
    logo_url: '',
    theme_accent: 'blue',
  },
  team = {
    id: 'team-a',
    club_id: 'club-a',
    name: 'Under 12 Alpha',
  },
  assignment = { team_id: 'team-a' },
  storage = createStorage(),
} = {}) {
  const calls = []

  return {
    calls,
    storage,
    from(table) {
      const filters = []
      const builder = {
        eq(column, value) {
          filters.push([column, value])
          return builder
        },
        maybeSingle: async () => {
          calls.push({ table, filters: [...filters] })
          const candidate = table === 'clubs'
            ? club
            : table === 'teams'
              ? team
              : table === 'team_staff'
                ? assignment
                : null
          const matches = candidate && filters.every(([column, value]) => candidate[column] === value)
          return { data: matches ? candidate : null, error: null }
        },
        select() {
          return builder
        },
      }

      return builder
    },
  }
}

async function imageBuffer(format, { width = 120, height = 80 } = {}) {
  const image = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: '#145ab4',
    },
  })

  if (format === 'jpeg') {
    return image.jpeg().toBuffer()
  }

  if (format === 'webp') {
    return image.webp().toBuffer()
  }

  return image.png().toBuffer()
}

test('managed club logo paths accept only the configured Supabase origin and exact club prefix', () => {
  assert.equal(
    resolveManagedClubLogoObjectPath(logoUrl('club-a', 'hash.png'), 'club-a', { storageOrigin: STORAGE_ORIGIN }),
    'club-a/logos/hash.png',
  )
  assert.equal(resolveManagedClubLogoObjectPath(logoUrl('club-b'), 'club-a', { storageOrigin: STORAGE_ORIGIN }), '')
  assert.equal(resolveManagedClubLogoObjectPath('https://cdn.example/logo.png', 'club-a', { storageOrigin: STORAGE_ORIGIN }), '')
  assert.equal(resolveManagedClubLogoObjectPath(
    `${STORAGE_ORIGIN}/storage/v1/object/public/club-logos/club-a/../club-b/logo.png`,
    'club-a',
    { storageOrigin: STORAGE_ORIGIN },
  ), '')
  assert.equal(resolveManagedClubLogoObjectPath(
    `${STORAGE_ORIGIN}/storage/v1/object/public/club-logos/club-a%5Cclub-b/logo.png`,
    'club-a',
    { storageOrigin: STORAGE_ORIGIN },
  ), '')
})

test('PNG, JPEG, and WebP club logos are validated, resized, and embedded only as PNG data', async () => {
  const cases = [
    ['png', 'image/png', 'logo.png'],
    ['jpeg', 'image/jpeg', 'logo.jpg'],
    ['webp', 'image/webp', 'logo.webp'],
  ]

  for (const [format, mimeType, fileName] of cases) {
    const input = await imageBuffer(format)
    const calls = []
    const diagnostics = {}
    const result = await preparePdfClubLogo({
      storage: createStorage({
        blob: new Blob([input], { type: mimeType }),
        calls,
      }),
      clubId: 'club-a',
      logoUrl: logoUrl('club-a', fileName),
      diagnostics,
      storageOrigin: STORAGE_ORIGIN,
    })

    assert.match(result.clubLogoData, /^data:image\/png;base64,iVBORw0KGgo/)
    assert.equal(result.fallbackReason, '')
    assert.equal(result.logoWidth, 120)
    assert.equal(result.logoHeight, 80)
    assert.equal(calls.length, 1)
    assert.equal(diagnostics.logoInputBytes, input.length)
    assert.ok(diagnostics.logoOutputBytes > 0)
  }
})

test('unsafe, invalid, oversized, inaccessible, and timed-out logos fall back without browser input', async () => {
  const validPng = await imageBuffer('png')
  const excessiveDimensions = await imageBuffer('png', { width: 2049, height: 1 })
  const excessiveAspectRatio = await imageBuffer('png', { width: 900, height: 10 })
  const fixtures = [
    {
      name: 'missing',
      args: { logoUrl: '' },
      expected: 'LOGO_MISSING',
    },
    {
      name: 'cross club',
      args: { logoUrl: logoUrl('club-b') },
      expected: 'LOGO_PATH_REJECTED',
    },
    {
      name: 'corrupt',
      storage: createStorage({ blob: new Blob([Buffer.from('not an image')], { type: 'image/png' }) }),
      expected: 'LOGO_VALIDATION_FAILED',
    },
    {
      name: 'invalid mime',
      storage: createStorage({ blob: new Blob([validPng], { type: 'text/plain' }) }),
      expected: 'LOGO_VALIDATION_FAILED',
    },
    {
      name: 'signature mismatch',
      storage: createStorage({ blob: new Blob([validPng], { type: 'image/jpeg' }) }),
      expected: 'LOGO_VALIDATION_FAILED',
    },
    {
      name: 'unsupported svg',
      storage: createStorage({ blob: new Blob([Buffer.from('<svg></svg>')], { type: 'image/svg+xml' }) }),
      expected: 'LOGO_VALIDATION_FAILED',
    },
    {
      name: 'oversized bytes',
      storage: createStorage({ blob: new Blob([Buffer.alloc((2 * 1024 * 1024) + 1)], { type: 'image/png' }) }),
      expected: 'LOGO_VALIDATION_FAILED',
    },
    {
      name: 'excessive dimensions',
      storage: createStorage({ blob: new Blob([excessiveDimensions], { type: 'image/png' }) }),
      expected: 'LOGO_VALIDATION_FAILED',
    },
    {
      name: 'excessive aspect ratio',
      storage: createStorage({ blob: new Blob([excessiveAspectRatio], { type: 'image/png' }) }),
      expected: 'LOGO_ASPECT_RATIO_REJECTED',
    },
    {
      name: 'storage failure',
      storage: createStorage({ error: new Error('private storage detail') }),
      expected: 'LOGO_FETCH_FAILED',
    },
    {
      name: 'timeout',
      storage: createStorage({ delayUntilAbort: true }),
      args: { fetchTimeoutMs: 5 },
      expected: 'LOGO_FETCH_TIMEOUT',
    },
  ]

  for (const fixture of fixtures) {
    const result = await preparePdfClubLogo({
      storage: fixture.storage || createStorage(),
      clubId: 'club-a',
      logoUrl: fixture.args?.logoUrl ?? logoUrl('club-a'),
      fetchTimeoutMs: fixture.args?.fetchTimeoutMs,
      storageOrigin: STORAGE_ORIGIN,
    })

    assert.equal(result.fallbackReason, fixture.expected, fixture.name)
    assert.equal(result.clubLogoData, undefined, fixture.name)
  }
})

test('server resolver owns club, team, colour, attribution, footer label, and logo fallback', async () => {
  const validPng = await imageBuffer('png')
  const diagnostics = {}
  const database = createDatabase({
    club: {
      id: 'club-a',
      name: 'Club Alpha',
      logo_url: logoUrl('club-a'),
      theme_accent: '#ffffff',
    },
    storage: createStorage({ blob: new Blob([validPng], { type: 'image/png' }) }),
  })
  const result = await resolvePdfBranding({
    supabaseAdmin: database,
    profile: activeProfile(),
    clubId: 'club-a',
    teamId: 'team-a',
    reportType: 'parent-message',
    diagnostics,
    now: () => new Date('2026-07-29T12:00:00Z'),
    storageOrigin: STORAGE_ORIGIN,
  })

  assert.equal(result.branding.clubName, 'Club Alpha')
  assert.equal(result.branding.teamName, 'Under 12 Alpha')
  assert.equal(result.branding.primaryColour, '#ffffff')
  assert.notEqual(result.branding.accentTextColour, '#ffffff')
  assert.equal(result.branding.brandingSource, PDF_BRANDING_SOURCES.clubLogo)
  assert.equal(result.branding.confidentialityLabel, 'Intended recipient only')
  assert.equal(result.branding.generatedDate, '29 July 2026')
  assert.equal(result.branding.platformAttribution, PDF_PLATFORM_ATTRIBUTION)
  assert.equal(diagnostics.brandingSource, PDF_BRANDING_SOURCES.clubLogo)
  assert.doesNotMatch(JSON.stringify(diagnostics), /club-a\/logos|storage\/v1|iVBOR/)
})

test('missing or invalid branding produces initials, safe colours, and a valid branded document', async () => {
  const database = createDatabase({
    club: {
      id: 'club-a',
      name: 'Long Example Football Club',
      logo_url: '',
      theme_accent: 'url(https://example.test)',
    },
  })
  const { branding } = await resolvePdfBranding({
    supabaseAdmin: database,
    profile: activeProfile(),
    clubId: 'club-a',
    teamId: 'team-a',
    reportType: 'assessment',
    now: () => new Date('2026-07-29T12:00:00Z'),
    storageOrigin: STORAGE_ORIGIN,
  })
  const document = buildParentMessagePdfDocument({
    clubName: 'caller club is replaced before rendering',
    playerName: 'Player Alpha',
    teamName: 'caller team',
    subject: 'Development update',
    body: 'Structured content',
  })
  const html = renderPdfDocumentHtml(document, { branding })

  assert.equal(branding.clubInitials, 'LEF')
  assert.equal(branding.brandingSource, PDF_BRANDING_SOURCES.clubInitials)
  assert.equal(branding.primaryColour, '#047857')
  assert.match(branding.fallbackReason, /LOGO_MISSING/)
  assert.match(branding.fallbackReason, /COLOUR_INVALID/)
  assert.match(html, /Long Example Football Club/)
  assert.match(html, />LEF<\/div>/)
  assert.doesNotMatch(html, /url\(https:\/\//)
  assert.doesNotMatch(html, /<img class="club-logo"/)
})

test('cross-club and cross-team branding scope fails closed before storage is read', async () => {
  const storageCalls = []
  const database = createDatabase({
    storage: createStorage({ calls: storageCalls }),
  })

  await assert.rejects(resolvePdfBranding({
    supabaseAdmin: database,
    profile: activeProfile({ clubId: 'club-b' }),
    clubId: 'club-a',
    teamId: 'team-a',
    storageOrigin: STORAGE_ORIGIN,
  }), { code: 'PDF_CROSS_CLUB_DENIED' })

  await assert.rejects(resolvePdfBranding({
    supabaseAdmin: database,
    profile: activeProfile({ role: 'coach', roleRank: 20 }),
    clubId: 'club-a',
    teamId: 'team-b',
    storageOrigin: STORAGE_ORIGIN,
  }), { code: 'PDF_CROSS_TEAM_DENIED' })

  assert.equal(storageCalls.length, 0)
})

test('sequential and concurrent multi-club renders do not mix names, teams, colours, or logos', async () => {
  const alphaLogo = await imageBuffer('png', { width: 100, height: 50 })
  const betaLogo = await sharp({
    create: {
      width: 80,
      height: 120,
      channels: 4,
      background: '#be2814',
    },
  }).png().toBuffer()
  const alphaDatabase = createDatabase({
    club: {
      id: 'club-a',
      name: 'Club Alpha',
      logo_url: logoUrl('club-a', 'alpha.png'),
      theme_accent: 'blue',
    },
    team: {
      id: 'team-a',
      club_id: 'club-a',
      name: 'Alpha Team',
    },
    storage: createStorage({ blob: new Blob([alphaLogo], { type: 'image/png' }) }),
  })
  const betaDatabase = createDatabase({
    club: {
      id: 'club-b',
      name: 'Club Beta',
      logo_url: logoUrl('club-b', 'beta.png'),
      theme_accent: 'red',
    },
    team: {
      id: 'team-b',
      club_id: 'club-b',
      name: 'Beta Team',
    },
    assignment: { team_id: 'team-b' },
    storage: createStorage({ blob: new Blob([betaLogo], { type: 'image/png' }) }),
  })
  const resolveAlpha = () => resolvePdfBranding({
    supabaseAdmin: alphaDatabase,
    profile: activeProfile(),
    clubId: 'club-a',
    teamId: 'team-a',
    storageOrigin: STORAGE_ORIGIN,
  })
  const resolveBeta = () => resolvePdfBranding({
    supabaseAdmin: betaDatabase,
    profile: activeProfile({ id: 'actor-b', clubId: 'club-b' }),
    clubId: 'club-b',
    teamId: 'team-b',
    storageOrigin: STORAGE_ORIGIN,
  })
  const sequential = [await resolveAlpha(), await resolveBeta()]
  const concurrent = await Promise.all([resolveAlpha(), resolveBeta()])

  for (const [alpha, beta] of [sequential, concurrent]) {
    assert.equal(alpha.branding.clubName, 'Club Alpha')
    assert.equal(alpha.branding.teamName, 'Alpha Team')
    assert.equal(alpha.branding.primaryColour, '#1d4ed8')
    assert.equal(alpha.branding.logoWidth, 100)
    assert.equal(beta.branding.clubName, 'Club Beta')
    assert.equal(beta.branding.teamName, 'Beta Team')
    assert.equal(beta.branding.primaryColour, '#dc2626')
    assert.equal(beta.branding.logoHeight, 120)
    assert.notEqual(alpha.branding.clubLogoData, beta.branding.clubLogoData)
  }
})

test('branding validation rejects caller data URIs, CSS colours, and attribution overrides', () => {
  const branding = validatePdfBranding({
    clubName: 'Club Alpha',
    clubInitials: 'CA',
    clubLogoData: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    primaryColour: 'linear-gradient(red, blue)',
    secondaryColour: 'var(--secret)',
    accentTextColour: 'transparent',
    platformAttribution: 'Caller controlled',
    confidentialityLabel: 'Public',
    brandingSource: 'external',
    fallbackReason: 'private/path/value',
  }, {
    context: { clubName: 'Club Alpha', teamName: 'Alpha Team' },
  })

  assert.equal(branding.clubLogoData, '')
  assert.equal(branding.primaryColour, '#047857')
  assert.equal(branding.secondaryColour, '#ecfdf5')
  assert.equal(branding.accentTextColour, '#065f46')
  assert.equal(branding.platformAttribution, PDF_PLATFORM_ATTRIBUTION)
  assert.equal(branding.confidentialityLabel, 'Confidential')
  assert.equal(branding.brandingSource, PDF_BRANDING_SOURCES.clubInitials)
  assert.equal(branding.fallbackReason, 'BRANDING_FALLBACK')
})

test('every supported server PDF caller uses the shared branding resolver and renderer envelope', async () => {
  const [reportSource, renderSource, emailSource, documentSource, brandingSource] = await Promise.all([
    readFile(new URL('../netlify/functions/lib/_pdf-report.js', import.meta.url), 'utf8'),
    readFile(new URL('../netlify/functions/render-pdf.js', import.meta.url), 'utf8'),
    readFile(new URL('../netlify/functions/send-parent-email.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/pdf-document.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/pdf-branding.js', import.meta.url), 'utf8'),
  ])

  assert.match(reportSource, /resolvePdfBranding/)
  assert.equal((reportSource.match(/resolvePdfBranding\(/g) || []).length, 2)
  assert.match(renderSource, /branding:\s*report\.branding/)
  assert.match(emailSource, /branding:\s*pdfReport\.branding/)
  assert.match(emailSource, /authorizeAssessmentPdfReport/)
  assert.doesNotMatch(renderSource, /body\.(logo|logoUrl|primaryColour|branding)/)
  assert.doesNotMatch(emailSource, /branding:\s*body\./)
  assert.match(documentSource, /img-src data:/)
  assert.match(documentSource, /Page <span class="pageNumber"/)
  assert.match(brandingSource, /Generated securely by Footballplayer\.online/)
})
