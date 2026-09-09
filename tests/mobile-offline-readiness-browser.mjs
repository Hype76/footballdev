import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import path from 'node:path'
const modules = path.resolve('apps/coach-mobile/node_modules')
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{CoachOfflineReadiness}from'./apps/coach-mobile/src/CoachOfflineReadiness.js';
window.saved={resources:{},journals:[],pending:2};window.fetches=[];window.fail=false;
const context={id:'team',teamId:'team',clubId:'club'},user={id:'coach',activeTeamId:'team'};
function App(){const[offline,setOffline]=React.useState(false);window.offline=setOffline;return <CoachOfflineReadiness user={{...user,isOfflineProfile:offline}} context={context} styles={{card:{padding:16,gap:12},bodyText:{fontSize:14},cardTitle:{fontSize:18},helperText:{fontSize:12}}}/>};createRoot(document.getElementById('root')).render(<App/>);`
const mocks = [
  [/BrandLoader$/, 'export const BrandLoader=()=>null;'],
  [/coachCalendarData$/, 'export const getCoachCalendarResources=async()=>[{id:"event"}];'],
  [/coachPlayersData$/, 'export const getCoachPlayerList=async()=>[{id:"player"}];'],
  [/coachPhase31EData$/, 'export const getCoachDevelopmentWorkspace=async()=>({forms:[{id:"form"}]});'],
  [/coachMatchDayData$/, `export const getCoachMatchDayList=async()=>Array.from({length:10},(_,i)=>({id:'match'+i,matchDate:'2099-10-'+String(i+1).padStart(2,'0'),status:'scheduled'}));
    export const getCoachMatchDayDetail=async(u,id)=>{if(window.fail)throw Error('Connection interrupted');window.fetches.push(id);return{id,clubId:'club',teamId:'team'}};`],
  [/\/offline$/, `export const readCoachOfflineReadiness=async()=>window.saved;
    export const saveCoachOfflineResources=async(u,c,r)=>{window.saved.resources={...window.saved.resources,...r}};
    export const updateCoachMatchDayOutbox=async(u,c,id,change)=>{const next=change(null);window.saved.journals=window.saved.journals.filter(j=>j.baseMatch.id!==id).concat(next);return next;};`],
]
const result=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx'},alias:{react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom'),'react-native':path.join(modules,'react-native-web')},define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'},plugins:[{name:'synthetic-downloads',setup(b){mocks.forEach(([filter],i)=>b.onResolve({filter},()=>({path:String(i),namespace:'mock'})));b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[Number(args.path)][1],loader:'js',resolveDir:process.cwd()}));}}]})
const browser=await chromium.launch({headless:true})
try {
  const page=await browser.newPage({viewport:{width:320,height:800}}),errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>')
  await page.addScriptTag({content:result.outputFiles[0].text})
  await page.getByText(/0 Players, 0 Development forms/).waitFor()
  await page.getByRole('button',{name:'Download for offline',exact:true}).click()
  await page.getByText(/1 Players, 1 Development forms and 8 fixtures/).waitFor()
  assert.equal(await page.evaluate(()=>window.fetches.length),8)
  await page.evaluate(()=>window.fail=true)
  await page.getByRole('button',{name:'Download for offline',exact:true}).click()
  await page.getByText(/Download incomplete/).waitFor()
  assert.equal(await page.evaluate(()=>window.saved.journals.length),8)
  await page.evaluate(()=>window.offline(true))
  await page.waitForFunction(()=>document.querySelector('[role="button"]').getAttribute('aria-disabled')==='true')
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  assert.deepEqual(errors,[])
  console.log('PASS actual readiness screen: exact saved counts, bounded eight-fixture download, partial-failure retention, pending changes and offline controls at 320px.')
} finally { await browser.close() }
