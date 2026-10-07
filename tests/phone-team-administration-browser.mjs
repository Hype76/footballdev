import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { parse } from '@babel/parser'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { assertRenderedTextContrast } from './helpers/rendered-text-contrast.mjs'

const root = process.cwd(), modules = path.join(root, 'apps/coach-mobile/node_modules'), out = 'output/playwright/team-administration'
await mkdir(out, { recursive: true })
const source = await readFile('apps/coach-mobile/App.js', 'utf8')
const functions = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body.filter(node => node.type === 'FunctionDeclaration')
const selected = ['FoundationRoute', 'SettingsScreen', 'ScreenIntro', 'Section', 'InfoRow', 'SettingRow', 'PrimaryAction', 'SecondaryAction', 'CoachIcon', 'useCoachTheme', 'createCoachThemeContext', 'createCoachStyles'].map(name => {
  const node = functions.find(candidate => candidate.id.name === name)
  assert.ok(node, `Actual app function ${name} is present`)
  return source.slice(node.start, node.end)
}).join('\n')
const entry = `
import React,{useState,useEffect,useMemo,useContext,createContext} from 'react';
import {createRoot} from 'react-dom/client';
import {View,Text,TextInput,Switch,Pressable,StyleSheet,Platform,Linking} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {CoachTeamAdministration} from './apps/coach-mobile/src/CoachTeamAdministration.js';
import {IconSettings,SettingsSection} from './apps/mobile-core/src/IconSettings.js';
import {createCoachTheme} from './apps/coach-mobile/src/coachThemeCore.js';
import {getWorkspaceScope} from './src/lib/workspace-scope.js';
import {getMobileIconName} from './apps/mobile-core/src/mobileIconSystem.js';
import {MOBILE_SETTING_LOAD_STATES} from './apps/mobile-core/src/deviceSettingsCore.js';
const CoachThemeContext=createContext(null),Application={},Constants={};
const config={isProduction:true},inspectCoachOfflineState=async()=>({hasDocument:true}),canChooseTrainingAttendanceVisibility=()=>false;
const coachSupabase={},getTrainingAttendanceVisibility=async()=>true,setTrainingAttendanceVisibility=async()=>true;
const teamLeagueScopeKey=()=>'',coachTeamLeagueScope=()=>({}),isMobileRouteAllowed=()=>false,resolveCoachRoute=()=>false;
const TeamLeagueLinkSettings=()=>null,DeviceThemeChoices=()=>null,CoachTeamKitSettings=()=>null,NotificationCategorySettings=()=>null;
const BrandLoader=()=>null,CoachOfflineReadiness=()=>null,getCoachNotificationStatusLabel=()=>'',formatDateTime=()=>'',getBuildClassification=()=>'';
${selected}
function Preview(){const[fixture,setFixture]=useState(window.fixture);window.updateFixture=p=>setFixture(f=>({...f,...p}));
const theme=createCoachTheme({mode:fixture.mode,context:{clubAccent:'#2ba7aa'}}),value=createCoachThemeContext(theme);
const context={id:fixture.teamId||'context-a',teamId:fixture.teamId||'10000000-0000-4000-8000-000000000020',clubId:'10000000-0000-4000-8000-000000000010',role:fixture.staffRole||'head_manager',roleRank:fixture.staffRole==='coach'?30:70,roleLabel:fixture.staffRole==='coach'?'Coach':'Team Admin',teamName:'Synthetic team',clubName:'Synthetic club',paymentAccess:{state:'active'}};
const user={id:'10000000-0000-4000-8000-000000000001',clubId:context.clubId,activeTeamId:context.teamId};
const common={context,user,quickActionVisibility:{ready:true,enabled:false},themeMode:fixture.mode,onNavigate(){},onSignOut(){}};
return <CoachThemeContext.Provider value={value}><View style={{backgroundColor:theme.tokens.background,minHeight:'100vh',padding:16}}>{fixture.route==='settings'?<SettingsScreen {...common}/>:<FoundationRoute route="team" {...common}/>}</View></CoachThemeContext.Provider>}
createRoot(document.getElementById('root')).render(<Preview/>);
`
const compiled = await build({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic', loader: { '.js': 'jsx' }, platform: 'browser', conditions: ['browser'], mainFields: ['browser', 'module', 'main'], resolveExtensions: ['.web.js', '.js', '.json'], nodePaths: [modules],
  alias: { 'react-native': path.join(modules, 'react-native-web'), react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom') },
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' },
  plugins: [{ name: 'synthetic-service-only-adapters', setup(b) {
    b.onResolve({ filter: /mobileSignup$/ }, () => ({ path: 'account', namespace: 'fixture' }))
    b.onResolve({ filter: /^@expo\/vector-icons/ }, () => ({ path: 'icon', namespace: 'fixture' }))
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'jsx', contents: args.path === 'icon'
      ? `import React from 'react';import {Text} from 'react-native';export default function Icon({color}){return <Text aria-hidden="true" style={{color}}>*</Text>}`
      : `export async function mobileAccountRequest(_,name,body){window.calls.push(body);const value={...window.policy};if(body.action==='read'||body.action==='roster')return value;if(window.defer)await new Promise(resolve=>window.resolvePending=resolve);if(body.action==='save')return {...value,...body};if(body.action==='remove'){if(window.rejectRemoval)throw new Error('Only the team admin can manage coaches.');const coaches=value.coaches.filter(c=>c.id!==body.assignmentId);if(window.policy.teamId===body.teamId)window.policy.coaches=coaches;return {...value,coaches,message:'Coach access removed from this team.'}}return {...value,message:'Coach invitation sent.'}}` }))
  } }],
})
const browser = await chromium.launch({ headless: true }), errors = []
let checks = 0, maximumFeedbackMs = 0
try {
  for (const width of [320, 390]) for (const mode of ['light', 'dark']) for (const route of ['settings', 'team']) {
    const page = await browser.newPage({ viewport: { width, height: 844 } })
    page.setDefaultTimeout(8000)
    page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
    await page.route('**/*', request => request.abort())
    await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div></body></html>')
    await page.evaluate(({ mode, route }) => {
      window.fixture={mode,route};window.calls=[];window.defer=true;
      window.policy={teamId:'10000000-0000-4000-8000-000000000020',clubId:'10000000-0000-4000-8000-000000000010',canManage:true,squadEnabled:false,squadHoursBefore:48,availabilityEnabled:false,availabilityHoursBefore:48,coaches:[{id:'10000000-0000-4000-8000-000000000031',userId:'10000000-0000-4000-8000-000000000002',name:'Synthetic coach',email:'synthetic@example.com',role:'coach',roleLabel:'Coach',canRemove:true}]}
    }, { mode, route })
    await page.addScriptTag({ content: compiled.outputFiles[0].text })
    if (route === 'settings') {
      await page.getByRole('button', { name: 'Team reminders', exact: true }).click()
      const field = page.getByRole('textbox', { name: 'Hours before kick-off', exact: true })
      await field.waitFor(); assert.equal(await field.inputValue(), '48')
      const availabilityField = page.getByRole('textbox', { name: 'Hours before a match or training', exact: true })
      const squadBounds = await field.boundingBox(), availabilityBounds = await availabilityField.boundingBox()
      assert.equal(squadBounds.x, availabilityBounds.x, 'Hour controls share an aligned column')
      assert.ok(squadBounds.height >= 48 && availabilityBounds.height >= 48, 'Hour controls retain touch targets')
      const squadSwitch = page.getByRole('switch', { name: 'Squad selection reminder', exact: true })
      await squadSwitch.check()
      assert.equal(await squadSwitch.isChecked(), true)
      await field.fill('24')
      const start = performance.now()
      await page.getByRole('button', { name: 'Save reminders', exact: true }).click()
      await page.getByText('Saving reminder settings...', { exact: true }).waitFor({ timeout: 1000 })
      maximumFeedbackMs = Math.max(maximumFeedbackMs, performance.now() - start)
      await page.evaluate(() => document.querySelector('[role="button"][aria-disabled="true"]')?.click())
      assert.equal(await page.evaluate(() => window.calls.filter(call => call.action === 'save').length), 1)
      await page.evaluate(() => window.resolvePending())
      await page.getByText('Reminder settings saved.', { exact: true }).waitFor()
      assert.equal(await page.evaluate(() => window.calls.find(call => call.action === 'save').squadHoursBefore), 24)
      assert.equal(await page.evaluate(() => window.calls.find(call => call.action === 'save').squadEnabled), true)
      assert.equal(await page.getByRole('textbox', { name: 'Coach email address', exact: true }).count(), 0)
      await page.getByRole('button', { name: 'Back to Settings', exact: true }).click()
      await page.getByRole('button', { name: 'Add a coach', exact: true }).click()
      await page.getByRole('textbox', { name: 'Coach email address', exact: true }).waitFor()
      assert.equal(await page.getByRole('radio', { name: 'Coach', exact: true }).getAttribute('aria-checked'), 'true')
    } else {
      await page.getByRole('button', { name: 'Remove Synthetic coach', exact: true }).click()
      await page.getByRole('button', { name: 'Cancel removal', exact: true }).click()
      assert.equal(await page.getByRole('button', { name: 'Remove coach access', exact: true }).count(), 0)
      await page.getByRole('button', { name: 'Remove Synthetic coach', exact: true }).click()
      await page.getByRole('button', { name: 'Remove coach access', exact: true }).click()
      await page.getByText('Removing coach access...', { exact: true }).waitFor({ timeout: 1000 })
      await page.evaluate(() => [...document.querySelectorAll('[role="button"]')].find(e=>e.textContent==='Remove coach access')?.click())
      assert.equal(await page.evaluate(() => window.calls.filter(c=>c.action==='remove').length),1)
      await page.evaluate(() => window.resolvePending())
      await page.getByText('Coach access removed from this team.', { exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Remove Synthetic coach', exact: true }).count(), 0)
      await page.getByText('No coaches have joined this team yet.', { exact: true }).waitFor()
      await page.getByRole('textbox', { name: 'Coach email address', exact: true }).fill('synthetic@example.com')
      await page.getByRole('radio', { name: 'Assistant coach', exact: true }).click()
      assert.equal(await page.getByRole('radio', { name: 'Assistant coach', exact: true }).getAttribute('aria-checked'), 'true')
      const start = performance.now()
      await page.getByRole('button', { name: 'Send coach invitation', exact: true }).click()
      await page.getByText('Saving coach invitation...', { exact: true }).waitFor({ timeout: 1000 })
      maximumFeedbackMs = Math.max(maximumFeedbackMs, performance.now() - start)
      await page.evaluate(() => window.resolvePending())
      await page.getByText('Coach invitation sent.', { exact: true }).waitFor()
      assert.equal(await page.evaluate(() => window.calls.find(call => call.action === 'invite').role), 'assistant_coach')
      assert.equal(await page.getByRole('textbox', { name: 'Hours before kick-off', exact: true }).count(), 0)
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${route} no overflow at ${width}`)
    await assertRenderedTextContrast(page, `Team administration ${route} ${mode} ${width}`)
    await page.screenshot({ path: `${out}/${route}-${mode}-${width}.png`, fullPage: true })
    await page.evaluate(() => { window.policy.canManage=false;window.updateFixture({route:window.fixture.route==='settings'?'team':'settings',staffRole:'coach'}) })
    if (route === 'team') {
      await page.getByRole('button', { name: 'Team reminders', exact: true }).click()
      await page.getByText('Only the team admin can change reminders.', { exact: true }).waitFor()
      assert.equal(await page.getByRole('switch', { name: 'Squad selection reminder', exact: true }).isDisabled(), true)
      assert.equal(await page.getByRole('button', { name: 'Save reminders', exact: true }).count(), 0)
      await page.getByRole('button', { name: 'Back to Settings', exact: true }).click()
      assert.equal(await page.getByRole('button', { name: 'Add a coach', exact: true }).count(), 0)
      await page.getByRole('button', { name: 'Team reminders', exact: true }).click()
    } else {
      await page.getByText('Team', { exact: true }).first().waitFor()
      assert.equal(await page.getByRole('textbox', { name: 'Coach email address', exact: true }).count(), 0)
    }
    // Revoke the selected team role without changing route or team: the old admin policy must clear.
    if (route === 'team') {
      await page.evaluate(() => { window.policy.canManage=true;window.updateFixture({staffRole:'head_manager'}) })
      await page.getByRole('button', { name: 'Save reminders', exact: true }).waitFor()
      await page.getByRole('textbox', { name: 'Hours before kick-off', exact: true }).fill('13')
      await page.evaluate(() => { window.policy.canManage=false;window.updateFixture({staffRole:'coach'}) })
      await page.getByText('Only the team admin can change reminders.', { exact: true }).waitFor()
      assert.equal(await page.getByRole('textbox', { name: 'Hours before kick-off', exact: true }).inputValue(), '48')
      assert.equal(await page.getByRole('button', { name: 'Save reminders', exact: true }).count(), 0)
    }
    if (route === 'team') {
      for (const change of ['revocation', 'team', 'server-denial']) {
        await page.evaluate(() => {
          window.rejectRemoval=false;window.policy.canManage=true;window.policy.teamId='10000000-0000-4000-8000-000000000020';
          window.policy.coaches=[{id:'10000000-0000-4000-8000-000000000031',name:'Delayed coach',role:'coach',roleLabel:'Coach',canRemove:true}];
          window.updateFixture({route:'team',staffRole:'head_manager',teamId:'10000000-0000-4000-8000-000000000020'})
        })
        await page.getByRole('button', { name: 'Remove Delayed coach', exact: true }).click()
        await page.getByRole('button', { name: 'Remove coach access', exact: true }).click()
        await page.getByText('Removing coach access...', { exact: true }).waitFor()
        await page.evaluate(kind => {
          if(kind==='server-denial'){window.policy.canManage=false;window.rejectRemoval=true}
          else if(kind==='revocation'){window.policy.canManage=false;window.updateFixture({staffRole:'coach'})}
          else{window.policy.teamId='10000000-0000-4000-8000-000000000021';window.policy.coaches=[{id:'10000000-0000-4000-8000-000000000041',name:'Next team coach',role:'coach',roleLabel:'Coach',canRemove:true}];window.updateFixture({teamId:window.policy.teamId})}
        },change)
        if(change!=='server-denial')await page.getByText(change==='revocation'?'Only the team admin can add coaches.':'Next team coach',{exact:true}).waitFor()
        await page.evaluate(async()=>{window.resolvePending();await Promise.resolve();await Promise.resolve()})
        assert.equal(await page.getByText('Coach access removed from this team.',{exact:true}).count(),0,'Old removal completion does not overwrite current context')
        if(change==='server-denial') await page.getByText('Only the team admin can add coaches.',{exact:true}).waitFor()
        if(change!=='team') assert.equal(await page.getByRole('button',{name:'Remove Delayed coach',exact:true}).count(),0)
        else assert.equal(await page.getByRole('button',{name:'Remove Next team coach',exact:true}).count(),1)
      }
    }
    checks += route === 'team' ? 22 : 12; await page.close()
  }
  assert.deepEqual(errors, []); assert.ok(maximumFeedbackMs < 1000)
  console.log(JSON.stringify({ checks, maximumFeedbackMs: Math.ceil(maximumFeedbackMs), errors, evidence: out, nativeHandsetReceipt: 'Unknown' }))
} finally { await browser.close() }
