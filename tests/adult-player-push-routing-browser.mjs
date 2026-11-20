import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const accessSource = await readFile(new URL('../apps/parent-mobile/src/adultPlayerAccess.js',import.meta.url),'utf8')
const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'jsx',contents:`
 import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
 import {AdultPlayerEntry} from './apps/parent-mobile/src/AdultPlayerEntry.js';
 function App(){const [response,setResponse]=useState(null);const [user,setUser]=useState('user');window.tap=setResponse;window.changeAccount=setUser;
 return <AdultPlayerEntry key={user} userId={user} links={[{id:'parent-link',linkType:'parent'}]} notificationResponse={response}
 onRejectPlayerNotification={window.rejectPush} renderParent={()=> <h1>Parent Home</h1>}
 renderPlayer={({link})=><h1>Player {link.id}</h1>} />}
 createRoot(document.getElementById('root')).render(<App/>);
`},bundle:true,write:false,platform:'browser',jsx:'automatic',loader:{'.js':'jsx'},plugins:[{name:'services',setup(builder){
 builder.onResolve({filter:/\/(useAdultPlayerAccess|adultPlayerAccess\.js|AdultPlayerScreen)$/},args=>({path:args.path,namespace:'fixture'}));
 builder.onLoad({filter:/.*/,namespace:'fixture'},args=>{
 if(args.path.endsWith('AdultPlayerScreen'))return {contents:'export const AdultPlayerScreen=()=>null'};
 if(args.path.endsWith('adultPlayerAccess.js'))return {contents:accessSource.slice(accessSource.indexOf('export function selectAdultPlayerView('))};
 return {resolveDir:process.cwd(),contents:`import {useState,useCallback} from 'react';export function useAdultPlayerAccess(userId){
 const [access,setAccess]=useState({status:'linked',link:window.activeLink,userId});
 const refresh=useCallback(async()=>{const result=await window.readAccess(userId);setAccess({...result,userId});return result},[userId]);
 window.refreshAccess=refresh;return {access,refresh};}`};
 });}}]})
const browser=await chromium.launch({headless:true})
try {
 const page=await browser.newPage()
 await page.setContent('<div id="root"></div>')
 await page.evaluate(()=>{
  window.activeLink={id:'own-link',clubId:'own-club',teamId:'own-team'};
  window.accessResult={status:'linked',link:window.activeLink};window.rejections=[];
  window.rejectPush=id=>window.rejections.push(id);window.readAccess=async()=>window.accessResult;
 })
 await page.addScriptTag({content:bundle.outputFiles[0].text})
 await page.getByRole('heading',{name:'Parent Home'}).waitFor()
 const tap=(id,change={})=>({notification:{request:{identifier:id,content:{data:{app:'player',userId:'user',adultLinkId:'own-link',clubId:'own-club',teamId:'own-team',route:'chat',roomId:'room',...change}}}}})
 await page.evaluate(value=>window.tap(value),tap('valid'))
 await page.getByRole('heading',{name:'Player own-link'}).waitFor()
 await page.evaluate(()=>window.changeAccount('wrong-user'))
 await page.getByRole('heading',{name:'Parent Home'}).waitFor()
 await page.waitForFunction(()=>window.rejections.includes('valid'))
 assert.equal(await page.getByRole('heading',{name:'Parent Home'}).count(),1)
 await page.evaluate(()=>{window.tap(null);window.changeAccount('user')})
 await page.getByRole('heading',{name:'Parent Home'}).waitFor()
 await page.evaluate(()=>{window.accessResult={status:'linked',link:{...window.activeLink,id:'new-link'}}})
 await page.evaluate(value=>window.tap(value),tap('stale'))
 await page.waitForFunction(()=>window.rejections.includes('stale'))
 assert.equal(await page.getByRole('heading',{name:'Parent Home'}).count(),1)
 await page.evaluate(()=>{window.accessResult={status:'error'};window.tap(null)})
 await page.evaluate(value=>window.tap(value),tap('retry'))
 await page.waitForTimeout(50)
 assert.equal(await page.getByRole('heading',{name:'Parent Home'}).count(),1)
 assert.equal(await page.evaluate(()=>window.rejections.includes('retry')),false)
 await page.evaluate(async()=>{window.accessResult={status:'linked',link:window.activeLink};await window.refreshAccess()})
 await page.getByRole('heading',{name:'Player own-link'}).waitFor()
 console.log('Player push mode browser fixture passed: valid same-account switch, wrong account, stale link and connection recovery.')
}finally{await browser.close()}
