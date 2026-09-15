import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'
const root=process.cwd(),modules=path.join(root,'apps/parent-mobile/node_modules')
const app=await readFile('apps/parent-mobile/App.js','utf8')
const paletteFunction=app.slice(app.indexOf('function createParentAppPalette('),app.indexOf('function createParentAppStyles('))
const entry=`
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{ParentPlayerAccessControls}from'./apps/parent-mobile/src/ParentPlayerAccessControls.js';
import{createParentMobileTheme}from'./apps/mobile-core/src/parentThemeCore.js';
${paletteFunction}
const links=[{id:'first',playerId:'one',playerName:'FP TEST First Player',clubName:'First club',teamName:'U14',linkType:'parent'},{id:'second',playerId:'two',playerName:'FP TEST Second Player',clubName:'Second club',teamName:'U15',linkType:'family'},{id:'fan',playerId:'fan',playerName:'Fan access player',linkType:'fan'},{id:'self',playerId:'self',playerName:'Own Player account',linkType:'player'}];
window.calls=[];
function App(){const[items,setItems]=useState(links),[mode,setMode]=useState('light'),[disabled,setDisabled]=useState(false);window.mode=setMode;window.disabled=setDisabled;
const palette=createParentAppPalette(createParentMobileTheme({mode}).tokens);
return <main style={{minHeight:'100vh',background:palette.background,padding:16}}><ParentPlayerAccessControls links={items} disabled={disabled} palette={palette} onRemove={async link=>{window.calls.push(link.id);if(window.fail){window.fail=false;throw Error('Access could not be removed. Try again.')}if(window.hold)await new Promise(resolve=>window.finish=resolve);setItems(current=>current.filter(item=>item.playerId!==link.playerId));}}/></main>}
createRoot(document.getElementById('root')).render(<App/>);`
const result=await build({stdin:{contents:entry,resolveDir:root,loader:'jsx'},bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx'},platform:'browser',conditions:['browser'],mainFields:['browser','module','main'],nodePaths:[modules],resolveExtensions:['.web.tsx','.web.ts','.web.js','.tsx','.ts','.jsx','.js','.json'],alias:{react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom'),'react-native':path.join(modules,'react-native-web')},define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'},banner:{js:'globalThis.process={env:{NODE_ENV:"production"}};'}})
const browser=await chromium.launch({headless:true})
await mkdir('output/playwright/parent-access-removal',{recursive:true})
try{
const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[]
page.on('pageerror',e=>errors.push(e.message))
await page.setContent('<body style="margin:0"><div id="root"></div></body>');await page.addScriptTag({content:result.outputFiles[0].text})
const first=()=>page.getByRole('button',{name:'Remove my access to FP TEST First Player',exact:true})
await first().waitFor();assert.equal(await page.getByRole('button',{name:/Remove my access to/}).count(),2)
await first().click();await page.getByText('Remove your access to FP TEST First Player?',{exact:true}).waitFor()
await page.getByText('Your contact details will remain with the club. The club may still send you direct emails.',{exact:true}).waitFor()
await page.getByRole('button',{name:'Keep my access',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.calls),[])
await page.evaluate(()=>window.disabled(true));await page.getByRole('button',{name:'Remove my access to FP TEST First Player',exact:true,disabled:true}).waitFor();assert.equal(await first().getAttribute('aria-disabled'),'true')
await page.evaluate(()=>window.disabled(false));await page.getByRole('button',{name:'Remove my access to FP TEST First Player',exact:true,disabled:false}).waitFor();await first().click();await page.getByRole('button',{name:'Remove my access',exact:true}).waitFor()
// Wait for React Native Web's Modal enter transition before visual evidence.
await page.waitForTimeout(400)
for(const mode of ['light','dark'])for(const width of [320,390]){
await page.evaluate(mode=>window.mode(mode),mode);await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'output/playwright/parent-access-removal/'+mode+'-'+width+'.png',animations:'disabled'})
}
await page.evaluate(()=>window.fail=true);await page.getByRole('button',{name:'Remove my access',exact:true}).click()
await page.getByText('Access could not be removed. Try again.',{exact:true}).waitFor();assert.equal(await first().count(),1)
await page.evaluate(()=>window.hold=true);await page.getByRole('button',{name:'Remove my access',exact:true}).click()
await page.getByRole('button',{name:'Removing access...',exact:true,disabled:true}).waitFor();await page.getByRole('button',{name:'Keep my access',exact:true,disabled:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Keep my access',exact:true}).getAttribute('aria-disabled'),'true')
assert.deepEqual(await page.evaluate(()=>window.calls),['first','first']);await page.evaluate(()=>window.finish())
await first().waitFor({state:'hidden'});await page.getByRole('button',{name:'Remove my access to FP TEST Second Player',exact:true}).waitFor()
await page.getByText('Fan access player',{exact:true}).waitFor();await page.getByText('Own Player account',{exact:true}).waitFor()
assert.deepEqual(errors,[]);console.log('PASS: Parent removal confirmation names exact player, preserves contact copy, cancel never mutates, errors remain visible, double submit is blocked, Fan/player actions hidden, other access retained, light/dark 320/390px fit.')
}finally{await browser.close()}
