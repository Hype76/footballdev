import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'
const modules = path.resolve('apps/coach-mobile/node_modules')
const source = await readFile('apps/coach-mobile/src/CoachPhase31EScreens.js', 'utf8')
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end))
const domain = extract('function DevelopmentDomain(', '\nfunction ResourcesDomain(')
const styles = extract('function phaseStyles(', '\nfunction InviteDeliveryTicks')
const button = extract('function Button(', '\nfunction Empty(')
const empty = extract('function Empty(', '\nexport function CoachPhase31EScreen(')
const entry = `import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';import {createRoot} from 'react-dom/client';
import {Alert,Keyboard,Pressable,StyleSheet,Text,TextInput,View} from 'react-native';
import {createCoachTheme} from './apps/coach-mobile/src/coachThemeCore.js';
import {mergeUnfinishedDevelopmentDrafts} from './apps/mobile-core/src/developmentOfflineCore.js';
import {readCoachDevelopmentDrafts} from './apps/coach-mobile/src/offline';
import {DevelopmentOfflineEditor as ActualEditor} from './apps/coach-mobile/src/DevelopmentOfflineEditor.js';
import {subscribeDevelopmentSync,notifyDevelopmentSync,syncCoachDevelopmentDrafts} from './apps/coach-mobile/src/coachDevelopmentSync.js';
import {useCoachDevelopmentSync} from './apps/coach-mobile/src/useCoachDevelopmentSync.js';
const MaterialIcons=()=>null;
const DevelopmentOfflineEditor=props=>{window.savedCallbacks??=[];window.savedCallbacks.push(props.onQueued);return <ActualEditor {...props} onQueued={event=>{window.acknowledgements.push({...event,at:performance.now()});props.onQueued(event)}}/>};
Alert.alert=(_title,_copy,buttons)=>buttons.find(b=>['Finalise and share','Finalise privately','Cancel assessment'].includes(b.text))?.onPress();
window.form={id:'form',name:'Elite attacking review',version:1,fields:[{id:'rating',label:'Finishing',type:'score_1_10',roleRank:0,options:[]}]};
window.workspace={forms:[window.form],players:[{id:'one',playerName:'Alex',teamId:'team'},{id:'two',playerName:'Bailey',teamId:'team'}]};
window.acknowledgements=[];window.finalRecords={};window.finalCalls=0;window.loads=0;window.failFinal=false;window.remoteDelay=1500;
const context={id:'team',teamId:'team',clubId:'club',role:'coach',roleRank:30,authorityId:'assignment',authoritySource:'team_staff'};const contexts=[context];
${styles}\n${button}\n${empty}\n${domain}
function App(){const [account,setAccount]=useState('coach'),[mode,setMode]=useState('light'),[notice,setNotice]=useState(''),[visible,setVisible]=useState(true);
window.account=setAccount;window.mode=setMode;window.emit=notifyDevelopmentSync;window.show=setVisible;
const user=React.useMemo(()=>({id:account,clubId:'club',activeTeamId:'team',roleRank:30}),[account]);
useCoachDevelopmentSync({user,contexts,enabled:true});
const palette=createCoachTheme({mode,context:{clubAccent:'#1d4079'}}).tokens;
const data={...window.workspace,records:[],drafts:[]};
return <View style={{backgroundColor:palette.background,minHeight:'100vh',padding:12}}><Text accessibilityRole='header'>Development</Text>{visible?<DevelopmentDomain context={context} data={data} load={()=>{window.loads++}} setNotice={setNotice} stale={false} styles={phaseStyles(palette)} user={user}/>:<Text>More</Text>}<Text accessibilityLabel='Development notice'>{notice}</Text></View>}
createRoot(document.getElementById('root')).render(<App/>);`
const storage = `import {editLocalDevelopmentDraft,developmentDraftKey} from './apps/mobile-core/src/developmentOfflineCore.js';
let chain=Promise.resolve();const read=user=>JSON.parse(localStorage.getItem('drafts:'+user)||'{}');
export const readCoachDevelopmentDrafts=async user=>{await chain;if(window.holdNextRead){window.holdNextRead=false;await new Promise(resolve=>{window.releaseHeldRead=resolve})};if(window.readFailures>0){window.readFailures--;throw Error('Synthetic local read failure')};return read(user)};
export function updateCoachDevelopmentDraft(user,context,key,change){const task=chain.then(()=>{const all=read(user),next=change(all[key]||null);if(next)all[key]=next;else delete all[key];localStorage.setItem('drafts:'+user,JSON.stringify(all));return next});chain=task.catch(()=>{});return task}
export const saveLocalCoachDevelopmentDraft=(user,context,input)=>updateCoachDevelopmentDraft(user,context,developmentDraftKey(input.playerId,input.formId),previous=>{if(previous?.finalisation||previous?.discardRequested)throw Error('Already queued');return editLocalDevelopmentDraft(previous,{...input,id:previous?.id||crypto.randomUUID()})});
export const createCoachDevelopmentDraftSaver=(user,context)=>input=>saveLocalCoachDevelopmentDraft(user,context,input);`
const transport = `export const discardCoachDevelopmentDraft=async(user,request)=>{window.discards??=[];window.discards.push(request.draftId);if(window.failDiscard)throw Error('Synthetic offline cancellation')};
export const getCoachDevelopmentWorkspace=async()=>window.workspace;
export const saveCoachDevelopmentDraft=async(user,request)=>{await new Promise(r=>setTimeout(r,window.remoteDelay));return {clientSaveVersion:request.clientSaveVersion+1,lastSavedAt:new Date().toISOString()}};
export const finalizeCoachDevelopmentRecord=async(user,request)=>{if(!request.isCurrent())throw Error('Account changed');window.finalCalls++;window.finalRecords[request.draftId]??={id:request.draftId,account:user.id};await new Promise(r=>setTimeout(r,window.remoteDelay));if(!request.isCurrent())throw Error('Account changed');if(window.failFinal){window.failFinal=false;throw Error('Lost confirmation')};return window.finalRecords[request.draftId]};`
const mocks = [[/\/offline$/,storage],[/coachContextCore$/,`export const applyCoachContext=user=>user`],[/coachPhase31EData$/,transport]]
const built = await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx'},
  alias:{react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom'),'react-native':path.join(modules,'react-native-web')},
  define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'},plugins:[{name:'transport-only',setup(b){mocks.forEach(([filter],i)=>b.onResolve({filter},()=>({path:String(i),namespace:'mock'})));b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[Number(args.path)][1],loader:'js',resolveDir:process.cwd()}))}}]})
const browser=await chromium.launch({headless:true})
try {
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.route('http://localhost:9882/**',route=>route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>'}))
  await page.goto('http://localhost:9882/');await page.addScriptTag({content:built.outputFiles[0].text})
  const chooseAssessment=async(waitForEditor=true)=>{
    await page.getByRole('button',{name:'Choose Development Player',exact:true}).click()
    await page.getByRole('radio',{name:'Alex. Choose this Player',exact:true}).click()
    await page.getByRole('button',{name:'Choose Development form',exact:true}).click()
    await page.getByRole('radio',{name:'Elite attacking review. Choose this form',exact:true}).click()
    if(waitForEditor) await page.getByLabel('Finishing',{exact:true}).waitFor()
  }
  await page.getByText('Select a Player and form to start Development.',{exact:true}).waitFor()
  await chooseAssessment()
  await page.getByLabel('Finishing',{exact:true}).fill('7')
  await page.getByText('Synced. Private draft saved to your account.',{exact:true}).waitFor()
  const start=await page.evaluate(()=>performance.now())
  await page.getByRole('button',{name:'Save private draft',exact:true}).click()
  await page.getByLabel('Development notice',{exact:true}).filter({hasText:'Private draft saved on this phone.'}).waitFor({timeout:1000})
  const draftAckMs=await page.evaluate(()=>window.acknowledgements.at(-1).at)-start
  assert.ok(draftAckMs<1000);assert.equal(await page.getByLabel('Finishing',{exact:true}).inputValue(),'7','Draft save keeps editor open')
  await page.getByText('Synced. Private draft saved to your account.',{exact:true}).waitFor()
  await page.evaluate(()=>window.failFinal=true)
  const finalStart=await page.evaluate(()=>performance.now())
  await page.getByRole('button',{name:'Finalise and share',exact:true}).click()
  await page.getByRole('button',{name:'Open saved assessment',exact:true}).waitFor({timeout:1000})
  await mkdir('output/playwright/development-background-domain',{recursive:true})
  await page.screenshot({path:'output/playwright/development-background-domain/pending-light-390.png',fullPage:true})
  const shareAckMs=await page.evaluate(()=>window.acknowledgements.at(-1).at)-finalStart
  assert.ok(shareAckMs<1000);assert.equal(await page.getByLabel('Finishing',{exact:true}).count(),0)
  assert.equal(await page.getByRole('button',{name:'Choose Development Player',exact:true}).count(),1)
  assert.equal(await page.getByRole('button',{name:'Choose Development form',exact:true}).count(),1)
  assert.equal(await page.getByRole('button',{name:'Show recent forms',exact:true}).count(),1)
  assert.equal(await page.getByText('Development record finalised and shared.',{exact:true}).count(),0,'Local queue must not claim server success')
  await page.waitForFunction(()=>Object.values(JSON.parse(localStorage.getItem('drafts:coach'))).some(d=>d.finalisationError))
  await page.getByRole('button',{name:'Open saved assessment',exact:true}).click()
  await page.getByText(/Sending needs a retry/).waitFor();assert.equal(await page.getByLabel('Finishing',{exact:true}).isEditable(),false)
  await page.getByRole('button',{name:'Retry sending',exact:true}).click()
  await page.getByRole('button',{name:'Open saved assessment',exact:true}).waitFor({timeout:1000})
  await page.getByText('Development record finalised and shared.',{exact:true}).waitFor()
  await page.getByText('Select a Player and form to start Development.',{exact:true}).waitFor()
  await page.screenshot({path:'output/playwright/development-background-domain/completed-light-390.png',fullPage:true})
  assert.equal(await page.evaluate(()=>window.loads),1);assert.equal(await page.evaluate(()=>Object.keys(window.finalRecords).length),1)
  await chooseAssessment()
  assert.equal(await page.getByLabel('Finishing',{exact:true}).inputValue(),'')
  const priorLoads=await page.evaluate(()=>window.loads)
  await page.evaluate(()=>window.account('other'))
  await page.getByText('Select a Player and form to start Development.',{exact:true}).waitFor()
  assert.equal(await page.getByLabel('Finishing',{exact:true}).count(),0)
  await chooseAssessment()
  await page.evaluate(()=>window.emit({kind:'finalised',userId:'coach',contextId:'team',key:JSON.stringify(['one','form']),shared:true}))
  assert.equal(await page.evaluate(()=>window.loads),priorLoads,'Old account completion cannot refresh or close the new account')
  assert.equal(await page.getByRole('button',{name:'Open saved assessment',exact:true}).count(),0)
  await page.evaluate(()=>window.account('coach'));await page.getByText('Select a Player and form to start Development.',{exact:true}).waitFor();await chooseAssessment()
  await page.evaluate(()=>window.savedCallbacks[0]({kind:'finalisation',shared:true,draftId:'stale',playerId:'one',formId:'form'}))
  assert.equal(await page.getByRole('button',{name:'Open saved assessment',exact:true}).count(),0,'A/B/A callback from an earlier committed scope is ignored')
  await page.getByLabel('Finishing',{exact:true}).fill('6');await page.getByText('Synced. Private draft saved to your account.',{exact:true}).waitFor()
  await page.getByRole('button',{name:'Finalise privately',exact:true}).click();await page.getByRole('button',{name:'Open saved assessment',exact:true}).waitFor({timeout:1000})
  const loadsBeforeExit=await page.evaluate(()=>window.loads);await page.evaluate(()=>window.show(false));await page.getByText('More',{exact:true}).waitFor()
  await page.waitForFunction(()=>Object.values(JSON.parse(localStorage.getItem('drafts:coach'))).every(d=>!d.finalisation))
  assert.equal(await page.evaluate(()=>window.loads),loadsBeforeExit,'Background completion never updates an exited domain')
  assert.equal(await page.evaluate(()=>Object.keys(window.finalRecords).length),2,'App-level worker continues after leaving the full Development screen')
  await page.evaluate(()=>window.show(true));await page.getByText('Select a Player and form to start Development.',{exact:true}).waitFor()
  await chooseAssessment()
  await page.getByLabel('Finishing',{exact:true}).fill('8')
  await page.getByLabel('Coach summary note',{exact:true}).fill('Keep scanning before receiving.')
  await page.getByText('Synced. Private draft saved to your account.',{exact:true}).waitFor()
  await page.evaluate(()=>window.show(false));await page.getByText('More',{exact:true}).waitFor()
  await page.evaluate(()=>window.show(true))
  await page.getByLabel('Finishing',{exact:true}).waitFor()
  assert.equal(await page.getByLabel('Finishing',{exact:true}).inputValue(),'8','Unfinished local draft restores the correct selection and rating')
  assert.equal(await page.getByLabel('Coach summary note',{exact:true}).inputValue(),'Keep scanning before receiving.','Local draft notes survive leaving and reopening Development')
  await mkdir('output/playwright/development-background-domain',{recursive:true})
  for(const mode of ['light','dark'])for(const width of [320,390]){await page.evaluate(value=>window.mode(value),mode);await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`output/playwright/development-background-domain/${mode}-${width}.png`,fullPage:true})}
  // Reproduce the closed cancellation screen when the worker's first read fails.
  const cancelledId=await page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('drafts:coach')))[0].id)
  await page.evaluate(()=>{window.readFailures=1;window.failDiscard=true})
  await page.getByRole('button',{name:'Cancel assessment',exact:true}).click()
  await page.getByRole('button',{name:'Retry cancellation',exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Retry cancellation',exact:true}).isDisabled(),false)
  await page.getByRole('button',{name:'Retry cancellation',exact:true}).click()
  await page.getByRole('button',{name:'Retry cancellation',exact:true}).waitFor()
  assert.ok(await page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('drafts:coach')))[0].discardRequested))
  assert.equal(await page.getByLabel('Finishing',{exact:true}).count(),0,'Failed cancellation cannot reopen the old draft')
  await page.evaluate(()=>window.failDiscard=false)
  await page.getByRole('button',{name:'Retry cancellation',exact:true}).click()
  await page.getByText('Select a Player and form to start Development.',{exact:true}).waitFor()
  assert.ok((await page.evaluate(()=>window.discards)).every(id=>id===cancelledId))
  await chooseAssessment()
  assert.equal(await page.getByLabel('Finishing',{exact:true}).inputValue(),'')
  await page.getByLabel('Finishing',{exact:true}).fill('9')
  await page.getByText('Synced. Private draft saved to your account.',{exact:true}).waitFor()
  const freshId=await page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('drafts:coach')))[0].id)
  assert.notEqual(freshId,cancelledId)
  // A completion arriving after the closed editor mounted must not cancel the fresh assessment.
  await page.evaluate(id=>window.emit({kind:'discarded',userId:'coach',contextId:'team',key:JSON.stringify(['one','form']),draftId:id}),cancelledId)
  assert.equal(await page.getByLabel('Finishing',{exact:true}).inputValue(),'9')
  await page.evaluate(()=>window.failDiscard=true)
  await page.getByRole('button',{name:'Cancel assessment',exact:true}).click()
  await page.getByRole('button',{name:'Retry cancellation',exact:true}).waitFor()
  // Model a completed durable cancellation whose screen notification was missed.
  await page.evaluate(()=>{localStorage.setItem('drafts:coach','{}');window.failDiscard=false})
  await page.getByRole('button',{name:'Retry cancellation',exact:true}).click()
  await page.getByLabel('Finishing',{exact:true}).waitFor()
  assert.equal(await page.getByLabel('Finishing',{exact:true}).inputValue(),'','Retry reconciles durable absence instead of waiting for an event that already happened')
  await page.getByLabel('Finishing',{exact:true}).fill('7')
  await page.getByText('Synced. Private draft saved to your account.',{exact:true}).waitFor()
  await page.evaluate(()=>window.failDiscard=true)
  await page.getByRole('button',{name:'Cancel assessment',exact:true}).click()
  await page.getByRole('button',{name:'Retry cancellation',exact:true}).waitFor()
  await page.evaluate(()=>window.holdNextRead=true)
  await page.getByRole('button',{name:'Retry cancellation',exact:true}).click()
  await page.waitForFunction(()=>window.releaseHeldRead)
  await page.getByRole('button',{name:'Checking cancellation...',exact:true}).waitFor()
  await page.evaluate(()=>window.account('other'))
  await page.getByText('Select a Player and form to start Development.',{exact:true}).waitFor()
  await page.evaluate(()=>window.account('coach'))
  await page.getByText('Select a Player and form to start Development.',{exact:true}).waitFor()
  await chooseAssessment(false)
  await page.getByRole('button',{name:'Retry cancellation',exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Retry cancellation',exact:true}).isDisabled(),false,'Returning to the original account cannot inherit an abandoned retry spinner')
  await page.evaluate(()=>{window.failDiscard=false;window.releaseHeldRead()})
  await page.getByRole('button',{name:'Retry cancellation',exact:true}).click()
  await page.getByText('Select a Player and form to start Development.',{exact:true}).waitFor()
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({draftAckMs,shareAckMs,remoteDelayMs:1500,domain:'actual DevelopmentDomain and editor',passed:true}))
} finally {await browser.close()}
