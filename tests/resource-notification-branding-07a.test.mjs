import assert from 'node:assert/strict'
import { test } from 'node:test'

import { sendEmail } from '../netlify/functions/lib/_email-provider.js'
import {
  loadAuthoritativeResourceNotificationContext,
  prepareScheduledResourceNotificationRow,
} from '../netlify/functions/lib/_resource-notification-email.js'
import { buildPreparedScheduledEmail } from '../netlify/functions/lib/_scheduled-email-payload.js'
import {
  buildAuthoritativeResourceNotificationEmail,
  RESOURCE_NOTIFICATION_PARENT_PORTAL_URL,
} from '../src/lib/resource-notification-email.js'

const ids = {
  club: '11111111-1111-4111-8111-111111111111',
  link: '22222222-2222-4222-8222-222222222222',
  notification: '33333333-3333-4333-8333-333333333333',
  parentLink: '44444444-4444-4444-8444-444444444444',
  parentUser: '55555555-5555-4555-8555-555555555555',
  player: '66666666-6666-4666-8666-666666666666',
  queue: '77777777-7777-4777-8777-777777777777',
  resource: '88888888-8888-4888-8888-888888888888',
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

function createSupabaseFixture(tables, tableErrors = {}) {
  return {
    from(tableName) {
      const filters = []
      const builder = {
        eq(column, value) {
          filters.push({ column, value })
          return builder
        },
        maybeSingle: async () => {
          if (tableErrors[tableName]) {
            return { data: null, error: tableErrors[tableName] }
          }

          const matchingRows = (tables[tableName] || []).filter((row) => (
            filters.every(({ column, value }) => String(row[column] ?? '') === String(value ?? ''))
          ))

          return {
            data: matchingRows[0] || null,
            error: null,
          }
        },
        select() {
          return builder
        },
      }

      return builder
    },
  }
}

function resourceNotificationFixture({
  linkOverrides = {},
  parentLinkOverrides = {},
} = {}) {
  const recipientEmail = 'delivered+fp07a@resend.dev'
  const row = {
    club_id: ids.club,
    id: ids.queue,
    payload: {
      displayName: 'Football Player',
      resendPayload: {
        html: '<p>Legacy resource notification</p>',
        replyTo: 'staff-personal@example.test',
        subject: 'Legacy subject',
        to: [recipientEmail],
      },
      resourceNotification: {
        type: 'resource_shared',
      },
    },
    subject: 'Legacy subject',
    team_id: ids.team,
    to_email: recipientEmail,
  }
  const tables = {
    clubs: [{
      id: ids.club,
      logo_url: 'https://cdn.example.com/club-logo.png',
      name: 'St Neots Town FC',
    }],
    parent_player_links: [{
      auth_user_id: ids.parentUser,
      club_id: ids.club,
      email: recipientEmail,
      id: ids.parentLink,
      player_id: ids.player,
      status: 'active',
      team_id: ids.team,
      ...parentLinkOverrides,
    }],
    players: [{
      archived_at: null,
      club_id: ids.club,
      id: ids.player,
      player_name: 'Alex Player',
      status: 'active',
      team_id: ids.team,
    }],
    resource_library_items: [{
      archived_at: null,
      club_id: ids.club,
      id: ids.resource,
      team_id: ids.team,
      title: 'Match preparation guide',
    }],
    resource_library_links: [{
      club_id: ids.club,
      id: ids.link,
      linked_id: ids.player,
      linked_type: 'player',
      parent_visible: true,
      removed_at: null,
      resource_id: ids.resource,
      share_description: 'Please review before Saturday.',
      team_id: ids.team,
      ...linkOverrides,
    }],
    resource_library_parent_notifications: [{
      club_id: ids.club,
      email_queue_id: ids.queue,
      id: ids.notification,
      link_id: ids.link,
      parent_link_id: ids.parentLink,
      player_id: ids.player,
      recipient_email: recipientEmail,
      resource_id: ids.resource,
      team_id: ids.team,
    }],
    teams: [{
      club_id: ids.club,
      id: ids.team,
      name: 'U17 Green',
      notification_display_name: 'U17G',
    }],
  }

  return { recipientEmail, row, tables }
}

test('club-branded resource email keeps the recipient hierarchy and trusted portal action', async () => {
  const email = await buildAuthoritativeResourceNotificationEmail({
    clubLogoUrl: 'https://cdn.example.com/st-neots.png',
    clubName: 'St Neots Town FC',
    fetchImpl: async () => reachableImageResponse(),
    playerName: 'Alex Player',
    resourceDescription: 'Please review before Saturday.',
    resourceTitle: 'Match preparation guide',
    teamName: 'U17 Green',
  })

  assert.equal(email.fromDisplayName, 'St Neots Town FC via Football Player')
  assert.equal(email.subject, 'St Neots Town FC shared a new resource for Alex Player')
  assert.equal(email.logoSource, 'club')
  assert.match(email.html, /src="https:\/\/cdn\.example\.com\/st-neots\.png"/)
  assert.match(email.html, /alt="St Neots Town FC logo"/)
  assert.match(email.html, /St Neots Town FC/)
  assert.match(email.html, /U17 Green/)
  assert.match(email.html, /Alex Player/)
  assert.match(email.html, /Match preparation guide/)
  assert.match(email.html, /Please review before Saturday\./)
  assert.match(email.html, new RegExp(RESOURCE_NOTIFICATION_PARENT_PORTAL_URL.replaceAll('?', '\\?')))
  assert.match(email.html, /Delivered securely through Footballplayer\.online\./)
  assert.doesNotMatch(email.html, /storage\/v1|resourceId|parentLinkId|service_role/i)
})

test('invalid, absent and unavailable club logos use the Football Player fallback', async () => {
  const cases = [
    {
      clubLogoUrl: '',
      fetchImpl: async () => {
        throw new Error('fetch should not run for an absent URL')
      },
    },
    {
      clubLogoUrl: 'http://insecure.example.com/logo.png',
      fetchImpl: async () => {
        throw new Error('fetch should not run for an insecure URL')
      },
    },
    {
      clubLogoUrl: 'https://cdn.example.com/missing.png',
      fetchImpl: async () => ({
        body: { cancel: async () => {} },
        headers: { get: () => 'text/html' },
        ok: false,
        status: 404,
      }),
    },
  ]

  for (const testCase of cases) {
    const email = await buildAuthoritativeResourceNotificationEmail({
      ...testCase,
      clubName: 'Fallback FC',
      playerName: 'Fallback Child',
      resourceTitle: 'Fallback Resource',
      teamName: 'Fallback Team',
    })

    assert.equal(email.logoSource, 'football-player')
    assert.match(email.html, /footballplayer\.online\/football-player-logo\.png/)
    assert.match(email.html, /alt="Football Player logo"/)
    assert.match(email.html, /Fallback FC/)
    assert.match(email.html, /Fallback Team/)
  }
})

test('resource notification copy escapes body content and removes unsafe header controls', async () => {
  const email = await buildAuthoritativeResourceNotificationEmail({
    clubName: 'Long Club <script>\nInjected',
    fetchImpl: async () => reachableImageResponse(),
    playerName: 'Child & One',
    resourceDescription: '<img src=x onerror=alert(1)>',
    resourceTitle: 'Guide "A"',
    teamName: 'Team > One',
  })

  assert.doesNotMatch(email.subject, /[\r\n]/)
  assert.doesNotMatch(email.fromDisplayName, /[\r\n<>]/)
  assert.match(email.html, /Long Club scriptInjected/)
  assert.match(email.html, /Child &amp; One/)
  assert.match(email.html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.doesNotMatch(email.html, /<script>|<img src=x/)
})

test('processor reloads exact authoritative notification context and replaces legacy payload', async () => {
  const fixture = resourceNotificationFixture()
  const supabaseClient = createSupabaseFixture(fixture.tables)
  const preparation = await prepareScheduledResourceNotificationRow(fixture.row, {
    fetchImpl: async () => reachableImageResponse(),
    supabaseClient,
  })

  assert.equal(preparation.handled, true)
  assert.equal(preparation.skipped, false)
  assert.equal(preparation.row.payload.clubName, 'St Neots Town FC')
  assert.equal(preparation.row.payload.teamName, 'U17G')
  assert.equal(preparation.row.payload.playerName, 'Alex Player')
  assert.equal(preparation.email.fromDisplayName, 'St Neots Town FC via Football Player')
  assert.equal(Object.hasOwn(preparation.row.payload, 'fromDisplayName'), false)
  assert.equal(preparation.row.payload.resendPayload.to[0], fixture.recipientEmail)
  assert.equal(Object.hasOwn(preparation.row.payload.resendPayload, 'replyTo'), false)
  assert.equal(Object.hasOwn(preparation.row.payload.resendPayload, 'reply_to'), false)
  assert.match(preparation.row.payload.resendPayload.html, /Please review before Saturday\./)
  assert.doesNotMatch(preparation.row.payload.resendPayload.html, /Legacy resource notification/)

  const prepared = buildPreparedScheduledEmail(
    preparation.row,
    { clubId: ids.club },
    { fromDisplayName: preparation.email.fromDisplayName },
  )
  const providerCalls = []

  await sendEmail(prepared.emailPayload, {
    env: {
      RESEND_API_KEY: 're_test_key',
      RESEND_FROM_EMAIL: 'feedback@footballplayer.online',
    },
    resendClient: {
      emails: {
        send: async (payload) => {
          providerCalls.push(payload)
          return { data: { id: 'email_fp07a' } }
        },
      },
    },
  })

  assert.equal(providerCalls.length, 1)
  assert.equal(
    providerCalls[0].from,
    'St Neots Town FC via Football Player <feedback@footballplayer.online>',
  )
  assert.equal(providerCalls[0].replyTo, undefined)
})

test('unshared and wrong-Parent contexts fail closed before provider preparation', async () => {
  for (const fixture of [
    resourceNotificationFixture({
      linkOverrides: { parent_visible: false },
    }),
    resourceNotificationFixture({
      parentLinkOverrides: { email: 'another-parent@example.test' },
    }),
  ]) {
    const supabaseClient = createSupabaseFixture(fixture.tables)
    const context = await loadAuthoritativeResourceNotificationContext(
      supabaseClient,
      fixture.row,
    )
    const preparation = await prepareScheduledResourceNotificationRow(fixture.row, {
      fetchImpl: async () => reachableImageResponse(),
      supabaseClient,
    })

    assert.equal(context.sendable, false)
    assert.equal(preparation.handled, true)
    assert.equal(preparation.skipped, true)
    assert.match(preparation.skipReason, /authoritative_scope_inactive/)
  }
})

test('non-resource scheduled email payloads preserve their established sender behavior', async () => {
  const row = {
    club_id: ids.club,
    id: ids.queue,
    payload: {
      clubName: 'Calendar Club',
      displayName: 'Coach Name',
      fromDisplayName: 'Untrusted Club via Football Player',
      resendPayload: {
        html: '<p>Calendar update</p>',
        subject: 'Calendar update',
        to: ['parent@example.test'],
      },
      teamName: 'Calendar Team',
    },
    team_id: ids.team,
    to_email: 'parent@example.test',
  }
  const preparation = await prepareScheduledResourceNotificationRow(row, {
    supabaseClient: createSupabaseFixture({}),
  })
  const prepared = buildPreparedScheduledEmail(preparation.row, { clubId: ids.club })

  assert.equal(preparation.handled, false)
  assert.match(prepared.emailPayload.from, /^Coach Name \(Calendar Team - Calendar Club\) </)
})
