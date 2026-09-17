import assert from 'node:assert/strict'
import { readFile, readdir, mkdir } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const source = (await readFile('src/pages/ResourceLibraryPage.jsx','utf8')).replace(/^import[\s\S]*?from ['"][^'"]+['"]\r?\n/gm,'').replace('export function ResourceLibraryPage','function ResourceLibraryPage')
const entry = `
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ResourceEditor} from './src/components/resources/ResourceEditor.jsx';
import {getResourceDisplayTitle,sortResourcesNewestFirst} from './src/lib/resource-date-presentation.js';
import {formatUkDateTime} from './src/lib/date-format.js';
import {canManageResourceLibrary,canUseResourceLibrary} from './src/lib/auth-permissions.js';
const user={id:'manager',clubId:'club',activeTeamId:'team',activeTeamName:'FP TEST U14',role:'manager',roleRank:50,planKey:'small_club',planStatus:'active'};
const useAuth=()=>({user}),useToast=()=>({showToast:()=>{}}),canCreateFormationBoard=()=>false,canUseFormationBoards=()=>false;
const Link=({children})=><span>{children}</span>,Navigate=()=>null;
const NoticeBanner=({title,message})=><div role="status">{title} {message}</div>,PageHeader=({title})=><h1>{title}</h1>;
const RESOURCE_LIBRARY_CATEGORIES=[{value:'general',label:'General'},{value:'training',label:'Training'},{value:'match_day',label:'Match day'}],RESOURCE_LIBRARY_SHARE_DESCRIPTION_MAX_LENGTH=500;
const resources=[{id:'link',clubId:'club',teamId:'team',title:'FP TEST Video',description:'Original description',category:'general',resourceType:'external_link',externalUrl:'https://example.test/old',updatedAt:'original',links:[{id:'shared',linkedType:'player',linkedId:'player',parentVisible:true}]},
{id:'file',clubId:'club',teamId:'team',title:'FP TEST Handbook',description:'',category:'general',resourceType:'file',originalFilename:'handbook.pdf',updatedAt:'original',links:[]}];
const getResourceLibraryItems=async()=>resources.slice(),getResourceLibraryPlayers=async()=>[{id:'player',playerName:'FP TEST Player'}],formatResourceLibraryFileSize=()=> '1 KB';
window.saves=[];window.setViewer=()=>{user.roleRank=30};
const updateResourceLibraryItem=async({resource,...draft})=>{
 window.saves.push({id:resource.id,stamp:resource.updatedAt,title:draft.title,file:draft.file?.name||null});
 if(window.hold)await new Promise(resolve=>window.release=resolve);
 if(window.fail){window.fail=false;throw new Error('Save failed. Please try again.')}
 const saved={...resource,...draft,updatedAt:'saved',originalFilename:draft.file?.name||resource.originalFilename};
 resources.splice(resources.findIndex(r=>r.id===resource.id),1,saved);return saved;
};
${source}
const root=createRoot(document.getElementById('root'));window.mount=()=>root.render(<ResourceLibraryPage key={Math.random()}/>);window.mount();
`
const bundle=await build({stdin:{contents:entry,loader:'jsx',resolveDir:process.cwd()},bundle:true,write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}})
const css=await Promise.all((await readdir('dist/assets')).filter(name=>name.endsWith('.css')).map(name=>readFile('dist/assets/'+name,'utf8')))
await mkdir('output/playwright/resource-edit',{recursive:true})
const browser=await chromium.launch({headless:true})
try {
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[]
 page.on('pageerror',error=>errors.push(error.message))
 await page.setContent('<main id="root" style="max-width:1100px;margin:auto;padding:16px"></main>')
 for(const content of css)await page.addStyleTag({content})
 await page.addScriptTag({content:bundle.outputFiles[0].text})
 const video=()=>page.locator('article').filter({has:page.getByText('FP TEST Video',{exact:true})})
 await video().getByRole('button',{name:'Edit resource',exact:true}).click()
 let form=page.getByRole('form',{name:'Edit resource'})
 assert.equal(await form.getByLabel('Title',{exact:true}).inputValue(),'FP TEST Video')
 await form.getByLabel('Title',{exact:true}).fill('FP TEST Updated video')
 await form.getByLabel('Category',{exact:true}).selectOption('training')
 await form.getByLabel('Resource link').fill('https://example.test/updated')
 await form.getByLabel('Description',{exact:true}).fill('Updated notes')
 await page.evaluate(()=>{window.hold=true;window.fail=true})
 await form.getByRole('button',{name:'Save changes'}).click()
 await form.getByRole('button',{name:'Saving resource...'}).waitFor()
 assert.equal(await form.getByRole('button',{name:'Cancel'}).isDisabled(),true)
 await page.evaluate(()=>{window.hold=false;window.release()})
 await form.getByRole('alert').waitFor()
 assert.equal(await form.getByLabel('Title',{exact:true}).inputValue(),'FP TEST Updated video')
 await form.getByRole('button',{name:'Save changes'}).click()
 await form.waitFor({state:'hidden'})
 await page.evaluate(()=>window.mount())
 const updated=page.locator('article').filter({has:page.getByText('FP TEST Updated video',{exact:true})})
 await updated.getByRole('button',{name:'Edit resource',exact:true}).click()
 form=page.getByRole('form',{name:'Edit resource'})
 assert.equal(await form.getByLabel('Resource link').inputValue(),'https://example.test/updated')
 assert.equal(await form.getByLabel('Category',{exact:true}).inputValue(),'training')
 assert.equal(await updated.getByText(/1 assignment/).count(),1)
 for(const mode of ['light','dark'])for(const width of [390,1280]){
  await page.setViewportSize({width,height:900});await page.evaluate(mode=>document.body.className='theme-'+mode,mode)
  await form.scrollIntoViewIfNeeded()
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow')
  await page.screenshot({path:'output/playwright/resource-edit/'+mode+'-'+width+'.png'})
 }
 await form.getByRole('button',{name:'Cancel'}).click()
 const file=page.locator('article').filter({has:page.getByText('FP TEST Handbook',{exact:true})})
 await file.getByRole('button',{name:'Edit resource',exact:true}).click()
 await form.getByLabel('Replace file (optional)',{exact:false}).setInputFiles({name:'replacement.pdf',mimeType:'application/pdf',buffer:Buffer.from('FP TEST')})
 await form.getByRole('button',{name:'Save changes'}).click()
 await form.waitFor({state:'hidden'})
 assert.equal(await file.getByText('replacement.pdf',{exact:true}).count(),1)
 assert.equal(await page.evaluate(()=>window.saves.at(-1).file),'replacement.pdf')
 await page.evaluate(()=>{window.setViewer();window.mount()})
 await page.getByText('2 active',{exact:true}).waitFor()
 assert.equal(await page.getByRole('button',{name:'Edit resource',exact:true}).count(),0)
 assert.deepEqual(errors,[])
 console.log('PASS: actual resource page edit/save/reopen, preserved assignments, failure/retry, pending state, file replacement, viewer restrictions, light/dark at 390/1280px.')
} finally { await browser.close() }
