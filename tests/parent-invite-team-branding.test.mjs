import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { buildAuthoritativeParentInviteEmail } from '../src/lib/parent-invite-email.js'
import { loadParentInviteBranding } from '../netlify/functions/lib/_parent-invite-branding.js'

const inviteLink = { team_id: 'team-a', club_id: 'club-a', invite_token: 'synthetic-token',
  clubs: { name: 'Synthetic Club', logo_url: 'https://cdn.example.com/club.png' },
  teams: { name: 'Synthetic Team' }, players: { player_name: 'Synthetic Player' } }
const display = { teamId: 'team-a', clubId: 'club-a', source: 'team', logoAllowed: true,
  coloursAllowed: true, logoUrl: 'https://cdn.example.com/team.png', accent: '#15803d' }
const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => 'image/png' } })

test('eligible team badge and colour reach the authoritative invitation for new and existing parents', async () => {
  for (const existingParentPortalUser of [false, true]) {
    const email = await buildAuthoritativeParentInviteEmail({ inviteLink, brandingDisplay: display, fetchImpl, existingParentPortalUser })
    assert.equal(email.logoSource, 'team')
    assert.match(email.html, /team\.png/)
    assert.match(email.html, /alt="Synthetic Team logo"/)
    assert.match(email.html, /background: #15803d/)
    assert.match(email.html, /color: #ffffff/)
    assert.match(email.html, existingParentPortalUser ? /parent-login\?parentInvite=synthetic-token/ : /parent-invite\/synthetic-token/)
  }
})

test('paid Club display wins over team artwork', async () => {
  const email = await buildAuthoritativeParentInviteEmail({ inviteLink, fetchImpl,
    brandingDisplay: { ...display, source: 'paid_club', logoUrl: 'https://cdn.example.com/paid-club.png', accent: '#facc15' } })
  assert.equal(email.logoSource, 'club')
  assert.match(email.html, /paid-club\.png/)
  assert.match(email.html, /background: #facc15; color: #142018/)
  assert.doesNotMatch(email.html, /team\.png/)
})

test('expired, denied, wrong-scope and unsafe team branding cannot appear', async () => {
  for (const brandingDisplay of [
    { ...display, expiresAt: '2000-01-01T00:00:00Z' },
    { ...display, logoAllowed: false, coloursAllowed: false },
    { ...display, teamId: 'another-team' }, { ...display, clubId: 'another-club' },
    { ...display, logoUrl: 'https://127.0.0.1/private.png', accent: 'red; background:url(evil)' },
  ]) {
    const email = await buildAuthoritativeParentInviteEmail({ inviteLink, brandingDisplay, fetchImpl })
    assert.doesNotMatch(email.html, /team\.png|private\.png|url\(evil\)|background: #15803d/)
  }
})

test('unreachable eligible team badge retains the reachable club fallback', async () => {
  const email = await buildAuthoritativeParentInviteEmail({ inviteLink, brandingDisplay: display,
    fetchImpl: async url => ({ ...await fetchImpl(), ok: !url.includes('team.png') }) })
  assert.equal(email.logoSource, 'club')
  assert.match(email.html, /club\.png/)
  assert.match(email.html, /background: #15803d/)
})

test('service loader requests exact scope and fails closed on RPC errors or mismatched responses', async () => {
  const calls = []
  assert.deepEqual(await loadParentInviteBranding({ rpc: async (name, args) => {
    calls.push({ name, args }); return { data: display, error: null }
  } }, inviteLink), { ...display, buttonStyle: 'solid' })
  assert.deepEqual(calls, [{ name: 'read_parent_invite_branding', args: { team_value: 'team-a', club_value: 'club-a' } }])
  for (const result of [{ error: { message: 'unavailable' } }, { data: { ...display, teamId: 'other' } }]) {
    await assert.rejects(loadParentInviteBranding({ rpc: async () => result }, inviteLink), /could not be verified/)
  }
  assert.equal(await loadParentInviteBranding({ rpc: async () => ({ data: null }) }, inviteLink), null)
})

test('direct handler uses current server branding and ignores submitted artwork without contacting a provider', async () => {
  const source = (await readFile(new URL('../netlify/functions/send-parent-portal-invite.js', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?from '[^']+'\r?\n/gm, '').replace('export async function handler', 'async function handler')
  for (const denied of [false, true]) {
    const sent = []; const brandingCalls = []
    const link = { ...inviteLink, id: 'synthetic-link', player_id: 'synthetic-player', email: 'parent@example.test',
      status: 'pending', auth_user_id: 'synthetic-parent', players: { player_name: 'Synthetic Player', section: 'Squad', status: 'active' } }
    const client = {
      rpc: async (name, args) => { brandingCalls.push({ name, args }); return { data: display, error: null } },
      from: () => {
        const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: link }),
          update: () => ({ eq: async () => ({ error: null }) }) }
        return query
      },
    }
    const profile = { id: 'synthetic-actor', clubId: 'club-a', role: 'admin', roleRank: 90, name: 'Synthetic Coach' }
    const dependencies = {
      process: { env: { RESEND_API_KEY: 'synthetic', SUPABASE_SERVICE_ROLE_KEY: 'synthetic', VITE_SUPABASE_URL: 'https://example.test' } },
      randomUUID: () => 'synthetic-id', createFromAddress: name => `${name} <no-reply@example.test>`,
      getPublicEmailErrorMessage: () => 'Failed', sendEmail: async payload => { sent.push(payload); return { id: 'synthetic-result' } },
      createEmailDedupeKey: () => 'dedupe', createEmailIdempotencyKey: () => 'idempotency', createEmailRecipientDedupeKeys: () => [],
      createPendingEmailLog: async () => ({ record: { id: 'synthetic-log' } }), createServerAuditLog: async () => {},
      markEmailLogFailed: async () => {}, markEmailLogSent: async () => {}, supabaseAdmin: client,
      assertPlanFeature: () => { if (denied) throw Object.assign(new Error('Denied'), { statusCode: 403 }) },
      getAuthenticatedPlanProfile: async () => profile, getAuthenticatedRequestUser: async () => ({ id: profile.id, email: 'coach@example.test' }),
      loadParentInviteBranding, buildAuthoritativeParentInviteEmail: args => buildAuthoritativeParentInviteEmail({ ...args, fetchImpl }),
    }
    const handler = new Function(...Object.keys(dependencies), `${source}\nreturn handler`)(...Object.values(dependencies))
    const result = await handler({ httpMethod: 'POST', body: JSON.stringify({ inviteLinkId: link.id,
      brandingDisplay: { ...display, logoUrl: 'https://attacker.example.com/forged.png' }, teamLogoUrl: 'https://attacker.example.com/forged.png' }) })
    assert.equal(result.statusCode, denied ? 403 : 200)
    if (denied) { assert.deepEqual(sent, []); assert.deepEqual(brandingCalls, []) }
    else {
      assert.equal(sent.length, 1); assert.match(sent[0].html, /team\.png/); assert.match(sent[0].html, /background: #15803d/)
      assert.doesNotMatch(sent[0].html, /forged\.png/); assert.deepEqual(sent[0].to, ['parent@example.test'])
      assert.deepEqual(brandingCalls, [{ name: 'read_parent_invite_branding', args: { team_value: 'team-a', club_value: 'club-a' } }])
    }
  }
})
