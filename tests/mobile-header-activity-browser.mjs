import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'

const root=process.cwd(),modules=path.join(root,'apps/parent-mobile/node_modules')
const entry=`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {View,Text,Pressable} from 'react-native';
import {MobileActivityProvider} from './apps/mobile-core/src/MobileActivityContext.js';
import {MobileHeaderActivity,MobileLoadingStatus} from './apps/mobile-core/src/MobileHeaderActivity.js';
import {AttendancePendingRows} from './apps/mobile-core/src/AttendancePendingRows.js';
window.alerts=[];window.retries=0;window.reviews=0;window.fresh=true;
let time=0,id=0;const timers=new Map(),originalTimer=window.setTimeout,originalClear=window.clearTimeout;
window.setTimeout=(fn,ms,...args)=>{if(ms!==60000)return originalTimer(fn,ms,...args);const key='notice-'+(++id);timers.set(key,{at:time+ms,fn:()=>fn(...args)});return key};
window.clearTimeout=key=>timers.has(key)?timers.delete(key):originalClear(key);
window.advance=ms=>{time+=ms;for(const[key,timer]of timers)if(timer.at<=time){timers.delete(key);timer.fn()}};
const styles={row:{},body:{},helper:{},error:{}};
function App(){const[busy,setBusy]=useState(false),[error,setError]=useState(''),[scope,setScope]=useState('first'),[offline,setOffline]=useState(false),[conflict,setConflict]=useState(false);
window.setBusy=setBusy;window.setError=setError;window.scope=setScope;window.offline=setOffline;window.conflict=setConflict;
const outbox={commands:busy||error?[{id:scope,label:'Monday training',status:conflict?'conflict':busy?'sending':'retryable',response:'available',error}]:[],error,retry:()=>{window.retries++},review:()=>{window.reviews++}};
return <MobileActivityProvider key={scope} active={busy} offline={offline}><View style={{minHeight:'100vh',backgroundColor:'#f7f8fa'}}>
<View style={{height:64,flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,borderBottomWidth:1}}><Text>Football Player</Text><MobileHeaderActivity live styles={{testBadgeText:{color:'#173f7a',fontSize:12}}}/></View>
<View testID="stable-content" style={{padding:16}}><Text>Monday training</Text><Pressable accessibilityRole="button" accessibilityLabel="Attending" onPress={()=>setBusy(true)} style={({pressed})=>({minHeight:44,opacity:pressed||busy?0.6:1})}><Text>Attending</Text></Pressable></View>
{busy?<MobileLoadingStatus message="Saving your response"/>:null}<AttendancePendingRows outbox={outbox} styles={styles} onRefresh={()=>window.fresh}/>
</View></MobileActivityProvider>}
createRoot(document.getElementById('root')).render(<App/>);`
const result=await build({stdin:{contents:entry,resolveDir:root,loader:'jsx'},bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx','.ttf':'dataurl','.png':'dataurl'},platform:'browser',conditions:['browser'],mainFields:['browser','module','main'],nodePaths:[modules],resolveExtensions:['.web.js','.jsx','.js','.json'],
alias:{react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom'),'rn-web':path.join(modules,'react-native-web')},define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'},banner:{js:'globalThis.process={env:{NODE_ENV:"production"}};'},plugins:[{name:'native-services',setup(builder){builder.onResolve({filter:/^react-native$/},()=>({path:'native',namespace:'mock'}));builder.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export * from 'rn-web';export const AppState={currentState:'active',addEventListener(){return {remove(){}}}};export const Alert={alert:(title,message,buttons)=>window.alerts.push({title,message,buttons})};`,loader:'js',resolveDir:root}))}}]})
const browser=await chromium.launch({headless:true})
try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[]
 page.on('pageerror',error=>errors.push(error.message))
 await page.route('http://localhost:9879/**',route=>route.fulfill({contentType:'text/html',body:'<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>'}))
 await page.goto('http://localhost:9879/');await page.addScriptTag({content:result.outputFiles[0].text})
 await page.getByText('LIVE',{exact:true}).waitFor()
 const header=page.getByTestId('mobile-header-activity'),content=page.getByTestId('stable-content'),initialHeader=await header.boundingBox(),initialContent=await content.boundingBox()
 const started=Date.now();await page.getByRole('button',{name:'Attending',exact:true}).click();await page.getByRole('progressbar',{name:'Updating'}).waitFor();assert.ok(Date.now()-started<500,'Immediate tap acknowledgement in this browser fixture')
 assert.deepEqual(await header.boundingBox(),initialHeader);assert.deepEqual(await content.boundingBox(),initialContent)
 assert.equal(await page.getByText('Attending',{exact:true}).count(),1);assert.equal(await page.getByText('Saving your response',{exact:true}).count(),0)
 await page.evaluate(()=>{window.setBusy(false);window.setError('Response could not be saved. Your entries remain open.')})
 await page.waitForTimeout(30);await page.evaluate(()=>window.advance(59999));assert.equal(await page.evaluate(()=>window.alerts.length),0)
 await page.evaluate(()=>window.advance(1));assert.equal(await page.evaluate(()=>window.alerts.length),1)
 assert.deepEqual(await content.boundingBox(),initialContent)
 await page.evaluate(()=>window.alerts[0].buttons[1].onPress());assert.equal(await page.evaluate(()=>window.retries),1)
 await page.evaluate(()=>{window.scope('second');window.setError('')});await page.waitForTimeout(30)
 await page.evaluate(()=>window.alerts[0].buttons[1].onPress());assert.equal(await page.evaluate(()=>window.retries),1,'A stale account notice cannot retry in the next account')
 await page.evaluate(()=>window.setError('Recovered before one minute'));await page.waitForTimeout(30);await page.evaluate(()=>{window.advance(30000);window.setError('')});await page.waitForTimeout(30);await page.evaluate(()=>window.advance(30000));assert.equal(await page.evaluate(()=>window.alerts.length),1)
 await page.evaluate(()=>{window.conflict(true);window.setError('Attendance changed on another device');window.fresh=false});await page.waitForTimeout(30);await page.evaluate(()=>window.advance(60000));assert.equal(await page.evaluate(()=>window.alerts.at(-1).buttons[1].text),'Refresh and review')
 await page.evaluate(()=>window.alerts.at(-1).buttons[1].onPress());assert.equal(await page.evaluate(()=>window.reviews),0)
 await page.evaluate(()=>{window.fresh=true;window.alerts.at(-1).buttons[1].onPress()});await page.waitForTimeout(20);assert.equal(await page.evaluate(()=>window.reviews),1)
 await page.evaluate(()=>{window.setError('');window.offline(true)});await page.getByText('OFFLINE',{exact:true}).waitFor();assert.deepEqual(await content.boundingBox(),initialContent)
 await mkdir('output/playwright/weekend',{recursive:true});await page.screenshot({path:'output/playwright/weekend/fixed-header-loading.png'})
 assert.deepEqual(errors,[]);console.log('PASS fixed header, stable content and labels, immediate acknowledgement, one-minute failure delay, recovery cancellation, account-safe callbacks, conflict review authority and offline status.')
}finally{await browser.close()}
