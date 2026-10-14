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
const scrollKey = scroller.openingElement.attributes.find(a => a.name?.name === 'key')
assert.ok(scrollKey, 'Each page owns its native scroll view')
const scrollKeySource = source.slice(scrollKey.value.expression.start, scrollKey.value.expression.end)
for (const scope of ['user.id', 'activeContext.id', 'activeRoute', 'moreRoute']) assert.ok(scrollKeySource.includes(scope), 'The native page identity includes '+scope)
const header = elements.find(n => n.openingElement.name.name === 'CoachHeader')
assert.ok(header.start > shell.start && header.end < scroller.start, 'The fixed Coach header stays outside the native scrolling content')
const dragAttribute = scroller.openingElement.attributes.find(a => a.name?.name === 'onScrollBeginDrag')
assert.ok(dragAttribute, 'Coach dismisses the focused field at the start of a drag')
const dragSource = source.slice(dragAttribute.value.expression.start, dragAttribute.value.expression.end)
const touchAttribute = scroller.openingElement.attributes.find(a => a.name?.name === 'onTouchStart')
const touchSource = source.slice(touchAttribute.value.expression.start, touchAttribute.value.expression.end)
let shellSource = source.slice(shell.start, shell.end)
for (const node of elements.filter(n => ['CoachRoute', 'CoachQuickActions'].includes(n.openingElement.name.name)).sort((a, b) => b.start - a.start)) {
  shellSource = shellSource.slice(0, node.start - shell.start) + (node.openingElement.name.name === 'CoachRoute' ? '<CoachRoute onRequestScrollTop={scrollContentToTop} onNotificationSettingsFocus={focusNotificationSettings}/>' : '<View/>') + shellSource.slice(node.end - shell.start)
}
const names = ['CoachHeader', 'ContextSwitcher', 'PrimaryNavigation', 'ScreenIntro', 'MoreScreen', 'createCoachStyles']
const selected = names.map(name => { const n = nodes.find(n => n.type === 'FunctionDeclaration' && n.id.name === name); return source.slice(n.start, n.end) }).join('\n').replace("require('./assets/football-player-logo.png')", "require('./apps/coach-mobile/assets/football-player-logo.png')")
const callbacks = ['scrollContentToTop', 'focusNotificationSettings'].map(name => {
  const declaration = home.body.body.find(n => n.type === 'VariableDeclaration' && n.declarations[0].id.name === name)
  return source.slice(declaration.start, declaration.end)
}).join('\n')
const resetEffect = home.body.body.find(node => node.type === 'ExpressionStatement' && node.expression.callee?.name === 'useEffect'
  && source.slice(node.start, node.end).includes('scrollContentToTop()') && source.slice(node.start, node.end).includes('pendingScrollRestoreRef'))
assert.ok(resetEffect, 'The production page scroll-reset lifecycle is exercised')
const resetLifecycle = source.slice(resetEffect.start, resetEffect.end)
const keyboardLifecycle = home.body.body.filter(node => {
  if (node.type === 'VariableDeclaration') {
    const id = node.declarations[0].id
    return id.name === 'keyboardViewport' || (id.type === 'ArrayPattern' && id.elements[0]?.name === 'keyboardVisible')
  }
  return node.type === 'ExpressionStatement' && node.expression.callee?.name === 'useEffect'
    && source.slice(node.start, node.end).includes('keyboardViewport')
}).map(node => source.slice(node.start, node.end)).join('\n')
const entry = `import {CoachTeamBrandingSetup} from './apps/coach-mobile/src/CoachTeamBrandingSetup.js';
import {CoachKeyboardFocusContext} from './apps/coach-mobile/src/CoachKeyboardFocusContext.js';
import {createCoachKeyboardViewport} from './apps/coach-mobile/src/coachKeyboardViewportCore.js';
import {MobileActivityProvider} from './apps/mobile-core/src/MobileActivityContext.js';
import {MobileHeaderActivity} from './apps/mobile-core/src/MobileHeaderActivity.js';
const refreshUserProfile=async()=>{};

import React,{useRef,useMemo,useCallback,useEffect,useState} from 'react';import {createRoot} from 'react-dom/client';
import {View,Text,Image,Pressable,ScrollView,TextInput,Keyboard,KeyboardAvoidingView,RefreshControl,StyleSheet,Platform,AppState} from 'react-native';
const keyboardListeners=new Map();Platform.OS='ios';Keyboard.isVisible=()=>Boolean(window.keyboardY);Keyboard.metrics=()=>window.keyboardY?{screenY:window.keyboardY}:undefined;Keyboard.addListener=(name,fn)=>{const listeners=keyboardListeners.get(name)||new Set();listeners.add(fn);keyboardListeners.set(name,listeners);return{remove:()=>listeners.delete(fn)}};window.keyboardEvent=(name,y)=>{window.keyboardY=y;window.setHeight(y||850);keyboardListeners.get(name)?.forEach(fn=>fn({endCoordinates:{screenY:y}}))};
import {createCoachTheme} from './apps/coach-mobile/src/coachThemeCore.js';
import {getCoachBottomNavigationPadding} from './apps/coach-mobile/src/coachNavigationCore.js';
import {getCoachRouteIconKey} from './apps/mobile-core/src/mobileIconSystem.js';
import {createCoachScrollBounds} from './apps/coach-mobile/src/coachScrollBounds.js';
import {IconMenu} from './apps/mobile-core/src/IconSettings.js';
const config={isProduction:false};let theme;
const useCoachTheme=()=>theme;
const CoachIcon=()=> <Text>+</Text>;
const NotificationStatusButton=({onPress})=><Pressable accessibilityRole="button" accessibilityLabel="Notification settings" onPress={onPress}><Text>Alerts</Text></Pressable>;
const StatePanel=()=>null,Notice=()=>null,BrandLoader=()=> <View style={{height:28}}/>;
const PartnersBanner=()=> <View style={{height:156}}><Text>Special Offers</Text></View>;
${selected}
function CoachRoute({onRequestScrollTop,onNotificationSettingsFocus}){const reveal=React.useContext(CoachKeyboardFocusContext);if(window.route==='more'&&!window.moreRoute)return <MoreScreen navigation={{more:['Notifications','Formation Boards','Sessions','Development','Resources','Chat','Polls','Invites and availability','Team','Settings','Feedback & Suggestions','Report a Bug'].map(label=>({key:label,label}))}} onSelectMore={()=>{}}/>;return <View><Text testID="content-anchor" style={{fontSize:24,color:theme.palette.textPrimary}}>Next calendar item</Text><TextInput accessibilityLabel="Fixture notes" multiline style={{marginTop:12,height:40}}/><View style={{height:window.shortContent?200:1100}}/>{!window.shortContent?<><Text>Overall Comments</Text><TextInput accessibilityLabel="Overall Comments" multiline onFocus={reveal} style={{height:96}}/><Text>Coach summary</Text><TextInput accessibilityLabel="Coach summary" multiline onFocus={reveal} style={{height:96}}/><View style={{height:100}}/></>:null}<Pressable accessibilityRole="button" accessibilityLabel="Return to top" onPress={onRequestScrollTop}><Text>Top</Text></Pressable></View>}
function App(){
const [mode,setMode]=useState('dark'),[activeRoute,setActiveRoute]=useState('home'),[selected,setSelected]=useState('a'),[isRefreshing,setRefreshing]=useState(false);
const [moreRoute,setMoreRoute]=useState('');window.setMoreRoute=setMoreRoute;
const [height,setHeight]=useState(850);window.setHeight=setHeight;
window.setMode=setMode;window.setRoute=setActiveRoute;window.refresh=setRefreshing;
window.route=activeRoute;window.moreRoute=moreRoute;
const isMatchInvitesRoute=activeRoute==='invites';const safeAreaInsets={bottom:16};
const user={isOfflineProfile:false};
const quickActionVisibility={ready:true,enabled:true};
theme={...createCoachTheme({mode,context:{clubAccent:'#51bac4'}})};theme.palette=theme.tokens;theme.styles=createCoachStyles(theme.palette);theme.branding={logoUrl:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44"><rect width="44" height="44" fill="teal"/></svg>'};
const styles=theme.styles,palette=theme.palette;
const contexts=[{id:'a',clubName:'FP TEST',teamName:'U17 Green',roleLabel:'Team Admin',paymentAccess:{state:'allowed'}},{id:'b',clubName:'FP TEST',teamName:'Spain',roleLabel:'Team Admin',paymentAccess:{state:'allowed'}}].slice(0,window.contextCount||2);
const contextResolution={contexts},activeContext=contexts.find(c=>c.id===selected)||contexts[0],selectedMobileUser={roleLabel:'Team Admin'};
const notificationState={},notificationStateStatus='ready',notice='',setNotice=()=>{},setNotificationSettingsFocusRequest=()=>{},navigation={primary:[{key:'home',label:'Home'},{key:'calendar',label:'Calendar'},{key:'matchday',label:'Match Day'},{key:'more',label:'More'}]};
const contentScrollRef=useRef(null),contentOriginRef=useRef(0),pendingScrollRestoreRef=useRef(null);
const [contentScrollable,setContentScrollable]=useState(true);
const scrollBounds=useMemo(()=>createCoachScrollBounds(options=>{window.corrections.push(options);contentScrollRef.current?.scrollTo(options)},undefined,setContentScrollable),[]);
${keyboardLifecycle}
useEffect(()=>()=>scrollBounds.dispose(),[scrollBounds]);
${callbacks}
const navigate=route=>{setActiveRoute(route);scrollContentToTop()},selectContext=id=>{setSelected(id);scrollContentToTop()},openNotificationSettings=()=>{setActiveRoute('settings');requestAnimationFrame(()=>focusNotificationSettings(0))},loadHome=()=>setRefreshing(true);
window.bounds=scrollBounds;window.focusSettings=()=>focusNotificationSettings(0);window.queueTop=scrollContentToTop;window.pendingScroll=()=>pendingScrollRestoreRef.current;window.contentScrollable=contentScrollable;
window.beginDrag=${dragSource};
window.beginTouch=${touchSource};
${resetLifecycle}
return <MobileActivityProvider active={isRefreshing}><View style={[styles.appShell,{height}]}>${shellSource}</View></MobileActivityProvider>;
}
window.corrections=[];createRoot(document.getElementById('root')).render(<App/>);`
const result = await build({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic', loader: { '.js': 'jsx', '.png': 'dataurl' }, nodePaths:[modules], conditions:['browser'], mainFields:['browser','module','main'], resolveExtensions:['.web.tsx','.web.ts','.web.js','.tsx','.ts','.jsx','.js','.json'], alias: { 'react-native': path.join(modules, 'react-native-web'), react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom') }, define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' }, banner:{js:'globalThis.process={env:{NODE_ENV:"production"}};'} })
const out = 'output/playwright/coach-smooth-scroll'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  for (const width of [320, 392]) {
    for (const contextCount of [1, 2]) {
      const context = await browser.newContext({ viewport: { width, height: 850 }, isMobile: true, hasTouch: true })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', e => { errors.push(e.message); console.error(e.message) })
      await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}input{max-width:100%;box-sizing:border-box}</style><div id="root"></div>')
      await page.evaluate(count => { window.contextCount = count }, contextCount)
      await page.addScriptTag({ content: result.outputFiles[0].text })
      const scroll = page.getByTestId('coach-content-scroll'), header = page.getByTestId('mobile-header-activity')
      await header.waitFor()
      await page.waitForTimeout(150)
      const initial = await scroll.boundingBox(), headerBox = await header.boundingBox()
      const activityBefore = await page.getByTestId('mobile-header-activity').boundingBox()
      await page.evaluate(() => {
        window.trace = []
        window.observe = true
        const tick = () => { if (!window.observe) return; const s=document.querySelector('[data-testid="coach-content-scroll"]'),h=document.querySelector('[data-testid="mobile-header-activity"]');const b=s.getBoundingClientRect();window.trace.push({y:b.y,height:b.height,offset:s.scrollTop,headerHeight:h.getBoundingClientRect().height});requestAnimationFrame(tick) };tick()
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
      assert.deepEqual(await page.getByTestId('mobile-header-activity').boundingBox(), activityBefore, 'The fixed header stays still during the gesture')
      await page.evaluate(()=>window.refresh(true))
      await page.getByTestId('brand-loader').waitFor()
      assert.deepEqual(await page.getByTestId('mobile-header-activity').boundingBox(), activityBefore, 'Loading does not move or resize the header slot')
      await page.evaluate(()=>window.refresh(false))
      await page.getByTestId('brand-loader').waitFor({state:'hidden'})
      await page.screenshot({ path: `${out}/held-${width}-${contextCount}.png` })
      await scroll.evaluate(el=>{window.previousScrollNode=el})
      await page.evaluate(()=>window.setRoute('calendar'))
      await page.waitForTimeout(180)
      assert.equal(await scroll.evaluate(el=>el===window.previousScrollNode),false,'A tab change starts a fresh native scroll view rather than retaining the prior page geometry')
      assert.equal(await scroll.evaluate(el=>el.scrollTop),0,'Route changes return to the header')
      if(contextCount===2){await page.getByRole('button',{name:'Spain, Team Admin',exact:true}).click();assert.equal(await scroll.evaluate(el=>el.scrollTop),0)}
      await page.evaluate(()=>window.focusSettings())
      await page.waitForTimeout(500)
      const anchor=await page.getByTestId('content-anchor').boundingBox()
      assert.ok(anchor.y>=initial.y&&anchor.y<initial.y+65,'Settings focus accounts for header height')
      await page.evaluate(()=>window.setRoute('invites'))
      await page.waitForTimeout(180)
      assert.equal(await page.getByTestId('coach-scroll-header').count(),0,'Match invitations retain the compact route layout')
      assert.equal(await header.count(),1,'Match invitations retain the fixed header activity slot')
      assert.equal(await scroll.evaluate(el=>el.scrollTop),0)
      await page.evaluate(()=>{window.shortContent=true;window.setRoute('home');window.setMode('light')})
      await header.waitFor()
      await page.waitForTimeout(180)
      assert.equal(await scroll.evaluate(el=>el.scrollHeight),await scroll.evaluate(el=>el.clientHeight),'Short Home content fills the viewport without gaining a blank scroll range')
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:width-40,y:650}]})
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:width-40,y:646}]})
      await page.waitForTimeout(200)
      assert.equal(await scroll.evaluate(el=>el.scrollTop),0,'A tiny held drag cannot move a page that fits the viewport')
      assert.ok(Math.abs((await header.boundingBox()).height-headerBox.height)<1,'Short content does not collapse the header')
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:width-40,y:650}]})
      for(let i=1;i<=20;i++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:width-40,y:650-i*18}]})
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
      await page.waitForTimeout(180)
      assert.equal(await scroll.evaluate(el=>el.scrollTop),0,'A full upward swipe cannot scroll short Home content out of sight')
      await page.evaluate(()=>window.setRoute('more'))
      const finalTool=page.getByRole('button',{name:'Report a Bug',exact:true})
      await finalTool.waitFor()
      await page.waitForFunction(()=>{const scroll=document.querySelector('[data-testid="coach-content-scroll"]');return window.pendingScroll()===null&&(window.contentScrollable||scroll.scrollHeight<=scroll.clientHeight)})
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:width-40,y:650}]})
      for(let i=1;i<=16;i++){
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:width-40,y:650-i*20}]})
        await page.waitForTimeout(20)
      }
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
      await page.waitForTimeout(250)
      await page.waitForFunction(()=>{const scroll=document.querySelector('[data-testid="coach-content-scroll"]'),footer=document.querySelector('[role="tablist"]');const items=document.querySelectorAll('[aria-label="Report a Bug"]');return items.length&&items[0].getBoundingClientRect().bottom<=footer.getBoundingClientRect().top&&scroll.scrollTop>=0})
      const footer=await page.getByRole('tablist').boundingBox(),toolBox=await finalTool.boundingBox(),moreViewport=await scroll.boundingBox()
      await page.screenshot({path:out+'/more-'+width+'-'+contextCount+'.png'})
      assert.ok(moreViewport.y+moreViewport.height<=footer.y+1,'The actual More tool grid scrolls inside the viewport above bottom navigation')
      assert.ok(toolBox.y+toolBox.height<=footer.y, 'The last actual More tool can be reached without falling beneath bottom navigation: '+JSON.stringify({width,contextCount,footer,toolBox,moreViewport,geometry:await scroll.evaluate(el=>({height:el.clientHeight,content:el.scrollHeight,offset:el.scrollTop}))}))
      assert.ok(footer.y+footer.height<=850,'Bottom navigation stays within the screen')
      assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=850),'Long tool grids never stretch the outer page')
      await page.screenshot({path:out+'/more-'+width+'-'+contextCount+'.png'})
      for(const gesture of ['beginTouch','beginDrag']){
        const cancellation=await page.evaluate(name=>{
          const nativeRequest=window.requestAnimationFrame,nativeCancel=window.cancelAnimationFrame,frames=new Map();let next=0;
          window.requestAnimationFrame=fn=>{frames.set(++next,fn);return next};window.cancelAnimationFrame=id=>frames.delete(id);
          try{
            window.queueTop();window[name]({nativeEvent:{}});
            const scroll=document.querySelector('[data-testid="coach-content-scroll"]'),target=Math.min(160,scroll.scrollHeight-scroll.clientHeight);scroll.scrollTop=target;
            const queued=frames.size;for(const fn of frames.values())fn();
            return{queued,offset:scroll.scrollTop,target,pending:window.pendingScroll()};
          }finally{window.requestAnimationFrame=nativeRequest;window.cancelAnimationFrame=nativeCancel;window.bounds.handlers.onTouchEnd();window.bounds.handlers.onScrollEndDrag({nativeEvent:{contentOffset:{y:160}}})}
        },gesture)
        assert.ok(cancellation.target>0,'More has a scrollable offset for the cancellation regression')
        assert.deepEqual({queued:cancellation.queued,offset:cancellation.offset,pending:cancellation.pending},{queued:0,offset:cancellation.target,pending:null},'Starting '+gesture+' cancels a delayed route reset before it can jump the page')
      }
      await page.evaluate(()=>{window.bounds.handlers.onTouchEnd();window.shortContent=false;window.setMoreRoute('settings')})
      await page.waitForTimeout(180)
      await scroll.evaluate(el=>{el.scrollTop=el.scrollHeight-el.clientHeight;window.beforeMoreBackNode=el})
      await page.waitForTimeout(150)
      assert.ok(await page.evaluate(()=>window.bounds.getOffset())>0,'The More subpage has an offset before the hardware-back path')
      await page.evaluate(()=>window.setMoreRoute(''))
      await page.waitForTimeout(180)
      assert.equal(await scroll.evaluate(el=>el===window.beforeMoreBackNode),false,'Returning from a More subpage owns a fresh native page')
      assert.equal(await scroll.evaluate(el=>el.scrollTop),0,'A same-tab More return cannot clamp the old subpage offset into the new menu')
      assert.equal(await page.evaluate(()=>window.bounds.getOffset()),0,'A same-tab More return resets the shared bounds controller too')
      await page.evaluate(()=>{window.shortContent=true;window.setRoute('matchday')})
      await page.waitForTimeout(180)
      assert.equal(await scroll.evaluate(el=>el.scrollTop),0,'Switching from More to a short Match Day page restores the top')
      assert.equal(await page.evaluate(()=>window.bounds.getOffset()),0)
      await page.getByLabel('Fixture notes').fill('Synthetic fixture note')
      assert.equal(await page.getByLabel('Fixture notes').evaluate(el=>document.activeElement===el),true,'Real multiline input has focus')
      await page.evaluate(()=>window.beginDrag({nativeEvent:{}}))
      assert.equal(await page.getByLabel('Fixture notes').evaluate(el=>document.activeElement===el),false,'Production drag callback blurs the focused multiline input')
      assert.equal(await page.getByLabel('Fixture notes').inputValue(),'Synthetic fixture note','Keyboard dismissal preserves entered notes')
      await page.evaluate(()=>window.bounds.handlers.onScrollEndDrag({nativeEvent:{contentOffset:{y:0}}}))
      await page.evaluate(()=>{window.shortContent=false;window.setMode('dark')})
      const comments = page.getByLabel('Overall Comments', {exact:true})
      await comments.fill('Saved comment remains visible while typing')
      await scroll.evaluate(el => { const field=document.querySelector('[aria-label="Overall Comments"]');el.scrollTop+=field.getBoundingClientRect().top-478 })
      await page.waitForTimeout(100)
      await page.evaluate(()=>window.keyboardEvent('keyboardDidShow',478))
      await page.waitForTimeout(200)
      let fieldBox=await comments.boundingBox(),viewportBox=await scroll.boundingBox()
      assert.ok(fieldBox.y>=viewportBox.y+23&&fieldBox.y+fieldBox.height<=455,'Actual multiline box fits between the fixed header and keyboard after the screenshot geometry')
      await page.evaluate(()=>window.keyboardEvent('keyboardDidChangeFrame',430))
      await page.waitForTimeout(200)
      fieldBox=await comments.boundingBox()
      assert.ok(fieldBox.y+fieldBox.height<=407,'Taller keyboard keeps the comment box visible')
      const summary=page.getByLabel('Coach summary',{exact:true})
      await summary.fill('Summary stays visible too')
      await page.waitForTimeout(200)
      fieldBox=await summary.boundingBox();viewportBox=await scroll.boundingBox()
      assert.ok(fieldBox.y>=viewportBox.y+23&&fieldBox.y+fieldBox.height<=407,'Switching to the summary uses its measured window position')
      await page.evaluate(()=>window.keyboardEvent('keyboardDidHide',null))
      await page.waitForTimeout(150)
      assert.equal(await comments.inputValue(),'Saved comment remains visible while typing')
      assert.equal(await summary.inputValue(),'Summary stays visible too')
      await page.setViewportSize({width,height:450})
      await page.getByLabel('Fixture notes').scrollIntoViewIfNeeded()
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow')
      assert.deepEqual(errors,[])
      await context.close()
    }
  }
  console.log('PASS: actual Coach scroll/header layout, held touch, stable viewport, route/context resets, Settings offset, compact invitations, multiline drag-dismiss, measured comment/summary visibility above resized keyboards, preserved text and reduced viewport at 320/392px. Native handset confirmation remains separate.')
} finally { await browser.close() }
