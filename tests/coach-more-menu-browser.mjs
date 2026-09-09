import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { parse } from '@babel/parser'
import { build } from 'esbuild'
import { chromium } from 'playwright'
const root=process.cwd(), modules=path.join(root,'apps/coach-mobile/node_modules')
const source=await readFile('apps/coach-mobile/App.js','utf8')
const functions=parse(source,{sourceType:'module',plugins:['jsx']}).program.body.filter(n=>n.type==='FunctionDeclaration')
const selected=['MoreScreen','ScreenIntro','CoachIcon','useCoachTheme','createCoachThemeContext','createCoachStyles'].map(name=>{const n=functions.find(n=>n.id.name===name);assert.ok(n);return source.slice(n.start,n.end)}).join('\n')
const entry=`
import React,{useState,useContext,createContext} from 'react';import {createRoot} from 'react-dom/client';
import {View,Text,StyleSheet,Platform} from 'react-native';import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {IconMenu} from './apps/mobile-core/src/IconSettings.js';
import {getCoachRouteIconKey,getMobileIconName} from './apps/mobile-core/src/mobileIconSystem.js';
import {createCoachTheme} from './apps/coach-mobile/src/coachThemeCore.js';
const CoachThemeContext=createContext(null);${selected}
const routes=[['formation','Formation Boards'],['sessions','Sessions'],['development','Development'],['resources','Resources'],['chat','Chat'],['polls','Polls'],['invites','Invites and availability'],['team','Team'],['settings','Settings']].map(([key,label])=>({key,label}));
window.visits=[];
function App(){const [mode,setMode]=useState('light');window.mode=setMode;const theme=createCoachTheme({mode,context:{clubAccent:'#1e477c'}});
return <CoachThemeContext.Provider value={createCoachThemeContext(theme)}><View style={{backgroundColor:theme.tokens.background,padding:16}}><MoreScreen navigation={{more:routes}} onSelectMore={key=>window.visits.push(key)}/></View></CoachThemeContext.Provider>}
createRoot(document.getElementById('root')).render(<App/>);`
const result=await build({stdin:{contents:entry,resolveDir:root,loader:'jsx'},bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx','.ttf':'dataurl'},platform:'browser',conditions:['browser'],mainFields:['browser','module','main'],resolveExtensions:['.web.tsx','.web.ts','.web.js','.tsx','.ts','.jsx','.js','.json'],nodePaths:[modules],alias:{'react-native':path.join(modules,'react-native-web'),react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom')},define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'},banner:{js:'globalThis.process={env:{NODE_ENV:"production"}};'}})
const browser=await chromium.launch({headless:true})
try {
const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div></body></html>');await page.addScriptTag({content:result.outputFiles[0].text})
await mkdir('output/playwright/more-menu',{recursive:true})
for(const width of [320,390]){await page.setViewportSize({width,height:844});for(const mode of ['light','dark']){await page.evaluate(mode=>window.mode(mode),mode);await page.getByRole('button',{name:'Settings',exact:true}).waitFor();await page.screenshot({path:`output/playwright/more-menu/${mode}-${width}.png`,fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const first=await page.getByRole('button',{name:'Formation Boards',exact:true}).boundingBox(),second=await page.getByRole('button',{name:'Sessions',exact:true}).boundingBox();assert.equal(first.y,second.y,'Menu uses icon columns');assert.ok(first.height>=96&&first.width>=44);}}
for(const label of ['Formation Boards','Sessions','Development','Resources','Chat','Polls','Invites and availability','Team','Settings'])await page.getByRole('button',{name:label,exact:true}).click()
assert.equal((await page.evaluate(()=>window.visits)).length,9);assert.deepEqual(errors,[])
console.log('PASS: actual Coach More uses Settings icon grid, every route opens, light/dark and 320/390px fit')
}finally{await browser.close()}
