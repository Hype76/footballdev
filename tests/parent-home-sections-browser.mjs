import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { parse } from '@babel/parser'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = process.cwd(), modules = path.join(root, 'apps/parent-mobile/node_modules')
const source = await readFile('apps/parent-mobile/App.js', 'utf8')
const nodes = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body
const names = ['HomeScreen', 'HomeCollapsibleSection', 'SectionHeading', 'SummaryButton', 'createParentAppPalette', 'createParentAppStyles']
const selected = names.map(name => { const node = nodes.find(node => node.type === 'FunctionDeclaration' && node.id.name === name); assert.ok(node, name); return source.slice(node.start, node.end) }).join('\n')
const entry = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {View,Text,Pressable,StyleSheet,Platform,useWindowDimensions} from 'react-native';
import ParentIcon from './apps/parent-mobile/src/ParentIcon.js';
import {useParentHomeSections} from './apps/parent-mobile/src/useParentHomeSections.js';
import {DEFAULT_PARENT_MOBILE_THEME,createParentMobileTheme} from './apps/mobile-core/src/parentThemeCore.js';
import {getParentHomeFixtureCards,getParentMatchDirectionsUrl,getParentCalendarDirectionsUrl} from './apps/parent-mobile/src/parentExperience.js';
import {countUnreadGeneralNotifications} from './apps/mobile-core/src/parentNotificationInboxCore.js';
const getParentScorerMatches=()=>[],getParentEventKey=event=>event.id,ResourceError=()=>null;
const MatchPreviewCard=({match,onPress})=><Pressable accessibilityRole="button" onPress={()=>onPress(match)}><Text>{match.opponent}</Text></Pressable>;
const CalendarCard=({event,onPress})=><Pressable accessibilityRole="button" onPress={()=>onPress(event)}><Text>{event.title}</Text></Pressable>;
let theme;const useParentTheme=()=>theme;
${selected}
const resources={items:[],loading:false};
const next={id:'next',title:'Monday Training',startsAt:'2099-01-01T18:00:00Z'};
const fixture={id:'fixture',opponent:'Upcoming fixture',status:'scheduled',matchDate:'2099-01-02'};
const homeModel={nextActivity:{type:'calendar',item:next},upcomingMatches:[fixture],upcomingCalendarEvents:[{id:'calendar',title:'Calendar session'}],recentMatches:[{id:'recent',opponent:'Recent result'}]};
function App(){const[user,setUser]=useState('parent-one'),[mounted,setMounted]=useState(true),[mode,setMode]=useState('light');window.user=setUser;window.mounted=setMounted;window.mode=setMode;
const tokens=createParentMobileTheme({mode}).tokens;const palette=createParentAppPalette(tokens);theme={palette,styles:createParentAppStyles(palette)};
return <View style={{padding:16,backgroundColor:palette.background,minHeight:'100vh'}}>{mounted?<HomeScreen userId={user} link={{id:'player'}} homeModel={homeModel} calendar={resources} matches={resources} messages={resources} notifications={{items:[{id:'notice',intentType:'match_update',title:'Hidden notification card',isRead:false}]}} onOpenUpdates={()=>window.destination='notifications'} onOpenMatch={match=>window.destination=match.id}/>:null}</View>}
createRoot(document.getElementById('root')).render(<App/>);`
const result = await build({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic', loader: { '.js': 'jsx', '.ttf': 'dataurl' }, platform: 'browser', conditions: ['browser'], mainFields: ['browser', 'module', 'main'], resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'], nodePaths: [modules], alias: { react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom'), 'react-native': path.join(modules, 'react-native-web') }, define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' }, banner: { js: 'globalThis.process={env:{NODE_ENV:"production"}};' } })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  await page.route('http://home.test/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body style="margin:0"><div id="root"></div></body></html>' }))
  const boot = async () => { await page.goto('http://home.test/'); await page.addScriptTag({ content: result.outputFiles[0].text }); await page.getByRole('button', { name: 'Fixtures', exact: true, expanded: true }).waitFor({timeout:10000}).catch(async error=>{ console.error(await page.locator('body').innerText()); throw error }) }
  await boot()
  assert.equal(await page.getByText('Hidden notification card').count(), 0)
  assert.equal(await page.getByRole('button', {name:'Calendar',exact:true}).count(),0)
  await page.getByRole('button', { name: '1 Notifications', exact: true }).click()
  assert.equal(await page.evaluate(() => window.destination), 'notifications')
  for (const [title, row] of [['Fixtures', 'Upcoming fixture'], ['Agenda', 'Calendar session'], ['Recent Matchday', 'Recent result']]) {
    const control = page.getByRole('button', { name: title, exact: true, expanded: true })
    await control.click()
    await page.getByRole('button', { name: title, exact: true, expanded: false }).waitFor()
    assert.equal(await page.getByText(row, { exact: true }).count(), 0)
    assert.ok(await page.getByText('Monday Training', { exact: true }).isVisible())
  }
  assert.equal(await page.getByRole('button', { name: 'Next up', exact: true }).count(), 0)
  await page.waitForFunction(() => Object.values(localStorage).some(value => value.includes('"recentMatches":false')))
  await page.evaluate(() => window.mounted(false))
  await page.getByText('Next up', { exact: true }).waitFor({ state: 'detached' })
  await page.evaluate(() => window.mounted(true))
  await page.getByRole('button', { name: 'Fixtures', exact: true, expanded: false }).waitFor()
  await page.evaluate(() => window.user('parent-two'))
  await page.getByRole('button', { name: 'Fixtures', exact: true, expanded: true }).waitFor()
  await page.evaluate(() => window.user('parent-one'))
  await page.getByRole('button', { name: 'Fixtures', exact: true, expanded: false }).waitFor()
  // Reload the entire JS runtime to prove persistence beyond the module cache.
  await page.reload()
  await page.addScriptTag({ content: result.outputFiles[0].text })
  for (const title of ['Fixtures', 'Agenda', 'Recent Matchday']) await page.getByRole('button', { name: title, exact: true, expanded: false }).waitFor()
  await mkdir('output/playwright/parent-home-sections', { recursive: true })
  for (const mode of ['light', 'dark']) for (const width of [320, 390]) {
    await page.evaluate(mode => window.mode(mode), mode)
    await page.setViewportSize({ width, height: 844 })
    assert.ok(await page.getByText('Monday Training', { exact: true }).isVisible())
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: `output/playwright/parent-home-sections/${mode}-${width}.png` })
  }
  await page.getByRole('button', { name: 'Fixtures', exact: true }).click()
  await page.getByRole('button', { name: 'Upcoming fixture', exact: true }).click()
  assert.equal(await page.evaluate(() => window.destination), 'fixture')
  assert.deepEqual(errors, [])
  console.log('PASS: Parent Home notification icon, saved independent sections, account isolation, remount and full reload, Next up, fixture navigation, 320/390px light/dark.')
} finally { await browser.close() }
