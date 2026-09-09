import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from '@babel/parser'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = process.cwd()
const modules = path.join(root, 'apps/parent-mobile/node_modules')
const source = await readFile('apps/parent-mobile/App.js', 'utf8')
const nodes = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body
const app = nodes.find(node => node.type === 'ExportDefaultDeclaration' && node.declaration.id?.name === 'App').declaration
const boundary = nodes.find(node => node.type === 'ClassDeclaration' && node.id.name === 'ParentRootErrorBoundary')
const result = await build({
  stdin: { contents: `import React,{Component,useState} from 'react';import {createRoot} from 'react-dom/client';
    import {SafeAreaProvider} from 'react-native-safe-area-context';
    import {MobileUpdateNotice} from './apps/mobile-core/src/MobileUpdateNotice.js';
    import {useMobileAutomaticUpdates} from './apps/mobile-core/src/updates.js';
    const AuthProvider=({children})=>children,parentOfflineProfileStore={},prepareParentMobileStartup=()=>{},clearFanNotificationDevice=()=>{};
    const StartupRecoveryScreen=()=> <main>Recovery screen</main>;
    function AppContent(){const[screen,setScreen]=useState('home');window.showScreen=setScreen;if(screen==='error')throw Error('synthetic render failure');return <main><h1>{screen}</h1><input aria-label="Unsaved draft" defaultValue="Keep this draft"/></main>}
    ${source.slice(boundary.start,boundary.end)}
    ${source.slice(app.start,app.end)}
    createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:root,loader:'jsx'},
  bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx'},
  alias:{react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom'),'react-native':path.join(modules,'react-native-web')},
  define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'},
  plugins:[{name:'update-device-fixtures',setup(b){
    b.onResolve({filter:/^(expo-updates|react-native-safe-area-context)$/},args=>({path:args.path,namespace:'fixture'}))
    b.onLoad({filter:/.*/,namespace:'fixture'},({path:module})=>({loader:'jsx',contents:module==='expo-updates'?`
      export const isEnabled=true;
      export async function checkForUpdateAsync(){window.checks++;return {isAvailable:!window.noUpdate}}
      export async function fetchUpdateAsync(){window.downloads++;return new Promise(resolve=>{window.finishDownload=resolve})}
      export async function reloadAsync(){window.restarts++;if(window.failRestart)throw Error('synthetic reload failure');return new Promise(resolve=>{window.finishRestart=resolve})}
    `:`import React from 'react';export const useSafeAreaInsets=()=>({top:24,bottom:16,left:0,right:0});export const SafeAreaProvider=({children})=><div style={{height:'100vh',position:'relative'}}>{children}</div>`}))
    b.onLoad({filter:/updates\.js$/},async({path:file})=>({contents:(await readFile(file,'utf8')).replace('const INITIAL_CHECK_DELAY_MS = 20 * 1000','const INITIAL_CHECK_DELAY_MS = 10'),loader:'js'}))
  }}],
})
const out='output/playwright/parent-update-notice'
await mkdir(out,{recursive:true})
const browser=await chromium.launch({headless:true})
async function open(options={}) {
  const page=await browser.newPage({viewport:{width:320,height:720}})
  await page.setContent('<style>body{margin:0;background:#071108;color:#fff;font-family:Arial}main{padding:120px 16px 16px}input{max-width:100%;box-sizing:border-box}</style><div id="root"></div>')
  await page.evaluate(options=>Object.assign(window,{checks:0,downloads:0,restarts:0,...options}),options)
  await page.addScriptTag({content:result.outputFiles[0].text})
  await page.waitForFunction(()=>window.checks===1)
  return page
}
try {
  const current=await open({noUpdate:true})
  assert.equal(await current.getByTestId('parent-update-notice').count(),0)
  assert.equal(await current.evaluate(()=>window.downloads),0)
  await current.close()

  const page=await open()
  await page.waitForFunction(()=>window.finishDownload)
  assert.equal(await page.getByTestId('parent-update-notice').count(),0,'Do not announce an unfinished download')
  await page.getByLabel('Unsaved draft').fill('Still editing')
  await page.evaluate(()=>window.finishDownload())
  await page.getByRole('button',{name:'Restart app',exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>window.restarts),0,'Download completion never restarts automatically')
  assert.equal(await page.getByLabel('Unsaved draft').inputValue(),'Still editing','Displaying the notice preserves current work')
  for(const width of [320,390]) {
    await page.setViewportSize({width,height:720})
    for(const color of ['#071108','#f8faf9']) {
      await page.evaluate(color=>document.body.style.background=color,color)
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
      const box=await page.getByTestId('parent-update-notice').boundingBox()
      assert.equal(box.y,32,'Notice clears the top safe area')
      assert.ok(box.height<=80,'Default prompt stays compact')
      for(const label of ['Restart app','Dismiss update notice']) {
        const tap=await page.getByRole('button',{name:label,exact:true}).boundingBox()
        assert.ok(tap.width>=44&&tap.height>=44)
      }
      await page.screenshot({path:`${out}/parent-${width}-${color==='#071108'?'dark':'light'}.png`})
    }
  }
  for(const screen of ['login','loading','locked','home']) {
    await page.evaluate(screen=>window.showScreen(screen),screen)
    await page.getByRole('heading',{name:screen,exact:true}).waitFor()
    assert.equal(await page.getByRole('button',{name:'Restart app',exact:true}).count(),1)
  }
  await page.getByRole('button',{name:'Dismiss update notice'}).click()
  assert.equal(await page.getByTestId('parent-update-notice').count(),0)
  await page.evaluate(()=>window.showScreen('login'))
  await page.getByRole('heading',{name:'login'}).waitFor()
  assert.equal(await page.getByTestId('parent-update-notice').count(),0,'Navigation does not bring back a dismissed prompt')
  assert.equal(await page.evaluate(()=>window.restarts),0)
  await page.close()

  const failed=await open({failRestart:true})
  await failed.waitForFunction(()=>window.finishDownload)
  await failed.evaluate(()=>window.finishDownload())
  await failed.getByRole('button',{name:'Restart app',exact:true}).click()
  await failed.getByRole('alert').waitFor()
  assert.match(await failed.getByRole('alert').innerText(),/Close and reopen the app/)
  assert.equal(await failed.evaluate(()=>window.restarts),1)
  await failed.getByRole('button',{name:'Dismiss update notice'}).click()
  await failed.close()

  const recovery=await open()
  await recovery.waitForFunction(()=>window.finishDownload)
  await recovery.evaluate(()=>{window.showScreen('error');window.finishDownload()})
  await recovery.getByText('Recovery screen',{exact:true}).waitFor()
  await recovery.getByRole('button',{name:'Restart app',exact:true}).click()
  await recovery.getByRole('button',{name:'Restarting...',exact:true}).waitFor()
  assert.equal(await recovery.getByRole('button',{name:'Restarting...',exact:true}).isDisabled(),true)
  assert.equal(await recovery.getByRole('button',{name:'Dismiss update notice'}).isDisabled(),true)
  assert.equal(await recovery.evaluate(()=>window.restarts),1)
  await recovery.close()
  console.log('PASS: actual Parent root wiring and OTA hook show a compact dismissible prompt only after download; preserve drafts; work across login/loading/locked/recovery screens; require an explicit restart; handle restart failure and busy state at 320/390px.')
} finally {await browser.close()}
