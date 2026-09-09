import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from '@babel/parser'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = process.cwd()
const modules = path.join(root, 'apps/coach-mobile/node_modules')
const source = await readFile(process.env.COACH_SCROLL_SOURCE || 'apps/coach-mobile/App.js', 'utf8')
const nodes = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body
const home = nodes.find(n => n.type === 'FunctionDeclaration' && n.id.name === 'CoachHome')
const elements = []
function visit(node) {
  if (!node || typeof node !== 'object') return
  if (node.type === 'JSXElement') elements.push(node)
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(visit)
    else if (value && typeof value === 'object') visit(value)
  }
}
visit(home)
const shell = elements.find(n => n.openingElement.name.name === 'KeyboardAvoidingView')
const scroller = elements.find(n => n.openingElement.attributes.some(a => a.name?.name === 'testID' && a.value?.value === 'coach-content-scroll'))
assert.ok(scroller, 'Coach uses the stable native scroll container')
const header = elements.find(n => n.openingElement.name.name === 'CoachHeader')
assert.ok(header.start > scroller.start && header.end < scroller.end, 'Header belongs to the native scrolling content')
let shellSource = source.slice(shell.start, shell.end)
for (const node of elements.filter(n => ['CoachRoute', 'CoachQuickActions'].includes(n.openingElement.name.name)).sort((a, b) => b.start - a.start)) {
  shellSource = shellSource.slice(0, node.start - shell.start) + (node.openingElement.name.name === 'CoachRoute' ? '<CoachRoute onRequestScrollTop={scrollContentToTop} onNotificationSettingsFocus={focusNotificationSettings}/>' : '<View/>') + shellSource.slice(node.end - shell.start)
}
const names = ['CoachHeader', 'ContextSwitcher', 'PrimaryNavigation', 'createCoachStyles']
const selected = names.map(name => { const n = nodes.find(n => n.type === 'FunctionDeclaration' && n.id.name === name); return source.slice(n.start, n.end) }).join('\n').replace("require('./assets/football-player-logo.png')", "require('./apps/coach-mobile/assets/football-player-logo.png')")
const callbacks = ['scrollContentToTop', 'focusNotificationSettings'].map(name => {
  const declaration = home.body.body.find(n => n.type === 'VariableDeclaration' && n.declarations[0].id.name === name)
  return source.slice(declaration.start, declaration.end)
}).join('\n')
const entry = `
import React,{useRef,useMemo,useCallback,useEffect,useState} from 'react';import {createRoot} from 'react-dom/client';
import {View,Text,Image,Pressable,ScrollView,KeyboardAvoidingView,RefreshControl,StyleSheet,Platform} from 'react-native';
import {createCoachTheme} from './apps/coach-mobile/src/coachThemeCore.js';
import {getCoachBottomNavigationPadding} from './apps/coach-mobile/src/coachNavigationCore.js';
import {getCoachRouteIconKey} from './apps/mobile-core/src/mobileIconSystem.js';
import {createCoachScrollBounds} from './apps/coach-mobile/src/coachScrollBounds.js';
const config={isProduction:false};let theme;
const useCoachTheme=()=>theme;
const CoachIcon=()=> <Text>+</Text>;
const NotificationStatusButton=({onPress})=><Pressable accessibilityRole="button" accessibilityLabel="Notification settings" onPress={onPress}><Text>Alerts</Text></Pressable>;
const StatePanel=()=>null,Notice=()=>null,BrandLoader=()=> <View style={{height:28}}/>;
${selected}
function CoachRoute({onRequestScrollTop,onNotificationSettingsFocus}){return <View><Text testID="content-anchor" style={{fontSize:24,color:theme.palette.textPrimary}}>Next calendar item</Text><TextInput/><View style={{height:window.shortContent?200:1100}}/><Pressable accessibilityRole="button" accessibilityLabel="Return to top" onPress={onRequestScrollTop}><Text>Top</Text></Pressable></View>}
const TextInput=()=> <input aria-label="Fixture notes" style={{marginTop:12,height:40}}/>;
function App(){
const [mode,setMode]=useState('dark'),[activeRoute,setActiveRoute]=useState('home'),[selected,setSelected]=useState('a'),[isRefreshing,setRefreshing]=useState(false);
window.setMode=setMode;window.setRoute=setActiveRoute;window.refresh=setRefreshing;
const moreRoute=activeRoute==='invites'?'invites':'';const isMatchInvitesRoute=activeRoute==='invites';const safeAreaInsets={bottom:16};
theme={...createCoachTheme({mode,context:{clubAccent:'#51bac4'}})};theme.palette=theme.tokens;theme.styles=createCoachStyles(theme.palette);theme.branding={logoUrl:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44"><rect width="44" height="44" fill="teal"/></svg>'};
const styles=theme.styles,palette=theme.palette;
const contexts=[{id:'a',clubName:'FP TEST',teamName:'U17 Green',roleLabel:'Team Admin',paymentAccess:{state:'allowed'}},{id:'b',clubName:'FP TEST',teamName:'Spain',roleLabel:'Team Admin',paymentAccess:{state:'allowed'}}].slice(0,window.contextCount||2);
const contextResolution={contexts},activeContext=contexts.find(c=>c.id===selected)||contexts[0],selectedMobileUser={roleLabel:'Team Admin'};
const notificationState={},notificationStateStatus='ready',notice='',setNotice=()=>{},setNotificationSettingsFocusRequest=()=>{},navigation={primary:[{key:'home',label:'Home'},{key:'calendar',label:'Calendar'},{key:'matchday',label:'Match Day'},{key:'more',label:'More'}]};
const contentScrollRef=useRef(null),contentOriginRef=useRef(0);
const scrollBounds=useMemo(()=>createCoachScrollBounds(options=>{window.corrections.push(options);contentScrollRef.current?.scrollTo(options)}),[]);
useEffect(()=>()=>scrollBounds.dispose(),[scrollBounds]);
${callbacks}
const navigate=route=>{setActiveRoute(route);scrollContentToTop()},selectContext=id=>{setSelected(id);scrollContentToTop()},openNotificationSettings=()=>{setActiveRoute('settings');requestAnimationFrame(()=>focusNotificationSettings(0))},loadHome=()=>setRefreshing(true);
window.bounds=scrollBounds;window.focusSettings=()=>focusNotificationSettings(0);
useEffect(()=>{scrollContentToTop()},[activeRoute,scrollContentToTop]);
return <View style={[styles.appShell,{height:'100vh'}]}>${shellSource}</View>;
}
window.corrections=[];createRoot(document.getElementById('root')).render(<App/>);`
const result = await build({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic', loader: { '.js': 'jsx', '.png': 'dataurl' }, alias: { 'react-native': path.join(modules, 'react-native-web'), react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom') }, define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' } })
const out = 'output/playwright/coach-smooth-scroll'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  for (const width of [320, 392]) {
    for (const contextCount of [1, 2]) {
      const context = await browser.newContext({ viewport: { width, height: 850 }, isMobile: true, hasTouch: true })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', e => errors.push(e.message))
      await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}input{max-width:100%;box-sizing:border-box}</style><div id="root"></div>')
      await page.evaluate(count => { window.contextCount = count }, contextCount)
      await page.addScriptTag({ content: result.outputFiles[0].text })
      const scroll = page.getByTestId('coach-content-scroll'), header = page.getByTestId('coach-scroll-header')
      await header.waitFor()
      await page.waitForTimeout(150)
      const initial = await scroll.boundingBox(), headerBox = await header.boundingBox()
      await page.evaluate(() => {
        window.trace = []
        window.observe = true
        const tick = () => { if (!window.observe) return; const s=document.querySelector('[data-testid="coach-content-scroll"]'),h=document.querySelector('[data-testid="coach-scroll-header"]');const b=s.getBoundingClientRect();window.trace.push({y:b.y,height:b.height,offset:s.scrollTop,headerHeight:h.getBoundingClientRect().height});requestAnimationFrame(tick) };tick()
      })
      const cdp = await context.newCDPSession(page)
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: width - 40, y: 650 }] })
      for (let i=1;i<=24;i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: width - 40, y: 650-i*5 }] })
        await page.waitForTimeout(20)
      }
      const held = await scroll.evaluate(el => el.scrollTop)
      await page.waitForTimeout(300)
      assert.ok(Math.abs(await scroll.evaluate(el => el.scrollTop)-held)<=2,'Held finger does not cause scroll oscillation')
      for (let i=1;i<=20;i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: width - 40, y: 530+i*3 }] })
        await page.waitForTimeout(20)
      }
      const reversed = await scroll.evaluate(el => el.scrollTop)
      await page.waitForTimeout(300)
      assert.ok(Math.abs(await scroll.evaluate(el => el.scrollTop)-reversed)<=2,'Reversing then holding does not oscillate the header or page')
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await page.waitForTimeout(250)
      const trace = await page.evaluate(() => { window.observe=false;return window.trace })
      assert.ok(trace.some(f=>f.offset>30),'Actual touch gesture scrolls the page')
      assert.ok(trace.every(f=>Math.abs(f.y-initial.y)<1&&Math.abs(f.height-initial.height)<1),'Scroll viewport never moves or resizes during touch')
      assert.ok(trace.every(f=>Math.abs(f.headerHeight-headerBox.height)<1),'Header never collapses or clips itself during touch')
      assert.deepEqual(await page.evaluate(()=>window.corrections),[],'No app-driven correction fights this gesture')
      await page.screenshot({ path: `${out}/held-${width}-${contextCount}.png` })
      await page.evaluate(()=>window.setRoute('calendar'))
      await page.waitForTimeout(180)
      assert.equal(await scroll.evaluate(el=>el.scrollTop),0,'Route changes return to the header')
      if(contextCount===2){await page.getByRole('button',{name:'Spain, Team Admin',exact:true}).click();assert.equal(await scroll.evaluate(el=>el.scrollTop),0)}
      await page.evaluate(()=>window.focusSettings())
      await page.waitForTimeout(500)
      const anchor=await page.getByTestId('content-anchor').boundingBox()
      assert.ok(anchor.y>=initial.y&&anchor.y<initial.y+65,'Settings focus accounts for header height')
      await page.evaluate(()=>window.setRoute('invites'))
      await page.waitForTimeout(180)
      assert.equal(await header.count(),0,'Match invitations retain the compact route layout')
      assert.equal(await scroll.evaluate(el=>el.scrollTop),0)
      await page.evaluate(()=>{window.shortContent=true;window.setRoute('home');window.setMode('light')})
      await header.waitFor()
      await page.waitForTimeout(180)
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:width-40,y:650}]})
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:width-40,y:646}]})
      await page.waitForTimeout(200)
      assert.equal(await scroll.evaluate(el=>el.scrollTop),0,'A tiny held drag cannot move a page that fits the viewport')
      assert.ok(Math.abs((await header.boundingBox()).height-headerBox.height)<1,'Short content does not collapse the header')
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
      await page.getByLabel('Fixture notes').fill('Synthetic fixture note')
      await page.setViewportSize({width,height:450})
      await page.getByLabel('Fixture notes').scrollIntoViewIfNeeded()
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow')
      assert.deepEqual(errors,[])
      await context.close()
    }
  }
  console.log('PASS: actual Coach scroll/header layout, held touch, stable viewport, route/context resets, Settings offset, compact invitations and reduced viewport at 320/392px. Native handset confirmation remains separate.')
} finally { await browser.close() }
