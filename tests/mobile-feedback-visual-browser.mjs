import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { assertRenderedTextContrast } from './helpers/rendered-text-contrast.mjs'

const root = process.cwd(), modules = path.join(root, 'apps/coach-mobile/node_modules')
const out = 'output/playwright/mobile-feedback'
await mkdir(out, { recursive: true })
const source = await readFile('apps/coach-mobile/src/CoachPhase31EScreens.js', 'utf8')
const styles = source.slice(source.indexOf('function phaseStyles('), source.indexOf('function InviteDeliveryTicks('))
const delivery = source.slice(source.indexOf('function InviteDeliveryTicks('), source.indexOf('function InviteCarpoolIcon('))
const result = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {View,Text,StyleSheet} from 'react-native'; import MaterialIcons from '@expo/vector-icons/MaterialIcons';
    import {InviteStatusBadge} from './apps/mobile-core/src/InviteStatusBadge.js';
    import {TextField} from './apps/mobile-core/src/ui.js';
    import {getCoachInviteDeliveryProgress} from './apps/mobile-core/src/coachPhase31ECore.js';
    import {createCoachTheme} from './apps/coach-mobile/src/coachThemeCore.js';
    ${styles} ${delivery}
    function App(){const [mode,setMode]=React.useState('dark'),[password,setPassword]=React.useState(''); window.setMode=setMode;
      const palette=createCoachTheme({mode,context:{clubAccent:'#004d00'}}).tokens, styles=phaseStyles(palette);
      return <View style={{backgroundColor:palette.background,padding:16,minHeight:'100vh'}}>
        <Text style={{color:palette.textPrimary,fontSize:20,fontWeight:'800',marginBottom:16}}>Training responses</Text>
        {['available','maybe','unavailable','awaiting','cancelled'].map((status,index)=>{const invite={status,sentAt:'2026-09-08',deliveryState:index===3?'sent':'delivered',respondedAt:index<3?'2026-09-08':''}; return <View key={status} style={styles.availabilityRow}>
          <Text style={[styles.body,{flex:1}]}>Player {index+1}</Text><View><InviteStatusBadge status={status} kind="training" Icon={MaterialIcons}/><InviteDeliveryTicks invite={invite} styles={styles}/></View>
        </View>})}
        <View style={{backgroundColor:'#07120c',padding:12,marginTop:20}}><TextField label="Registration password" secureTextEntry value={password} onChangeText={setPassword}/></View>
      </View>}
    createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: root, loader: 'jsx' },
  bundle: true, write: false, jsx: 'automatic', loader: { '.js': 'jsx', '.ttf': 'dataurl', '.png': 'dataurl' },
  platform: 'browser', conditions: ['browser'], mainFields: ['browser', 'module', 'main'], nodePaths: [modules],
  resolveExtensions: ['.web.tsx','.web.ts','.web.js','.tsx','.ts','.jsx','.js','.json'],
  alias: { react: path.join(modules,'react'), 'react-dom': path.join(modules,'react-dom'), 'react-native': path.join(modules,'react-native-web') },
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' }, banner: { js: 'globalThis.process={env:{NODE_ENV:"production"}};' },
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 650 } })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.setContent('<body style="margin:0"><div id="root"></div></body>')
  await page.addScriptTag({ content: result.outputFiles[0].text })
  await page.getByText('Training responses', { exact: true }).waitFor()
  const field = page.locator('input')
  await field.fill('Synthetic-password-42!')
  await page.getByRole('button', { name: 'Show Registration password' }).click()
  assert.equal(await field.evaluate(el => el.type), 'text')
  assert.equal(await field.inputValue(), 'Synthetic-password-42!')
  await page.getByRole('button', { name: 'Hide Registration password' }).click()
  assert.equal(await field.evaluate(el => el.type), 'password')
  for (const mode of ['dark','light']) {
    await page.evaluate(mode => window.setMode(mode), mode)
    for (const width of [390,320]) {
      await page.setViewportSize({width,height:650})
      await assertRenderedTextContrast(page, `Response badges ${mode} ${width}`)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.screenshot({path:`${out}/responses-${mode}-${width}.png`,fullPage:true})
    }
  }
  assert.deepEqual(errors,[])
  console.log('PASS: response badges and delivery progress contrast, dark/light, 320/390px, registration show/hide and value preservation.')
} finally { await browser.close() }
