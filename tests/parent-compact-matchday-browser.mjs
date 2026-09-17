import assert from 'node:assert/strict'
import { assertRenderedTextContrast } from './helpers/rendered-text-contrast.mjs'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
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
const portal = await extract('apps/parent-mobile/src/ParentPortalScreens.js', ['MatchdayScreen', 'ParentMatchFormationPlan', 'MatchCard', 'scoreVisible', 'MatchStatusBadge', 'MatchdayAction', 'InvitationResponseControl', 'ParentCarpoolControl', 'IconChoice', 'Button', 'invitationResponsePresentation', 'invitationToneColor', 'volunteerIconKey', 'colorsFor', 'usePortalStyles', 'formatDateOnly', 'formatDate', 'labelize', 'normalizeText'])
const invitationCore = await extract('apps/parent-mobile/src/parentPortalData.js', ['getInvitationResponseOptions', 'isParentInvitationActionable'])
const formationCore = await extract('apps/mobile-core/src/parentFormationBoardCore.js', ['getParentFormationPlayerLabel', 'getParentFormationPitchPercent', 'getNamedParentFormationPlayers'])
const appSource = await readFile('apps/parent-mobile/App.js', 'utf8')
const handlers = appSource.slice(appSource.indexOf('  async function handleInvitationResponse('), appSource.indexOf('  async function handleAddToCalendar('))
const childChange = appSource.slice(appSource.indexOf('  function handleChildChange('), appSource.indexOf('  async function handleRemoveOwnPlayerAccess('))
const app = await extract('apps/parent-mobile/App.js', ['SyncStatus', 'Notice', 'createParentAppPalette', 'createParentAppStyles'])
const kit = await extract('apps/mobile-core/src/ClubKitDisplay.js', ['ClubKitDisplay']).then(source => source.replace('../assets/kit-tbc.png', './apps/mobile-core/assets/kit-tbc.png'))
const entry = `
import React,{useState,useMemo,useEffect,useRef} from 'react';import {createRoot} from 'react-dom/client';
import {View,Text,Pressable,StyleSheet,Platform,Image,Modal,SafeAreaView} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import ParentIcon from './apps/parent-mobile/src/ParentIcon.js';
import {MatchTypeIcon} from './apps/parent-mobile/src/MatchTypeIcon.js';
import {HomeAwayIcon} from './apps/parent-mobile/src/HomeAwayIcon.js';
import {PitchTypeIcon} from './apps/parent-mobile/src/PitchTypeIcon.js';
import {createParentMobileTheme,DEFAULT_PARENT_MOBILE_THEME} from './apps/mobile-core/src/parentThemeCore.js';
import {getParentMatchGroups,getParentMatchStatusLabel,getParentScorerInterestInvitation,getParentMatchDirectionsUrl} from './apps/parent-mobile/src/parentExperience.js';
import {getParentMatchTimeline,getParentScorerMatches,getParentScorerActionLabel} from './apps/parent-mobile/src/parentScorerCore.js';
import {canChangeParentMatchAvailability,getParentMatchAttendanceInvitation,getParentMatchAvailability,getParentMatchSquadStatus} from './apps/parent-mobile/src/parentMatchAvailability.js';
import {getParentInvitationLockReason,isParentInvitationOptionSelected} from './apps/parent-mobile/src/parentPresentationCore.js';
import {getParentEventPresentation} from './apps/parent-mobile/src/parentEventPresentation.js';
import {getMatchDayShirtChoiceLabel} from './src/lib/matchday-model.js';
import {getMatchDayLifecycleState} from './src/lib/matchday-lifecycle.js';
import {getCoachMatchDayPresentation} from './apps/mobile-core/src/coachMatchDayCore.js';
import {getMatchDayDisplayName} from './src/lib/matchday-display.js';
import {formatParentProductDateTime,formatParentProductTime} from './apps/mobile-core/src/parentDateTimeCore.js';
import {formatMatchAddedTimeClock} from './src/lib/matchday-event-time.js';
import {buildCompletedMatchEventPresentation} from './src/lib/matchday-final-report.js';
const normalize = (value) => String(value ?? '').trim();
const BrandLoader=()=>null,useConfirmedConnectionIssue=value=>value;
const ResourceState=()=>null;
const ScorerControls=()=> <Text>Authorised scorer controls</Text>;
const supabase={},peekMobileClubKits=()=>({}),loadMobileClubKits=async()=>({}),kitLabel=()=> 'Home kit';
const kitImageUrl=()=> 'data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="blue"/></svg>').toString('base64')}';
let theme;const useParentTheme=()=>theme;
${kit}\n${invitationCore}\n${formationCore}\n${portal}\n${app}
const initial={id:'match',teamId:'team',clubId:'club',clubName:'Cambourne Town FC',teamName:'U14 JPL 26/27',opponent:'Peterborough Junior Blues U14',status:'scheduled',timerStatus:'not_started',currentMatchPhase:'pre_match',matchDate:'2099-09-19',arrivalTime:'10:00:00',kickoffTime:'10:45:00',venueName:'Bourne AGP',venueAddress:'Fontwell Drive PE10 0YE',fixtureType:'cup',homeAway:'away',shirtChoice:'home',pitchType:'3g',homeScore:0,awayScore:0,notes:'Please arrive at 10:00.',confirmedTeam:['Synthetic Player'],availabilityStatus:'available',squadDecisionState:'selected',events:[],formationPlan:{title:'Published Match Plan',gameFormat:'7v7',formationPresetKey:'7v7-2-3-1',placements:[{playerId:'starter',displayName:'Published Starter',x:0.5,y:0.6}],bench:[{playerId:'bench',displayName:'Published Bench',state:'bench'}],notes:'PRIVATE COACH NOTE',unselectedPlayers:[{displayName:'UNSELECTED PRIVATE PLAYER'}]}};
const parentLink={id:'parent',clubId:'club',playerId:'child',linkType:'parent'};
const initialInvitation={invitationId:'invitation',eventId:'match',childId:'child',parentLinkId:'parent',sourceRecordId:'request',invitationType:'match_attendance',invitationState:'active',canRespond:true,canChangeResponse:true,responseState:'available',carpoolEnabled:true};
const getParentFriendlyError=(error)=>error.message,saveParentOfflineSelection=async()=>{};
const respondToParentInvitation=async(user,invitation,response)=>{window.calls.push(['attendance',user.selectedParentLinkId,invitation.sourceRecordId,response]);if(window.defer)await new Promise(resolve=>window.pending.push(resolve));window.server={...window.server,availabilityStatus:response};window.serverInvitation={...window.serverInvitation,responseState:response}};
const setParentMatchTransport=async(user,invitation,mode)=>{window.calls.push(['transport',user.selectedParentLinkId,invitation.sourceRecordId,mode]);window.serverInvitation={...window.serverInvitation,transportNeedsLift:mode==='needs_lift',transportCanOfferLift:mode==='offering_lift',transportRespondedAt:'2099-01-01'};window.server={...window.server,squadTransport:[{playerId:'child',playerName:'Synthetic Player',needsLift:mode==='needs_lift',canOfferLift:mode==='offering_lift'}]}};
window.calls=[];window.pending=[];window.server=initial;window.serverInvitation=initialInvitation;
function App(){const[match,setMatch]=useState(initial),[mode,setMode]=useState('light'),[offline,setOffline]=useState(false),[warning,setWarning]=useState(false),[activeActionId,setActiveActionId]=useState(''),[notice,setNotice]=useState(null),[invitation,setInvitation]=useState(initialInvitation),[selectedLinkId,setSelectedLinkId]=useState('parent'),[linkType,setLinkType]=useState('parent'),[showList,setShowList]=useState(false),[fixtures,setFixtures]=useState([]);
const isOffline=offline,selectedMobileUser={id:'account',selectedParentLinkId:selectedLinkId},link={...parentLink,id:selectedLinkId,playerId:selectedLinkId==='parent'?'child':'other-child',linkType},parentLinks=[parentLink,{id:'other'}];
const parentSyncScopeRef=useRef(''),parentActionScopeRef=useRef(0),requestIdRef=useRef(0);parentSyncScopeRef.current='account:'+selectedLinkId;
const setChildSwitcherOpen=()=>{},setActiveTab=()=>{};
async function loadParentData(){window.refreshes=(window.refreshes||0)+1;setMatch(window.server);setInvitation(window.serverInvitation)}
${handlers}\n${childChange}
window.match=patch=>setMatch({...initial,...patch});window.mode=setMode;window.offline=setOffline;window.warning=setWarning;window.linkType=setLinkType;window.switchChild=handleChildChange;window.list=setShowList;window.fixtures=patches=>setFixtures(patches.map(p=>({...initial,...p})));window.invitation=patch=>setInvitation({...initialInvitation,...patch});window.refresh=loadParentData;window.current={activeActionId,notice,selectedLinkId};
const tokens=createParentMobileTheme({mode,selectedLink:{themeAccent:'#075293'}}).tokens,palette=createParentAppPalette(tokens);theme={palette,styles:createParentAppStyles(palette)};
return <View style={{padding:16,backgroundColor:palette.background,minHeight:'100vh'}}>
<SyncStatus cacheState={{source:'cache',stale:true}} isOffline={offline} summary={{waiting:0,needsAttention:0}}/>
{warning?<Notice compact tone="warning" message="Could not refresh. Showing saved information." onDismiss={()=>setWarning(false)}/>:null}
<MatchdayScreen activeActionId={activeActionId} isOffline={isOffline} invitations={fixtures.length?fixtures.map(f=>({...initialInvitation,eventId:f.id,invitationState:f.demoInvitationState||'active'})):invitation?[invitation]:[]} selectedMatch={showList?null:match} resource={{items:fixtures.length?fixtures:[match]}} clubKits={{home:{}}} link={link} themeTokens={tokens} onBack={()=>window.action='back'} onAddToCalendar={()=>window.action='calendar'} onOpenLink={()=>window.action='directions'} onOpen={()=>setShowList(false)} onRespond={handleInvitationResponse} onTransport={handleMatchTransport}/>
</View>}
createRoot(document.getElementById('root')).render(<App/>);`
const result = await build({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic', loader: { '.js': 'jsx', '.ttf': 'dataurl', '.png': 'dataurl' }, platform: 'browser', conditions: ['browser'], mainFields: ['browser', 'module', 'main'], resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'], nodePaths: [modules], alias: { react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom'), 'react-native': path.join(modules, 'react-native-web') }, define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' }, banner: { js: 'globalThis.process={env:{NODE_ENV:"production"}};' } })
const browser = await chromium.launch({ headless: true })
await mkdir('output/playwright/parent-compact', { recursive: true })
await writeFile('output/playwright/parent-compact/matchday-preview.js', result.outputFiles[0].text)
await writeFile('output/playwright/parent-compact/matchday-preview.html', '<html><meta name="viewport" content="width=device-width, initial-scale=1"><body style="margin:0"><div id="root"></div><script src="./matchday-preview.js"></script></body></html>')
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  await page.setContent('<html><body style="margin:0"><div id="root"></div></body></html>')
  await page.addScriptTag({ content: result.outputFiles[0].text })
  await page.getByRole('button', { name: 'Back to Matchday' }).waitFor()
  await page.waitForFunction(() => [...document.images].some(image => image.src.startsWith('data:image/svg+xml') && image.naturalWidth === 40))
  await page.getByText('Show', { exact: true }).click()
  await page.getByText('Published Starter', { exact: true }).waitFor()
  await page.getByText('Published Bench', { exact: true }).waitFor()
  assert.equal(await page.getByText('PRIVATE COACH NOTE', { exact: true }).count(), 0)
  assert.equal(await page.getByText('UNSELECTED PRIVATE PLAYER', { exact: true }).count(), 0)
  await page.getByText('Hide', { exact: true }).click()
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
  await page.getByRole('button', { name: 'Change availability' }).click()
  await page.getByRole('radio', { name: 'Availability, Not attending', exact: true }).click()
  await page.getByLabel('Availability: Not available', { exact: true }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.calls[0]), ['attendance', 'parent', 'request', 'unavailable'])
  await page.getByRole('button', { name: /Carpool, Optional/ }).click()
  await page.getByRole('radio', { name: 'Need a lift', exact: true }).click()
  await page.getByRole('button', { name: /Carpool, Needs a lift/ }).waitFor()
  await page.getByRole('button', { name: 'See squad (1)' }).click()
  await page.getByLabel('Carpool: Needs a lift', { exact: true }).waitFor()
  await page.getByRole('radio', { name: 'Offer a lift', exact: true }).click()
  await page.getByLabel('Carpool: Offering a lift', { exact: true }).waitFor()
  await page.evaluate(() => window.refresh())
  await page.getByLabel('Availability: Not available', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Close availability response' }).click()
  await page.getByRole('button', { name: 'Hide squad' }).click()
  await page.evaluate(() => window.list(true))
  await page.getByLabel('Availability: Not available', { exact: true }).waitFor()
  await page.getByLabel('Match squad: Selected', { exact: true }).waitFor()
  await page.evaluate(() => { window.match({ availabilityStatus: '', squadDecisionState: 'undecided' }); window.invitation({ responseState: 'awaiting_response' }) })
  await page.getByLabel('Availability: Needs response', { exact: true }).waitFor()
  await page.getByLabel('Match squad: Not announced yet', { exact: true }).waitFor()
  await page.evaluate(() => window.invitation({ invitationState: 'expired' }))
  await page.getByLabel('Availability: Not responded', { exact: true }).waitFor()
  await page.evaluate(() => { window.list(false); window.invitation({}); window.match({}) })
  await page.getByRole('button', { name: 'Change availability' }).waitFor()
  for (const role of ['player', 'fan']) {
    await page.evaluate(role => window.linkType(role), role)
    assert.equal(await page.getByRole('button', { name: 'Change availability' }).count(), 0)
  }
  await page.evaluate(() => window.linkType('parent'))
  await page.evaluate(() => window.offline(true))
  assert.equal(await page.getByRole('button', { name: 'Change availability' }).getAttribute('aria-disabled'), 'true')
  await page.evaluate(() => window.offline(false))
  // Exercise the real App handlers across A -> B -> A with delayed responses.
  await page.getByRole('button', { name: 'Change availability' }).click()
  await page.evaluate(() => { window.defer = true })
  await page.getByRole('radio', { name: 'Availability, Attending', exact: true }).click()
  await page.waitForFunction(() => window.pending.length === 1)
  await page.evaluate(() => window.switchChild('other'))
  await page.waitForFunction(() => window.current.activeActionId === '')
  assert.equal(await page.getByRole('button', { name: 'Change availability' }).count(), 0)
  await page.evaluate(() => window.switchChild('parent'))
  // Existing panel may reopen for the same child, but the old request must not control it.
  if (await page.getByRole('button', { name: 'Change availability' }).count()) await page.getByRole('button', { name: 'Change availability' }).click()
  await page.getByRole('radio', { name: 'Availability, Not attending', exact: true }).click()
  await page.waitForFunction(() => window.pending.length === 2)
  const refreshes = await page.evaluate(() => window.refreshes)
  await page.evaluate(() => window.pending[0]())
  await page.waitForTimeout(30)
  assert.equal(await page.evaluate(() => window.current.activeActionId), 'invite:invitation')
  assert.equal(await page.evaluate(() => window.refreshes), refreshes)
  await page.evaluate(() => { window.pending[1](); window.defer = false })
  await page.waitForFunction(() => window.current.activeActionId === '')
  await page.getByLabel('Availability: Not available', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Close availability response' }).click()
  await page.evaluate(() => window.match({}))
  await mkdir('output/playwright/parent-compact', { recursive: true })
  for (const mode of ['light', 'dark']) for (const width of [320, 390]) {
    await page.evaluate(mode => window.mode(mode), mode)
    await page.setViewportSize({ width, height: 844 })
    const positions = await Promise.all(['Match type: Cup', 'Away game', 'Home kit', 'Surface: 3G'].map(label => page.getByLabel(label, { exact: true }).boundingBox()))
    assert.ok(Math.max(...positions.map(box => box.y)) - Math.min(...positions.map(box => box.y)) < 2)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await assertRenderedTextContrast(page, `match detail ${mode} ${width}`)
    await page.screenshot({ path: `output/playwright/parent-compact/${mode}-${width}.png`, fullPage: true })
    await page.evaluate(() => { window.fixtures([
      {id:'one',opponent:'Peterborough Junior Blues U14'},
      {id:'two',opponent:'St Neots U14',availabilityStatus:'',squadDecisionState:'undecided'},
      {id:'three',opponent:'Haverhill U14',availabilityStatus:'unavailable',squadDecisionState:'not_selected'},
      {id:'four',opponent:'Godmanchester U14',availabilityStatus:'',squadDecisionState:'undecided',demoInvitationState:'expired'},
    ]);window.list(true) })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    const longBadges = await Promise.all(['Availability: Needs response', 'Match squad: Not announced yet'].map(label => page.getByLabel(label,{exact:true}).first().boundingBox()))
    assert.ok(Math.abs(longBadges[0].y-longBadges[1].y)<2, 'long status chips remain beside each other')
    const expectedStatusColors = mode === 'dark'
      ? {
        'Availability: Available': ['rgb(134, 239, 172)', 'rgb(20, 83, 45)', 'Available'],
        'Availability: Needs response': ['rgb(252, 211, 77)', 'rgb(113, 63, 18)', 'Needs response'],
        'Availability: Not available': ['rgb(252, 165, 165)', 'rgb(127, 29, 29)', 'Not available'],
        'Availability: Not responded': ['rgb(209, 213, 219)', 'rgb(55, 65, 81)', 'Not responded'],
        'Match squad: Selected': ['rgb(191, 219, 254)', 'rgb(30, 58, 138)', 'Selected'],
        'Match squad: Not announced yet': ['rgb(209, 213, 219)', 'rgb(55, 65, 81)', 'Not announced yet'],
        'Match squad: Not selected': ['rgb(209, 213, 219)', 'rgb(55, 65, 81)', 'Not selected'],
      }
      : {
        'Availability: Available': ['rgb(22, 112, 0)', 'rgb(225, 243, 225)', 'Available'],
        'Availability: Needs response': ['rgb(153, 89, 0)', 'rgb(255, 240, 208)', 'Needs response'],
        'Availability: Not available': ['rgb(185, 28, 28)', 'rgb(254, 226, 226)', 'Not available'],
        'Availability: Not responded': ['rgb(75, 85, 99)', 'rgb(229, 231, 235)', 'Not responded'],
        'Match squad: Selected': ['rgb(29, 78, 216)', 'rgb(219, 234, 254)', 'Selected'],
        'Match squad: Not announced yet': ['rgb(75, 85, 99)', 'rgb(229, 231, 235)', 'Not announced yet'],
        'Match squad: Not selected': ['rgb(75, 85, 99)', 'rgb(229, 231, 235)', 'Not selected'],
      }
    for (const [label, [foreground, background, text]] of Object.entries(expectedStatusColors)) {
      const chip = page.getByLabel(label, { exact: true }).first()
      await chip.waitFor()
      const appearance = await chip.evaluate((element, text) => {
        const label = [...element.querySelectorAll('*')].find(child => child.textContent.trim() === text)
        const style = getComputedStyle(element)
        return {
          background: style.backgroundColor,
          borderWidth: style.borderTopWidth,
          foreground: label ? getComputedStyle(label).color : null,
          radius: Number.parseFloat(style.borderTopLeftRadius),
        }
      }, text)
      assert.deepEqual(appearance, { background, borderWidth: '0px', foreground, radius: 999 }, `${label} pill style`)
    }
    await assertRenderedTextContrast(page, `match list ${mode} ${width}`)
    await page.screenshot({ path: `output/playwright/parent-compact/list-${mode}-${width}.png`, fullPage: true })
    await page.evaluate(() => {window.list(false);window.fixtures([]);window.match({confirmedTeam:['Needs Lift Player','Offering Lift Player'],squadTransport:[{playerId:'one',playerName:'Needs Lift Player',needsLift:true},{playerId:'two',playerName:'Offering Lift Player',canOfferLift:true}]})})
    await page.getByRole('button',{name:'See squad (2)'}).click()
    await page.getByLabel('Carpool: Offering a lift',{exact:true}).waitFor()
    await page.screenshot({ path: `output/playwright/parent-compact/squad-${mode}-${width}.png`, fullPage: true })
    await page.getByRole('button',{name:'Hide squad'}).click()
    await page.evaluate(() => window.match({}))
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
  console.log('PASS: Parent Matchday at 320/390px light/dark with contrast and no overflow; availability and squad chips distinct; save/reload availability and carpool; squad lift badges; Parent/Player/Fan and offline gates; real App handlers reject stale A->B->A completion; score/timeline/scorer, back, calendar and directions retained.')
} finally { await browser.close() }
