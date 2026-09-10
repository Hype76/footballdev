import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import path from 'node:path'
const modules = path.resolve('apps/coach-mobile/node_modules')
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{useCoachOfflinePreparation}from'./apps/coach-mobile/src/useCoachOfflinePreparation.js';import{CoachOfflineReadiness}from'./apps/coach-mobile/src/CoachOfflineReadiness.js';
window.saved={resources:{},journals:[],pending:2};window.fetches=[];window.fail=false;
const context={id:'team',teamId:'team',clubId:'club'},user={id:'coach',activeTeamId:'team'};
function App(){const[offline,setOffline]=React.useState(false);window.offline=setOffline;const activeUser=React.useMemo(()=>({...user,isOfflineProfile:offline}),[offline]);useCoachOfflinePreparation({user:activeUser,context,enabled:true});return <CoachOfflineReadiness user={{...user,isOfflineProfile:offline}} context={context} styles={{card:{padding:16,gap:12},bodyText:{fontSize:14},cardTitle:{fontSize:18},helperText:{fontSize:12}}}/>};createRoot(document.getElementById('root')).render(<App/>);`
const mocks = [
  [/BrandLoader$/, 'export const BrandLoader=()=>null;'],
  [/coachCalendarData$/, 'export const getCoachCalendarResources=async()=>[{id:"event"}];'],
  [/coachPlayersData$/, 'export const getCoachPlayerList=async()=>[{id:"player"}];'],
  [/coachPhase31EData$/, 'export const getCoachDevelopmentWorkspace=async()=>({forms:[{id:"form"}]});'],
  [/coachMatchDayData$/, `export const getCoachMatchDayList=async()=>Array.from({length:10},(_,i)=>({id:'match'+i,matchDate:'2099-10-'+String(i+1).padStart(2,'0'),status:'scheduled'}));
    export const getCoachMatchDayDetail=async(u,id)=>{if(window.fail)throw Error('Connection interrupted');window.fetches.push(id);return{id,clubId:'club',teamId:'team'}};`],
  [/\/offline$/, `export const readCoachOfflineReadiness=async()=>window.saved; export const readCoachOfflineResources=async()=>window.saved;export const readCoachMatchDayOutbox=async(u,c,id)=>window.saved.journals.find(j=>j.baseMatch.id===id);
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
  assert.equal(await page.getByRole('button').count(),0)
  await page.waitForFunction(()=>window.fetches.length===8)
  assert.equal(await page.evaluate(()=>window.saved.journals.length),8)
  await page.getByText(/1 Players and 8 fixtures/).waitFor()
  await page.getByText(/2 saved changes will sync/).waitFor()
  await page.evaluate(()=>window.offline(true))
  assert.equal(await page.getByRole('button').count(),0)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  assert.deepEqual(errors,[])
  console.log('PASS actual automatic-saving hook and status: no manual controls, eight fixtures saved without user action, retained pending changes, phone width and offline state.')
} finally { await browser.close() }
