import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  loadAuthoritativeParentPortalInviteContext,
  markScheduledParentPortalInviteSent,
  prepareScheduledParentPortalInviteRow,
} from '../netlify/functions/lib/_parent-portal-invite-email.js'
import { reauthorizePreparedDevelopmentParentEmail } from '../netlify/functions/lib/_development-parent-email-output.js'
import { buildPreparedScheduledEmail } from '../netlify/functions/lib/_scheduled-email-payload.js'

const ids = {
  actor: '11111111-1111-4111-8111-111111111111',
  club: '22222222-2222-4222-8222-222222222222',
  existingLink: '33333333-3333-4333-8333-333333333333',
  link: '44444444-4444-4444-8444-444444444444',
  membership: '55555555-5555-4555-8555-555555555555',
  parentUser: '66666666-6666-4666-8666-666666666666',
  player: '77777777-7777-4777-8777-777777777777',
  queue: '88888888-8888-4888-8888-888888888888',
  team: '99999999-9999-4999-8999-999999999999',
}

function reachableImageResponse() {
  return {
    body: { cancel: async () => {} },
    headers: { get: () => 'image/png' },
    ok: true,
    status: 200,
  }
}

function createSupabaseFixture(tables) {
  return {
    from(tableName) {
      const filters = []
      let updateValues = null
      const builder = {
        eq(column, value) {
          filters.push((row) => String(row[column] ?? '') === String(value ?? ''))
          return builder
        },
        ilike(column, value) {
          filters.push((row) => String(row[column] ?? '').toLowerCase() === String(value ?? '').toLowerCase())
          return builder
        },
        is(column, value) {
          filters.push((row) => row[column] === value)
          return builder
        },
        limit() {
          return builder
        },
        maybeSingle: async () => {
          const row = (tables[tableName] || []).find((candidate) => filters.every((filter) => filter(candidate))) || null
          if (row && updateValues) Object.assign(row, updateValues)
          return { data: row, error: null }
        },
        neq(column, value) {
          filters.push((row) => String(row[column] ?? '') !== String(value ?? ''))
          return builder
        },
        not(column, operator, value) {
          assert.equal(operator, 'is')
          assert.equal(value, null)
          filters.push((row) => row[column] !== null && row[column] !== undefined)
          return builder
        },
        select() {
          return builder
        },
        update(values) {
          updateValues = values
          return builder
        },
      }

      return builder
    },
  }
}

function parentInviteFixture({ linkOverrides = {}, playerOverrides = {} } = {}) {
  const recipientEmail = 'parent@example.test'
  const row = {
    club_id: ids.club,
    created_by: ids.actor,
    id: ids.queue,
    payload: {
      parentPortalInvite: {
        linkId: ids.link,
        playerId: ids.player,
        type: 'coach_mobile_new_player',
      },
      resendPayload: {
        bcc: ['attacker@example.test'],
        cc: ['attacker@example.test'],
        from: 'Injected <attacker@example.test>',
        html: '<p>Untrusted invite</p>',
        replyTo: 'attacker@example.test',
        subject: 'Untrusted subject',
        to: ['attacker@example.test'],
      },
    },
    team_id: ids.team,
    to_email: recipientEmail,
  }
  const tables = {
    clubs: [{
      archived_at: null,
      contact_email: 'club@example.test',
      id: ids.club,
      logo_url: 'https://cdn.example.com/club.png',
      name: 'St Neots Town FC',
      status: 'active',
    }],
    parent_player_links: [
      {
        auth_user_id: null,
        club_id: ids.club,
        email: recipientEmail,
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        id: ids.link,
        invite_sent_at: null,
        invite_token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        invited_by: ids.actor,
        link_type: 'parent',
        player_id: ids.player,
        status: 'pending',
        team_id: ids.team,
        ...linkOverrides,
      },
      {
        auth_user_id: ids.parentUser,
        club_id: ids.club,
        email: recipientEmail,
        id: ids.existingLink,
        link_type: 'parent',
        player_id: 'aaaaaaaa-0000-4000-8000-000000000001',
        status: 'active',
        team_id: ids.team,
      },
    ],
    player_team_memberships: [{
      club_id: ids.club,
      ended_at: null,
      id: ids.membership,
      player_id: ids.player,
      status: 'active',
      team_id: ids.team,
    }],
    players: [{
      archived_at: null,
      club_id: ids.club,
      id: ids.player,
      player_name: 'Alex Player',
      section: 'Squad',
      status: 'promoted',
      ...playerOverrides,
    }],
    team_staff: [{ team_id: ids.team, user_id: ids.actor }],
    teams: [{ club_id: ids.club, id: ids.team, name: 'U14 Green' }],
    user_club_memberships: [{
      auth_user_id: ids.actor,
      club_id: ids.club,
      role: 'coach',
      role_rank: 20,
    }],
    users: [{
      club_id: ids.club,
      display_name: 'Test Coach',
      email: 'coach@example.test',
      id: ids.actor,
      name: 'Test Coach',
      role: 'coach',
      role_rank: 20,
      status: 'active',
      username: 'coach',
    }],
  }

  return { recipientEmail, row, tables }
}

test('scheduled Parent Portal invites are rebuilt from current authoritative data', async () => {
  const fixture = parentInviteFixture()
  const supabaseClient = createSupabaseFixture(fixture.tables)
  const context = await loadAuthoritativeParentPortalInviteContext(supabaseClient, fixture.row)
  const preparation = await prepareScheduledParentPortalInviteRow(fixture.row, {
    fetchImpl: async () => reachableImageResponse(),
    supabaseClient,
  })

  assert.equal(context.sendable, true)
  assert.equal(context.existingParentPortalUser, true)
  assert.equal(preparation.handled, true)
  assert.equal(preparation.skipped, false)
  assert.equal(preparation.row.subject, 'Family portal invite for Alex Player')
  assert.equal(preparation.row.payload.resendPayload.to[0], fixture.recipientEmail)
  assert.equal(Object.hasOwn(preparation.row.payload.resendPayload, 'bcc'), false)
  assert.equal(Object.hasOwn(preparation.row.payload.resendPayload, 'cc'), false)
  assert.equal(Object.hasOwn(preparation.row.payload.resendPayload, 'from'), false)
  assert.equal(Object.hasOwn(preparation.row.payload.resendPayload, 'replyTo'), false)
  assert.match(preparation.row.payload.resendPayload.html, /St Neots Town FC/)
  assert.match(preparation.row.payload.resendPayload.html, /Alex Player/)
  assert.match(preparation.row.payload.resendPayload.html, /Sign in to parent portal/)
  assert.doesNotMatch(preparation.row.payload.resendPayload.html, /Untrusted invite|attacker@example/)

  const preparedEmail = buildPreparedScheduledEmail(
    preparation.row,
    { clubId: ids.club },
    { fromDisplayName: preparation.email.fromDisplayName },
  )
  assert.match(preparedEmail.emailPayload.from, /^Test Coach \(U14 Green - St Neots Town FC\) </)
  assert.deepEqual(preparedEmail.emailPayload.to, [fixture.recipientEmail])
})

test('stale or inactive Parent Portal invite authority fails closed', async () => {
  for (const fixture of [
    parentInviteFixture({ linkOverrides: { invite_sent_at: new Date().toISOString() } }),
    parentInviteFixture({ linkOverrides: { status: 'revoked' } }),
    parentInviteFixture({ playerOverrides: { archived_at: new Date().toISOString() } }),
  ]) {
    const preparation = await prepareScheduledParentPortalInviteRow(fixture.row, {
      supabaseClient: createSupabaseFixture(fixture.tables),
    })
    assert.equal(preparation.handled, true)
    assert.equal(preparation.skipped, true)
    assert.match(preparation.skipReason, /authoritative_scope_inactive/)
  }
})

test('provider acceptance is recorded on the exact pending Parent Portal link', async () => {
  const fixture = parentInviteFixture()
  await markScheduledParentPortalInviteSent(
    createSupabaseFixture(fixture.tables),
    fixture.row,
  )
  assert.ok(fixture.tables.parent_player_links[0].invite_sent_at)
  assert.equal(fixture.tables.parent_player_links[1].invite_sent_at, undefined)
})

test('scheduled Parent Portal invites bypass only the unrelated Development recipient route', async () => {
  const fixture = parentInviteFixture()
  const preparation = await prepareScheduledParentPortalInviteRow(fixture.row, {
    fetchImpl: async () => reachableImageResponse(),
    supabaseClient: createSupabaseFixture(fixture.tables),
  })
  const preparedEmail = buildPreparedScheduledEmail(
    preparation.row,
    {
      clubId: ids.club,
      role: 'system',
      roleRank: 100,
      teamId: ids.team,
    },
    { fromDisplayName: preparation.email.fromDisplayName },
  )

  const authorizedEmail = await reauthorizePreparedDevelopmentParentEmail(null, preparedEmail)

  assert.equal(authorizedEmail, preparedEmail)
  await assert.rejects(
    reauthorizePreparedDevelopmentParentEmail(null, {
      ...preparedEmail,
      storedPayload: {
        ...preparedEmail.storedPayload,
        outputKey: 'parent-portal-invite:wrong-link',
      },
    }),
    (error) => error.code === 'PARENT_PORTAL_INVITE_STORED_CONTEXT_INVALID',
  )
})

test('processor keeps Parent Portal invites email-only and rechecks both plan capabilities', async () => {
  const processor = await readFile(
    new URL('../netlify/functions/process-scheduled-emails.js', import.meta.url),
    'utf8',
  )
  assert.match(processor, /isParentPortalInvite[\s\S]*\? 'email'/)
  assert.match(processor, /assertTrustedSystemPlanFeature\(planProfile, 'parentEmails'\)/)
  assert.match(processor, /teamId: String\(lockedRow\.team_id \?\? ''\)\.trim\(\)/)
  assert.match(processor, /activeTeamId: String\(lockedRow\.team_id \?\? ''\)\.trim\(\)/)
  assert.match(processor, /playerId: String\(lockedRow\.payload\?\.parentPortalInvite\?\.playerId \?\? ''\)\.trim\(\)/)
  assert.match(processor, /assertTrustedSystemPlanFeature\(planProfile, 'parentInvitations'\)/)
  assert.match(processor, /markScheduledParentPortalInviteSent/)
})

test('release migrations keep the new trigger disabled until the compatible worker is live', async () => {
  const [installMigration, enableMigration] = await Promise.all([
    readFile(
      new URL('../supabase/migrations/20260823161252_coach_mobile_auto_parent_portal_invite.sql', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL('../supabase/migrations/20260823163137_coach_mobile_auto_parent_portal_invite_enable.sql', import.meta.url),
      'utf8',
    ),
  ])
  assert.match(installMigration, /disable trigger zz_players_enqueue_coach_mobile_parent_portal_invites/i)
  assert.match(enableMigration, /enable trigger zz_players_enqueue_coach_mobile_parent_portal_invites/i)
})
