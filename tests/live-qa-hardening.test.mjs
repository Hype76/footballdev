import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  canAddStaffAccessEmail,
  getUniqueStaffAccessEmails,
  PLAN_KEYS,
} from '../src/lib/plans.js'
import {
  buildPlayerDirectEmailPayload,
  getEmailReadyContactsForAudience,
  isValidContactEmail,
} from '../src/hooks/players/playerProfileUtils.js'
import {
  EMAIL_TEMPLATE_AUDIENCES,
} from '../src/lib/email-templates.js'
import {
  PLAYER_CONTACT_TYPES,
} from '../src/lib/domain/contact-utils.js'

const parentTemplate = {
  key: 'direct_parent',
  label: 'Parent direct',
  audience: EMAIL_TEMPLATE_AUDIENCES.parent,
  subject: 'Update for {{playerName}}',
  body: 'Hello {{parentName}}, update for {{playerName}}.',
}

test('setup checklist session modal exposes and submits a start time', async () => {
  const source = await readFile(new URL('../src/components/onboarding/OnboardingProvider.jsx', import.meta.url), 'utf8')

  assert.match(source, /const \[sessionStartTime, setSessionStartTime\] = useState\('09:00'\)/)
  assert.match(source, /startTime: sessionStartTime/)
  assert.match(source, /Start time/)
  assert.match(source, /type="time" value=\{sessionStartTime\}/)
})

test('visible legacy parent email can be used for direct player invite email', () => {
  const payload = buildPlayerDirectEmailPayload({
    audience: EMAIL_TEMPLATE_AUDIENCES.parent,
    contacts: [{ name: 'Simon Bailey', parentEmail: 'simondanielbailey@gmail.com', type: PLAYER_CONTACT_TYPES.parent }],
    player: {
      id: 'player-1',
      playerName: 'Test Player',
      parentName: 'Simon Bailey',
      team: 'U12',
      section: 'Squad',
    },
    routePlayerName: 'Test Player',
    selectedTemplate: parentTemplate,
    user: {
      clubId: 'club-1',
      id: 'user-1',
      clubName: 'QA FC',
      email: 'coach@example.com',
    },
  })

  assert.equal(payload.recipientEmails, 'simondanielbailey@gmail.com')
  assert.equal(payload.payloads.length, 1)
})

test('audience mismatch falls back to available visible contact email', () => {
  const contacts = [{ name: 'Guardian', email: 'guardian@example.com', type: PLAYER_CONTACT_TYPES.parent }]
  const result = getEmailReadyContactsForAudience(contacts, PLAYER_CONTACT_TYPES.self)

  assert.equal(result.length, 1)
  assert.equal(result[0].email, 'guardian@example.com')
})

test('missing or invalid contact email is rejected clearly', () => {
  assert.equal(isValidContactEmail('guardian@example.com'), true)
  assert.equal(isValidContactEmail('not-an-email'), false)

  assert.throws(
    () => buildPlayerDirectEmailPayload({
      audience: EMAIL_TEMPLATE_AUDIENCES.parent,
      contacts: [{ name: 'Guardian', email: 'not-an-email', type: PLAYER_CONTACT_TYPES.parent }],
      player: { id: 'player-1', playerName: 'Test Player' },
      routePlayerName: 'Test Player',
      selectedTemplate: parentTemplate,
      user: { clubId: 'club-1', id: 'user-1' },
    }),
    /Check this contact email before sending: not-an-email/,
  )

  assert.throws(
    () => buildPlayerDirectEmailPayload({
      audience: EMAIL_TEMPLATE_AUDIENCES.parent,
      contacts: [],
      player: { id: 'player-1', playerName: 'Test Player' },
      routePlayerName: 'Test Player',
      selectedTemplate: parentTemplate,
      user: { clubId: 'club-1', id: 'user-1' },
    }),
    /Add an email contact before sending\./,
  )
})

test('single team staff access counts active and pending unique emails', () => {
  const singleTeamUser = {
    planKey: PLAN_KEYS.singleTeam,
    planStatus: 'active',
  }
  const members = [
    { email: 'owner@example.com' },
    { email: 'coach@example.com' },
  ]
  const invites = [
    { email: 'pending@example.com' },
    { email: 'coach@example.com' },
  ]

  assert.equal(getUniqueStaffAccessEmails(members, invites).size, 3)
  assert.equal(canAddStaffAccessEmail(singleTeamUser, 'pending@example.com', members, invites), true)
  assert.equal(canAddStaffAccessEmail(singleTeamUser, 'coach@example.com', members, invites), true)
  assert.equal(canAddStaffAccessEmail(singleTeamUser, 'new@example.com', members, invites), false)
  assert.equal(
    canAddStaffAccessEmail({ ...singleTeamUser, planKey: PLAN_KEYS.smallClub }, 'new@example.com', members, invites),
    true,
  )
})
