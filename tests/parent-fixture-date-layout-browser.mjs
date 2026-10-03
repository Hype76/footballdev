import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { parse } from '@babel/parser'
import { build } from 'esbuild'
import { chromium } from 'playwright'

// Render the actual Home and Match Day rows, including their actual styles.
// No account, fixture write, invitation response or external request is needed.
const root = process.cwd()
const modules = path.join(root, 'apps/parent-mobile/node_modules')
const baseline = process.argv.includes('--baseline')
function extract(source, names) {
  const declarations = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body.map(node => node.declaration || node)
  return names.map(name => {
    const node = declarations.find(node => node.type === 'FunctionDeclaration' && node.id.name === name)
    assert.ok(node, `Missing actual function ${name}`)
    return source.slice(node.start, node.end)
  }).join('\n')
}
let app = await readFile('apps/parent-mobile/App.js', 'utf8')
let portal = await readFile('apps/parent-mobile/src/ParentPortalScreens.js', 'utf8')
if (baseline) {
  app = app.replace("marginLeft: 'auto', textAlign: 'right'", "textAlign: 'right'")
  portal = portal.replace('style={[styles.meta, styles.fixtureDate]}', 'style={styles.meta}')
}
const entry = `
import React,{useState,useMemo} from 'react';import{createRoot}from'react-dom/client';
import{View,Text,Pressable,StyleSheet,Platform}from'react-native';
import{createParentMobileTheme,DEFAULT_PARENT_MOBILE_THEME}from'./apps/mobile-core/src/parentThemeCore.js';
import{getParentMatchStatusLabel}from'./apps/parent-mobile/src/parentExperience.js';
import{getParentMatchAvailability,getParentMatchSquadStatus}from'./apps/parent-mobile/src/parentMatchAvailability.js';
import{formatParentProductDateTime,formatParentProductTime}from'./apps/mobile-core/src/parentDateTimeCore.js';
import{getMatchDayDisplayName}from'./src/lib/matchday-display.js';
import{getMatchDayShirtChoiceLabel}from'./src/lib/matchday-model.js';
const ParentIcon=()=> <View style={{width:34,height:34}}/>;
const MatchResultIcon=()=>null,getParentMatchResult=()=>null;
const HomeStatusBadges=()=>null,getParentMatchStatusBadges=()=>[];
const getParentMatchAttendanceInvitation=()=>null;
const normalizeText=value=>String(value??'').trim();
const formatTime=value=>formatParentProductTime(value);
let currentTheme;const useParentTheme=()=>currentTheme;
${extract(app, ['MatchPreviewCard', 'Badge', 'createParentAppPalette', 'createParentAppStyles', 'formatDateOnly'])}
${extract(portal, ['MatchCard', 'MatchStatusBadge', 'scoreVisible', 'colorsFor', 'usePortalStyles', 'formatDate'])}
const fixture={id:'fixture',matchDate:'2026-10-24',teamName:'Synthetic U14',opponent:'Synthetic opposition',homeAway:'away',kickoffTime:'10:30',shirtChoice:'home',homeScore:0,awayScore:0};
const variants=[['scheduled','scheduled',false],['request','scorer_request',false],['live','live',false],['cancelled','cancelled',false],['finished','full_time',false],['fan','scheduled',true]];
function App(){const[mode,setMode]=useState('light');window.mode=setMode;const theme=createParentMobileTheme({mode});
currentTheme={palette:createParentAppPalette(theme.tokens),styles:createParentAppStyles(theme.tokens)};
const{colors,styles}=usePortalStyles(theme.tokens);
return <View style={{padding:16,backgroundColor:theme.tokens.background}}>{variants.map(([id,status,isFanView])=>{
 const match={...fixture,id,status,isFanView};return <View key={id}>
 <View testID={'home-'+id}><MatchPreviewCard match={match} onPress={()=>window.opened=id}/></View>
 <View testID={'list-'+id}><MatchCard match={match} colors={colors} styles={styles} invitations={[]} link={{}} onOpen={()=>window.opened=id}/></View>
 </View>})}</View>}
createRoot(document.getElementById('root')).render(<App/>);
`
const result = await build({
  stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false,
  jsx: 'automatic', loader: { '.js': 'jsx' }, platform: 'browser', conditions: ['browser'],
  mainFields: ['browser', 'module', 'main'], nodePaths: [modules],
  alias: { react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom'), 'react-native': path.join(modules, 'react-native-web') },
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' },
})
const browser = await chromium.launch({ headless: true })
const output = 'output/playwright/parent-fixture-date-layout'
await mkdir(output, { recursive: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  await page.route('**/*', route => route.abort())
  await page.setContent('<main id="root"></main>')
  await page.addScriptTag({ content: result.outputFiles[0].text })
  let checks = 0
  for (const width of [320, 390, 768]) for (const mode of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 1200 })
    await page.evaluate(mode => window.mode(mode), mode)
    await page.getByTestId('list-scheduled').waitFor()
    for (const surface of ['home', 'list']) {
      const rightEdges = []
      for (const variant of ['scheduled', 'request', 'live', 'cancelled', 'finished', 'fan']) {
        const row = page.getByTestId(`${surface}-${variant}`)
        const date = row.getByText(/24.*Oct/).first()
        const box = await date.boundingBox()
        assert.ok(box, `Date visible: ${surface} ${variant}`)
        const bounds = await date.evaluate(element => {
          const row = element.parentElement.getBoundingClientRect()
          const range = document.createRange(); range.selectNodeContents(element)
          const text = range.getBoundingClientRect()
          return { rowRight: row.right, textRight: text.right }
        })
        assert.ok(Math.abs(bounds.rowRight - bounds.textRight) < 2, `Date aligned right: ${surface} ${variant} ${mode} ${width}`)
        if (['scheduled', 'request', 'fan'].includes(variant)) rightEdges.push(bounds.textRight)
        checks++
      }
      assert.ok(Math.max(...rightEdges) - Math.min(...rightEdges) < 2, `Consistent dates: ${surface} ${mode} ${width}`)
      assert.equal(await page.getByTestId(`${surface}-scheduled`).getByText('Scheduled', { exact: true }).count(), 0)
      assert.equal(await page.getByTestId(`${surface}-request`).getByText('Scheduled', { exact: true }).count(), surface === 'list' ? 1 : 0)
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No overflow: ${mode} ${width}`)
    await page.screenshot({ path: `${output}/${mode}-${width}.png`, fullPage: true })
  }
  await page.getByTestId('list-scheduled').getByRole('button').click()
  assert.equal(await page.evaluate(() => window.opened), 'scheduled')
  assert.deepEqual(errors, [])
  assert.equal(baseline, false, 'Baseline must fail the alignment assertion')
  console.log(`PASS ${checks} date-alignment checks, both fixture surfaces, six statuses, three widths, two themes; badge policy and navigation preserved`)
} finally {
  await browser.close()
}
