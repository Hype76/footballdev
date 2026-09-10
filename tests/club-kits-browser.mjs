import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { build as buildCss } from 'vite'
import tailwindcss from '@tailwindcss/vite'
const root=process.cwd(), modules=path.join(root,'apps/coach-mobile/node_modules'), out='output/playwright/club-kits'
await mkdir(out,{recursive:true})
const mock=`export const supabase = {
 from: () => ({
   select: () => ({ eq: async () => ({data:Object.entries(window.kits).map(([kit_type,kit])=>({kit_type,...kit}))}) }),
   upsert: row => ({select:()=>({single:async()=>{window.saved.push(row);if(window.failSave)return{error:new Error('Save failed')};window.kits[row.kit_type]=row;return{data:row}}})})
 }),
 storage: { from: () => ({
   upload: async (key,blob) => {window.uploaded.push(key);window.images[key]=await new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result);f.readAsDataURL(blob)});return{}},
   remove: async keys => {window.removed.push(...keys);return{}},
   getPublicUrl: key => ({data:{publicUrl:window.images[key]||''}})
 }) }
};`
const entry=`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{ClubKitsSection}from'./src/components/club-settings/ClubKitsSection.jsx';import{ClubKitDisplay}from'./apps/mobile-core/src/ClubKitDisplay.js';import{CoachNotificationHistoryScreen}from'./apps/coach-mobile/src/CoachNotificationHistoryScreen.js';
crypto.randomUUID ||= () => 'test-' + Math.random().toString(36).slice(2);window.kits={home:{colour:'#123456',image_path:null},away:{colour:'#991144',image_path:null}};window.images={};window.uploaded=[];window.removed=[];window.saved=[];
const admin={id:'test',email:'kit@fp.test',clubId:'club',role:'admin',roleRank:90,planKey:'small_club',planStatus:'active',isPlanComped:true};
function App(){const[role,setRole]=useState('admin'),[screen,setScreen]=useState('editor'),[mode,setMode]=useState('light');window.role=setRole;window.screen=setScreen;window.mode=setMode;const colors=mode==='dark'?{background:'#071109',text:'#f0f4ef',border:'#65786c',accentText:'#cbeed5'}:{background:'#f5f7f6',text:'#142622',border:'#65786c',accentText:'#075e54'};return <main style={{padding:16,background:colors.background,color:colors.text,minHeight:'100vh'}}>{screen==='editor'?<ClubKitsSection user={{...admin,role}}/>:screen==='native'?<><ClubKitDisplay clubId="club" shirtChoice="home" textStyle={{color:colors.text}}/><ClubKitDisplay clubId="club" shirtChoice="away" textStyle={{color:colors.text}}/></>:<CoachNotificationHistoryScreen user={admin} palette={colors} styles={{stack:{gap:12},bodyText:{color:colors.text},screenTitle:{fontSize:24,color:colors.text},cardTitle:{fontWeight:'bold',color:colors.text},helperText:{color:colors.text}}} homeState={{}} onOpenNotification={data=>window.opened=data}/>}</main>};createRoot(document.getElementById('root')).render(<App/>);`
const result=await build({stdin:{contents:entry,resolveDir:root,loader:'jsx'},bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx','.ttf':'dataurl','.png':'dataurl'},platform:'browser',conditions:['browser'],mainFields:['browser','module','main'],nodePaths:[modules],resolveExtensions:['.web.tsx','.web.ts','.web.js','.tsx','.ts','.jsx','.js','.json'],alias:{react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom'),'react-native':path.join(modules,'react-native-web')},define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'},plugins:[{name:'test-services',setup(b){b.onLoad({filter:/kit-background-removal\.js$/},()=>({contents:`export function removeKitBackground(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});window.completeBackground=()=>{const c=document.createElement('canvas');c.width=64;c.height=96;const x=c.getContext('2d');x.fillStyle='#ef2020';x.fillRect(32,0,32,96);c.toBlob(resolve,'image/png')};window.failBackground=()=>reject(new Error('Background removal failed'));return{promise,cancel:()=>reject(new DOMException('Cancelled','AbortError'))}}`,loader:'js'}));b.onLoad({filter:/[\\/]supabase(?:-client)?\.js$/},()=>({contents:mock,loader:'js'}));b.onLoad({filter:/coachNotificationHistory\.js$/},()=>({contents:`export async function getCoachNotificationHistory(){return[{id:1,title:'FP TEST Player · Attending',body:'JPL Training',created_at:'2026-09-10T10:15:00Z',data:{app:'coach',route:'calendar',targetId:'exact-event',teamId:'team'}}]}`,loader:'js'}));}}],banner:{js:'globalThis.process={env:{NODE_ENV:"production"}};'}})
const cssBuild=await buildCss({configFile:false,logLevel:'silent',plugins:[tailwindcss()],build:{write:false,rollupOptions:{input:path.resolve('src/index.css')}}});const css=cssBuild.output.find(asset=>asset.fileName.endsWith('.css')).source
const browser=await chromium.launch({headless:true});let debugPage
try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
 debugPage=page;page.setDefaultTimeout(8000);
 await page.setContent('<body style="margin:0;font-family:Arial"><div id="root"></div>');await page.addStyleTag({content:css});await page.addScriptTag({content:result.outputFiles[0].text})
 await page.getByRole('button',{name:'Choose Home kit colour'}).click()
 await page.getByRole('textbox',{name:'Home kit colour code'}).fill('#abcdef')
 await page.getByRole('button',{name:'Save Home kit',exact:true}).click();await page.getByText('Home kit saved.',{exact:true}).waitFor()
 assert.equal(await page.evaluate(()=>window.kits.home.colour),'#abcdef')
 await page.getByRole('button',{name:'Choose Home kit colour'}).click()
 await page.evaluate(()=>{window.EyeDropper=class{async open(){return{sRGBHex:'#246810'}}}})
 await page.getByRole('button',{name:'Choose Home kit colour'}).click();await page.getByRole('button',{name:'Choose Home kit colour'}).click()
 await page.getByRole('button',{name:'Pick from screen'}).click();assert.equal(await page.getByRole('textbox',{name:'Home kit colour code'}).inputValue(),'#246810')
 const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=64;c.height=96;const x=c.getContext('2d');x.fillStyle='#ef2020';x.fillRect(0,0,64,96);return c.toDataURL().split(',')[1]})
 const home=page.getByLabel('Home kit editor',{exact:true})
 await home.locator('input[type=file]').last().setInputFiles({name:'kit.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')})
 await page.getByLabel('Home kit image preview').waitFor();assert.equal(await page.getByRole('textbox',{name:'Home kit colour code'}).count(),0)
 await page.getByRole('slider',{name:'Home kit Zoom',exact:true}).fill('1.5')
 await page.waitForTimeout(50)
 const originalPreview=await page.getByLabel('Home kit image preview').evaluate(c=>c.toDataURL())
 await home.getByRole('button',{name:'Remove background',exact:true}).click();assert.equal(await home.getByRole('button',{name:'Save Home kit',exact:true}).isDisabled(),true)
 await home.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.getByLabel('Home kit image preview').evaluate(c=>c.toDataURL()),originalPreview)
 await home.getByRole('button',{name:'Remove background',exact:true}).click();await page.evaluate(()=>window.completeBackground());await home.getByRole('button',{name:'Apply',exact:true}).waitFor()
 assert.equal(await page.getByLabel('Home kit image preview').evaluate(c=>c.toDataURL()),originalPreview);assert.equal(await page.evaluate(()=>window.uploaded.length),0)
 await page.screenshot({path:out+'/background-preview.png',fullPage:true});await home.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(await page.getByLabel('Home kit image preview').evaluate(c=>c.toDataURL()),originalPreview)
 await home.getByRole('button',{name:'Remove background',exact:true}).click();await page.evaluate(()=>window.completeBackground());await home.getByRole('button',{name:'Apply',exact:true}).click();await page.waitForFunction(before=>document.querySelector('canvas[aria-label="Home kit image preview"]').toDataURL()!==before,originalPreview)
 await home.getByRole('button',{name:'Restore original',exact:true}).click();await page.waitForFunction(before=>document.querySelector('canvas[aria-label="Home kit image preview"]').toDataURL()===before,originalPreview)
 await home.getByRole('button',{name:'Remove background',exact:true}).click();await page.evaluate(()=>window.failBackground());await home.getByRole('alert').getByText('Background removal failed',{exact:true}).waitFor();assert.equal(await page.getByLabel('Home kit image preview').evaluate(c=>c.toDataURL()),originalPreview)
 await home.getByRole('button',{name:'Remove background',exact:true}).click();await page.evaluate(()=>window.completeBackground());await home.getByRole('button',{name:'Apply',exact:true}).click()

 await page.getByRole('button',{name:'Save Home kit',exact:true}).click();await page.getByText('Home kit saved.',{exact:true}).waitFor()
 assert.equal(await page.evaluate(async()=>{const i=new Image();i.src=window.images[window.saved.at(-1).image_path];await i.decode();const c=document.createElement('canvas');c.width=c.height=512;c.getContext('2d').drawImage(i,0,0);return c.getContext('2d').getImageData(50,250,1,1).data[3]}),0,'Saved PNG preserves transparent background')
 assert.equal(await page.evaluate(()=>window.saved.at(-1).colour),'#246810');assert.ok(await page.evaluate(()=>window.saved.at(-1).image_path.startsWith('club/home/')))
 await page.evaluate(()=>window.screen('native'));await page.getByText('Home kit',{exact:true}).waitFor();assert.ok(await page.locator('img').count()>0)
 for(const mode of ['light','dark']){await page.evaluate(v=>window.mode(v),mode);await page.screenshot({path:out+'/native-'+mode+'.png',fullPage:true})}
 await page.evaluate(()=>window.screen('editor'));await page.getByRole('button',{name:'Remove image',exact:true}).click();await page.getByRole('button',{name:'Save Home kit',exact:true}).click();await page.getByText('Home kit saved.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.kits.home.image_path),null);assert.equal(await page.evaluate(()=>window.removed.length),1)
 const data=await page.evaluateHandle(base64=>{const dt=new DataTransfer();dt.items.add(new File([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],'away.png',{type:'image/png'}));return dt},image)
 await page.getByLabel('Away kit editor',{exact:true}).locator('div').filter({hasText:'Or drag and drop'}).last().dispatchEvent('drop',{dataTransfer:data})
 await page.getByLabel('Away kit image preview').waitFor();await page.evaluate(()=>window.failSave=true);await page.getByRole('button',{name:'Save Away kit',exact:true}).click();await page.getByRole('alert').getByText('Save failed').waitFor();assert.equal(await page.evaluate(()=>window.kits.away.image_path),null)
 await page.evaluate(()=>window.failSave=false);await page.getByRole('button',{name:'Save Away kit',exact:true}).click();await page.getByText('Away kit saved.',{exact:true}).waitFor()
 for(const width of [320,900]){await page.setViewportSize({width,height:1000});await page.getByRole('heading',{name:'Kits',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:out+'/editor-'+width+'.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))}
 await page.evaluate(()=>window.role('coach'));assert.equal(await page.getByRole('heading',{name:'Kits',exact:true}).count(),0)
 await page.evaluate(()=>window.screen('notifications'));await page.getByRole('button',{name:'Open notification: FP TEST Player · Attending'}).click();assert.equal(await page.evaluate(()=>window.opened.targetId),'exact-event');await page.getByText('10:09:2026 11:15',{exact:true}).waitFor()
 await page.screenshot({path:out+'/notifications.png',fullPage:true});assert.deepEqual(errors,[])
 console.log('PASS: Club kit colour, eyedropper capability, upload/crop, drag/drop, image precedence, failed-save cleanup, remove/restore, non-admin UI, native rendering and detailed notification routing.')
}catch(error){console.error(await debugPage?.locator('body').innerText());throw error}finally{await browser.close()}
