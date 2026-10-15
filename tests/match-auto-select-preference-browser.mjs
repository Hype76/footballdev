import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const source = await readFile('src/pages/MatchDayPage.jsx', 'utf8')
function section(start, end) {
  const first = source.indexOf(start)
  const last = source.indexOf(end, first)
  assert.ok(first >= 0 && last > first)
  return source.slice(first, last)
}
const open = section('const openFixtureSetup = async', '    const storedSetupIntent =')
const save = section('const handleConfirmCreateMatch = async', '  const handleDeleteSavedLocation =')
const update = section('const updateForm = (updates)', '  const openNewFixtureSetup =')
const harness = `
import {createRoot} from 'react-dom/client';
window.fixtureUser={id:'FP TEST coach',clubId:'FP TEST club',activeTeamId:'team-1'};
window.saved=[];
function PreferenceHarness(){
  const user=window.fixtureUser;
  const [form,setForm]=useState(EMPTY_MATCH_FORM),[isFixtureFormOpen,setIsFixtureFormOpen]=useState(false);
  const [error,setErrorMessage]=useState(''),[isSaving,setIsSaving]=useState(false);
  const [selectedLocationId,setSelectedLocationId]=useState('');
  const fixturePreferenceRequestRef=useRef(0);
  const [isFixtureDefaultLoading,setFixtureDefaultLoading]=useState(false);
  const teams=[{id:'team-1',name:'FP TEST First'},{id:'team-2',name:'FP TEST Second'}],locations=[];
  const fixturePlayers=[{id:'player-1',section:'Squad'}],squadSelection={selectedPlayerIds:['player-1'],mode:'full'};
  const getOwnTeamFixturePreferences=async()=>({found:false}),updateOwnTeamFixturePreferences=async()=>{};
  const getOwnMatchSelectionPreference=async({teamId,user})=>{
    if(window.holdPreferenceTeam===teamId) await new Promise(resolve=>{window.releasePreference=resolve});
    return (await fetch('https://fixture.test/preferences?team='+teamId+'&user='+user.id+'&club='+user.clubId)).json();
  };
  const updateTeamNotificationDisplayName=async()=>({}),setTeams=()=>{},setMatches=()=>{},setSquadSelection=()=>{};
  const setExpandedMatchId=()=>{},setActiveWorkspaceTab=()=>{},setActiveMatchId=()=>{},loadData=async()=>{};
  const logFixtureAvailabilityRecipientEvents=async()=>{},createMatchDayEventLogEntry=async()=>{};
  const syncCalendarEventParentScope=async()=>{},showToast=()=>{},allowsCommunication=false,session=null;
  const volunteerRequestMessages={scorer:''},selectedFixtureTeamName='FP TEST',notificationContext={};
  const createMatchDay=async({match})=>{
    if(window.failSave) throw new Error('FP TEST save failed');
    await fetch('https://fixture.test/preferences',{method:'POST',body:JSON.stringify({user:user.id,club:user.clubId,team:match.teamId||user.activeTeamId,selected:match.autoSelectAvailablePlayers})});
    const saved={id:'fixture-'+window.saved.length,...match};window.saved.push(saved);return saved;
  };
  ${open}
  ${save}
  window.openFixture=openFixtureSetup;
  ${update}
  return <><button onClick={()=>void openFixtureSetup()}>Open new fixture</button><p role="status">{error}</p>
    {isFixtureFormOpen?<FixtureSetupModal form={form} user={user} teams={teams} locations={locations}
      selectedLocationId={selectedLocationId} selectedFixtureTeamId={form.teamId||user.activeTeamId}
      selectedFixtureTeamName="FP TEST" isTeamScopedFixture={false} isFixtureDataLoading={isFixtureDefaultLoading} isSaving={isSaving}
      updateForm={updateForm} onClose={closeFixtureSetup} validationMessage=""
      volunteerRequestMessages={volunteerRequestMessages} handleCreateMatch={event=>{event.preventDefault();void handleConfirmCreateMatch()}}
      applyLocation={()=>{}} onDeleteSavedLocation={()=>{}} updateArrivalFromPreset={()=>{}}
      updateCustomMatchDuration={()=>{}} updateKickoffTime={()=>{}} updateKickoffTimeMode={()=>{}}
      updateManualLocation={()=>{}} updateMatchDurationPreset={()=>{}}/>:null}</>;
}
createRoot(document.getElementById('root')).render(<PreferenceHarness/>);
`
const bundle = await build({
  stdin: { contents: source + harness, resolveDir: `${process.cwd()}/src/pages`, loader: 'jsx' },
  bundle: true, write: false, jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
})
const browser = await chromium.launch({ headless: true })
await mkdir('output/playwright/auto-select-preference', { recursive: true })
try {
  for (const width of [390, 1280]) {
    const preferences = new Map()
    const context = await browser.newContext({ viewport: { width, height: 950 } })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const serve = async route => {
      if (route.request().url() === 'https://fixture.test/') {
        return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script>' + bundle.outputFiles[0].text + '</script>' })
      }
      const url = new URL(route.request().url())
      if (url.origin === 'https://fixture.test' && url.pathname === '/preferences') {
        if (route.request().method() === 'POST') {
          const saved = route.request().postDataJSON()
          preferences.set(saved.user + ':' + saved.club + ':' + saved.team, saved.selected)
          return route.fulfill({ json: { success: true } })
        }
        const key = url.searchParams.get('user') + ':' + url.searchParams.get('club') + ':' + url.searchParams.get('team')
        return route.fulfill({ json: { found: preferences.has(key), autoSelectAvailablePlayers: preferences.get(key) === true } })
      }
      return route.abort()
    }
    await page.route('**/*', serve)
    await page.goto('https://fixture.test/')
    const checkbox = page.locator('#matchday-auto-select-available')
    const openForm = () => page.getByRole('button', { name: 'Open new fixture', exact: true }).click()
    const closeForm = () => page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).last().click()
    await openForm()
    assert.equal(await checkbox.isChecked(), false, 'First new fixture defaults off')
    await checkbox.check()
    await closeForm()
    await openForm()
    assert.equal(await checkbox.isChecked(), false, 'Cancelled choice is not remembered')
    await checkbox.check()
    await page.getByRole('button', { name: 'Continue to squad', exact: true }).click()
    await page.waitForFunction(() => window.saved.length === 1)
    await page.reload()
    await openForm()
    assert.equal(await checkbox.isChecked(), true, 'Successful choice survives browser reload')
    await checkbox.uncheck()
    await page.evaluate(() => { window.failSave = true })
    await page.getByRole('button', { name: 'Continue to squad', exact: true }).click()
    await page.getByRole('status').filter({ hasText: 'FP TEST save failed' }).waitFor()
    await closeForm()
    await openForm()
    assert.equal(await checkbox.isChecked(), true, 'Failed save preserves previous choice')
    await page.getByRole('dialog').getByText('Team', { exact: true }).locator('..').locator('select').selectOption('team-2')
    assert.equal(await checkbox.isChecked(), false, 'Another team defaults off')
    await page.getByRole('dialog').getByText('Team', { exact: true }).locator('..').locator('select').selectOption('team-1')
    assert.equal(await checkbox.isChecked(), true, 'Returning to saved team restores choice')
    await checkbox.uncheck()
    await page.evaluate(() => { window.failSave = false })
    await page.getByRole('button', { name: 'Continue to squad', exact: true }).click()
    await page.waitForFunction(() => window.saved.length === 1)
    await openForm()
    assert.equal(await checkbox.isChecked(), false, 'Successfully saved off replaces saved on')
    const otherDevice = await browser.newContext({ viewport: { width, height: 950 } })
    const otherPage = await otherDevice.newPage()
    await otherPage.route('**/*', serve)
    await otherPage.goto('https://fixture.test/')
    await otherPage.getByRole('button', { name: 'Open new fixture', exact: true }).click()
    const otherCheckbox = otherPage.locator('#matchday-auto-select-available')
    assert.equal(await otherCheckbox.isChecked(), false, 'Fresh device reads shared saved off')
    await otherCheckbox.check()
    await otherPage.getByRole('button', { name: 'Continue to squad', exact: true }).click()
    await otherPage.waitForFunction(() => window.saved.length === 1)
    await closeForm()
    await openForm()
    assert.equal(await checkbox.isChecked(), true, 'First device refreshes the choice saved on another device')
    await otherPage.reload()
    await otherPage.getByRole('button', { name: 'Open new fixture', exact: true }).click()
    assert.equal(await otherCheckbox.isChecked(), true, 'Saved on survives fresh device reload')
    await otherDevice.close()

    await page.evaluate(() => { window.holdPreferenceTeam = 'team-2' })
    const teamSelect = page.getByRole('dialog').getByText('Team', { exact: true }).locator('..').locator('select')
    await teamSelect.selectOption('team-2')
    await page.waitForFunction(() => typeof window.releasePreference === 'function')
    await checkbox.check()
    await page.evaluate(() => { window.releasePreference() })
    await page.waitForTimeout(100)
    assert.equal(await checkbox.isChecked(), true, 'Late server read cannot replace an explicit checkbox choice')
    await checkbox.scrollIntoViewIfNeeded()
    await page.screenshot({ path: 'output/playwright/auto-select-preference/' + width + '.png' })
    assert.deepEqual(errors, [])
    await context.close()
  }
  console.log('PASS: actual website fixture form/save handler at 390/1280px; two isolated devices share saved on/off; stale reads, reload, cancellation, failed save and team switching. All transport synthetic.')
} finally {
  await browser.close()
}
