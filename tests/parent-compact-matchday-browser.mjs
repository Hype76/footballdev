import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { parse } from '@babel/parser'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = process.cwd(), modules = path.join(root, 'apps/parent-mobile/node_modules')
async function extract(file, names) {
  const source = await readFile(file, 'utf8')
  const nodes = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body.map(node => node.type === 'ExportNamedDeclaration' ? node.declaration : node)
  return names.map(name => { const node = nodes.find(node => node?.type === 'FunctionDeclaration' && node.id.name === name); assert.ok(node, name); return source.slice(node.start, node.end) }).join('\n')
}
const portal = await extract('apps/parent-mobile/src/ParentPortalScreens.js', ['MatchdayScreen', 'MatchdayAction', 'colorsFor', 'usePortalStyles', 'formatDateOnly', 'labelize', 'normalizeText'])
const app = await extract('apps/parent-mobile/App.js', ['SyncStatus', 'Notice', 'createParentAppPalette', 'createParentAppStyles'])
const kit = await extract('apps/mobile-core/src/ClubKitDisplay.js', ['ClubKitDisplay']).then(source => source.replace('../assets/kit-tbc.png', './apps/mobile-core/assets/kit-tbc.png'))
const entry = `
import React,{useState,useMemo,useEffect} from 'react';import {createRoot} from 'react-dom/client';
import {View,Text,Pressable,StyleSheet,Platform,Image} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import ParentIcon from './apps/parent-mobile/src/ParentIcon.js';
import {MatchTypeIcon} from './apps/parent-mobile/src/MatchTypeIcon.js';
import {HomeAwayIcon} from './apps/parent-mobile/src/HomeAwayIcon.js';
import {PitchTypeIcon} from './apps/parent-mobile/src/PitchTypeIcon.js';
import {createParentMobileTheme,DEFAULT_PARENT_MOBILE_THEME} from './apps/mobile-core/src/parentThemeCore.js';
import {getParentMatchGroups,getParentMatchStatusLabel,getParentScorerInterestInvitation,getParentMatchDirectionsUrl} from './apps/parent-mobile/src/parentExperience.js';
import {getParentMatchTimeline} from './apps/parent-mobile/src/parentScorerCore.js';
import {getMatchDayLifecycleState} from './src/lib/matchday-lifecycle.js';
import {getCoachMatchDayPresentation} from './apps/mobile-core/src/coachMatchDayCore.js';
import {getMatchDayDisplayName} from './src/lib/matchday-display.js';
import {formatParentProductDateTime,formatParentProductTime} from './apps/mobile-core/src/parentDateTimeCore.js';
import {formatMatchAddedTimeClock} from './src/lib/matchday-event-time.js';
import {buildCompletedMatchEventPresentation} from './src/lib/matchday-final-report.js';
const BrandLoader=()=>null,useConfirmedConnectionIssue=value=>value;
const ScorerControls=()=> <Text>Authorised scorer controls</Text>;
const supabase={},peekMobileClubKits=()=>({}),loadMobileClubKits=async()=>({}),kitLabel=()=> 'Home kit';
const kitImageUrl=()=> 'data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="blue"/></svg>').toString('base64')}';
let theme;const useParentTheme=()=>theme;
${kit}\n${portal}\n${app}
const initial={id:'match',teamId:'team',clubId:'club',teamName:'U14 JPL 26/27',opponent:'Peterborough Junior Blues U14',status:'scheduled',timerStatus:'not_started',currentMatchPhase:'pre_match',matchDate:'2099-09-19',arrivalTime:'10:00:00',kickoffTime:'10:45:00',venueName:'Bourne AGP',venueAddress:'Fontwell Drive PE10 0YE',fixtureType:'cup',homeAway:'away',shirtChoice:'home',pitchType:'3g',homeScore:0,awayScore:0,notes:'Please arrive at 10:00.',confirmedTeam:['Synthetic Player'],availabilityStatus:'available',squadDecisionState:'selected',events:[]};
function App(){const[match,setMatch]=useState(initial),[mode,setMode]=useState('light'),[offline,setOffline]=useState(false),[warning,setWarning]=useState(false);window.match=patch=>setMatch({...initial,...patch});window.mode=setMode;window.offline=setOffline;window.warning=setWarning;
const tokens=createParentMobileTheme({mode}).tokens,palette=createParentAppPalette(tokens);theme={palette,styles:createParentAppStyles(palette)};
return <View style={{padding:16,backgroundColor:palette.background,minHeight:'100vh'}}>
<SyncStatus cacheState={{source:'cache',stale:true}} isOffline={offline} summary={{waiting:0,needsAttention:0}}/>
{warning?<Notice compact tone="warning" message="Could not refresh. Showing saved information." onDismiss={()=>setWarning(false)}/>:null}
<MatchdayScreen selectedMatch={match} resource={{items:[match]}} clubKits={{home:{}}} link={{clubId:'club'}} themeTokens={tokens} onBack={()=>window.action='back'} onAddToCalendar={()=>window.action='calendar'} onOpenLink={()=>window.action='directions'}/>
</View>}
createRoot(document.getElementById('root')).render(<App/>);`
const result = await build({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic', loader: { '.js': 'jsx', '.ttf': 'dataurl', '.png': 'dataurl' }, platform: 'browser', conditions: ['browser'], mainFields: ['browser', 'module', 'main'], resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'], nodePaths: [modules], alias: { react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom'), 'react-native': path.join(modules, 'react-native-web') }, define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' }, banner: { js: 'globalThis.process={env:{NODE_ENV:"production"}};' } })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  await page.setContent('<html><body style="margin:0"><div id="root"></div></body></html>')
  await page.addScriptTag({ content: result.outputFiles[0].text })
  await page.getByRole('button', { name: 'Back to Matchday' }).waitFor()
  await page.waitForFunction(() => [...document.images].some(image => image.src.startsWith('data:image/svg+xml') && image.naturalWidth === 40))
  for (const text of ['Scheduled', 'Pre-match', 'Score', 'Match timer', 'Parent view', 'Match Timeline', 'Fixture details', 'Showing saved information while the latest update is checked.']) assert.equal(await page.getByText(text, { exact: true }).count(), 0, text)
  assert.equal(await page.getByText('Authorised scorer controls').count(), 0)
  for (const [name, action] of [['Back to Matchday', 'back'], ['Add to Google Calendar', 'calendar'], ['Get directions', 'directions']]) {
    const button = page.getByRole('button', { name, exact: true })
    assert.equal(await button.evaluate(element => getComputedStyle(element).borderTopWidth), '0px')
    await button.click()
    assert.equal(await page.evaluate(() => window.action), action)
  }
  await page.getByRole('button', { name: 'See squad (1)' }).click()
  await page.getByText('Synthetic Player', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Hide squad' }).click()
  await mkdir('output/playwright/parent-compact', { recursive: true })
  for (const mode of ['light', 'dark']) for (const width of [320, 390]) {
    await page.evaluate(mode => window.mode(mode), mode)
    await page.setViewportSize({ width, height: 844 })
    const positions = await Promise.all(['Match type: Cup', 'Away game', 'Home kit', 'Surface: 3G'].map(label => page.getByLabel(label, { exact: true }).boundingBox()))
    assert.ok(Math.max(...positions.map(box => box.y)) - Math.min(...positions.map(box => box.y)) < 2)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: `output/playwright/parent-compact/${mode}-${width}.png`, fullPage: true })
  }
  await page.evaluate(() => window.match({homeAway:'neutral',pitchType:'',fixtureType:''}))
  await page.getByLabel('Neutral venue',{exact:true}).waitFor()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.evaluate(() => window.match({ status: 'live', timerStatus: 'running', currentMatchPhase: 'first_half', timerElapsedSeconds: 60, homeScore: 1 }))
  await page.getByText('Score', { exact: true }).waitFor()
  await page.getByText('Match timer', { exact: true }).waitFor()
  await page.getByText('Match Timeline', { exact: true }).waitFor()
  await page.evaluate(() => window.match({ status: 'full_time', timerStatus: 'full_time', homeScore: 2, awayScore: 1 }))
  await page.getByText('2 - 1', { exact: true }).first().waitFor()
  await page.evaluate(() => window.match({ status: 'cancelled' }))
  await page.getByText('Cancelled', { exact: true }).waitFor()
  assert.equal(await page.getByText('Score', { exact: true }).count(), 0)
  await page.evaluate(() => window.match({ isScorer: true }))
  await page.getByText('Authorised scorer controls').waitFor()
  await page.evaluate(() => window.warning(true))
  await page.getByText('Could not refresh. Showing saved information.').waitFor()
  assert.ok((await page.getByText('Could not refresh. Showing saved information.').boundingBox()).height < 60)
  await page.getByRole('button', { name: 'Dismiss refresh status' }).click()
  await page.evaluate(() => window.offline(true))
  await page.getByText(/Offline. Showing your last saved information./).waitFor()
  assert.deepEqual(errors, [])
  console.log('PASS: compact Parent Matchday at 320/390px light/dark; saved info quiet; offline/error status retained; pre-match clutter hidden; live/final score and timeline retained; scorer gate; back, squad, calendar and directions work without boxes.')
} finally { await browser.close() }
