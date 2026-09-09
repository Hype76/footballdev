import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'
const root=process.cwd()
const modules=path.join(root,'apps/parent-mobile/node_modules')
const native=path.join(modules,'react-native-web').replaceAll('\\','/')
const out='output/playwright/mobile-login'
await mkdir(out,{recursive:true})
const result=await build({stdin:{contents:`
import React from 'react';import {createRoot} from 'react-dom/client';import {MobileLoginScreen} from './apps/mobile-core/src/ui.js';
window.logins=[];window.resets=[];
createRoot(document.getElementById('root')).render(<MobileLoginScreen title="Everything for your child, in one place." kicker="Parent access" copy="Use the email and password linked to your family account." emailPlaceholder="parent@example.test" logoSource={{uri:'data:image/svg+xml,<svg xmlns=\"http://www.w3.org/2000/svg\"/>'}} meta="Private family access. Password sign-in only." signIn={async(...args)=>window.logins.push(args)} requestPasswordReset={async(email)=>window.resets.push(email)}/>);
`,resolveDir:root,loader:'jsx'},bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx'},platform:'browser',conditions:['browser'],mainFields:['browser','module','main'],nodePaths:[modules],alias:{react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom')},define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'},plugins:[{name:'device-adapter',setup(builder){
builder.onResolve({filter:/^react-native$/},()=>({path:'native',namespace:'mock'}));
builder.onResolve({filter:/BrandLoader$/},()=>({path:'loader',namespace:'mock'}));
builder.onLoad({filter:/.*/,namespace:'mock'},args=>({loader:'jsx',resolveDir:root,contents:args.path==='loader'?'export const BrandLoader=()=>null;':`export * from '${native}'; import React from 'react';import {ScrollView as Base} from '${native}';export const Platform={OS:'ios'};export function ScrollView(props){window.keyboardConfig={adjust:props.automaticallyAdjustKeyboardInsets,dismiss:props.keyboardDismissMode,taps:props.keyboardShouldPersistTaps};return <Base {...props}/>}` }));
}}]})
const browser=await chromium.launch({headless:true})
try {
 const page=await browser.newPage({viewport:{width:390,height:844}})
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root" style="height:100dvh;display:flex;flex-direction:column"></div></body></html>')
 await page.addScriptTag({content:result.outputFiles[0].text})
 const email=page.getByPlaceholder('parent@example.test'),password=page.getByPlaceholder('Password',{exact:true})
 await email.fill('test@example.test');await email.press('Enter');assert.equal(await password.evaluate(el=>el===document.activeElement),true)
 assert.deepEqual(await page.evaluate(()=>window.keyboardConfig),{adjust:true,dismiss:'interactive',taps:'handled'})
 await page.setViewportSize({width:390,height:400})
 await password.fill('Synthetic8!');await password.scrollIntoViewIfNeeded()
 const box=await password.boundingBox();assert.ok(box.y>=0&&box.y+box.height<=400)
 await page.getByRole('button',{name:'Show Password',exact:true}).click();assert.equal(await password.getAttribute('type'),'text')
 await page.getByRole('button',{name:'Hide Password',exact:true}).click();assert.equal(await password.getAttribute('type'),'password')
 await page.screenshot({path:`${out}/password-reduced-viewport.png`})
 await password.press('Enter');assert.equal(await page.evaluate(()=>window.logins.length),1)
 await page.getByRole('button',{name:'Forgot password?',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.resets),['test@example.test'])
 await page.setViewportSize({width:390,height:844})
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 assert.deepEqual(errors,[])
 console.log('PASS: actual mobile login email Next focus, password visibility, submission, recovery and reduced viewport. iOS keyboard inset props verified; physical keyboard requires handset confirmation.')
}finally{await browser.close()}
