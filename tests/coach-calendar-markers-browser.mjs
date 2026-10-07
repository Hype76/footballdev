import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { assertRenderedTextContrast } from './helpers/rendered-text-contrast.mjs'

const root = process.cwd()
const modules = path.join(root, 'apps/coach-mobile/node_modules')
const output = 'output/playwright/coach-calendar-markers'
const source = await readFile('apps/coach-mobile/src/CoachOperationalScreens.js', 'utf8')
const calendarImport = source.match(/import \{\s+buildCoachCalendarMonth,[\s\S]*?from '..\/..\/mobile-core\/src\/coachCalendarCore'/)[0]
  .replace('../../mobile-core/src/coachCalendarCore', './apps/mobile-core/src/coachCalendarCore.js')
const screen = source.slice(source.indexOf('function useDomainStyles('), source.indexOf('export function CoachPlayersScreen('))
const entry = `
import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Pressable,StyleSheet,Switch,Text,TextInput,View} from 'react-native'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import {createCoachTheme} from './apps/coach-mobile/src/coachThemeCore.js'
import {themeContrastRatio} from './apps/mobile-core/src/themeContrast.js'
import {formatUkDate} from './src/lib/date-format.js'
import {getMatchDayShirtChoiceLabel} from './src/lib/matchday-model.js'
import {CAPABILITIES,getFeatureAccess} from './src/lib/paywall-access.js'
${calendarImport}
const BrandLoader=()=>null,useConfirmedConnectionIssue=v=>v,useConfirmedConnectionMessage=v=>v
const deriveTeamNotificationDisplayName=v=>v,getCoachTeamNotificationDisplayName=async()=> 'FP TEST',message=e=>e.message
const readCoachOfflineResources=async()=>null,saveCoachOfflineResources=async()=>{},peekMobileResource=()=>undefined
const readMobileResource=async(_u,_key,loader)=>loader(),getCoachPlayerList=async()=>[],getCoachResources=async()=>[]
const getCoachCalendarResources=async()=>window.events
${screen}
const user={id:'FP TEST coach',activeTeamId:'team',roleRank:90}
const context={id:'team',teamId:'team',teamName:'FP TEST',planKey:'large_club',planStatus:'active',role:'head_coach',roleRank:90,paymentAccess:{canMutate:true}}
const date=getCoachCalendarMonthKey()+'-15',startsAt=date+'T12:00:00Z'
window.testDate=date
window.events=[
 {id:'match',sourceType:'match_day',title:'FP TEST match',eventType:'match'},
 {id:'training',title:'FP TEST training',eventType:'training'},
 {id:'development',sourceType:'assessment_session',title:'FP TEST development'},
 {id:'meeting',title:'FP TEST meeting',eventType:'meeting'},
].map(event=>({sourceType:'calendar_event',status:'scheduled',teamId:'team',calendarDate:date,startsAt,...event}))
window.events.push(...[
 {id:'cancelled',title:'FP TEST cancelled training',eventType:'training',status:'cancelled',day:'16'},
 {id:'postponed',title:'FP TEST postponed match',eventType:'match',status:'postponed',day:'17'},
 {id:'development-only',sourceType:'assessment_session',title:'FP TEST assessment',day:'18'},
 {id:'meeting-only',title:'FP TEST meeting only',eventType:'meeting',day:'19'},
].map(event=>({sourceType:'calendar_event',status:'scheduled',teamId:'team',calendarDate:date.slice(0,8)+event.day,startsAt:date.slice(0,8)+event.day+'T12:00:00Z',...event})))
window.iconGlyphs=MaterialIcons.glyphMap
window.themeContrastRatio=themeContrastRatio
function App(){const[mode,setMode]=useState('light');window.setMode=setMode;const palette=createCoachTheme({mode,context:{clubAccent:'#1d4079'}}).tokens;window.palette=palette;return <View style={{backgroundColor:palette.background,minHeight:'100vh',padding:12}}><CoachCalendarScreen context={context} contexts={[context]} onNavigate={()=>{}} palette={palette} user={user}/></View>}
createRoot(document.getElementById('root')).render(<App/>);
`
const result = await build({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic', loader: { '.js': 'jsx', '.ttf': 'dataurl' }, platform: 'browser', conditions: ['browser'], mainFields: ['browser', 'module', 'main'], nodePaths: [modules], resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'], alias: { react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom'), 'react-native': path.join(modules, 'react-native-web') }, define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' }, banner: { js: 'globalThis.process={env:{NODE_ENV:"production"}};' } })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<body style="margin:0"><div id="root"></div></body>')
  await page.addScriptTag({ content: result.outputFiles[0].text })
  const mixed = page.getByRole('button', { name: /15 .*4 events: Match, Training, Development, Calendar event/ })
  await mixed.waitFor()
  await page.waitForFunction(() => document.fonts.check('14px material'))
  const markerText = async (cell, names) => {
    const glyphs = await page.evaluate(names => names.map(name => String.fromCodePoint(window.iconGlyphs[name])), names)
    for (const glyph of glyphs) await cell.getByText(glyph, { exact: true }).waitFor()
  }
  await markerText(mixed, ['sports-soccer', 'sports'])
  assert.ok((await mixed.textContent()).includes('+2'))
  const cancelled = page.getByRole('button', { name: /16 .*1 event: Cancelled training/ })
  const postponed = page.getByRole('button', { name: /17 .*1 event: Postponed match/ })
  await markerText(cancelled, ['cancel'])
  await markerText(postponed, ['cancel'])
  await markerText(page.getByRole('button', { name: /18 .*1 event: Development/ }), ['trending-up'])
  await markerText(page.getByRole('button', { name: /19 .*1 event: Calendar event/ }), ['event'])
  await mkdir(output, { recursive: true })
  for (const mode of ['light', 'dark']) for (const width of [320, 390]) {
    await page.evaluate(mode => window.setMode(mode), mode)
    await page.setViewportSize({ width, height: 844 })
    await mixed.click()
    await page.getByText('4 Calendar items', { exact: true }).waitFor()
    await page.waitForFunction(() => document.querySelector('[aria-label*="4 events: Match, Training, Development, Calendar event"]')?.getAttribute('aria-selected') === 'true')
    assert.equal(await mixed.getAttribute('aria-selected'), 'true')
    await page.getByText('FP TEST match', { exact: true }).waitFor()
    await page.getByText('FP TEST training', { exact: true }).waitFor()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow')
    const bounds = await mixed.evaluate(cell => {
      const parent = cell.getBoundingClientRect()
      return [...cell.querySelectorAll('*')].filter(item => /^[\uE000-\uF8FF]$/.test(item.textContent)).map(item => {
        const box = item.getBoundingClientRect()
        return box.left >= parent.left && box.right <= parent.right
      })
    })
    assert.deepEqual(bounds, [true, true], 'Both icons fit inside narrow date cell')
    const iconColors = await mixed.evaluate(cell => {
      const expected = document.createElement('span').style
      expected.color = window.palette.selectedForeground
      return [...cell.querySelectorAll('*')].filter(item => /^[\uE000-\uF8FF]$/.test(item.textContent))
        .map(item => getComputedStyle(item).color === expected.color)
    })
    assert.deepEqual(iconColors, [true, true], 'Selected icons use selected foreground')
    await assertRenderedTextContrast(page, 'Coach Calendar '+mode+' '+width)
    assert.ok(await page.evaluate(() => window.themeContrastRatio(window.palette.selectedForeground, window.palette.selected) >= 3), 'Selected icon contrast')
    assert.ok(await page.evaluate(() => window.themeContrastRatio(window.palette.accentText, window.palette.surface) >= 3), 'Unselected icon contrast')
    await page.locator('[aria-label$=" Calendar"]').screenshot({ path: output+'/'+mode+'-'+width+'.png' })
    await page.getByRole('button', { name: 'Show all dates', exact: true }).click()
  }
  await cancelled.click()
  await page.getByText('FP TEST cancelled training', { exact: true }).waitFor()
  assert.equal(await page.getByText('FP TEST match', { exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await mixed.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'Previous', exact: true }).click()
  await mixed.waitFor()
  assert.deepEqual(errors, [])
  console.log('PASS: rendered Calendar event icons, mixed overflow, cancellation/postponement, selected-date filtering and month navigation, light/dark contrast and 320/390 px fit.')
} finally {
  await browser.close()
}
