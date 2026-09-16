import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from '@babel/parser'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { assertRenderedTextContrast } from './helpers/rendered-text-contrast.mjs'

const root = process.cwd()
const modules = path.join(root, 'apps/coach-mobile/node_modules')
const source = await readFile('apps/coach-mobile/src/CoachOperationalScreens.js', 'utf8')
const nodes = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body
  .map(node => node.type === 'ExportNamedDeclaration' ? node.declaration : node)
const extract = names => names.map(name => {
  const node = nodes.find(candidate => candidate?.type === 'FunctionDeclaration' && candidate.id.name === name)
  assert.ok(node, name)
  return source.slice(node.start, node.end)
}).join('\n')
const helpers = extract(['useDomainStyles', 'Button', 'Field', 'Chips', 'getSavedLocationOptions', 'DomainHeader', 'DomainState'])
const screen = source.slice(source.indexOf('export function CoachSessionsScreen('), source.indexOf('function SessionPlayerNotes'))

const entry = `
import React,{useCallback,useEffect,useMemo,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Keyboard,Pressable,StyleSheet,Switch,Text,TextInput,View} from 'react-native'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import {createCoachTheme} from './apps/coach-mobile/src/coachThemeCore.js'
import {filterCoachSessions,getCoachSessionMutationPolicy} from './apps/mobile-core/src/coachSessionsCore.js'
import {coachCalendarFormFromEvent,filterCoachCalendarEvents} from './apps/mobile-core/src/coachCalendarCore.js'
import {getCoachOfflineSaveWarning} from './apps/coach-mobile/src/coachOfflineErrors.js'
import {formatUkDate} from './src/lib/date-format.js'
const getCoachFriendlyError=error=>error?.message||'Unknown error'
const message=getCoachFriendlyError
const useConfirmedConnectionIssue=value=>value
const useConfirmedConnectionMessage=value=>value
const BrandLoader=()=>null
const formatCoachCalendarEventDateTime=event=>event.title+' | '+event.occurrenceDate
const withMobileAsyncTimeout=loader=>loader()
const getCoachSessionList=async()=>window.liveSessions
const getCoachPlayerList=async()=>[]
const getCoachCalendarResources=async()=>[]
const getCoachSessionDetail=async()=>({session:window.liveSessions[0],players:[]})
const saveCoachSession=async()=>{}
const saveCoachTrainingInvitation=async()=>({})
const completeCoachSession=async()=>{}
const addCoachSessionPlayers=async()=>{}
const updateCoachSessionPlayerNotes=async()=>{}
const coachSessionFormFromSession=existing=>existing||{sessionType:'training',sessionDate:'2026-09-16',startTime:'18:00',endTime:'19:00',location:'',notes:''}
const readMobileResource=(_user,_key,loader)=>loader()
const readCoachOfflineResources=async()=>null
const createCoachOfflineResourceSaver=()=>async resources=>{window.cacheSaves=(window.cacheSaves||0)+1;if(window.cacheError)throw new Error('SQLite database or disk is full');window.lastCached=resources}
const CoachDateTimeField=({label,value})=><Text accessibilityLabel={label}>{value}</Text>
const LocationField=({label='Location',value})=><Text accessibilityLabel={label}>{value}</Text>
${helpers}
${screen}
const user={id:'FP TEST coach',clubId:'FP TEST club',activeTeamId:'FP TEST team'}
window.liveSessions=[{id:'FP TEST session',title:'FP TEST Assessment Session',status:'open',sessionDate:'2099-09-16',sessionType:'training',startTime:'18:00',endTime:'19:00',location:'FP TEST pitch',notes:''}]
window.cacheError=true
function App(){const[mode,setMode]=useState('light');window.setMode=setMode;const context=useMemo(()=>({id:'FP TEST team',clubId:'FP TEST club',teamId:'FP TEST team',teamName:'FP TEST',roleRank:70,paymentAccess:{canMutate:true}}),[]);const palette=createCoachTheme({mode,context:{clubAccent:'#1d4079'}}).tokens;return <View style={{backgroundColor:palette.background,minHeight:'100vh',padding:12}}><CoachSessionsScreen context={context} onNavigate={()=>{}} onQuickActionHandled={()=>{}} palette={palette} quickAction={null} user={user}/></View>}
createRoot(document.getElementById('root')).render(<App/>);`

const result = await build({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic', loader: { '.js': 'jsx', '.ttf': 'dataurl' }, platform: 'browser', conditions: ['browser'], mainFields: ['browser', 'module', 'main'], nodePaths: [modules], resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'], alias: { react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom'), 'react-native': path.join(modules, 'react-native-web') }, define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' }, banner: { js: 'globalThis.process={env:{NODE_ENV:"production"}};' } })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error('pageerror:', error.message) })
  await page.setContent('<body style="margin:0"><div id="root"></div></body>')
  await page.addScriptTag({ content: result.outputFiles[0].text })
  await page.getByText('FP TEST Assessment Session', { exact: true }).waitFor({ timeout: 3000 })
  const warningText = page.getByText(/Sessions are up to date, but this phone could not save an offline copy/)
  await warningText.waitFor()
  assert.equal(await page.getByText('Could not load Sessions', { exact: true }).count(), 0)
  assert.equal(await page.getByText('FP TEST Assessment Session', { exact: true }).count(), 1)
  assert.equal(await page.getByText('Try saving offline again', { exact: true }).count(), 1)
  assert.equal(await page.locator('input').count(), 0)
  const warningAppearance = await warningText.evaluate(element => {
    const container = element.closest('[aria-live="polite"]')
    const style = getComputedStyle(container)
    return {
      background: style.backgroundColor,
      borderBottom: style.borderBottomWidth,
      borderLeft: style.borderLeftWidth,
      borderRadius: style.borderTopLeftRadius,
      borderRight: style.borderRightWidth,
      borderTop: style.borderTopWidth,
    }
  })
  assert.deepEqual(warningAppearance, { background: 'rgba(0, 0, 0, 0)', borderBottom: '1px', borderLeft: '0px', borderRadius: '0px', borderRight: '0px', borderTop: '0px' })
  await mkdir('output/playwright/coach-sessions-cache-warning', { recursive: true })
  for (const mode of ['light', 'dark']) for (const width of [320, 390]) {
    await page.evaluate(value => window.setMode(value), mode)
    await page.setViewportSize({ width, height: 844 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await assertRenderedTextContrast(page, `Coach Sessions cache warning ${mode} ${width}`)
    await page.screenshot({ path: `output/playwright/coach-sessions-cache-warning/${mode}-${width}.png`, fullPage: true })
  }
  await page.evaluate(() => { window.cacheError = false })
  await page.getByText('Try saving offline again', { exact: true }).click()
  await warningText.waitFor({ state: 'hidden' })
  assert.equal(await page.getByText('FP TEST Assessment Session', { exact: true }).count(), 1)
  assert.equal(await page.evaluate(() => window.cacheSaves), 2)
  await page.getByText('Create training session', { exact: true }).click()
  await page.getByText('Save training session', { exact: true }).waitFor()
  await page.getByText('Cancel', { exact: true }).waitFor()
  const trainingFormAppearance = await page.getByText('Create training session', { exact: true }).evaluate(element => {
    const section = element.closest('div')?.parentElement
    const style = getComputedStyle(section)
    return {
      background: style.backgroundColor,
      borderBottom: style.borderBottomWidth,
      borderLeft: style.borderLeftWidth,
      borderRadius: style.borderTopLeftRadius,
      borderRight: style.borderRightWidth,
      borderTop: style.borderTopWidth,
    }
  })
  assert.deepEqual(trainingFormAppearance, { background: 'rgba(0, 0, 0, 0)', borderBottom: '1px', borderLeft: '0px', borderRadius: '0px', borderRight: '0px', borderTop: '0px' })
  await page.getByText('Cancel', { exact: true }).click()
  assert.equal(await page.getByText('Save training session', { exact: true }).count(), 0)
  assert.deepEqual(errors, [])
  console.log('PASS: live Sessions remain visible after offline cache-save failure; SPACE warning is actionable, compact, borderless except separator, contrast-safe at 320/390px light/dark, clears after successful retry, and training form is compact and cancellable.')
} finally { await browser.close() }
