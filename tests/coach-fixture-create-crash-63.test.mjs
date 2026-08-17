import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  createCoachFixtureForm,
  initializeCoachFixtureForm,
} from '../apps/mobile-core/src/coachFixtureCore.js'
import {
  getParentChatRoomTitle,
  getParentChatRoomTypeLabel,
  prepareParentChatRooms,
} from '../apps/parent-mobile/src/parentPresentationCore.js'

const source = async (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8')

test('fixture refresh preserves a Coach opponent and the full in-progress form', () => {
  const inProgress = {
    ...createCoachFixtureForm(),
    fixtureType: 'league',
    opponent: 'St Ives',
    selectedPlayerIds: ['player-1'],
  }
  const initialized = initializeCoachFixtureForm(inProgress, {
    defaultDuration: 60,
    defaultLocation: { address: 'New address', name: 'New venue' },
  })

  assert.equal(initialized, inProgress)
  assert.equal(initialized.opponent, 'St Ives')
  assert.equal(initialized.fixtureType, 'league')
  assert.deepEqual(initialized.selectedPlayerIds, ['player-1'])
})

test('fixture setup still applies saved defaults before the Coach starts editing', () => {
  const initialized = initializeCoachFixtureForm(null, {
    defaultDuration: 70,
    defaultLocation: { address: '1 Football Road', name: 'Home Ground' },
  })

  assert.equal(initialized.matchDurationMinutes, 70)
  assert.equal(initialized.venueName, 'Home Ground')
  assert.equal(initialized.venueAddress, '1 Football Road')
})

test('Coach Match Day returns to visible content after creating or cancelling a long fixture form', async () => {
  const [app, form, screen] = await Promise.all([
    source('../apps/coach-mobile/App.js'),
    source('../apps/coach-mobile/src/CoachFixtureForm.js'),
    source('../apps/coach-mobile/src/CoachMatchDayScreen.js'),
  ])

  assert.match(form, /setForm\(\(current\) => initializeCoachFixtureForm\(current,/)
  assert.match(form, /const submittedForm = \{[\s\S]*selectedPlayerIds: \[\.\.\.form\.selectedPlayerIds\]/)
  assert.match(app, /ref=\{contentScrollRef\}/)
  assert.match(app, /scrollTo\(\{ animated: false, y: 0 \}\)/)
  assert.match(screen, /handleFixtureCreated[\s\S]*setFixtureFormOpen\(false\)[\s\S]*onRequestScrollTop\?\.\(\)/)
  assert.match(screen, /onCancel=\{\(\) => \{ setFixtureFormOpen\(false\); onRequestScrollTop\?\.\(\) \}\}/)
})

test('Parent Chat uses Coach wording for the remaining parent_staff room labels', () => {
  const room = { title: 'Chat with Staff', type: 'parent_staff' }
  assert.equal(getParentChatRoomTypeLabel(room.type), 'Parent coach')
  assert.equal(getParentChatRoomTitle(room), 'Chat with Coach')
  assert.equal(prepareParentChatRooms([room])[0].title, 'Chat with Coach')
})

test('Parent Chat rendering uses the explicit Coach label instead of machine wording', async () => {
  const screens = await source('../apps/parent-mobile/src/ParentPortalScreens.js')
  assert.match(screens, /getParentChatRoomTypeLabel\(room\.type\)/)
  assert.doesNotMatch(screens, /labelize\(room\.type\)/)
})
