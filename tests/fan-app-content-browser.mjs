import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import path from 'node:path'
import {build} from 'esbuild'
import {chromium} from 'playwright'
const source=await readFile('apps/parent-mobile/App.js','utf8')
const extracted=source.slice(source.indexOf('function AppContent() {'),source.indexOf('function StartupRecoveryScreen('))
assert.ok(extracted.includes('fanLink.route'))
const root=process.cwd(), modules=path.join(root,'apps/parent-mobile/node_modules')
const contents=`import React,{useState,useEffect} from 'react';import{createRoot}from'react-dom/client';import{useFanAppLink as realUseFanAppLink}from'./apps/parent-mobile/src/useFanAppLink.js';
const Notifications={useLastNotificationResponse:()=>null};const MOBILE_STARTUP_STATES={BOOTING:'boot',RESTORING_SESSION:'restore',RECOVERABLE_ERROR:'error'};
function useFanAppLink(){const link=realUseFanAppLink();window.link=link;return link}function useMobileAuth(){return window.auth}
const View=({children})=><div>{children}</div>,Text=({children})=><span>{children}</span>,Pressable=({children,onPress})=><button onClick={onPress}>{children}</button>;
const LoadingScreen=()=> <p>Loading</p>,StartupRecoveryScreen=()=> <p>Recovery</p>,LockedScreen=()=> <p>Locked</p>,ParentHome=()=> <p>Parent home</p>;
const LoginScreen=()=> <p>Login screen</p>;const FansScreen=({onBack})=><section><p>Fans screen</p><button onClick={onBack}>Close Fans</button></section>;
const FanInvitationScreen=({token,onSignIn,onClose,onAccepted})=><section>Invite {token}<button onClick={onSignIn}>Invitation sign in</button><button onClick={onClose}>Close invitation</button><button onClick={onAccepted}>Accept invitation</button></section>;
${extracted.replace("require('./assets/football-player-logo.png')","null")}
window.root=createRoot(document.getElementById('root'));window.render=()=>window.root.render(<AppContent/>);window.render();`
const result=await build({stdin:{contents,resolveDir:root,loader:'jsx'},bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx'},alias:{react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom')},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'mock-links',setup(b){b.onResolve({filter:/^(react-native|expo-secure-store)$/},args=>({path:args.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='react-native'?`export const Linking={getInitialURL:async()=>window.url,addEventListener:(_,fn)=>{window.emit=fn;return{remove(){}}}}`:`export const getItemAsync=async()=>null,setItemAsync=async()=>{},deleteItemAsync=async()=>{}`,loader:'js'}))}}]})
const browser=await chromium.launch({headless:true})
try{
 const page=await browser.newPage()
 await page.setContent('<div id="root"></div>')
 await page.evaluate(()=>{window.url='footballplayerparents://fan-invite/12345678-1234-1234-1234-123456789012';window.auth={startupState:'boot',session:null,isLocked:false,user:{parentPortalLinks:[]}}})
 await page.addScriptTag({content:result.outputFiles[0].text})
 await page.getByText('Loading',{exact:true}).waitFor()
 await page.waitForFunction(()=>window.link.route?.kind==='invite')
 assert.equal(await page.getByRole('button',{name:'Invitation sign in'}).count(),0)
 const auth=async(patch)=>page.evaluate(p=>{Object.assign(window.auth,p);window.render()},patch)
 await auth({startupState:'error'});await page.getByText('Recovery',{exact:true}).waitFor()
 await auth({startupState:'ready'});await page.getByRole('button',{name:'Invitation sign in'}).waitFor()
 await page.getByRole('button',{name:'Invitation sign in'}).click();await page.getByText('Login screen',{exact:true}).waitFor()
 assert.equal(await page.getByRole('button',{name:'Accept invitation'}).count(),0)
 await page.getByRole('button',{name:'Back to Fan invitation'}).click();await page.getByRole('button',{name:'Invitation sign in'}).waitFor()
 await page.getByRole('button',{name:'Invitation sign in'}).click()
 await auth({session:{user:{id:'synthetic'}},isLocked:true});await page.getByText('Locked',{exact:true}).waitFor()
 assert.equal(await page.getByRole('button',{name:'Accept invitation'}).count(),0)
 await auth({isLocked:false});await page.getByRole('button',{name:'Accept invitation'}).waitFor()
 await page.getByRole('button',{name:'Accept invitation'}).click();await page.getByText('Fans screen',{exact:true}).waitFor()
 await page.getByRole('button',{name:'Close Fans'}).click();await page.getByText('Parent home',{exact:true}).waitFor()
 console.log('PASS: actual AppContent boot/recovery gates, signed-out invitation/login/back, same invitation after login, biometric lock precedence, accepted Fans and close routing.')
}finally{await browser.close()}
