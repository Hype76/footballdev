import assert from 'node:assert/strict'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root=process.cwd(), modules=path.join(root,'apps/coach-mobile/node_modules')
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';
import {CoachOfflineReadiness} from './apps/coach-mobile/src/CoachOfflineReadiness.js';
window.fail=false;window.calls=0;
const user={id:'test'},context={id:'team',teamId:'team'},styles={bodyText:{color:'#123'},helperText:{color:'#345'}};
createRoot(document.getElementById('root')).render(<CoachOfflineReadiness user={user} context={context} styles={styles}/>);`
const result=await build({stdin:{contents:entry,resolveDir:root,loader:'jsx'},bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx'},alias:{'react-native':path.join(modules,'react-native-web'),react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom')},define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'},plugins:[{name:'services',setup(builder){
  builder.onResolve({filter:/\/offline$/},()=>({path:'offline',namespace:'mock'}))
  builder.onResolve({filter:/\/useCoachOfflinePreparation$/},()=>({path:'sync',namespace:'mock'}))
  builder.onLoad({filter:/.*/,namespace:'mock'},({path:name})=>({contents:name==='offline'?`export const readCoachOfflineReadiness=async()=>({resources:{players:[{}]},journals:[],pending:0});`:`export const syncCoachOfflineNow=async()=>{window.calls++;await new Promise(resolve=>window.finish=resolve);if(window.fail)throw Error('Saved changes still need attention.');};`,loader:'js'}))
}}]})
const browser=await chromium.launch({headless:true})
try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.setContent('<div id="root"></div>');await page.addScriptTag({content:result.outputFiles[0].text})
  await page.getByRole('button',{name:'Sync now'}).click()
  assert.equal(await page.getByRole('button',{name:'Syncing...'}).isDisabled(),true)
  await page.evaluate(()=>window.finish())
  await page.getByText('Sync complete. Your saved information is up to date.').waitFor()
  await page.evaluate(()=>window.fail=true)
  await page.getByRole('button',{name:'Sync now'}).click();await page.evaluate(()=>window.finish())
  await page.getByText('Saved changes still need attention.').waitFor()
  assert.equal(await page.getByText('Sync complete. Your saved information is up to date.').count(),0)
  assert.equal(await page.evaluate(()=>window.calls),2)
  assert.deepEqual(errors,[])
  console.log('PASS: manual sync disables repeated requests and reports success and failure accurately')
}finally{await browser.close()}
