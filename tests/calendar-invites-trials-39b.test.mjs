import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  buildAuthoritativeCalendarNotificationEmail,
  buildCalendarNotificationHtml,
  resolveCalendarEmailAccent,
} from '../src/lib/calendar-notification-email.js'
import {
  loadAuthoritativeCalendarNotificationContext,
  prepareScheduledCalendarNotificationRow,
} from '../netlify/functions/lib/_calendar-notification-email.js'

const ids = {
  club: '11111111-1111-4111-8111-111111111111',
  command: '22222222-2222-4222-8222-222222222222',
  event: '33333333-3333-4333-8333-333333333333',
  guardian: '44444444-4444-4444-8444-444444444444',
  invitation: '55555555-5555-4555-8555-555555555555',
  link: '66666666-6666-4666-8666-666666666666',
  player: '77777777-7777-4777-8777-777777777777',
  queue: '88888888-8888-4888-8888-888888888888',
  team: '99999999-9999-4999-8999-999999999999',
}

const rawToken = 'a'.repeat(64)
const tokenHash = createHash('sha256').update(rawToken).digest('hex')

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

function trialNotificationFixture({
  invitationOverrides = {},
  parentLinkOverrides = {},
  playerOverrides = {},
} = {}) {
  const recipientEmail = 'delivered+fp39b@resend.dev'
  const row = {
    club_id: ids.club,
    id: ids.queue,
    payload: {
      communicationLog: {
        metadata: {
          notificationCommandId: ids.command,
          notificationType: 'creation',
          source: 'calendar_trial_event_notification',
        },
      },
      resendPayload: {
        html: '<p>Placeholder</p>',
        subject: 'Placeholder',
        to: [recipientEmail],
      },
      trialEventInvitation: {
        id: ids.invitation,
        rawToken,
        type: 'calendar_trial_event_invitation',
      },
    },
    subject: 'Placeholder',
    team_id: ids.team,
    to_email: recipientEmail,
  }
  const tables = {
    calendar_events: [{
      cancelled_at: null,
      club_id: ids.club,
      ends_at: '2026-08-02T11:00:00.000Z',
      event_type: 'training',
      id: ids.event,
      location: 'Training Ground',
      notes: 'Bring water',
      parent_audience: 'involved_players',
      parent_visible: true,
      starts_at: '2026-08-02T10:00:00.000Z',
      team_id: ids.team,
      title: 'Trial training',
    }],
    calendar_trial_event_invitations: [{
      calendar_event_id: ids.event,
      club_id: ids.club,
      email_queue_id: ids.queue,
      expires_at: '2099-08-12T10:00:00.000Z',
      guardian_id: ids.guardian,
      id: ids.invitation,
      match_day_id: null,
      notification_command_id: ids.command,
      parent_link_id: ids.link,
      player_id: ids.player,
      recipient_email: recipientEmail,
      recipient_name: 'Taylor Guardian',
      revoked_at: null,
      status: 'queued',
      team_id: ids.team,
      token_hash: tokenHash,
      ...invitationOverrides,
    }],
    clubs: [{
      id: ids.club,
      logo_url: 'https://cdn.example.com/st-neots.png',
      name: 'St Neots Town FC',
      theme_accent: 'blue',
    }],
    guardians: [{
      club_id: ids.club,
      email: recipientEmail,
      first_name: 'Taylor',
      id: ids.guardian,
      last_name: 'Guardian',
      status: 'active',
    }],
    parent_player_links: [{
      auth_user_id: null,
      club_id: ids.club,
      email: recipientEmail,
      guardian_id: ids.guardian,
      id: ids.link,
      player_id: ids.player,
      receives_communications: true,
      status: 'uninvited',
      team_id: ids.team,
      ...parentLinkOverrides,
    }],
    players: [{
      club_id: ids.club,
      id: ids.player,
      player_name: 'Jordan Trial',
      section: 'Trial',
      status: 'active',
      team_id: ids.team,
      ...playerOverrides,
    }],
    teams: [{
      club_id: ids.club,
      id: ids.team,
      name: 'U16 Blue',
    }],
  }

  return { recipientEmail, row, tables }
}

test('new-event choices cover every supported user-facing type and omit pseudo-event creation', async () => {
  const [sessionsPage, domain, migration] = await Promise.all([
    readFile(new URL('../src/pages/SessionsPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/domain/calendar-events.js', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260728103000_calendar_invites_trials_v1.sql', import.meta.url), 'utf8'),
  ])

  for (const eventType of ['training', 'match', 'meeting', 'tournament', 'social', 'general', 'other']) {
    assert.match(sessionsPage, new RegExp(`value: '${eventType}'`))
    assert.match(domain, new RegExp(`'${eventType}'`))
  }

  const optionsSource = sessionsPage.slice(
    sessionsPage.indexOf('const EVENT_TYPE_OPTIONS'),
    sessionsPage.indexOf('const RECURRENCE_OPTIONS'),
  )
  assert.doesNotMatch(optionsSource, /availability_deadline|parent_cutoff/)
  assert.match(domain, /const LEGACY_EVENT_TYPES = \['availability_deadline', 'parent_cutoff'\]/)
  assert.match(domain, /assertUserFacingEventType/)
  assert.match(migration, /tg_op = 'INSERT'[\s\S]*supported user-facing event type/i)
  assert.match(migration, /tg_op = 'UPDATE'[\s\S]*new\.event_type is distinct from old\.event_type/i)
})

test('notification choice defaults off and preserves the saved player scope', async () => {
  const sessionsPage = await readFile(new URL('../src/pages/SessionsPage.jsx', import.meta.url), 'utf8')
  const inviteFieldsSource = sessionsPage.slice(
    sessionsPage.indexOf('function getFormInviteFields'),
    sessionsPage.indexOf('function getFormFromCalendarEvent'),
  )

  assert.match(sessionsPage, /notifyInvitedFamilies: false/)
  assert.match(sessionsPage, /notificationRequestToken: ''/)
  assert.match(inviteFieldsSource, /invitedPlayerIds: eventInvites\.map\(\(invite\) => invite\.playerId\)/)
  assert.match(inviteFieldsSource, /notifyInvitedFamilies: false/)
  assert.match(sessionsPage, /name="notifyInvitedFamilies"/)
  assert.match(sessionsPage, /current\.notificationRequestToken \|\| createNotificationRequestToken\(\)/)
})

test('club-branded event email includes identity, accent, context, instructions, and a safe fallback', async () => {
  const branded = await buildAuthoritativeCalendarNotificationEmail({
    clubLogoUrl: 'https://cdn.example.com/st-neots.png',
    clubName: 'St Neots Town FC',
    endsAt: '2026-08-02T11:00:00.000Z',
    eventTitle: 'Trial training',
    eventType: 'Training',
    fetchImpl: async () => reachableImageResponse(),
    location: 'Training Ground',
    notes: 'Bring water',
    parentName: 'Taylor Guardian',
    playerName: 'Jordan Trial',
    responseUrl: 'https://footballplayer.online/.netlify/functions/calendar-trial-rsvp?token=safe',
    startsAt: '2026-08-02T10:00:00.000Z',
    teamName: 'U16 Blue',
    themeAccent: 'blue',
    trialInvitation: true,
  })

  assert.equal(branded.fromDisplayName, 'St Neots Town FC via Football Player')
  assert.equal(branded.logoSource, 'club')
  assert.match(branded.html, /St Neots Town FC/)
  assert.match(branded.html, /U16 Blue/)
  assert.match(branded.html, /Trial training/)
  assert.match(branded.html, /Training Ground/)
  assert.match(branded.html, /Respond to invitation/)
  assert.match(branded.html, /only for this event and this trial player/i)
  assert.doesNotMatch(branded.html, /Parent Portal/)

  const fallback = await buildAuthoritativeCalendarNotificationEmail({
    clubLogoUrl: '',
    clubName: 'Fallback FC',
    eventTitle: 'Meeting',
    fetchImpl: async () => {
      throw new Error('No club logo probe expected')
    },
    startsAt: '2026-08-02T10:00:00.000Z',
    teamName: 'Fallback Team',
  })

  assert.equal(fallback.logoSource, 'football-player')
  assert.match(fallback.html, /footballplayer\.online\/football-player-logo\.png/)
  assert.equal(resolveCalendarEmailAccent('#123abc'), '#123abc')
  assert.equal(resolveCalendarEmailAccent('unknown'), '#047857')
})

test('event email escapes content and keeps club branding ahead of platform attribution', () => {
  const html = buildCalendarNotificationHtml({
    clubName: 'Club <script>',
    eventTitle: 'Meeting & briefing',
    eventType: 'Meeting',
    notes: '<img src=x onerror=alert(1)>',
    parentName: 'Guardian',
    playerName: 'Player',
    startsAt: '2026-08-02T10:00:00.000Z',
    teamName: 'Team > One',
    themeAccent: 'red',
  })

  assert.match(html, /Club script/)
  assert.match(html, /Meeting &amp; briefing/)
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.doesNotMatch(html, /<script>|<img src=x/)
  assert.ok(html.indexOf('Club script') < html.indexOf('Footballplayer.online'))
})

test('trial delivery reloads exact scope and produces a single-event response link', async () => {
  const fixture = trialNotificationFixture()
  const supabaseClient = createSupabaseFixture(fixture.tables)
  const context = await loadAuthoritativeCalendarNotificationContext(supabaseClient, fixture.row)
  const preparation = await prepareScheduledCalendarNotificationRow(fixture.row, {
    fetchImpl: async () => reachableImageResponse(),
    supabaseClient,
  })

  assert.equal(context.sendable, true)
  assert.equal(context.trialInvitation, true)
  assert.equal(context.recipientEmail, fixture.recipientEmail)
  assert.match(context.responseUrl, new RegExp(`token=${rawToken}`))
  assert.equal(preparation.handled, true)
  assert.equal(preparation.skipped, false)
  assert.equal(preparation.email.fromDisplayName, 'St Neots Town FC via Football Player')
  assert.match(preparation.row.payload.resendPayload.html, /Jordan Trial/)
  assert.match(preparation.row.payload.resendPayload.html, /Respond to invitation/)
  assert.doesNotMatch(preparation.row.payload.resendPayload.html, /Parent Portal/)
})

test('wrong token, expired contact, portal-linked contact, wrong player, and cross-club scope fail closed', async () => {
  const cases = [
    trialNotificationFixture({
      invitationOverrides: { token_hash: 'b'.repeat(64) },
    }),
    trialNotificationFixture({
      invitationOverrides: { expires_at: '2000-01-01T00:00:00.000Z' },
    }),
    trialNotificationFixture({
      parentLinkOverrides: { auth_user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'active' },
    }),
    trialNotificationFixture({
      playerOverrides: { section: 'Squad' },
    }),
    trialNotificationFixture({
      parentLinkOverrides: { club_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    }),
  ]

  for (const fixture of cases) {
    const context = await loadAuthoritativeCalendarNotificationContext(
      createSupabaseFixture(fixture.tables),
      fixture.row,
    )

    assert.equal(context.sendable, false)
  }
})

test('migration and public RSVP endpoint keep trial invitations non-portal, scoped, revocable, and auditable', async () => {
  const [migration, boundaryMigration, endpoint, processor] = await Promise.all([
    readFile(new URL('../supabase/migrations/20260728103000_calendar_invites_trials_v1.sql', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260728104500_calendar_trial_rsvp_service_boundary.sql', import.meta.url), 'utf8'),
    readFile(new URL('../netlify/functions/calendar-trial-rsvp.js', import.meta.url), 'utf8'),
    readFile(new URL('../netlify/functions/process-scheduled-emails.js', import.meta.url), 'utf8'),
  ])

  assert.match(migration, /token_hash text not null/)
  assert.match(migration, /extensions\.gen_random_bytes\(32\)/)
  assert.match(migration, /extensions\.digest\(raw_token_value, 'sha256'\)/)
  assert.match(migration, /link\.status = 'uninvited'/)
  assert.match(migration, /link\.auth_user_id is null/)
  assert.match(migration, /link\.receives_communications is true/)
  assert.match(migration, /guardian\.status = 'active'/)
  assert.match(migration, /status = 'revoked'/)
  assert.match(migration, /calendar_trial_event_response_recorded/)
  assert.match(migration, /grant execute on function public\.get_calendar_trial_event_response\(text\)[\s\S]*to anon, authenticated, service_role/)
  assert.match(migration, /grant execute on function public\.submit_calendar_trial_event_response\(text, text\)[\s\S]*to anon, authenticated, service_role/)
  assert.doesNotMatch(migration, /create user|auth\.admin|parent_portal_invite/i)
  assert.match(boundaryMigration, /revoke all on function public\.get_calendar_trial_event_response\(text\)[\s\S]*from public, anon, authenticated/)
  assert.match(boundaryMigration, /grant execute on function public\.get_calendar_trial_event_response\(text\)[\s\S]*to service_role/)
  assert.match(boundaryMigration, /revoke all on function public\.submit_calendar_trial_event_response\(text, text\)[\s\S]*from public, anon, authenticated/)
  assert.match(boundaryMigration, /grant execute on function public\.submit_calendar_trial_event_response\(text, text\)[\s\S]*to service_role/)
  assert.match(endpoint, /createSupabaseAdminClient/)
  assert.match(endpoint, /does not create a Parent Portal account/)
  assert.match(endpoint, /Content-Security-Policy/)
  assert.match(endpoint, /Referrer-Policy/)
  assert.match(endpoint, /\^\[0-9a-f\]\{64\}\$/)
  assert.match(processor, /calendar_trial_event_invitations/)
  assert.match(processor, /rawToken: null/)
})
