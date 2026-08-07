import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('current and completed player routes use the compact focused-player workspace', async () => {
  const [routerSource, pageSource, listSource] = await Promise.all([
    readSource('src/app/router.jsx'),
    readSource('src/pages/PlayersPage.jsx'),
    readSource('src/components/players/PlayersListSection.jsx'),
  ])

  assert.match(routerSource, /path: 'players\/current'[\s\S]*<PlayersPage compactMode/)
  assert.match(routerSource, /path: 'assess-player\/completed'[\s\S]*<PlayersPage[\s\S]*compactMode[\s\S]*defaultView="evaluated"/)
  assert.match(pageSource, /searchParams\.get\('player'\)/)
  assert.match(pageSource, /params\.set\('player', nextPlayerKey\)/)
  assert.match(pageSource, /compactMode[\s\S]*focusedPlayer \? \[focusedPlayer\] : \[\]/)
  assert.match(listSource, /Player in focus/)
  assert.match(listSource, /onRemoveFromTeam\(event, player\)/)
  assert.match(listSource, /onMovePlayerToTrial\(event, player\)/)
  assert.match(listSource, /Open profile/)
})

test('poll create and reply tasks are separate URL-addressable workspaces', async () => {
  const source = await readSource('src/pages/PollsPage.jsx')

  assert.match(source, /searchParams\.get\('view'\) === 'create'/)
  assert.match(source, /nextParams\.set\('view', 'create'\)/)
  assert.match(source, /nextParams\.delete\('view'\)/)
  assert.match(source, /workspaceView === 'create' \? <section/)
  assert.match(source, /workspaceView === 'board' \? <section/)
  assert.match(source, /Create poll/)
  assert.match(source, /handleStatusChange/)
  assert.match(source, /handleDeletePoll/)
  assert.match(source, /handleVote/)
})

test('development record starts with optional long sections collapsed but available', async () => {
  const [fieldsSource, submitSource] = await Promise.all([
    readSource('src/components/evaluations/ConfiguredFieldsSection.jsx'),
    readSource('src/components/evaluations/SubmitExportSection.jsx'),
  ])

  assert.match(fieldsSource, /defaultCollapsed/)
  assert.match(fieldsSource, /development-record-fields-v3/)
  assert.match(submitSource, /defaultCollapsed/)
  assert.match(submitSource, /development-record-submit-v3/)
  assert.match(submitSource, /Save Draft/)
  assert.match(submitSource, /type="submit"/)
  assert.match(submitSource, /submitActionLabel/)
})

test('settings areas use URL state and render one task area at a time', async () => {
  const source = await readSource('src/pages/UserSettingsPage.jsx')

  assert.match(source, /searchParams\.get\('area'\)/)
  assert.match(source, /nextParams\.set\('area', area\)/)
  assert.match(source, /nextParams\.delete\('area'\)/)
  assert.match(source, /settingsArea === 'profile'/)
  assert.match(source, /settingsArea === 'display'/)
  assert.match(source, /settingsArea === 'setup'/)
  assert.match(source, /settingsArea === 'security'/)
  assert.match(source, /<AccountProfileSection/)
  assert.match(source, /<DisplaySettingsSection/)
  assert.match(source, /<SetupChecklistSettingsSection/)
  assert.match(source, /<LoginEmailSection/)
  assert.match(source, /<PasswordSettingsSection/)
})
