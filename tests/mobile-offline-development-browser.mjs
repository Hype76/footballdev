import assert from 'node:assert/strict'
import {readFile,mkdir} from 'node:fs/promises'
import path from 'node:path'
import {build} from 'esbuild'
import {chromium} from 'playwright'
const modules=path.resolve('apps/coach-mobile/node_modules')
const source=await readFile('apps/mobile-core/src/coachPhase31EData.js','utf8')
const saveSource=source.slice(source.indexOf('export async function saveCoachDevelopmentDraft'),source.indexOf('export async function finalizeCoachDevelopmentRecord'))
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';
import {DevelopmentOfflineEditor} from './apps/coach-mobile/src/DevelopmentOfflineEditor.js';
import {syncCoachDevelopmentDrafts} from './apps/coach-mobile/src/coachDevelopmentSync.js';
window.online=false;window.failStorage=false;window.lostAck=false;window.writes=0;window.serverRows={};
window.form={id:'form',name:'Development',version:1,fields:[{id:'score',label:'Passing',type:'score_1_5',roleRank:20,options:[]}]};
window.workspace={forms:[window.form],players:[{id:'one',playerName:'Alex',teamId:'team'},{id:'two',playerName:'Jamie',teamId:'team'}]};
window.query=()=>{let action='read',row,filters=[];const q={select(){return q},eq(k,v){filters.push([k,v]);return q},lt(){return q},insert(v){action='insert';row=v;return q},update(v){action='update';row=v;return q},maybeSingle(){return run()},single(){return run()}};
async function run(){if(!window.online)throw Error('Waiting for a connection');let data=Object.values(window.serverRows).find(r=>filters.every(([k,v])=>r[k]===v));if(action==='read')return {data:data||null};if(action==='insert'){if(window.serverRows[row.id])return {error:{code:'23505'}};data=row;}if(action==='update'){if(!data)return {error:{code:'PGRST116'}};data={...data,...row}};window.serverRows[data.id]=data;window.writes++;if(window.lostAck){window.lostAck=false;throw Error('Connection lost after save')}return {data};}return q;};
const context={id:'context',clubId:'club',teamId:'team',role:'coach',roleRank:30};
const user={id:'coach',clubId:'club',activeTeamId:'team',roleRank:30};
const styles={panel:{padding:16,gap:12},heading:{fontSize:20},label:{fontSize:16},body:{fontSize:14},input:{borderWidth:1,minHeight:48,padding:12},secondary:{padding:12,minHeight:48,backgroundColor:'#cee1d4'},secondaryText:{color:'#132d20'},row:{gap:8},helper:{fontSize:12}};
function App(){const [player,setPlayer]=React.useState('one'),[key,setKey]=React.useState(0);window.player=setPlayer;window.remount=()=>setKey(k=>k+1);window.sync=()=>syncCoachDevelopmentDrafts(user,context);return <DevelopmentOfflineEditor key={player+key} context={context} user={user} player={window.workspace.players.find(p=>p.id===player)} form={window.form} styles={styles} stale={true}/>};
createRoot(document.getElementById('root')).render(<App/>);`
const offlineMock=`import {editLocalDevelopmentDraft,developmentDraftKey} from './apps/mobile-core/src/developmentOfflineCore.js';
let chain=Promise.resolve();const read=()=>JSON.parse(localStorage.getItem('drafts')||'{}');
export const readCoachDevelopmentDrafts=async()=>{await chain;return read()};
export function updateCoachDevelopmentDraft(user,context,key,change){const task=chain.then(()=>{if(window.failStorage)throw Error('Storage full. Keep this screen open.');const all=read();const next=change(all[key]||null);if(next)all[key]=next;else delete all[key];localStorage.setItem('drafts',JSON.stringify(all));return next});chain=task.catch(()=>{});return task;}
export const saveLocalCoachDevelopmentDraft=(user,context,input)=>updateCoachDevelopmentDraft(user,context,developmentDraftKey(input.playerId,input.formId),previous=>editLocalDevelopmentDraft(previous,{...input,id:previous?.id||crypto.randomUUID()}));`
const mocks=[[/\/offline$/,offlineMock],[/coachContextCore$/,`export const applyCoachContext=(user)=>user;`],[/coachPhase31EData$/,`
import {sameDevelopmentSave} from './apps/mobile-core/src/developmentOfflineCore.js';
import {validateCoachDevelopmentValues,splitCoachDevelopmentVisibility} from './apps/mobile-core/src/coachPhase31ECore.js';
const supabase={from:()=>window.query()};const assertCanonicalMutation=()=>{};const assertCoachCapability=()=>{};const assertTeamEntity=()=>{};const CAPABILITIES={assessments:'assessments'};
export const getCoachDevelopmentWorkspace=async()=>window.workspace;
export const finalizeCoachDevelopmentRecord=async()=>{throw Error('Finalising is not part of offline testing')};
${saveSource}`]]
const result=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx'},alias:{react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom'),'react-native':path.join(modules,'react-native-web')},define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'},plugins:[{name:'synthetic-storage-transport',setup(b){mocks.forEach(([filter],i)=>b.onResolve({filter},()=>({path:String(i),namespace:'mock'})));b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[Number(args.path)][1],loader:'js',resolveDir:process.cwd()}));}}]})
const browser=await chromium.launch({headless:true})
try{
const page=await browser.newPage({viewport:{width:320,height:800}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('http://localhost:9881/**',route=>route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>'}));
const mount=async()=>{await page.goto('http://localhost:9881/');await page.addScriptTag({content:result.outputFiles[0].text})};
await mount();await page.getByLabel('Passing',{exact:true}).fill('4');await page.getByLabel('Coach summary note',{exact:true}).fill('Keep scanning before receiving.');await page.getByText('Saved on this phone. Waiting to sync.',{exact:true}).waitFor();
assert.equal(await page.getByRole('button',{name:'Finalise and share',exact:true}).isDisabled(),true);
await page.evaluate(()=>window.player('two'));await page.getByLabel('Passing',{exact:true}).waitFor();await page.waitForFunction(()=>document.querySelector('[aria-label="Passing"]').value==='');
await page.getByLabel('Passing',{exact:true}).fill('2');await page.getByText('Saved on this phone. Waiting to sync.',{exact:true}).waitFor();
await mount();await page.waitForFunction(()=>document.querySelector('[aria-label="Passing"]')?.value==='4');assert.equal(await page.getByLabel('Coach summary note',{exact:true}).inputValue(),'Keep scanning before receiving.');
await page.evaluate(async()=>{window.online=true;window.lostAck=true;await window.sync()});
await page.evaluate(async()=>await window.sync());await page.getByText('Synced. Private draft saved to your account.',{exact:true}).waitFor();
assert.equal(await page.evaluate(()=>Object.keys(window.serverRows).length),2);assert.equal(await page.evaluate(()=>window.writes),2,'Response loss must not duplicate either draft');
await page.getByLabel('Passing',{exact:true}).fill('5');await page.getByText('Saved on this phone. Waiting to sync.',{exact:true}).waitFor();await page.evaluate(async()=>await window.sync());await page.getByText('Synced. Private draft saved to your account.',{exact:true}).waitFor();
assert.equal(await page.evaluate(()=>Object.values(window.serverRows).find(row=>row.player_id==='one').draft_data.responseValues.score),5);
await page.evaluate(()=>window.failStorage=true);await page.getByLabel('Coach summary note',{exact:true}).fill('Not saved yet');await page.getByText('Some changes have not been saved.',{exact:true}).waitFor();
assert.equal(await page.getByLabel('Coach summary note',{exact:true}).inputValue(),'Not saved yet');await page.evaluate(()=>window.failStorage=false);await page.getByRole('button',{name:'Save private draft',exact:true}).click();await page.getByText('Synced. Private draft saved to your account.',{exact:true}).waitFor();
await mkdir('output/playwright/offline-development',{recursive:true});await page.screenshot({path:'output/playwright/offline-development/editor-320.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
console.log('PASS actual Development editor and save transport: two Players survive a cold reload offline; notes and ratings persist; lost response retries without duplicates; edits sync; storage failures retain visible input and recover; 320px layout.')
}finally{await browser.close()}
