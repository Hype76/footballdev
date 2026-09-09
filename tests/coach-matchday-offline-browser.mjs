import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const rootDir = process.cwd()
const modules = path.join(rootDir, 'apps/coach-mobile/node_modules')
const dataSource = await readFile('apps/mobile-core/src/coachMatchDayData.js', 'utf8')
const names = [...dataSource.matchAll(/export (?:async )?function (\w+)/g)].map(match => match[1])
const entry = `
  import React from 'react'; import {createRoot} from 'react-dom/client';
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
  function App(){const [show,setShow]=React.useState(true);window.leaveMatch=()=>setShow(false);
    useCoachMatchDayBackgroundSync({user,contexts,enabled:!show});
    return show?<CoachMatchDayScreen user={user} context={context} palette={createCoachTheme({mode:'dark'}).tokens}
      matchDayTarget={{fixtureId:'fixture',requestId:'one'}} onMatchDayTargetHandled={()=>{}} onNavigate={()=>{}}/>:<div>Home</div>;}
  createRoot(document.getElementById('root')).render(<App/>);
`
const implemented = new Set(['createCoachMatchDayCommandId','getCoachMatchDayList','getCoachMatchDayDetail','normalizeCoachMatchDay','syncCoachMatchDayCommand'])
const dataMock = `
  import {projectMatchDayCommand} from './apps/mobile-core/src/matchDayOutboxCore.js';
  export const createCoachMatchDayCommandId=()=>crypto.randomUUID();
  export const normalizeCoachMatchDay=value=>value;
  const requireSignal=()=>{if(!window.online){window.failedRefresh=(window.failedRefresh||0)+1;throw new Error('Waiting for a connection.');}};
  export async function getCoachMatchDayList(){requireSignal();return [window.server]}
  export async function getCoachMatchDayDetail(){requireSignal();return window.server}
  export async function syncCoachMatchDayCommand(user,command){
    requireSignal();window.calls.push(command.id);
    const accepted=JSON.parse(localStorage.getItem('accepted')||'{}');
    if(!accepted[command.id]){window.server=projectMatchDayCommand(window.server,command);window.server.updatedAt=new Date().toISOString();accepted[command.id]=window.server;
      localStorage.setItem('accepted',JSON.stringify(accepted));localStorage.setItem('server',JSON.stringify(window.server));}
    if(window.loseResponse){window.loseResponse=false;throw new Error('Response lost');}
    return accepted[command.id];
  }
  ${names.filter(name=>!implemented.has(name)).map(name=>`export async function ${name}(){throw new Error('Unexpected call: ${name}')}`).join('\n')}
`
const mocks = [
  [/coachSquadTemplateData$/, 'export const createCoachSquadTemplateStore=()=>async()=>[];'],
  [/coachMatchDayData(?:\.js)?$/, dataMock],
  [/coachPlayersData$/, 'export async function getCoachPlayerList(){return []}'],
  [/\/offline$/, `export async function readCoachOfflineResources(){return JSON.parse(localStorage.getItem('resources')||'null')}
    export async function saveCoachOfflineResources(user,context,resources){localStorage.setItem('resources',JSON.stringify({resources}));}
    export async function readCoachMatchDayOutbox(){return window.readJournal()}
    export async function getPendingCoachMatchDays(){return window.readJournal()?.pending.length?[{contextId:'context',matchId:'fixture'}]:[]}
    export async function updateCoachMatchDayOutbox(user,context,match,change){const value=change(window.readJournal());localStorage.setItem('journal',JSON.stringify(value));return value;}`],
  [/\/config$/, 'export const getMobileRuntimeConfig=()=>({isProduction:true,isUsable:true});'],
  [/BrandLoader$/, 'export const BrandLoader=()=>null;'],
  [/CoachFormationBoard$/, 'export const CoachFormationBoard=()=>null;'],
  [/CoachFixtureForm$/, 'export const CoachFixtureForm=()=>null;'],
  [/CoachGuestScorer$/, 'export const CoachGuestScorer=()=>null;'],
  [/CoachSquadPanel$/, 'export const CoachSquadPanel=()=>null;'],
  [/^@expo\/vector-icons\/MaterialIcons$/, 'export default ()=>null;'],
  [/^expo-keep-awake$/, 'export const isAvailableAsync=async()=>false;export const activateKeepAwakeAsync=async()=>{};export const deactivateKeepAwake=async()=>{};'],
  [/^react-native$/, `export * from 'rn-web';export const AppState={currentState:'active',addEventListener(){return {remove(){}}}};`],
]
const result = await build({ stdin: { contents: entry, resolveDir: rootDir, loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic', loader: {'.js':'jsx'},
  alias:{'rn-web':path.join(modules,'react-native-web'),react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom')},
  define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'},
  plugins:[{name:'synthetic-transport-and-storage',setup(builder){
    for(const [index,[filter]] of mocks.entries()) builder.onResolve({filter},()=>({path:String(index),namespace:'mock'}));
    builder.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[Number(args.path)][1],loader:'jsx',resolveDir:rootDir}));
  }}] })
const browser = await chromium.launch({headless:true})
try {
  const page = await browser.newPage({viewport:{width:390,height:844}})
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.route('http://localhost:9876/**',route=>route.fulfill({contentType:'text/html',body:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>'}))
  const mount = async()=>{await page.goto('http://localhost:9876/');await page.addScriptTag({content:result.outputFiles[0].text})}
  await mount()
  await page.waitForFunction(()=>window.readJournal()?.baseMatch?.id==='fixture')
  await page.getByRole('button',{name:'Goal',exact:true}).waitFor()
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
  assert.deepEqual(errors,[])
  console.log('PASS actual Coach Match Day screen and hooks: offline goal remains enabled, survives reload, syncs exactly once, and another goal syncs after leaving Match Day.')
} finally {await browser.close()}
