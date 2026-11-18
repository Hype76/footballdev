import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import path from 'node:path'

const modules = path.resolve('apps/coach-mobile/node_modules')
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{useCoachOfflinePreparation}from'./apps/coach-mobile/src/useCoachOfflinePreparation.js';import{CoachOfflineReadiness}from'./apps/coach-mobile/src/CoachOfflineReadiness.js';
window.saved={};window.statuses={};window.fetches=[];window.pending=2;
const contexts=[{id:'team:a',type:'team',role:'coach',teamId:'team-a',clubId:'club-a',clubName:'Club A',teamName:'Team A'},{id:'team:b',type:'team',role:'coach',teamId:'team-b',clubId:'club-b',clubName:'Club B',teamName:'Team B'}];
function App(){const[offline,setOffline]=React.useState(false);window.offline=setOffline;const user=React.useMemo(()=>({id:'coach',clubId:'club-a',activeTeamId:'team-a',coachContexts:contexts,isOfflineProfile:offline}),[offline]);useCoachOfflinePreparation({user,contexts,activeContext:contexts[0],enabled:true});return <CoachOfflineReadiness user={user} context={contexts[0]} styles={{bodyText:{fontSize:14},helperText:{fontSize:12}}}/>};createRoot(document.getElementById('root')).render(<App/>);`
const mocks = [
  [/coachAccountOfflineService$/, `import{prepareCoachAccountOffline}from'./apps/coach-mobile/src/coachAccountOfflinePreparation.js';
    export const prepareCoachAccount=(user,contexts,selected,isCurrent=()=>true)=>prepareCoachAccountOffline({user,contexts,selectedContextId:selected,isCurrent,
      createSaver:(_u,c)=>async values=>{const saved=window.saved[c.id]||={resources:{},resourceMetadata:{},journals:[]};Object.assign(saved.resources,values);for(const key of Object.keys(values))saved.resourceMetadata[key]={fingerprint:'saved:'+key};return saved},
      saveStatus:async(_id,c,status)=>{window.statuses[c.id]=structuredClone(status)},
      saveMatch:async(_u,c,detail)=>{window.fetches.push(c.id+':'+detail.id);(window.saved[c.id]||={resources:{},resourceMetadata:{},journals:[]}).journals.push({baseMatch:detail})},
      prepareMedia:async(_u,c)=>{if(c.id==='team:b')throw Error('One file could not be saved.');return{bytes:1024}},
      loadContext:async(_u,c,{onResource,onMatch,onMedia})=>{await onResource({cacheKey:'players',value:[{id:'player'}],complete:true});for(let i=0;i<(c.id==='team:a'?10:4);i++)await onMatch({id:'match-'+i});await onMedia({id:'file',kind:'file'});return{complete:true,onlineOnly:c.id==='team:b'?[{id:'link',title:'Training video'}]:[]}}})`],
  [/\/offline$/, `export const getPendingCoachMatchDays=async()=>[];export const readCoachMatchDayOutbox=async()=>null;export const updateCoachMatchDayOutbox=async()=>{};
    export const readCoachOfflineReadiness=async(_id,c)=>({...window.saved[c.id],resources:window.saved[c.id]?.resources||{},journals:window.saved[c.id]?.journals||[],pending:window.pending});
    export const readCoachAccountPreparation=async()=>window.statuses;`],
  [/coachMatchDayData$/, 'export const syncCoachMatchDayCommand=async()=>({});'],
]
const result=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx'},alias:{react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom'),'react-native':path.join(modules,'react-native-web')},define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'},plugins:[{name:'synthetic-offline',setup(b){mocks.forEach(([filter],i)=>b.onResolve({filter},()=>({path:String(i),namespace:'mock'})));b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[Number(args.path)][1],loader:'js',resolveDir:process.cwd()}))}}]})
const browser=await chromium.launch({headless:true})
try {
 const page=await browser.newPage({viewport:{width:320,height:800}}),errors=[]
 page.on('pageerror',error=>errors.push(error.message))
 await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>')
 await page.addScriptTag({content:result.outputFiles[0].text})
 await page.waitForFunction(()=>window.statuses['team:a']?.state==='ready'&&window.statuses['team:b']?.state==='partial',{timeout:15000})
 assert.equal(await page.evaluate(()=>window.fetches.filter(id=>id.startsWith('team:a:')).length),10)
 assert.equal(await page.evaluate(()=>window.fetches.filter(id=>id.startsWith('team:b:')).length),4)
 assert.equal(await page.evaluate(()=>window.statuses['team:a'].filesSaved),1)
 assert.equal(await page.evaluate(()=>window.statuses['team:a'].fileBytesSaved),1024)
 assert.equal(await page.evaluate(()=>window.statuses['team:b'].filesFailed),1)
 await page.evaluate(()=>window.offline(true))
 await page.getByText(/1 Players and 10 fixtures saved/).waitFor()
 await page.getByText(/2 saved changes will sync/).waitFor()
 await page.getByText('Club A | Team A').waitFor();await page.getByText('Club B | Team B').waitFor()
 await page.getByText('1 file still need downloading').waitFor()
 await page.getByText('Training video: internet required').waitFor()
 assert.equal(await page.getByRole('button',{name:'Sync and download all teams'}).count(),1)
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 assert.deepEqual(errors,[])
 console.log('PASS: actual automatic hook prepares both clubs and all fixtures; status tracks saved bytes, failed files, online-only links, pending changes and narrow layout.')
} finally {await browser.close()}
