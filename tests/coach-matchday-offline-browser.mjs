import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const rootDir = process.cwd()
const modules = path.join(rootDir, 'apps/coach-mobile/node_modules')
const dataSource = await readFile('apps/mobile-core/src/coachMatchDayData.js', 'utf8')
const names = [...dataSource.matchAll(/export (?:async )?function (\w+)/g)].map(match => match[1])
const entry = `
  import React from 'react'; import {createRoot} from 'react-dom/client'; import {View} from 'react-native';
  import {CoachMatchDayScreen} from './apps/coach-mobile/src/CoachMatchDayScreen.js';
  import {useCoachMatchDayBackgroundSync} from './apps/coach-mobile/src/useCoachMatchDayBackgroundSync.js';
  import {createCoachTheme} from './apps/coach-mobile/src/coachThemeCore.js';
  const base = {id:'fixture',clubId:'club',teamId:'team',teamName:'FP TEST',opponent:'Visitors',updatedAt:new Date(Date.now()-300000).toISOString(),
    status:'live',currentMatchPhase:'first_half',timerStatus:'running',timerStartedAt:new Date(Date.now()-300000).toISOString(),timerElapsedSeconds:0,
    homeAway:'away',homeScore:0,awayScore:0,matchDurationMinutes:70,clockMode:'fixed',events:[],squadDecisions:[],isToday:true,hasPresentationState:true};
  window.server=JSON.parse(localStorage.getItem('server')||JSON.stringify(base));
  localStorage.setItem('server',JSON.stringify(window.server));
  window.online=localStorage.getItem('offline')!=='1'; window.listeners=[]; window.calls=[];
  window.setSignal=value=>{window.online=value;localStorage.setItem('offline',value?'0':'1');window.listeners.forEach(fn=>fn({isConnected:value,isInternetReachable:value}));};
  window.readJournal=()=>JSON.parse(localStorage.getItem('journal')||'null');
  const user={id:'user',activeTeamId:'team'},context={id:'context',clubId:'club',teamId:'team',role:'coach',roleRank:30,paymentAccess:{canMutate:true}};
  const contexts=[context];
  window.navigations=[];
  function App(){const [mode,setMode]=React.useState('dark');window.setMode=setMode;const [show,setShow]=React.useState(true);const [target,setTarget]=React.useState(JSON.parse(localStorage.getItem('entryTarget')||'null')||{fixtureId:'fixture',requestId:'one'});window.leaveMatch=()=>setShow(false);
    useCoachMatchDayBackgroundSync({user,contexts,enabled:!show});
    return show?<View style={{padding:16,backgroundColor:createCoachTheme({mode,context:{clubAccent:'#1d4079'}}).tokens.background,minHeight:'100vh'}}><CoachMatchDayScreen user={user} context={context} palette={createCoachTheme({mode,context:{clubAccent:'#1d4079'}}).tokens}
      matchDayTarget={target} onMatchDayTargetHandled={()=>setTarget(null)} onNavigate={(route,target)=>{window.navigations.push({route,target});setShow(false)}}/></View>:<div>Home</div>;}
  createRoot(document.getElementById('root')).render(<App/>);
`
const implemented = new Set(['createCoachMatchDayCommandId','getCoachMatchDayList','getCoachMatchDayDetail','normalizeCoachMatchDay','syncCoachMatchDayCommand','setCoachMatchDaySquadDecision','setCoachMatchDaySquadDecisions','notifyCoachMatchDaySquadDecisions'])
const dataMock = `
  import {projectMatchDayCommand} from './apps/mobile-core/src/matchDayOutboxCore.js';
  export const createCoachMatchDayCommandId=()=>crypto.randomUUID();
  export const normalizeCoachMatchDay=value=>value;
  const requireSignal=()=>{if(!window.online){window.failedRefresh=(window.failedRefresh||0)+1;throw new Error('Waiting for a connection.');}};
  export async function getCoachMatchDayList(){requireSignal();return [window.server]}
  export async function getCoachMatchDayDetail(){requireSignal();await new Promise(resolve=>setTimeout(resolve,50));return window.server}
  export async function setCoachMatchDaySquadDecision(user,match,id,decision){await new Promise(resolve=>setTimeout(resolve,30));window.server={...window.server,squadDecisions:[...window.server.squadDecisions.filter(row=>row.playerId!==id),{playerId:id,status:decision,decisionRevision:id+'-revision',decidedAt:'now'}]};return window.server;}
  export async function setCoachMatchDaySquadDecisions(user,match,choices){window.squadSaveCalls=(window.squadSaveCalls||0)+1;for(const {player,decision} of choices) await setCoachMatchDaySquadDecision(user,match,player.id,decision);return window.server;}
  export async function notifyCoachMatchDaySquadDecisions(user,match,choices){window.squadNotifyCalls=(window.squadNotifyCalls||0)+1;return choices.map(p=>({playerId:p.id,revision:p.decisionRevision,sent:true}));}
  export async function syncCoachMatchDayCommand(user,command){
    requireSignal();window.calls.push(command.id); if(localStorage.getItem('conflict')==='1') throw Object.assign(new Error('Match changed on another device'),{code:'40001'});
    if(command.kind==='event' && command.payload.eventType==='substitution' && command.payload.playerName==='Paul') throw Object.assign(new Error('Choose one selected Match squad Player from this fixture Team.'),{code:'22023'});
    const accepted=JSON.parse(localStorage.getItem('accepted')||'{}');
    if(!accepted[command.id]){window.server=projectMatchDayCommand(window.server,command);window.server.updatedAt=new Date().toISOString();accepted[command.id]=window.server;
      localStorage.setItem('accepted',JSON.stringify(accepted));localStorage.setItem('server',JSON.stringify(window.server));}
    if(window.loseResponse){window.loseResponse=false;throw new Error('Response lost');}
    return accepted[command.id];
  }
  ${names.filter(name=>!implemented.has(name)).map(name=>`export async function ${name}(){throw new Error('Unexpected call: ${name}')}`).join('\n')}
`
const mocks = [
  [/coachFormationBoardData$/, `export const getCoachFormationBoards=async()=>[];export const deleteCoachFormationBoard=async()=>{throw new Error('No saved boards in this fixture')}`],
  // Kit rendering and permissions have their own browser and database checks.
  [/ClubKitDisplay(?:\.js)?$/, 'export const ClubKitDisplay=()=>null;'],
  [/coachSquadTemplateData$/, 'export const createCoachSquadTemplateStore=()=>async()=>[];'],
  [/coachMatchDayData(?:\.js)?$/, dataMock],
  [/coachPlayersData$/, `export async function getCoachPlayerList(){return [{id:'squad-a',playerName:'Squad Alex'},{id:'squad-b',playerName:'Squad Bailey'}]}`],
  [/\/offline$/, `export async function readCoachOfflineResources(){return JSON.parse(localStorage.getItem('resources')||'null')}
    export async function saveCoachOfflineResources(user,context,resources){localStorage.setItem('resources',JSON.stringify({resources}));}
    export async function readCoachMatchDayOutbox(){return window.readJournal()}
    export async function getPendingCoachMatchDays(){return window.readJournal()?.pending.length?[{contextId:'context',matchId:'fixture'}]:[]}
    export async function updateCoachMatchDayOutbox(user,context,match,change){const value=change(window.readJournal());localStorage.setItem('journal',JSON.stringify(value));return value;}`],
  [/\/config$/, 'export const getMobileRuntimeConfig=()=>({isProduction:true,isUsable:true});'],
  [/BrandLoader$/, 'export const BrandLoader=()=>null;'],
  [/CoachFormationBoard$/, 'export const CoachFormationBoard=()=>null;'],
  [/CoachFixtureForm$/, `export const CoachFixtureForm=({match,onCancel,onUpdated})=><div><p>Editing fixture {match.id}</p><button onClick={onCancel}>Cancel fixture edit</button><button onClick={()=>onUpdated({...match,matchDate:'2099-09-20'})}>Save fixture edit</button></div>;`],
  [/CoachGuestScorer$/, 'export const CoachGuestScorer=()=>null;'],
  [/^expo-keep-awake$/, 'export const isAvailableAsync=async()=>false;export const activateKeepAwakeAsync=async()=>{};export const deactivateKeepAwake=async()=>{};'],
  [/^react-native$/, `export * from 'rn-web';export const AppState={currentState:'active',addEventListener(){return {remove(){}}}};`],
]
const result = await build({ stdin: { contents: entry, resolveDir: rootDir, loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic', loader: {'.js':'jsx','.ttf':'dataurl','.png':'dataurl'}, platform:'browser',conditions:['browser'],mainFields:['browser','module','main'],nodePaths:[modules],resolveExtensions:['.web.tsx','.web.ts','.web.js','.tsx','.ts','.jsx','.js','.json'], banner:{js:'globalThis.process={env:{NODE_ENV:"production"}};'},
  alias:{'rn-web':path.join(modules,'react-native-web'),react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom')},
  define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'},
  plugins:[{name:'synthetic-transport-and-storage',setup(builder){
    for(const [index,[filter]] of mocks.entries()) builder.onResolve({filter},()=>({path:String(index),namespace:'mock'}));
    builder.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[Number(args.path)][1],loader:'jsx',resolveDir:rootDir}));
  }}] })
const browser = await chromium.launch({headless:true})
try {
  const page = await browser.newPage({viewport:{width:390,height:844}})
  const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error(error.message)})
  await page.route('http://localhost:9876/**',route=>route.fulfill({contentType:'text/html',body:'<html style="scrollbar-gutter:stable"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>'}))
  const mount = async()=>{await page.goto('http://localhost:9876/');await page.addScriptTag({content:result.outputFiles[0].text})}
  await mount()
  await page.waitForFunction(()=>window.readJournal()?.baseMatch?.id==='fixture')
  if(!process.argv.includes('--squad-only')) {
  await page.getByRole('button',{name:'Goal',exact:true}).waitFor().catch(async error=>{console.error((await page.locator('body').innerText()).slice(0,2500));throw error})
  await page.evaluate(()=>window.setSignal(false))
  await page.waitForFunction(()=>window.failedRefresh>0, null, {timeout:25000})
  assert.equal(await page.getByRole('button',{name:'Goal',exact:true}).isEnabled(),true)
  await page.getByRole('button',{name:'Goal',exact:true}).click()
  await page.getByLabel('Scorer',{exact:true}).fill('FP TEST')
  await page.getByRole('button',{name:'Record goal',exact:true}).click()
  await page.getByText('1 action saved on this device',{exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>window.server.awayScore),0)
  assert.equal(await page.getByRole('button',{name:'Goal',exact:true}).isEnabled(),true)
  await mount()
  await page.getByText('1 action saved on this device',{exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Goal',exact:true}).isEnabled(),true)
  await page.evaluate(()=>window.setSignal(true))
  await page.waitForFunction(()=>window.readJournal()?.pending.length===0)
  assert.equal(await page.evaluate(()=>window.server.awayScore),1)
  assert.equal(await page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('accepted'))).length),1)
  await page.evaluate(()=>window.setSignal(false))
  await page.getByRole('button',{name:'Goal',exact:true}).click()
  await page.getByLabel('Scorer',{exact:true}).fill('FP TEST Second')
  await page.getByRole('button',{name:'Record goal',exact:true}).click()
  await page.getByText('1 action saved on this device',{exact:true}).waitFor()
  await page.evaluate(()=>window.leaveMatch())
  await page.getByText('Home',{exact:true}).waitFor({timeout:5000}).catch(async error => { console.error(errors, await page.locator('body').innerText()); throw error })
  await page.evaluate(()=>window.setSignal(true))
  await page.waitForFunction(()=>window.readJournal()?.pending.length===0)
  assert.equal(await page.evaluate(()=>window.server.awayScore),2)
  assert.equal(await page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('accepted'))).length),2)

  await page.evaluate(()=>{
    const journal=window.readJournal();
    const capturedAt=new Date().toISOString();
    journal.pending=[{id:'conflicting-action',matchId:'fixture',kind:'event',payload:{eventType:'substitution',minute:30,scorerName:'FP TEST'},capturedAt,expectedUpdatedAt:journal.baseMatch.updatedAt,previousCommandId:null}];
    localStorage.setItem('journal',JSON.stringify(journal));
    localStorage.setItem('server',JSON.stringify({...window.server,status:'full_time',timerStatus:'full_time',currentMatchPhase:'full_time',homeScore:2,awayScore:0,updatedAt:capturedAt}));
    localStorage.setItem('conflict','1');
  })
  await mount()
  await page.getByText('1 action saved on this device',{exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Review and conclude',exact:true}).count(),0)
  await page.getByRole('button',{name:'Discard saved actions',exact:true}).click()
  await page.getByRole('button',{name:'Cancel',exact:true}).click()
  assert.equal(await page.evaluate(()=>window.readJournal().pending.length),1)
  await page.getByRole('button',{name:'Discard saved actions',exact:true}).click()
  await page.getByRole('button',{name:'Confirm',exact:true}).click()
  await page.waitForFunction(()=>window.readJournal().pending.length===0)
  await page.getByRole('button',{name:'Review and conclude',exact:true}).click()
  await page.getByText('Final result',{exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Conclude match',exact:true}).isEnabled(),true)
  for (const action of ['Cancel', 'Save']) {
    await page.evaluate(() => {
      localStorage.clear();
      const fixture={id:'fixture',clubId:'club',teamId:'team',status:'scheduled',timerStatus:'not_started',matchDate:'2099-09-19',opponent:'Visitors',events:[],squadDecisions:[]};
      localStorage.setItem('server',JSON.stringify(fixture));
      localStorage.setItem('entryTarget',JSON.stringify({fixtureId:'fixture',requestId:'calendar-edit',intent:'edit-fixture',returnCalendarTarget:{sourceId:'fixture',sourceType:'match_day'}}));
    })
    await mount()
    await page.getByText('Editing fixture fixture',{exact:true}).waitFor()
    await page.getByRole('button',{name:action+' fixture edit',exact:true}).click()
    await page.getByText('Home',{exact:true}).waitFor()
    assert.deepEqual(await page.evaluate(()=>window.navigations[0]), {route:'calendar',target:{sourceId:'fixture',sourceType:'match_day',...(action==='Save'?{occurrenceDate:'2099-09-20'}:{})}})
  }
  await page.evaluate(() => {
    const fixture=JSON.parse(localStorage.getItem('server'));
    localStorage.setItem('resources',JSON.stringify({resources:{matchDayList:[fixture],matchDayDetail:fixture,matchDayPlayers:[]}}));
    localStorage.setItem('server',JSON.stringify({...fixture,status:'live',timerStatus:'running'}));
  })
  await mount()
  await page.getByText('This fixture cannot be edited in the current Team context or match state.',{exact:true}).waitFor()
  assert.equal(await page.getByText('Editing fixture fixture',{exact:true}).count(),0,'A cached scheduled fixture must not open the editor after the server reports it live')
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('server',JSON.stringify({id:'fixture',clubId:'club',clubName:'FP TEST Club',teamId:'team',teamName:'U14 JPL 26/27',opponent:'Visitors',homeAway:'away',status:'scheduled',timerStatus:'not_started',matchDate:'2099-09-19',kickoffTime:'10:45',arrivalTime:'10:00',fixtureType:'cup',venueName:'Bourne AGP 3G Fontwell Drive PE10 0YE (Pitch 1)',notes:'Please arrive at 10:00 or just before; we only have 45 mins to change and warm up.',clockMode:'fixed',matchDurationMinutes:70,events:[],squadDecisions:[]}));
    localStorage.setItem('entryTarget',JSON.stringify({requestId:'list'}));
  })
  await mount()
  await page.getByRole('button',{name:'Upcoming',exact:true}).click()
  await page.getByText('Visitors v FP TEST Club',{exact:true}).waitFor()
  await page.getByText('19:09:2099 | 10:45',{exact:true}).waitFor()
  assert.equal(await page.getByText('Visitors v U14 JPL 26/27',{exact:true}).count(),0)
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  await mkdir('output/playwright/club-match-name',{recursive:true})
  await page.screenshot({path:'output/playwright/club-match-name/coach-upcoming.png',fullPage:true})
  for (const name of ['Availability', 'Team Chat', 'Calendar']) assert.equal(await page.getByRole('button', { name, exact: true }).count(), 0)
  for (const mode of ['light', 'dark']) for (const width of [320, 390]) {
    await page.evaluate(value => window.setMode(value), mode)
    await page.setViewportSize({ width, height: 844 })
    const tab = page.getByRole('button', { name: 'Upcoming', exact: true })
    assert.equal(await tab.getAttribute('aria-selected'), 'true')
    const look = await tab.evaluate(element => { const style = getComputedStyle(element); return { radius: style.borderTopLeftRadius, top: style.borderTopWidth, bottom: style.borderBottomWidth } })
    assert.deepEqual(look, { radius: '0px', top: '0px', bottom: '2px' })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: `output/playwright/club-match-name/compact-${mode}-${width}.png`, fullPage: true })
  }
  await page.getByText('Visitors v FP TEST Club', { exact: true }).click()
  await page.getByRole('button', { name: 'Back to fixtures', exact: true }).waitFor()
  assert.equal(await page.getByText('scheduled', { exact: true }).count(), 0)
  await page.getByRole('heading', { name: 'Visitors v FP TEST Club', exact: true }).waitFor()
  assert.equal(await page.getByText('Pre-match', { exact: true }).count(), 0)
  assert.equal(await page.getByText('Game Day', { exact: true }).count(),0)
  await page.getByRole('button',{name:'Edit fixture',exact:true}).click()
  await page.getByText('Editing fixture fixture',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Cancel fixture edit',exact:true}).click()
  await page.getByRole('button',{name:'More match options',exact:true}).click()
  await page.getByRole('button',{name:'Timeline',exact:true}).click()
  assert.equal(await page.getByRole('button',{name:'More match options',exact:true}).getAttribute('aria-selected'),'true')
  await page.getByRole('button',{name:'Overview',exact:true}).click()
  for(const mode of ['light','dark']) for(const width of [320,390]) {
    await page.evaluate(value=>window.setMode(value),mode)
    await page.setViewportSize({width,height:844})
    const navNames=['Overview','Squad','Formation','Volunteers','Live','More match options']
    const boxes=await Promise.all(navNames.map(name=>page.getByRole('button',{name,exact:true}).boundingBox()))
    assert.ok(boxes.every(box=>box.width>=44 && box.height>=44))
    assert.ok(boxes.every(box=>Math.abs(box.y-boxes[0].y)<1),'All six tabs fit one row')
    const heading=await page.getByRole('heading',{name:'Visitors v FP TEST Club',exact:true}).boundingBox()
    assert.ok(heading.y<boxes[0].y,'Match heading precedes navigation')
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    await page.screenshot({path:`output/playwright/club-match-name/overview-${mode}-${width}.png`,fullPage:true})
  }
  }
  await page.evaluate(()=>{window.server={...window.server,status:'scheduled',timerStatus:'not_started',squadDecisions:[],squadNotificationContacts:['squad-a','squad-b'].map(playerId=>({playerId,canNotify:true,hasContact:true,emailRecipientCount:1}))};localStorage.clear();localStorage.setItem('server',JSON.stringify(window.server))})
  await mount()
  await page.getByRole('button',{name:'Squad',exact:true}).click()
  await page.getByRole('button',{name:'Selected: Squad Alex',exact:true}).click()
  await page.getByRole('button',{name:'Selected: Squad Bailey',exact:true}).click()
  await page.getByRole('button',{name:'Save and send notifications',exact:true}).click()
  await page.getByText('Notifications queued for 2 players.',{exact:true}).waitFor({timeout:3000}).catch(async error=>{console.error('Notification endpoint calls:',await page.evaluate(()=>window.squadNotifyCalls||0));console.error((await page.locator('body').innerText()).slice(-1800));throw error})
  assert.equal(await page.evaluate(()=>window.squadSaveCalls),1);
  assert.equal(await page.evaluate(()=>window.squadNotifyCalls),1,'The screen must call Notify after saving without waiting for a React render')
  await page.evaluate(()=>{
    localStorage.clear();
    const now=Date.now();const timestamp=new Date(now-60000).toISOString();
    window.server={...window.server,status:'live',timerStatus:'running',timerStartedAt:timestamp,updatedAt:timestamp,homeScore:1,awayScore:0,events:[],squadDecisions:[]};
    localStorage.setItem('server',JSON.stringify(window.server));
    const pending=[{id:'bad-sub',matchId:'fixture',kind:'event',payload:{eventType:'substitution',teamSide:'club',minute:3,playerName:'Paul',playerOnName:'Other: Pat'},capturedAt:timestamp,expectedUpdatedAt:timestamp,previousCommandId:null},
      {id:'pending-full',matchId:'fixture',kind:'timer',payload:{action:'full_time'},capturedAt:new Date(now-30000).toISOString(),expectedUpdatedAt:null,previousCommandId:'bad-sub'}];
    localStorage.setItem('journal',JSON.stringify({baseMatch:window.server,pending,verifiedAt:timestamp,error:''}));
  });
  await mount();
  await page.getByRole('button',{name:'Correct saved event',exact:true}).click();
  await page.getByText('Full time is saved on this device. Sync the remaining actions before concluding the match.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Review and conclude',exact:true}).count(),0);
  for(const mode of ['light','dark']) for(const width of [320,390]) {
    await page.evaluate(value=>window.setMode(value),mode);await page.setViewportSize({width,height:844});
    await page.screenshot({path:`output/playwright/club-match-name/recovery-${mode}-${width}.png`,fullPage:true});
    const overflow = await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,elements:[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth).map(el=>({tag:el.tagName,text:el.textContent.slice(0,80),right:el.getBoundingClientRect().right})).slice(-12)}));
    assert.ok(overflow.scroll<=width,JSON.stringify({mode,...overflow}));
    for(const label of ['Player off','Player off shirt number']) {
      const fits = await page.getByRole('textbox',{name:label,exact:true}).evaluate(el=>el.parentElement.scrollWidth<=el.parentElement.clientWidth);
      assert.equal(fits,true,`${label} input and Choose action fit their row at ${width}`);
    }
  }
  await page.getByRole('button',{name:'Other',exact:true}).first().click();
  await page.getByRole('button',{name:'Save correction and sync',exact:true}).click();
  await page.waitForFunction(()=>window.readJournal()?.pending.length===0);
  assert.equal(await page.evaluate(()=>window.server.status),'full_time');
  assert.equal(await page.evaluate(()=>window.server.homeScore),1);
  assert.equal(await page.evaluate(()=>window.server.events.at(-1).playerName),'Other: Paul');
  assert.deepEqual(errors,[])
  console.log('PASS actual Coach Match Day screen and hooks: offline goal remains enabled, survives reload, syncs exactly once, and another goal syncs after leaving Match Day.')
} finally {await browser.close()}
