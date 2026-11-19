import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium, devices, webkit } from 'playwright'

const root = process.cwd()
const modules = path.join(root, 'apps/coach-mobile/node_modules')
const app = await readFile('apps/coach-mobile/App.js', 'utf8')
const navigationStart = app.indexOf('function PrimaryNavigation(')
const navigationEnd = app.indexOf('\nfunction ', navigationStart + 1)
assert.ok(navigationStart >= 0 && navigationEnd > navigationStart)

const result = await build({
  stdin: { resolveDir: root, loader: 'jsx', contents: `
    import React, { useState } from 'react'
    import { createRoot } from 'react-dom/client'
    import { Pressable, Text, View } from 'react-native'
    import { CoachSpeedDiagnostics } from './apps/coach-mobile/src/CoachSpeedDiagnostics'
    import { COACH_TIMED_TABS, createCoachTabTiming } from './apps/coach-mobile/src/coachPerformanceDiagnosticsCore'
    import { recordCoachPerformanceSample } from './apps/coach-mobile/src/coachPerformanceDiagnostics'
    const styles = { tabBar: { flexDirection: 'row', justifyContent: 'space-around' }, tab: { minHeight: 48, justifyContent: 'center' }, infoRow: { flexDirection: 'row', justifyContent: 'space-between', padding: 4 }, infoLabel: { flex: 1 } }
    const useCoachTheme = () => ({ styles, palette: { accentText: '#0d4480', textMuted: '#435461' } })
    const CoachIcon = () => null
    const getCoachBottomNavigationPadding = () => 0
    const getCoachRouteIconKey = route => route
    ${app.slice(navigationStart, navigationEnd)}
    const timings = createCoachTabTiming({ record: recordCoachPerformanceSample })
    const tabs = Object.entries(COACH_TIMED_TABS).map(([key, label]) => ({ key, label }))
    function Screen({ route, timing }) {
      const [data, setData] = useState(false)
      async function reloadHome() {
        recordCoachPerformanceSample({ name: 'home.invites', durationMs: 17700, status: 'error', source: 'manual' })
      }
      window.showCalendar = () => { setData(true); timing.data('success') }
      return <View onLayout={() => timing?.screen()}>
        {route === 'more' ? <CoachSpeedDiagnostics reloadHome={reloadHome} styles={styles}/> : <Text>{data ? 'Calendar data' : 'Loading tab data'}</Text>}
      </View>
    }
    function App() {
      const [visit, setVisit] = useState({ route: 'more', timing: null })
      const open = route => { if (route !== visit.route) setVisit({ route, timing: timings.begin(route) }) }
      return <View><PrimaryNavigation activeRoute={visit.route} bottomInset={0} navigation={tabs} onNavigate={open} platform="web"/>
        <Screen key={visit.route} {...visit}/>
      </View>
    }
    createRoot(document.getElementById('root')).render(<App/>)
  ` },
  plugins: [{
    name: 'local-timing-storage',
    setup(build) {
      build.onResolve({ filter: /^@react-native-async-storage\/async-storage$/ }, () => ({ path: 'storage', namespace: 'timings' }))
      build.onLoad({ filter: /.*/, namespace: 'timings' }, () => ({ contents: "export default {getItem: async key => localStorage.getItem(key), setItem: async (key, value) => localStorage.setItem(key, value), removeItem: async key => localStorage.removeItem(key)}" }))
    },
  }],
  alias: { 'react-native': path.join(modules, 'react-native-web'), react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom') },
  loader: { '.js': 'jsx' },
  jsx: 'automatic',
  bundle: true,
  write: false,
  define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
})

const androidBrowser = await chromium.launch()
const iosBrowser = process.env.COACH_TIMINGS_IOS_WEBKIT === '1' ? await webkit.launch() : androidBrowser
try {
  for (const [browser, device] of [[iosBrowser, 'iPhone 13'], [androidBrowser, 'Pixel 7']]) {
    const page = await browser.newPage({ ...devices[device] })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://localhost:9883/**', route => route.fulfill({
      contentType: route.request().url().endsWith('/app.js') ? 'application/javascript' : 'text/html',
      body: route.request().url().endsWith('/app.js') ? result.outputFiles[0].text : '<meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script src="/app.js"></script>',
    }))
    await page.goto('http://localhost:9883')
    const open = name => page.getByRole('tab', { name: name + ' tab', exact: true }).click()
    const section = name => page.getByRole('heading', { name, exact: true }).locator('..')
    const timing = async (name, tab) => (await section(name).getByText(tab, { exact: true }).locator('..').innerText()).replace(tab, '').trim()
    const milliseconds = value => parseFloat(value) * (value.endsWith(' ms') ? 1 : 1000)
    await open('Calendar')
    await page.getByText('Loading tab data', { exact: true }).waitFor()
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('fp.mobile.performance.v1.coach') || '[]').some(sample => sample.name === 'tab.calendar.screen'))
    await page.evaluate(() => window.showCalendar())
    await page.getByText('Calendar data', { exact: true }).waitFor()
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('fp.mobile.performance.v1.coach') || '[]').some(sample => sample.name === 'tab.calendar.data'))
    await open('Match Day')
    await page.getByText('Loading tab data', { exact: true }).waitFor()
    await open('More')
    await section('Tap to screen').getByText('Calendar', { exact: true }).waitFor()
    const screen = await timing('Tap to screen', 'Calendar')
    const data = await timing('Data wait after screen opens', 'Calendar')
    assert.ok(milliseconds(data) > milliseconds(screen), `Expected delayed data after layout, got ${screen} and ${data}`)
    assert.match(await timing('Data wait after screen opens', 'Match Day'), /Left before ready/)
    assert.equal(await section('Data wait after screen opens').getByText('More', { exact: true }).count(), 0)
    await page.getByRole('button', { name: 'Run speed check', exact: true }).click()
    await page.getByText('17.70 s · Failed', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Clear saved results', exact: true }).click()
    await page.getByText('Saved speed results cleared from this phone.', { exact: true }).waitFor()
    assert.equal(await timing('Tap to screen', 'Calendar'), 'Awaiting sample')
    assert.deepEqual(errors, [])
    console.log(`PASS ${device} ${browser.browserType().name()}: separate tap and data timing, interrupted load, failed request duration and clear.`)
    await page.close()
  }
} finally {
  if (iosBrowser !== androidBrowser) await iosBrowser.close()
  await androidBrowser.close()
}
