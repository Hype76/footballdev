import assert from 'node:assert/strict'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'
const root=process.cwd()
const modules=path.join(root,'apps/parent-mobile/node_modules')
const result=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {useFanAppLink} from './apps/parent-mobile/src/useFanAppLink.js';function State(){window.link=useFanAppLink();return <p>{window.link.route?.kind||'none'}</p>}window.rerender=()=>window.root.render(<State/>);window.mount=()=>{window.root=createRoot(document.getElementById('root'));window.root.render(<State/>)};window.mount()`,resolveDir:root,loader:'jsx'},bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx'},alias:{react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom')},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'link-fixtures',setup(b){b.onResolve({filter:/^(react-native|expo-secure-store)$/},args=>({path:args.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='react-native'?`export const Linking={getInitialURL:()=>window.initialPromise,addEventListener:(_,fn)=>{window.emit=fn;return{remove:()=>{window.removed++}}}}`:`export const getItemAsync=()=>window.savedPromise;export const setItemAsync=async(k,v)=>{window.writes.push(v);window.saved=v};export const deleteItemAsync=async()=>{window.writes.push(null);window.saved=null}` ,loader:'js'}))}}]})
const browser=await chromium.launch({headless:true})
const token='12345678-1234-1234-1234-123456789012'
const nextToken='22345678-1234-1234-1234-123456789012'
const invite=`footballplayerparents://fan-invite/${token}`
try {
 const page=await browser.newPage()
 await page.setContent('<div id="root"></div>')
 await page.evaluate(()=>{window.writes=[];window.removed=0;window.initialPromise=new Promise(r=>window.initialResolve=r);window.savedPromise=new Promise(r=>window.savedResolve=r)})
 await page.addScriptTag({content:result.outputFiles[0].text})
 await page.waitForFunction(()=>window.emit)
 // New live link wins while startup URL and saved value are still pending.
 await page.evaluate(url=>window.emit({url}),`footballplayerparents://fan-invite/${nextToken}`)
 await page.waitForFunction(t=>window.link.route?.token===t,nextToken)
 await page.evaluate(url=>{window.initialResolve(url);window.savedResolve(url)},invite)
 await page.waitForFunction(t=>window.saved?.endsWith(t),nextToken)
 assert.equal(await page.evaluate(()=>window.link.route.token),nextToken)
 await page.evaluate(()=>window.emit({url:'footballplayerparents://fan-invite/invalid'}))
 assert.equal(await page.evaluate(()=>window.link.route.token),nextToken)
 // Ordinary rerenders such as login completion preserve the invitation.
 await page.evaluate(()=>{window.authUser='signed-in-synthetic';window.rerender()})
 assert.equal(await page.evaluate(()=>window.link.route.token),nextToken)
 // Remount with persisted invitation emulates app restart.
 await page.evaluate(()=>{window.root.unmount();window.initialPromise=Promise.resolve(null);window.savedPromise=Promise.resolve(window.saved);window.mount()})
 await page.waitForFunction(t=>window.link.route?.token===t,nextToken)
 await page.evaluate(()=>window.link.accepted())
 await page.waitForFunction(()=>window.link.route?.kind==='fans'&&window.saved===null)
 await page.evaluate(url=>window.emit({url}),invite)
 await page.waitForFunction(t=>window.link.route?.token===t,token)
 await page.evaluate(()=>window.link.close())
 await page.waitForFunction(()=>window.link.route===null&&window.saved===null)
 // Close before initial hydration prevents it reopening an old saved invitation.
 await page.evaluate(()=>{window.root.unmount();window.initialPromise=new Promise(r=>window.initialResolve=r);window.savedPromise=new Promise(r=>window.savedResolve=r);window.mount()})
 await page.waitForFunction(()=>window.link?.route===null)
 await page.evaluate(()=>window.link.close())
 await page.evaluate(url=>{window.initialResolve(url);window.savedResolve(url)},invite)
 await page.waitForTimeout(40)
 assert.equal(await page.evaluate(()=>window.link.route),null)
 assert.equal(await page.evaluate(()=>window.saved),null)
 // A current launch URL beats the cached invitation.
 await page.evaluate(url=>{window.root.unmount();window.initialPromise=Promise.resolve('footballplayerparents://fans');window.savedPromise=Promise.resolve(url);window.mount()},invite)
 await page.waitForFunction(()=>window.link.route?.kind==='fans'&&window.saved===null)
 assert.ok(await page.evaluate(()=>window.removed)>=3)
 console.log('PASS: actual Fan link hook startup/live URL races, malformed URL preservation, pending invitation restart, accept/close persistence clearing, dismissed startup link and listener cleanup.')
} finally {await browser.close()}
