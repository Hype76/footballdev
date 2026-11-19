import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium, webkit, devices } from 'playwright'
import path from 'node:path'

const modules = path.resolve('apps/coach-mobile/node_modules')
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import{useCoachOfflinePreparation}from'./apps/coach-mobile/src/useCoachOfflinePreparation.js';import{CoachOfflineReadiness}from'./apps/coach-mobile/src/CoachOfflineReadiness.js';
window.saved={};window.statuses={};window.fetches=[];window.pending=2;
const contexts=[{id:'team:a',type:'team',role:'coach',teamId:'team-a',clubId:'club-a',clubName:'Club A',teamName:'Team A'},{id:'team:b',type:'team',role:'coach',teamId:'team-b',clubId:'club-b',clubName:'Club B',teamName:'Team B'}];
for(const suffix of ['c','d','e'])contexts.push({id:'team:'+suffix,type:'team',role:'coach',teamId:'team-'+suffix,clubId:'club-'+suffix,clubName:'Club '+suffix.toUpperCase(),teamName:'Team '+suffix.toUpperCase()});
window.contexts=contexts;function App(){const[offline,setOffline]=React.useState(false);window.offline=setOffline;const user=React.useMemo(()=>({id:'coach',clubId:'club-a',activeTeamId:'team-a',coachContexts:contexts,isOfflineProfile:offline}),[offline]);useCoachOfflinePreparation({user,contexts,activeContext:contexts[0],enabled:true});return <CoachOfflineReadiness user={user} context={contexts[0]} styles={{bodyText:{fontSize:14},helperText:{fontSize:12}}}/>};createRoot(document.getElementById('root')).render(<App/>);`
const mocks = [
  [/coachAccountOfflineService$/, `import{prepareCoachAccountOffline}from'./apps/coach-mobile/src/coachAccountOfflinePreparation.js';import{createCoachAccountPreparationCoordinator}from'./apps/coach-mobile/src/coachAccountPreparationCoordinator.js';
    const coordinator=createCoachAccountPreparationCoordinator();
    export const subscribeCoachOfflinePreparation=(id,listener)=>coordinator.subscribe(id,listener);export const notifyCoachOfflinePreparation=id=>coordinator.notify(id);
    window.progressStart=()=>{window.current=true;window.progressRun=coordinator.run('progress',()=>window.current,async(current,report)=>{window.report=report;await new Promise(resolve=>window.finishProgress=resolve);return {cancelled:!current()}},'coach')};
    window.progressReport=(id,status)=>window.report(id,status);window.progressPause=()=>{window.current=false;coordinator.notify('coach');window.finishProgress()};
    window.interruptEngine=()=>{window.engineCurrent=true;window.downloadMode='interrupt';window.engineResult=prepareCoachAccount({id:'coach'},window.contexts,'team:a',()=>window.engineCurrent)};
    window.stopEngine=()=>{window.engineCurrent=false;coordinator.notify('coach');window.releaseEngine()};
    export const prepareCoachAccount=(user,contexts,selected,isCurrent=()=>true)=>window.downloadMode==='cancel'?Promise.resolve({cancelled:true,results:[]}):window.downloadMode==='incomplete'?Promise.resolve({complete:false,results:[{contextId:contexts[0].id,state:'saving',filesSaved:1}]}):coordinator.run('prepare',isCurrent,(current,report)=>prepareCoachAccountOffline({user,contexts,selectedContextId:selected,isCurrent:current,report,
      createSaver:(_u,c)=>async values=>{const saved=window.saved[c.id]||={resources:{},resourceMetadata:{},journals:[]};Object.assign(saved.resources,values);for(const key of Object.keys(values))saved.resourceMetadata[key]={fingerprint:'saved:'+key};return saved},
      saveStatus:async(_id,c,status)=>{window.statuses[c.id]=structuredClone(status)},
      saveMatch:async(_u,c,detail)=>{window.fetches.push(c.id+':'+detail.id);(window.saved[c.id]||={resources:{},resourceMetadata:{},journals:[]}).journals.push({baseMatch:detail})},
      prepareMedia:async(_u,c)=>{if(c.id==='team:b'&&window.downloadMode!=='success')throw Error('One file could not be saved.');return{bytes:1024}},
      loadContext:async(_u,c,{onResource,onMatch,onMedia})=>{if(window.downloadMode==='interrupt'&&c.id==='team:a')await new Promise(resolve=>window.releaseEngine=resolve);await onResource({cacheKey:'players',value:[{id:'player'}],complete:true});for(let i=0;i<(c.id==='team:a'?10:4);i++)await onMatch({id:'match-'+i});await onMedia({id:'file',kind:'file'});return{complete:true,onlineOnly:c.id==='team:b'&&window.downloadMode!=='success'?[{id:'link',title:'Training video'}]:[]}}}),'coach')`],
  [/\/offline$/, `export const getPendingCoachMatchDays=async()=>[];export const readCoachMatchDayOutbox=async()=>null;export const updateCoachMatchDayOutbox=async()=>{};
    export const readCoachOfflineReadiness=async(_id,c)=>({...window.saved[c.id],resources:window.saved[c.id]?.resources||{},journals:window.saved[c.id]?.journals||[],pending:window.pending});
    export const readCoachAccountPreparation=async()=>window.statuses;`],
  [/coachMatchDayData$/, 'export const syncCoachMatchDayCommand=async()=>({});'],
]
const result=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx'},alias:{react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom'),'react-native':path.join(modules,'react-native-web')},define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'},plugins:[{name:'synthetic-offline',setup(b){mocks.forEach(([filter],i)=>b.onResolve({filter},()=>({path:String(i),namespace:'mock'})));b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[Number(args.path)][1],loader:'js',resolveDir:process.cwd()}))}}]})
let ran=0
for (const [name,engine,profile] of [['Android Chromium',chromium,devices['Pixel 5']],['iPhone WebKit',webkit,devices['iPhone 13']]]) {
 let browser
 try { browser=await engine.launch({headless:true}) } catch (error) { if (/Executable doesn't exist|browserType\.launch.*executable/i.test(error.message)) { console.log(`SKIP: ${name} browser is not installed`); continue } throw error }
 try {
 const page=await browser.newPage({...profile,viewport:{width:320,height:800}}),errors=[]
 page.on('pageerror',error=>errors.push(error.message))
 await page.setContent('<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>')
 await page.clock.install()
 await page.addScriptTag({content:result.outputFiles[0].text})
 await page.waitForFunction(()=>typeof window.offline==='function')
 await page.clock.runFor(10_000)
 assert.equal(await page.evaluate(()=>window.fetches.length),0,'Automatic downloads leave the first ten seconds clear for startup')
 await page.clock.runFor(6_000)
 await page.clock.runFor(2_000)
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
 for(const suffix of ['c','d','e']) {
  assert.equal(await page.evaluate(id=>window.statuses[id]?.state,'team:'+suffix),'ready')
  await page.getByText('Club '+suffix.toUpperCase()+' | Team '+suffix.toUpperCase()).waitFor()
 }
 await page.evaluate(()=>{window.offline(false);window.downloadMode='cancel'})
 await page.getByRole('button',{name:'Sync and download all teams'}).click()
 await page.getByText('Download paused before every team was saved. Keep Coach open and connected, then retry.').waitFor()
 assert.equal(await page.getByText(/Download complete/).count(),0)
 await page.evaluate(()=>{window.downloadMode='incomplete'})
 await page.getByRole('button',{name:'Sync and download all teams'}).click()
 await page.getByText('Download incomplete. Check the team statuses and retry while connected.').waitFor()
 assert.equal(await page.getByText(/Download complete/).count(),0)
 await page.evaluate(()=>{window.downloadMode='success';window.pending=0})
 await page.getByRole('button',{name:'Sync and download all teams'}).click()
 await page.getByText('Download complete. All your teams are ready offline.').waitFor()
 assert.equal(await page.evaluate(()=>Object.values(window.statuses).filter(status=>status.state==='ready').length),5)
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 assert.deepEqual(errors,[])
 // Pause a real engine run after its initial checkpoint, then exercise the live phases.
 await page.evaluate(()=>{window.offline(true);window.interruptEngine()})
 await page.waitForFunction(()=>typeof window.releaseEngine==='function')
 await page.evaluate(()=>window.stopEngine())
 assert.equal(await page.evaluate(async()=> (await window.engineResult).cancelled),true)
 assert.equal(await page.evaluate(()=>window.statuses['team:a'].state),'saving')
 await page.evaluate(()=>{window.statuses['team:a']={state:'saving',filesSaved:2};window.statuses['team:b']={state:'saving',filesSaved:0}})
 await page.clock.runFor(16_000)
 await page.evaluate(()=>window.progressStart())
 await page.waitForFunction(()=>typeof window.report==='function')
 await page.evaluate(()=>window.progressReport('team:a',{state:'saving',phase:'records',resourceKey:'playerProfiles',filesSaved:2}))
 await page.getByText('Saving records: player Profiles').waitFor()
 await page.getByText('Waiting to download').waitFor()
 await page.getByText('2 teams remaining').waitFor()
 await page.evaluate(()=>window.progressReport('team:a',{state:'saving',phase:'files',filesTotal:4,filesSaved:2,filesFailed:1}))
 await page.getByText('2 of 4 files saved, 1 failed').waitFor()
 await page.evaluate(()=>window.progressPause())
 await page.getByText('Download paused. 2 files saved. Keep Coach open and connected to resume.').waitFor()
 await page.evaluate(()=>{window.report=null;window.progressStart()})
 await page.waitForFunction(()=>typeof window.report==='function')
 await page.evaluate(()=>window.progressReport('team:a',{state:'saving',phase:'verifying',filesSaved:2}))
 await page.getByText('Checking saved information').waitFor()
 await page.evaluate(()=>window.finishProgress())
 console.log(`PASS: ${name} actual hook, five teams, fixture persistence, failures, retries, startup cadence and live coordinator progress. Storage and network are fixtures.`)
 ran++
 } finally {await browser.close()}
}
assert.ok(ran,'At least one browser must be installed')
