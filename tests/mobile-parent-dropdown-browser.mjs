import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { parse } from '@babel/parser'
import { build } from 'esbuild'
import { chromium } from 'playwright'
const root = process.cwd(), modules = path.join(root, 'apps/parent-mobile/node_modules')
const source = await readFile('apps/parent-mobile/App.js', 'utf8')
const nodes = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body
const selected = ['AppHeader', 'createParentAppPalette', 'createParentAppStyles'].map(name => {
 const node = nodes.find(n => n.type === 'FunctionDeclaration' && n.id.name === name)
 return source.slice(node.start, node.end)
}).join('\n')
const entry = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{View,Text,Pressable,ScrollView,StyleSheet,Platform}from'react-native';import{DEFAULT_PARENT_MOBILE_THEME}from'./apps/mobile-core/src/parentThemeCore.js';
${selected}
const palette=createParentAppPalette(DEFAULT_PARENT_MOBILE_THEME.tokens),styles=createParentAppStyles(DEFAULT_PARENT_MOBILE_THEME.tokens);const useParentTheme=()=>({palette,styles});const ClubBrandLogo=()=>null,NotificationStatusButton=()=>null,ParentIcon=()=>null;
const links=Array.from({length:8},(_,i)=>({id:'link'+i,playerName:'FP TEST Player '+i,teamName:'Team '+i,clubName:'FP TEST Club'}));
function Harness(){const[open,setOpen]=useState(false),[id,setId]=useState('link0');return <AppHeader childCount={8} childSwitcherOpen={open} childNotificationBadges={{link1:2}} links={links} onToggleChildSwitcher={()=>setOpen(!open)} onChildChange={next=>{setId(next);setOpen(false)}} selectedLink={links.find(l=>l.id===id)} theme="dark"/>}createRoot(document.getElementById('root')).render(<Harness/>);`
const result=await build({stdin:{contents:entry,resolveDir:root,loader:'jsx'},bundle:true,write:false,jsx:'automatic',platform:'browser',nodePaths:[modules],alias:{react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom'),'react-native':path.join(modules,'react-native-web')},define:{'process.env.NODE_ENV':'"production"',__DEV__:'false'}})
const browser=await chromium.launch({headless:true})
try {
 for(const width of [320,390]){
  const page=await browser.newPage({viewport:{width,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.setContent('<div id="root"></div>');await page.addScriptTag({content:result.outputFiles[0].text})
  await page.getByRole('button',{name:'Active player FP TEST Player 0',exact:true}).click()
  const menu=page.getByLabel('Choose player and team');await menu.waitFor()
  const geometry=await menu.evaluate(e=>({width:e.clientWidth,scrollWidth:e.scrollWidth,height:e.clientHeight,scrollHeight:e.scrollHeight}))
  assert.ok(geometry.scrollHeight>geometry.height);assert.ok(geometry.scrollWidth<=geometry.width+1)
  await page.getByRole('button',{name:'FP TEST Player 7, Team 7',exact:true}).click()
  await page.getByRole('button',{name:'Active player FP TEST Player 7',exact:true}).waitFor();assert.equal(await menu.count(),0)
  await page.getByRole('button',{name:'Active player FP TEST Player 7',exact:true}).click()
  await page.getByRole('button',{name:'FP TEST Player 1, Team 1, 2 unread notifications',exact:true}).click()
  await page.getByRole('button',{name:'Active player FP TEST Player 1',exact:true}).waitFor()
  assert.deepEqual(errors,[]);await mkdir('output/playwright/parent-dropdown',{recursive:true});await page.screenshot({path:'output/playwright/parent-dropdown/'+width+'.png'});await page.close()
 }
 console.log('PASS: actual Parent dropdown, eight player/team choices, vertical scroll, unread badges and selection closes at 320/390px.')
}finally{await browser.close()}
