import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { parse } from '@babel/parser'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = process.cwd()
const modules = path.join(root, 'apps/parent-mobile/node_modules')
const baseline = process.argv.includes('--baseline')
async function extract(file, names) {
  const source = await readFile(file, 'utf8')
  const nodes = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body.map(node => node.declaration || node)
  return names.map(name => {
    const node = nodes.find(node => node.type === 'FunctionDeclaration' && node.id.name === name)
    assert.ok(node, `Missing actual function ${name}`)
    return source.slice(node.start, node.end)
  }).join('\n')
}
let portal = await extract('apps/parent-mobile/src/ParentPortalScreens.js', ['ChatScreen', 'colorsFor', 'usePortalStyles', 'Button', 'normalizeText', 'formatDate'])
if (baseline) portal = portal.replace('chatListContent: { flexGrow: 1, gap: 8, paddingVertical: 12 }', "chatListContent: { flexGrow: 1, gap: 8, justifyContent: 'flex-end', paddingVertical: 12 }")
const app = await extract('apps/parent-mobile/App.js', ['createParentAppPalette', 'createParentAppStyles'])
const shortBody = 'Monday training has moved pitches, we are now meeting beside the main entrance. Please bring both kits.'
const longBody = `${'Training details and travel arrangements. '.repeat(40)}FINAL FULL MESSAGE TEXT`
const entry = `
import React,{useState,useEffect,useMemo,useRef} from 'react';import{createRoot}from'react-dom/client';
import{View,Text,Pressable,StyleSheet,Platform,FlatList,TextInput,ScrollView,AppState,Switch}from'react-native';
import{createParentMobileTheme,DEFAULT_PARENT_MOBILE_THEME}from'./apps/mobile-core/src/parentThemeCore.js';
import{formatParentProductDateTime}from'./apps/mobile-core/src/parentDateTimeCore.js';
import{prepareParentChatRooms,prepareParentChatMessages,getParentChatRoomContext,getParentChatRoomTypeLabel}from'./apps/parent-mobile/src/parentPresentationCore.js';
const ParentIcon=()=>null,BrandLoader=()=>null,ResourceState=()=>null;
const useConfirmedConnectionMessage=value=>value;
${portal}\n${app}
const room={id:'team-room',type:'team',title:'U14 JPL 26/27 Team Chat',teamName:'U14 JPL 26/27',canPost:true};
const message={id:'one',roomId:room.id,senderName:'Synthetic Coach',createdAt:'2026-10-03T12:00:00Z',body:${JSON.stringify(shortBody)}};
window.calls=[];
function App(){const[mode,setMode]=useState('light'),[items,setItems]=useState([message]),[offline,setOffline]=useState(false),[canPost,setCanPost]=useState(true),[selected,setSelected]=useState(true);
window.mode=setMode;window.messages=setItems;window.offline=setOffline;window.canPost=setCanPost;window.selected=setSelected;
const theme=createParentMobileTheme({mode}),styles=createParentAppStyles(theme.tokens);
return <View style={[styles.safeArea,{height:'100vh',paddingBottom:34}]}><View style={styles.keyboardShell}><View style={[styles.contentColumn,styles.chatRouteContent]}>
<ChatScreen themeTokens={theme.tokens} link={{id:'link-one',playerName:'Synthetic Player'}} rooms={{items:[room]}} messages={{items,loading:false,error:''}} selectedRoom={selected?{...room,canPost}:null} isOffline={offline}
 onBack={()=>setSelected(false)} onOpenRoom={()=>setSelected(true)} onSend={async body=>window.calls.push(['send',body])} onDelete={item=>window.calls.push(['delete',item.id])} onToggleRoomNotifications={()=>{}}/>
</View></View></View>}
createRoot(document.getElementById('root')).render(<App/>);
`
const result = await build({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false,
  jsx: 'automatic', loader: { '.js': 'jsx' }, platform: 'browser', conditions: ['browser'], mainFields: ['browser', 'module', 'main'], nodePaths: [modules],
  alias: { react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom'), 'react-native': path.join(modules, 'react-native-web') },
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' },
})
const output = 'output/playwright/parent-chat-layout'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message) })
  await page.route('**/*', route => route.abort())
  await page.setContent('<main id="root"></main>')
  await page.addScriptTag({ content: result.outputFiles[0].text })
  await page.getByText(shortBody, { exact: true }).waitFor()
  let checks = 0
  for (const width of [320, 390]) for (const mode of ['light', 'dark']) for (const height of [844, 500]) {
    await page.setViewportSize({ width, height })
    await page.evaluate(mode => window.mode(mode), mode)
    const body = await page.getByText(shortBody, { exact: true }).boundingBox()
    const header = await page.getByText('U14 JPL 26/27 | Parents and Team Coaches', { exact: true }).boundingBox()
    const composer = await page.getByLabel('Parent Chat message', { exact: true }).boundingBox()
    await page.screenshot({ path: `${output}/${baseline ? 'baseline-' : ''}${mode}-${width}-${height}.png`, fullPage: true })
    assert.ok(body.y - (header.y + header.height) < 90, `Short conversation begins below header: ${mode} ${width}x${height}`)
    assert.ok(body.y + body.height <= composer.y, `Full short message above composer: ${mode} ${width}x${height}`)
    assert.ok(composer.y + composer.height <= height - 34, 'Composer above bottom safe area')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow')
    checks++
  }
  await page.evaluate(body => window.messages([{ id: 'long', roomId: 'team-room', senderName: 'Synthetic Coach', createdAt: '2026-10-03T12:00:00Z', body }]), longBody)
  const longMessage = page.getByText(longBody, { exact: true })
  await longMessage.waitFor()
  // Let the component's existing 30ms initial scroll and layout measurement finish
  // before testing a user's subsequent manual scroll through the full message.
  await page.waitForTimeout(100)
  assert.equal(await longMessage.textContent(), longBody, 'Message content retained in full')
  const list = await longMessage.evaluateHandle(element => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (getComputedStyle(parent).overflowY === 'auto' || getComputedStyle(parent).overflowY === 'scroll') return parent
    }
    throw new Error('Actual scrolling message list not found')
  })
  await list.evaluate(element => { element.scrollTop = element.scrollHeight })
  const lastLine = await longMessage.evaluate(element => {
    const range = document.createRange(); const text = element.firstChild
    range.setStart(text, text.textContent.length - 23); range.setEnd(text, text.textContent.length)
    const rect = range.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom }
  })
  const composer = await page.getByLabel('Parent Chat message').boundingBox()
  assert.ok(lastLine.bottom <= composer.y && lastLine.top >= 0, 'Final message text reachable above composer')
  await page.screenshot({ path: `${output}/long-message-tail.png`, fullPage: true })
  await list.evaluate(element => { element.scrollTop = 0 })
  assert.ok((await longMessage.boundingBox()).y >= 0, 'Beginning of long message reachable')
  await page.screenshot({ path: `${output}/long-message-head.png`, fullPage: true })
  await page.getByLabel('Parent Chat message').fill('Synthetic multiline\nmessage')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.calls), [['send', 'Synthetic multiline\nmessage']])
  assert.equal(await page.getByLabel('Parent Chat message').inputValue(), '')
  await page.evaluate(() => window.offline(true))
  // React commits the simulated connection change after evaluate returns.
  // Observe that commit before asserting the same disabled-input contract.
  await page.waitForFunction(() => {
    const composer = document.querySelector('[aria-label="Parent Chat message"]')
    return composer && (composer.readOnly || composer.disabled)
  }, null, { timeout: 2000 })
  assert.equal(await page.getByLabel('Parent Chat message').isEditable(), false)
  await page.evaluate(() => { window.offline(false); window.canPost(false) })
  await page.waitForFunction(() => !document.querySelector('[aria-label="Parent Chat message"]'))
  assert.equal(await page.getByText(longBody, { exact: true }).count(), 1, 'Read-only room retains full message')
  await page.getByRole('button', { name: 'Back to Chat rooms', exact: true }).click()
  await page.getByRole('button', { name: /U14 JPL/ }).click()
  await page.getByText(longBody, { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  assert.equal(baseline, false, 'Original bottom alignment must fail the short conversation assertion')
  console.log(`PASS ${checks} Parent Chat layout cases, short/full long text, viewport shrink, composer safe area, multiline send, offline/read-only and room navigation`)
} finally {
  await browser.close()
}
