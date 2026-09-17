import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { parse } from '@babel/parser'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = process.cwd()
const modules = path.join(root, 'apps/parent-mobile/node_modules')
const source = await readFile('apps/parent-mobile/App.js', 'utf8')
const declarations = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body
  .filter(node => node.type === 'FunctionDeclaration')
const names = ['MatchPreviewCard', 'CalendarCard', 'CompactIconAction', 'HomeStatusBadges', 'NotificationsScreen', 'PollsScreen',
  'getNotificationTypeLabel', 'getNotificationTypeIcon', 'SectionHeading', 'ScreenIntro', 'ResourceError', 'EmptyPanel',
  'LoadingPanel', 'LoadingLine', 'PrimaryAction', 'Badge', 'createParentAppPalette', 'createParentAppStyles',
  'formatDateOnly', 'formatDateTime', 'formatTime', 'normalizeText']
const components = names.map(name => {
  const node = declarations.find(item => item.id.name === name)
  assert.ok(node, `Actual Parent component ${name} exists`)
  return source.slice(node.start, node.end)
}).join('\n')
const entry = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {View,Text,Pressable,StyleSheet,Platform} from 'react-native';
import ParentIcon from './apps/parent-mobile/src/ParentIcon.js';
import {MatchResultIcon} from './apps/parent-mobile/src/MatchResultIcon.js';
import {getParentMatchResult} from './apps/parent-mobile/src/matchResult.js';
import {BrandLoader} from './apps/mobile-core/src/BrandLoader.js';
import {createParentMobileTheme} from './apps/mobile-core/src/parentThemeCore.js';
import {getMatchDayDisplayName} from './src/lib/matchday-display.js';
import {getMatchDayShirtChoiceLabel} from './src/lib/matchday-model.js';
import {formatParentProductDateTime,formatParentProductTime} from './apps/mobile-core/src/parentDateTimeCore.js';
import {getParentMatchStatusLabel,getParentMatchStatusBadges,getParentAgendaResponseBadge,getPollDraftOption,canSubmitParentPoll,rankParentPollResults} from './apps/parent-mobile/src/parentExperience.js';
import {getParentEventPresentation,getParentEventDateTimeLabel} from './apps/parent-mobile/src/parentEventPresentation.js';
import {prepareParentUpdates,getParentNotificationPresentation} from './apps/mobile-core/src/parentNotificationInboxCore.js';
let theme;const useParentTheme=()=>theme;
${components}
const link={id:'parent',playerId:'player',linkType:'parent',playerName:'Synthetic Player',themeAccent:'#0c8093'};
const baseMatch={id:'fixture',status:'scheduled',opponent:'Long Visiting Football Club',teamName:'Home team',venueType:'home',matchDate:'2100-09-19',kickoffTime:'10:30',shirtChoice:'home',homeScore:2,awayScore:1,squadDecisionState:'selected'};
const baseEvent={id:'event',eventType:'training',title:'Evening training and team preparation',startsAt:'2100-09-18T17:00:00Z',location:'Training ground'};
const matchInvitation={invitationType:'match_attendance',invitationId:'match-invite',eventId:'fixture',parentLinkId:'parent',childId:'player',sourceRecordId:'request',invitationState:'active',canRespond:true,responseDeadline:'2100-09-19T09:00:00Z',responseState:'pending'};
const eventInvitation={invitationType:'training_attendance',invitationId:'event-invite',eventId:'event',responseState:'pending',isPending:true};
const notifications=[{id:'unread',intentType:'parent_message',title:'New club news',body:'A new club update for your family.',createdAt:'2100-09-17T10:00:00Z',isRead:false},{id:'read',intentType:'resource_shared',title:'Training guide',body:'Your shared training guide is ready.',createdAt:'2100-09-16T10:00:00Z',isRead:true}];
const polls=[{id:'open',title:'Open team poll',status:'open',options:[{id:'one',label:'Morning'},{id:'two',label:'Afternoon'}],votes:[],allowVoteChanges:true},{id:'closed',title:'Completed team poll',status:'closed',options:[{id:'one',label:'Morning'},{id:'two',label:'Afternoon'}],votes:[{optionId:'two'},{optionId:'two'},{optionId:'one'}]},{id:'expired',title:'Expired team poll',status:'open',isExpired:true,options:[{id:'three',label:'Tuesday'}],votes:[]}];
window.calls=[];
function App(){const[state,setState]=useState({scene:'home',mode:'light',offline:false,match:baseMatch,event:baseEvent,invitations:[matchInvitation,eventInvitation]}),[drafts,setDrafts]=useState({});
window.patch=patch=>setState(previous=>({...previous,...patch}));window.reset=()=>{window.calls=[];setDrafts({});setState({scene:'home',mode:'light',offline:false,match:baseMatch,event:baseEvent,invitations:[matchInvitation,eventInvitation]})};window.fixture=baseMatch;window.event=baseEvent;window.matchInvitation=matchInvitation;window.eventInvitation=eventInvitation;
const tokens=createParentMobileTheme({mode:state.mode,selectedLink:link}).tokens;theme={palette:createParentAppPalette(tokens),styles:createParentAppStyles(tokens)};
const callback=(name,...args)=>window.calls.push([name,...args]);
return <View style={{backgroundColor:tokens.background,minHeight:'100vh',padding:16}}>
{state.scene==='home'?<><MatchPreviewCard match={state.match} link={link} invitations={state.invitations} onPress={item=>callback('match',item.id)}/><CalendarCard event={state.event} invitations={state.invitations} onPress={item=>callback('event',item.id)}/><CompactIconAction iconKey='refresh' label='Refresh' onPress={()=>callback('refresh')}/></>:null}
{state.scene==='notifications'?<NotificationsScreen busy={false} isOffline={state.offline} matches={[]} resource={{items:notifications,loading:false,error:''}} onAction={(action,items)=>callback(action,items.map(item=>item.id))} onOpenNotification={item=>callback('openNotification',item.id)} onRetry={()=>callback('retry')}/>:null}
{state.scene==='polls'?<PollsScreen activeActionId='' drafts={drafts} link={link} resource={{items:polls,loading:false,error:''}} onDraftChange={(id,option)=>{setDrafts(previous=>({...previous,[id]:option}));callback('draft',id,option)}} onSubmit={poll=>callback('submit',poll.id)} onDismiss={poll=>callback('dismiss',poll.id)} onRetry={()=>callback('retry')}/>:null}
</View>}
createRoot(document.getElementById('root')).render(<App/>);`
const result = await build({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic',
  loader: { '.js': 'jsx', '.ttf': 'dataurl', '.png': 'dataurl' }, platform: 'browser', conditions: ['browser'], mainFields: ['browser', 'module', 'main'],
  nodePaths: [modules], resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'],
  alias: { react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom'), 'react-native': path.join(modules, 'react-native-web') },
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' }, banner: { js: 'globalThis.process={env:{NODE_ENV:"production"}};' } })
const browser = await chromium.launch({ headless: true })
const output = 'output/playwright/parent-home-status-actions'
await mkdir(output, { recursive: true })
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 844 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<body style="margin:0"><div id="root"></div>')
  await page.addScriptTag({ content: result.outputFiles[0].text })
  const patch = value => page.evaluate(value => window.patch(value), value)
  const checkLayout = async name => {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: no horizontal overflow`)
    await page.screenshot({ path: `${output}/${name}.png`, fullPage: true })
  }
  const checkIconAction = async label => {
    const action = page.getByRole('button', { name: label, exact: true })
    const box = await action.boundingBox()
    assert.ok(box.height >= 44 && box.width >= 44, `${label}: accessible touch target`)
    const decoration = await action.evaluate(element => {
      const style = getComputedStyle(element)
      return { top: style.borderTopWidth, left: style.borderLeftWidth, right: style.borderRightWidth, background: style.backgroundColor }
    })
    assert.deepEqual(decoration, { top: '0px', left: '0px', right: '0px', background: 'rgba(0, 0, 0, 0)' }, `${label}: unboxed action`)
  }
  for (const mode of ['light', 'dark']) for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await page.evaluate(() => window.reset())
    await patch({ mode })
    await page.getByText('Needs response', { exact: true }).first().waitFor()
    assert.equal(await page.getByText('Scheduled', { exact: true }).count(), 0)
    await page.getByText('Selected', { exact: true }).waitFor()
    await checkIconAction('Refresh')
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await page.getByRole('button', { name: /Long Visiting Football Club/ }).click()
    await page.getByRole('button', { name: 'Evening training and team preparation', exact: true }).click()
    assert.deepEqual(await page.evaluate(() => window.calls), [['refresh'], ['match', 'fixture'], ['event', 'event']])
    await checkLayout(`home-${mode}-${width}`)
    await page.evaluate(() => window.patch({ match: { ...window.fixture, availabilityStatus: 'available' }, event: window.event, invitations: [window.matchInvitation, { ...window.eventInvitation, responseState: 'available', isPending: false }] }))
    await page.getByText('Available', { exact: true }).waitFor()
    await page.getByText('Attending', { exact: true }).waitFor()
    await page.evaluate(() => window.patch({ match: { ...window.fixture, availabilityStatus: 'unavailable', squadDecisionState: 'not_selected' }, event: { ...window.event, responseState: 'unavailable' }, invitations: [window.matchInvitation, { ...window.eventInvitation, responseState: 'unavailable', isPending: false }] }))
    await page.getByText('Not available', { exact: true }).waitFor()
    await page.getByText('Not attending', { exact: true }).waitFor()
    await page.getByText('Not selected', { exact: true }).waitFor()
    await page.evaluate(() => window.patch({ match: { ...window.fixture, status: 'live' }, event: { ...window.event, status: 'cancelled' } }))
    await page.getByText('Live', { exact: true }).waitFor()
    await page.getByText('Cancelled', { exact: true }).waitFor()
    await page.getByText('2 - 1', { exact: true }).waitFor()
    await checkLayout(`live-cancelled-${mode}-${width}`)
    await page.evaluate(() => window.patch({ match: { ...window.fixture, status: 'cancelled' }, event: window.event }))
    await page.getByRole('button', { name: /Long Visiting Football Club, Cancelled/ }).getByText('Cancelled', { exact: true }).waitFor()

    await patch({ scene: 'notifications' })
    await checkIconAction('All (2)')
    await checkIconAction('Unread (1)')
    await checkIconAction('Mark all as read')
    await checkIconAction('Clear all')
    await page.getByRole('button', { name: 'Unread (1)', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: 'Read: Training guide', exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Unread: New club news', exact: true }).click()
    await page.getByRole('button', { name: 'Mark as read', exact: true }).click()
    await page.getByRole('button', { name: 'All (2)', exact: true }).click()
    await page.getByRole('button', { name: 'Read: Training guide', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Mark all as read', exact: true }).click()
    await page.getByRole('button', { name: 'Clear all', exact: true }).click()
    assert.deepEqual((await page.evaluate(() => window.calls)).slice(-4), [['openNotification', 'unread'], ['read', ['unread']], ['read', ['unread']], ['clear', ['unread', 'read']]])
    await checkLayout(`notifications-${mode}-${width}`)
    await patch({ offline: true })
    for (const label of ['Clear all', 'Mark all as read', 'Mark as read']) assert.equal(await page.getByRole('button', { name: label, exact: true }).isDisabled(), true, `${label} is disabled offline`)
    const before = await page.evaluate(() => window.calls.length)
    await page.getByRole('button', { name: 'Clear all', exact: true }).evaluate(element => element.click())
    assert.equal(await page.evaluate(() => window.calls.length), before, 'Offline clear cannot invoke a destructive callback')

    await patch({ scene: 'polls', offline: false })
    await checkIconAction('Open (1)')
    await checkIconAction('Results (2)')
    await page.getByRole('heading', { name: 'Open team poll', exact: true }).waitFor()
    await page.getByRole('radio', { name: 'Morning', exact: true }).click()
    await page.getByRole('button', { name: 'Submit response', exact: true }).click()
    assert.deepEqual((await page.evaluate(() => window.calls)).slice(-2), [['draft', 'open', 'one'], ['submit', 'open']])
    await page.getByRole('button', { name: 'Results (2)', exact: true }).click()
    await page.getByRole('heading', { name: 'Completed team poll', exact: true }).waitFor()
    await page.getByRole('heading', { name: 'Expired team poll', exact: true }).waitFor()
    assert.equal(await page.getByRole('radio').count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Submit response', exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Remove from this list', exact: true }).first().click()
    assert.deepEqual((await page.evaluate(() => window.calls)).at(-1), ['dismiss', 'closed'])
    await checkLayout(`poll-results-${mode}-${width}`)
  }
  assert.deepEqual(errors, [])
  console.log('PASS: actual Parent Home statuses, unboxed icon actions, notification filters and offline guards, Poll filters and callbacks at 320/390px in light/dark.')
} finally { await browser.close() }
