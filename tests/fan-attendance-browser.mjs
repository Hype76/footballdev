import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { assertRenderedTextContrast } from './helpers/rendered-text-contrast.mjs'

const root = process.cwd()
const modules = path.join(root, 'apps/parent-mobile/node_modules')
const out = 'output/playwright/fan-attendance'
await mkdir(out, { recursive: true })
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';
import {FanAttendanceScreen} from './apps/parent-mobile/src/FanAttendanceScreen';
import {createParentMobileTheme} from './apps/mobile-core/src/parentThemeCore';
const items=Array.from({length:7},(_,i)=>({id:'event'+i,title:i===0?'St Neots v HISTON':'Training '+i,
date:'2026-09-'+(20+i),time:i===0?'':'20:00',event_type:i===0?'match_day':'training',home_away:'home',
location:'Club ground',response:i<3?'available':'awaiting'}));
items.push({id:'past',title:'Previous fixture',date:'2026-09-10',event_type:'match_day',home_away:'away',response:'unavailable'});
const root=createRoot(document.getElementById('root'));
window.render=(mode='light',empty=false)=>{const {tokens}=createParentMobileTheme({mode});document.body.style.background=tokens.background;
root.render(<div style={{padding:16}}><FanAttendanceScreen items={empty?[]:items} themeTokens={tokens} now={new Date('2026-09-17T12:00:00Z')}/></div>)};
window.render();`
const result = await build({ stdin: { contents: entry, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, jsx: 'automatic',
  loader: { '.js': 'jsx', '.ttf': 'dataurl', '.png': 'dataurl' }, platform: 'browser', conditions: ['browser'], mainFields: ['browser', 'module', 'main'],
  resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.jsx', '.js', '.json'], nodePaths: [modules],
  alias: { 'react-native': path.join(modules, 'react-native-web'), react: path.join(modules, 'react'), 'react-dom': path.join(modules, 'react-dom') },
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', global: 'globalThis' }, banner: { js: 'globalThis.process={env:{NODE_ENV:"production"}};' },
})
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.setContent('<html><head><style>body{margin:0;font-family:Arial}</style></head><body><div id="root"></div></body></html>')
  await page.addScriptTag({ content: result.outputFiles[0].text })
  for (const width of [320,390,430]) for (const mode of ['light','dark']) {
    await page.setViewportSize({width,height:1100})
    await page.evaluate(mode=>window.render(mode),mode)
    await page.getByRole('tab',{name:'Upcoming',exact:true}).click()
    await page.getByRole('heading',{name:'Next event'}).waitFor()
    assert.equal(await page.getByText('Training 4',{exact:true}).count(),0)
    await page.getByRole('button',{name:'View all upcoming events'}).click()
    await page.getByText('Training 6',{exact:true}).waitFor()
    await page.getByRole('button',{name:'Show fewer events'}).click()
    await page.getByRole('button',{name:'St Neots v HISTON, Available, show details'}).click()
    await page.getByText('Club ground',{exact:true}).waitFor()
    await page.getByRole('button',{name:'St Neots v HISTON, Available, hide details'}).click()
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    for(const box of await page.getByRole('button').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().height))) assert.ok(box>=44)
    await assertRenderedTextContrast(page,`Attendance ${width} ${mode}`)
    await page.screenshot({path:`${out}/${mode}-${width}.png`,fullPage:true})
    await page.getByRole('tab',{name:'Past',exact:true}).click()
    await page.getByText('Previous fixture',{exact:true}).waitFor()
    await page.getByText('Unavailable',{exact:true}).waitFor()
    assert.equal(await page.getByRole('heading',{name:'Next event'}).count(),0)
    assert.equal(await page.getByRole('button',{name:/Accept|Decline|Respond/}).count(),0)
  }
  await page.evaluate(()=>window.render('light',true))
  await page.getByText('No past attendance responses in the last 90 days.').waitFor()
  await page.getByRole('tab',{name:'Upcoming',exact:true}).click()
  await page.getByText('No upcoming attendance requests.').waitFor()
  console.log('PASS: actual native attendance tabs, expansion, dates, status, read-only access, compact responsive layout and light/dark contrast')
} finally { await browser.close() }
