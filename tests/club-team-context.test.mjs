import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const teamManagementPageUrl = new URL('../src/pages/TeamManagementPage.jsx', import.meta.url)
const onboardingProviderUrl = new URL('../src/components/onboarding/OnboardingProvider.jsx', import.meta.url)
const sidebarUrl = new URL('../src/components/layout/Sidebar.jsx', import.meta.url)
const layoutUrl = new URL('../src/components/layout/Layout.jsx', import.meta.url)
const manageTeamFunctionUrl = new URL('../netlify/functions/manage-team.js', import.meta.url)

test('managed team writes keep existing cross-club assignments and enforce the TV settings boundary', async (t) => {
  t.mock.method(console, 'error', () => {})
  const localClub = 'club-one'
  const people = [
    { id: 'local', club_id: localClub, role: 'coach' },
    { id: 'foreign', club_id: 'club-two', role: 'head_manager' },
    { id: 'unassigned', club_id: 'club-three', role: 'coach' },
  ]
  const memberships = [
    { auth_user_id: 'foreign', club_id: localClub, role: 'head_manager' },
    { auth_user_id: 'foreign', club_id: 'club-two', role: 'admin' },
  ]
  let staff = [{ id: 'original-assignment', team_id: 'team-one', user_id: 'foreign', role_key: 'head_manager' }]
  const team = { id: 'team-one', club_id: localClub, name: 'Team One' }
  const writes = []
  const client = { from(table) {
    let matches = () => true
    let operation = 'select'
    let payload
    const chain = {
      select() { return chain },
      eq(key, value) { const previous = matches; matches = row => previous(row) && row[key] === value; return chain },
      in(key, values) { const previous = matches; matches = row => previous(row) && values.includes(row[key]); return chain },
      is() { return chain },
      delete() { operation = 'delete'; return chain },
      update(value) { operation = 'update'; payload = value; return chain },
      upsert(value) { operation = 'upsert'; payload = value; return chain },
      single() { return chain.maybeSingle() },
      async maybeSingle() { return { data: run().data[0] ?? null } },
      then(resolve) { return Promise.resolve(run()).then(resolve) },
    }
    function run() {
      if (operation !== 'select') writes.push({ table, operation, payload })
      if (table === 'teams' && operation === 'update' && matches(team)) Object.assign(team, payload)
      if (table === 'team_staff' && operation === 'delete') staff = staff.filter(row => !matches(row))
      if (table === 'team_staff' && operation === 'upsert') {
        staff.push(...payload.map(row => ({ ...row, id: 'new-assignment', role_key: 'coach' })))
      }
      const rows = { users: people, team_staff: staff, teams: [team], club_user_invites: [], user_club_memberships: memberships }[table]
      if (!rows) throw new Error(`Unexpected table: ${table}`)
      return { data: rows.filter(matches) }
    }
    return chain
  } }
  const fixtureKey = '__teamManagementTestFixture'
  globalThis[fixtureKey] = {
    client,
    authenticate(event, { clubId }) {
      if (clubId !== localClub) throw Object.assign(new Error('Wrong workspace'), { statusCode: 403 })
      return { id: 'actor', clubId, role: event.headers.role || 'admin', roleRank: 90, planKey: 'club', planStatus: 'active' }
    },
  }
  t.after(() => { delete globalThis[fixtureKey] })
  const bundled = await build({
    entryPoints: [fileURLToPath(manageTeamFunctionUrl)], bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{ name: 'team-management-test', setup(builder) {
      builder.onResolve({ filter: /\/_supabase\.js$|\/_plan-gate\.js$/ }, ({ path }) => ({ path, namespace: 'fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
        contents: path.endsWith('_supabase.js')
          ? `export const supabaseAdmin = globalThis.${fixtureKey}.client`
          : `export const getAuthenticatedPlanProfile = globalThis.${fixtureKey}.authenticate; export function assertPlanFeature() {}`,
      }))
    } }],
  })
  const { handler } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)
  async function request(action, body, role = 'admin') {
    const result = await handler({ httpMethod: 'POST', headers: { role }, body: JSON.stringify({
      action, teamId: team.id, clubId: localClub, ...body,
    }) })
    return { status: result.statusCode, ...JSON.parse(result.body) }
  }

  assert.equal((await request('update-tv', { tvPublicAnnouncements: false, tvGoalCelebrations: true }, 'coach')).status, 403)
  assert.equal((await request('update-tv', { tvPublicAnnouncements: false })).status, 400)
  assert.equal(writes.length, 0)
  const settings = await request('update-tv', { tvPublicAnnouncements: false, tvGoalCelebrations: true })
  assert.equal(settings.status, 200)
  assert.equal(settings.team.tvPublicAnnouncements, false)
  assert.equal(settings.team.tvGoalCelebrations, true)

  const denied = await request('replace-staff', { userIds: ['unassigned'] })
  assert.equal(denied.status, 403)
  const saved = await request('replace-staff', { userIds: ['local'] })
  assert.equal(saved.status, 200)
  assert.deepEqual(saved.assignments.map(row => [row.id, row.user_id, row.role_key]), [
    ['original-assignment', 'foreign', 'head_manager'], ['new-assignment', 'local', 'coach'],
  ])
  Object.assign(people[1], { club_id: localClub, role: 'head_manager' })
  const afterSwitch = await request('replace-staff', { userIds: ['local'] })
  assert.deepEqual(afterSwitch.assignments.map(row => row.user_id), ['foreign', 'local'])
  Object.assign(people[1], { club_id: 'club-two', role: 'admin' })
  const removed = await request('replace-staff', { userIds: ['local'], removeUserId: 'foreign' })
  assert.equal(removed.status, 200)
  assert.deepEqual(removed.assignments.map(row => row.user_id), ['local'])
})

function getFunctionSection(source, marker, nextMarker = '\n  const ') {
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `${marker} not found`)

  const next = source.indexOf(nextMarker, start + marker.length)
  return source.slice(start, next === -1 ? undefined : next)
}

function getBranchSection(source, marker) {
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `${marker} not found`)

  const nextBranch = source.indexOf("      } else if (actionType === '", start + marker.length)
  return source.slice(start, nextBranch === -1 ? undefined : nextBranch)
}

test('team management create keeps club admin context and theme after adding a team', async () => {
  const source = await readFile(teamManagementPageUrl, 'utf8')
  const createSection = getFunctionSection(source, '  const handleCreateTeam = async (event) => {', '\n  const handleCoachFormChange')

  assert.match(createSection, /const createdTeam = await createTeam/)
  assert.match(createSection, /setTeams\(\(current\) => \{/)
  assert.match(createSection, /await refreshTeamSelection\?\.\(\)/)
  assert.doesNotMatch(createSection, /selectTeam\?\.\(createdTeam\.id\)/)
  assert.doesNotMatch(createSection, /setSelectedTeamId\(createdTeam\.id\)/)
  assert.doesNotMatch(createSection, /updateCurrentUserDetails/)
  assert.doesNotMatch(createSection, /activeTeamId:\s*createdTeam\.id/)
  assert.doesNotMatch(createSection, /activeTeamName:\s*createdTeam\.name/)
  assert.doesNotMatch(createSection, /themeAccent:\s*createdTeam\.themeAccent/)
  assert.doesNotMatch(createSection, /themeButtonStyle:\s*createdTeam\.themeButtonStyle/)
})

test('onboarding manage teams action refreshes teams without selecting the new team', async () => {
  const source = await readFile(onboardingProviderUrl, 'utf8')
  const manageTeamsSection = getBranchSection(source, "      } else if (actionType === 'manage-teams') {")

  assert.match(manageTeamsSection, /await createTeam\(\{ user, name: teamName \}\)/)
  assert.match(manageTeamsSection, /await refreshTeamSelection\?\.\(\)/)
  assert.doesNotMatch(manageTeamsSection, /selectTeam\?\./)
  assert.doesNotMatch(manageTeamsSection, /updateCurrentUserDetails/)
  assert.doesNotMatch(manageTeamsSection, /activeTeamId:\s*createdTeam\.id/)
  assert.doesNotMatch(manageTeamsSection, /themeAccent:\s*createdTeam\.themeAccent/)
})

test('manual team switching remains available through explicit team selectors', async () => {
  const sidebarSource = await readFile(sidebarUrl, 'utf8')
  const layoutSource = await readFile(layoutUrl, 'utf8')

  assert.match(sidebarSource, /await selectTeam\(teamId\)/)
  assert.match(sidebarSource, /<span className="text-\[11px\] font-black uppercase tracking-\[0\.16em\] text-\[var\(--text-muted\)\]">\s*Access view\s*<\/span>/)
  assert.match(layoutSource, /await selectTeam\(teamId\)/)
})

test('team management remains workspace-scope guarded server side', async () => {
  const source = await readFile(manageTeamFunctionUrl, 'utf8')

  assert.match(source, /const profile = await getAuthenticatedPlanProfile\(event, \{ clubId \}\)/)
  assert.match(source, /await assertWorkspaceTeamAuthority\(profile, action, body\.teamId\)/)
  assert.match(source, /workspaceScope\.key === WORKSPACE_SCOPES\.club/)
  assert.match(source, /!\['update', 'replace-staff'\]\.includes\(action\)/)
  assert.match(source, /\.eq\('role_key', workspaceScope\.ownerRole\.key\)/)
})
