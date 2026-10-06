import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { parse } from '@babel/parser'
import { withParentMatchReportBranding } from '../apps/parent-mobile/src/parentMatchReportBranding.js'
import { buildCompletedReportPdf, buildCompletedReportBranding } from '../src/lib/matchday-report-export.js'

const bundled = await build({ entryPoints: ['apps/parent-mobile/src/parentPdfLogo.js'], bundle: true, write: false, format: 'esm', platform: 'browser' })
const { prepareParentPdfLogo, convertParentPdfLogo } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)
const origin = 'https://synthetic.supabase.co'
const link = { id: 'parent-one', clubId: 'club-one', teamId: 'team-one', clubName: 'Synthetic Club', themeAccent: 'blue', planKey: 'club', planStatus: 'active', clubLogoUrl: `${origin}/storage/v1/object/public/club-logos/club-one/logo.png` }
const match = { id: 'match-one', clubId: link.clubId, teamId: link.teamId, teamName: 'Synthetic Team', status: 'full_time', matchDate: '2026-10-03', opponent: 'Synthetic Visitors', homeScore: 1, awayScore: 0, staffNotes: 'PRIVATE_COACH_NOTE', events: [{ id: 'goal-one', eventType: 'goal', eventStatus: 'active', teamSide: 'club', minute: 5, scorerName: 'Synthetic Scorer', notes: 'PRIVATE_EVENT_NOTE' }, { id: 'void-one', eventType: 'goal', eventStatus: 'voided', scorerName: 'VOIDED_SCORER' }] }
// Small generated transparent PNG; all data and identities are synthetic.
const UPNG = (await import('../apps/parent-mobile/node_modules/upng-js/UPNG.js')).default
const png = new Uint8Array(UPNG.encode([new Uint8Array([255, 0, 0, 255, 0, 0, 255, 0]).buffer], 2, 1, 0, undefined, true))
const response = bytes => ({ ok: true, headers: { get: () => String(bytes.length) }, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) })

test('Authorised Parent context retains colour and embeds converted JPEG in the actual PDF', async () => {
  const prepared = withParentMatchReportBranding(match, link)
  const branding = await prepareParentPdfLogo(prepared, { storageOrigin: origin, fetchLogo: async (url, options) => {
    assert.equal(url, link.clubLogoUrl)
    assert.equal(options.credentials, 'omit')
    return response(png)
  } })
  assert.equal(branding.logoWidth, 256)
  assert.match(branding.clubLogoData, /^data:image\/jpeg;base64,\/9j\//)
  const model = buildCompletedReportBranding(prepared, branding)
  assert.notEqual(model.primaryColour, buildCompletedReportBranding(match).primaryColour)
  const pdf = Buffer.from(buildCompletedReportPdf(prepared, { audience: 'parent', branding, accessContext: prepared })).toString('latin1')
  assert.match(pdf, /\/Subtype \/Image/)
  assert.match(pdf, /\/DCTDecode/)
  assert.match(pdf, /Synthetic Club/)
  assert.match(pdf, /Synthetic Team/)
  assert.doesNotMatch(pdf, /PRIVATE_COACH_NOTE|PRIVATE_EVENT_NOTE/)
  assert.match(pdf, /VOIDED_SCORER/, 'Existing Parent report retains the voided-events audit section')
})

test('Unavailable badge keeps the authorised club colour and initials', async () => {
  const prepared = withParentMatchReportBranding(match, link)
  const branding = await prepareParentPdfLogo(prepared, { storageOrigin: origin, fetchLogo: async () => { throw new Error('Offline') } })
  assert.deepEqual(branding, {})
  const model = buildCompletedReportBranding(prepared, branding)
  assert.notEqual(model.primaryColour, buildCompletedReportBranding(match).primaryColour)
  assert.equal(model.clubInitials, 'SC')
})

for (const changed of [{ clubId: 'club-two' }, { teamId: 'team-two' }, { clubId: '' }, { teamId: '' }]) {
  test(`Changed or absent identity cannot inherit selected branding ${JSON.stringify(changed)}`, () => {
    const prepared = withParentMatchReportBranding({ ...match, ...changed, clubLogoData: 'cached', themeAccent: 'red' }, link)
    assert.equal(prepared.clubLogoUrl, '')
    assert.equal(prepared.clubLogoData, '')
    assert.equal(prepared.themeAccent, '')
    assert.equal(buildCompletedReportBranding(prepared).clubInitials, 'FP')
  })
}

for (const deniedLink of [{ ...link, planKey: 'matchday' }, { ...link, planKey: '' }]) {
  test(`Denied branding uses platform fallback ${deniedLink.planKey}/${deniedLink.planStatus}`, () => {
    const prepared = withParentMatchReportBranding(match, deniedLink)
    const branding = buildCompletedReportBranding(prepared)
    assert.equal(branding.clubLogoData, '')
    assert.equal(branding.clubInitials, 'FP')
    assert.equal(branding.primaryColour, buildCompletedReportBranding(match).primaryColour)
  })
}

test('Team plan retains logo entitlement and current custom-colour policy', () => {
  const prepared = withParentMatchReportBranding(match, { ...link, planKey: 'team' })
  assert.equal(prepared.clubLogoUrl, link.clubLogoUrl)
  assert.equal(prepared.themeAccent, link.themeAccent)
})

test('Scoped Matchday promotion embeds the selected team badge without widening plan capabilities', async () => {
  const selected = { ...link, planKey: 'matchday', teamBrandingDisplay: {
    clubId: link.clubId, teamId: link.teamId, source: 'team', logoAllowed: true,
    coloursAllowed: true, logoUrl: link.clubLogoUrl, accent: 'blue', buttonStyle: 'solid',
  } }
  const prepared = withParentMatchReportBranding(match, selected)
  assert.equal(prepared.planKey, 'matchday')
  assert.equal(prepared.clubLogoUrl, link.clubLogoUrl)
  const branding = await prepareParentPdfLogo(prepared, { storageOrigin: origin, fetchLogo: async () => response(png) })
  const pdf = Buffer.from(buildCompletedReportPdf(prepared, { audience: 'parent', branding, accessContext: prepared })).toString('latin1')
  assert.match(pdf, /\/DCTDecode/)
  assert.doesNotMatch(pdf, /PRIVATE_COACH_NOTE|PRIVATE_EVENT_NOTE/)
  for (const changed of [{ teamId: 'another' }, { clubId: 'another' }]) {
    const denied = withParentMatchReportBranding(match, { ...selected, ...changed })
    assert.equal(denied.clubLogoUrl, '')
    assert.equal(denied.teamBrandingDisplay, null)
  }
  const expired = withParentMatchReportBranding(match, { ...selected, teamBrandingDisplay: {
    ...selected.teamBrandingDisplay, expiresAt: '2020-01-01T00:00:00Z', baseLogoAllowed: false, baseColoursAllowed: false,
  } })
  assert.equal(expired.clubLogoUrl, '')
  assert.equal(expired.themeAccent, '')
})

test('An absent selected Parent link safely clears cached branding', () => {
  const prepared = withParentMatchReportBranding({ ...match, clubLogoData: 'cached', themeAccent: 'red' }, null)
  assert.equal(prepared.clubLogoUrl, '')
  assert.equal(prepared.clubLogoData, '')
  assert.equal(prepared.themeAccent, '')
  assert.equal(prepared.planKey, 'matchday')
})

test('Malformed, oversized, foreign and wrong-club logos fall back without requesting foreign URLs', async () => {
  for (const url of ['https://foreign.example/logo.png', `${origin}/storage/v1/object/public/club-logos/club-two/logo.png`, 'data:image/png;base64,AAAA']) {
    assert.deepEqual(await prepareParentPdfLogo({ ...match, clubLogoUrl: url }, { storageOrigin: origin, fetchLogo: () => { assert.fail('Foreign logo fetched') } }), {})
  }
  assert.deepEqual(convertParentPdfLogo(new Uint8Array(2_000_001)), {})
  assert.deepEqual(await prepareParentPdfLogo({ ...match, clubLogoUrl: link.clubLogoUrl }, { storageOrigin: origin, fetchLogo: async () => response(new Uint8Array([1, 2, 3])) }), {})
})

test('PNG transparency flattens to white and non-square badges preserve aspect ratio', async () => {
  const jpeg = (await import('../apps/parent-mobile/node_modules/jpeg-js/index.js')).default
  const result = convertParentPdfLogo(png)
  const decoded = jpeg.decode(Buffer.from(result.clubLogoData.split(',')[1], 'base64'), { useTArray: true })
  const pixel = (x, y) => Array.from(decoded.data.slice((y * 256 + x) * 4, (y * 256 + x) * 4 + 3))
  assert.ok(pixel(10, 10).every(value => value > 240), 'White outside the centred badge')
  assert.ok(pixel(200, 128).every(value => value > 240), 'Transparent pixel is white')
  assert.ok(pixel(30, 128)[0] > 220 && pixel(30, 128)[1] < 40, 'Opaque red remains red')
})

test('App cache preparation and data loading both use the same scoped branding helper', async () => {
  const [app, data] = await Promise.all(['apps/parent-mobile/App.js', 'apps/parent-mobile/src/parentPortalData.js'].map(file => readFile(file, 'utf8')))
  assert.match(app, /normalizedItems\.map\(match => withParentMatchReportBranding\(match, selectedLink\)\)/)
  assert.match(data, /withParentMatchReportBranding\(normalizeParentMatchDay\(/)
})

test('Shared mobile normalizer preserves both API and cached branding field names', async () => {
  const source = await readFile('apps/mobile-core/src/data.js', 'utf8')
  const declarations = parse(source, { sourceType: 'module' }).program.body.map(node => node.declaration || node)
  const names = ['normalizeMatchDay', 'normalizeMatchDayEvent', 'normalizeText', 'getRelatedRow']
  const functions = names.map(name => declarations.find(node => node.type === 'FunctionDeclaration' && node.id.name === name)).map(node => source.slice(node.start, node.end)).join('\n')
  const normalize = new Function('normalizeMatchDayShirtChoice', 'normalizePitchType', `${functions}; return normalizeMatchDay;`)(value => value, value => value)
  const fromApi = normalize({ club_id: link.clubId, team_id: link.teamId, club_name: link.clubName, club_logo_url: link.clubLogoUrl, theme_accent: link.themeAccent, plan_key: link.planKey, plan_status: link.planStatus })
  const fromCache = normalize(fromApi)
  for (const field of ['clubId', 'teamId', 'clubName', 'clubLogoUrl', 'themeAccent', 'planKey', 'planStatus']) assert.equal(fromCache[field], link[field])
  assert.equal(withParentMatchReportBranding(fromCache, link).clubLogoUrl, link.clubLogoUrl)
})

test('Logo conversion executes without browser canvas or Node Buffer/text globals', async () => {
  const result = await build({ entryPoints: ['apps/parent-mobile/src/parentPdfLogo.js'], bundle: true, write: false, format: 'iife', globalName: 'logo', platform: 'browser' })
  const sandbox = { input: png, setTimeout, clearTimeout, Buffer: undefined, TextEncoder: undefined, TextDecoder: undefined }
  runInNewContext(`${result.outputFiles[0].text}; output = logo.convertParentPdfLogo(input)`, sandbox)
  assert.match(sandbox.output.clubLogoData, /^data:image\/jpeg;base64,\/9j\//)
})

test('A failed or timed-out badge request retains fallback and terminates cleanly', async () => {
  const prepared = withParentMatchReportBranding(match, link)
  assert.deepEqual(await prepareParentPdfLogo(prepared, { storageOrigin: origin, fetchLogo: async () => ({ ok: false }) }), {})
  assert.deepEqual(await prepareParentPdfLogo(prepared, { storageOrigin: origin, timeoutMs: 1, fetchLogo: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Aborted')))) }), {})
})
