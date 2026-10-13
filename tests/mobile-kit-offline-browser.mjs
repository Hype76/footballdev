import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root=process.cwd(),origin='https://project.supabase.co',output='output/playwright/mobile-kit-offline'
const remote=version=>`${origin}/storage/v1/object/public/club-kits/club/home/${version}.png`
const hashes=Object.fromEntries(['first','second'].map(version=>[remote(version),createHash('sha256').update(remote(version)).digest('hex')]))
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')
const entry=`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{View,Text}from'react-native';import{ClubKitDisplay}from'./apps/mobile-core/src/ClubKitDisplay.js';
window.downloads=[];window.version='first';window.offline=localStorage.getItem('offline')==='true';
const readFiles=()=>JSON.parse(localStorage.getItem('phone.files')||'{}'),writeFiles=files=>localStorage.setItem('phone.files',JSON.stringify(files));
window.fileSystem={documentDirectory:'http://kit.test/phone/',getInfoAsync:async uri=>readFiles()[uri]||{exists:false},makeDirectoryAsync:async()=>{},downloadAsync:async(uri,target)=>{window.downloads.push(uri);if(window.offline)throw new Error('No signal');const files=readFiles();files[target]={exists:true,isDirectory:false,size:70};writeFiles(files);return{status:200,headers:{'content-type':'image/png'}}},moveAsync:async({from,to})=>{const files=readFiles();files[to]=files[from];delete files[from];writeFiles(files)},deleteAsync:async uri=>{const files=readFiles();delete files[uri];writeFiles(files)}};
window.digest=async uri=>(${JSON.stringify(hashes)})[uri];
function App(){const[revision,setRevision]=useState(0),[club,setClub]=useState('club');window.refresh=()=>setRevision(v=>v+1);window.club=setClub;return<View><ClubKitDisplay key={revision} clubId={club} shirtChoice="home" textStyle={{color:'#142622'}}/><Text testID="following-row">Next match</Text></View>};createRoot(document.getElementById('root')).render(<App/>);`
const originalAdapter=await readFile('apps/mobile-core/src/mobileKitImageStorage.js','utf8')
const adapter=originalAdapter.replace("import { requireOptionalNativeModule } from 'expo'","const requireOptionalNativeModule=()=>new Proxy({},{get:(_,key)=>window.fileSystem?.[key]})").replace("import * as Crypto from 'expo-crypto'","const Crypto={CryptoDigestAlgorithm:{SHA256:'SHA-256'},digestStringAsync:(_,uri)=>window.digest(uri)}")
const mock=`export const supabase={
from:()=>({select:()=>({eq:async()=>{if(window.offline)throw new Error('No signal');return{data:[{kit_type:'home',colour:'#123456',image_path:'club/home/'+window.version+'.png'}]}}})}),
storage:{from:()=>({getPublicUrl:path=>({data:{publicUrl:'${origin}/storage/v1/object/public/club-kits/'+path}})})}};`
await mkdir(output,{recursive:true})
const browser=await chromium.launch({headless:true})
try {
  for(const role of ['coach','parent']) {
    const modules=path.join(root,`apps/${role}-mobile/node_modules`)
    const result=await build({stdin:{contents:entry,resolveDir:root,loader:'jsx'},bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx','.png':'dataurl','.ttf':'dataurl'},platform:'browser',conditions:['browser'],mainFields:['browser','module','main'],nodePaths:[modules],resolveExtensions:['.web.tsx','.web.ts','.web.js','.tsx','.ts','.jsx','.js','.json'],alias:{react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom'),'react-native':path.join(modules,'react-native-web')},define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'},plugins:[{name:'phone-services',setup(b){b.onLoad({filter:/mobileKitImageStorage\.js$/},()=>({contents:adapter,loader:'js'}));b.onLoad({filter:/[\\/]config\.js$/},args=>args.path.includes('mobile-core')?{contents:`export const getMobileRuntimeConfig=()=>({supabaseUrl:'${origin}'})`,loader:'js'}:null);b.onLoad({filter:/[\\/]supabase\.js$/},()=>({contents:mock,loader:'js'}))}}],banner:{js:'globalThis.process={env:{NODE_ENV:"production"}};'}})
    const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],external=[]
    page.on('pageerror',error=>errors.push(error.message))
    await page.route('**/*',async route=>{
      const url=route.request().url()
      if(url==='http://kit.test/')return route.fulfill({contentType:'text/html',body:'<body style="margin:0"><div id="root"></div></body>'})
      if(url.startsWith('http://kit.test/phone/')) {
        const exists=await page.evaluate(uri=>Boolean(JSON.parse(localStorage.getItem('phone.files')||'{}')[uri]),url)
        return exists?route.fulfill({contentType:'image/png',body:png}):route.abort()
      }
      external.push(url);return route.abort()
    })
    await page.goto('http://kit.test/');await page.addScriptTag({content:result.outputFiles[0].text})
    const enlarge=page.getByRole('button',{name:'Enlarge home kit image',exact:true})
    await enlarge.waitFor();await page.waitForFunction(()=>window.downloads.length===1)
    await page.waitForFunction(()=>Object.keys(localStorage).some(key=>key.startsWith('fp.kits.v1:')))
    const first=await page.locator('img').last().getAttribute('src'),following=await page.getByTestId('following-row').boundingBox()
    assert.match(first,/^http:\/\/kit\.test\/phone\/fp-kit-art-v1\/[a-f0-9]{64}\.image$/)
    await page.evaluate(()=>{localStorage.setItem('offline','true');for(const key of Object.keys(localStorage)){if(key.startsWith('fp.kits.v1:')){const value=JSON.parse(localStorage.getItem(key));value.checkedAt=Date.now()-9*86400000;localStorage.setItem(key,JSON.stringify(value))}}})
    await page.reload();await page.addScriptTag({content:result.outputFiles[0].text});await enlarge.waitFor()
    assert.equal(await page.locator('img').last().getAttribute('src'),first,'Cold restart without signal uses the saved file even after a week')
    assert.deepEqual(await page.evaluate(()=>window.downloads),[],'Saved artwork does not download again')
    assert.equal((await page.getByTestId('following-row').boundingBox()).y,following.y,'Restored artwork keeps its row size')
    await enlarge.click();const preview=page.getByLabel('Home kit enlarged',{exact:true});await preview.waitFor()
    assert.equal(await preview.locator('img').getAttribute('src').catch(()=>preview.getAttribute('src')),first,'Enlarged offline artwork uses the same saved file')
    await page.screenshot({path:`${output}/${role}-offline.png`})
    await page.getByRole('button',{name:'Close kit image',exact:true}).click()
    await page.evaluate(()=>{window.offline=false;window.version='second';for(const key of Object.keys(localStorage))if(key.startsWith('fp.kits.v1:'))localStorage.removeItem(key);window.club('new-club')})
    await enlarge.waitFor();await page.waitForFunction(()=>window.downloads.length===1)
    assert.notEqual(await page.locator('img').last().getAttribute('src'),first,'Updated artwork uses its own file rather than the old image')
    await enlarge.click();await preview.waitFor();await page.evaluate(()=>window.club('third-club'))
    await page.getByRole('button',{name:'Close kit image',exact:true}).waitFor({state:'hidden'})
    assert.deepEqual(errors,[]);assert.deepEqual(external,[])
    await page.close();console.log('PASS '+role+' saved thumbnail, offline cold restart, enlarged image, stale metadata and artwork/context replacement')
  }
} finally { await browser.close() }
