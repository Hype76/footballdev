import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { parse } from '@babel/parser'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { assertRenderedTextContrast } from './helpers/rendered-text-contrast.mjs'

const root=process.cwd(),modules=path.join(root,'apps/coach-mobile/node_modules')
const source=await readFile('apps/coach-mobile/src/CoachPhase31EScreens.js','utf8')
const styleNode=parse(source,{sourceType:'module',plugins:['jsx']}).program.body.find(node=>node.type==='FunctionDeclaration'&&node.id?.name==='phaseStyles')
const styles=source.slice(styleNode.start,styleNode.end)
const entry=`import React,{useMemo,useState} from 'react';import {createRoot} from 'react-dom/client';
import {Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import {CoachDevelopmentTemplateBuilder} from './apps/coach-mobile/src/CoachDevelopmentTemplateBuilder.js';
import {createCoachTheme} from './apps/coach-mobile/src/coachThemeCore.js';
import {MobileActivityProvider} from './apps/mobile-core/src/MobileActivityContext.js';
import {MobileHeaderActivity} from './apps/mobile-core/src/MobileHeaderActivity.js';
${styles}
window.cache={};window.calls=[];window.used=[];window.confirmed=[];
window.templateFixture={async read(user,context){return {resources:window.cache[user+':'+context.id]||{}}},saver(user,context){return async resources=>{if(window.failPhoneCopy)throw new Error('Phone storage timed out');window.cache[user.id+':'+context.id]={...(window.cache[user.id+':'+context.id]||{}),...resources}}},async save(user,draft){window.calls.push(['save',user.id,draft]);if(window.holdSave)await new Promise(done=>window.finishSave=done);if(window.failServerSave)throw new Error('Network request failed');const saved={...draft,teamId:user.activeTeamId,createdBy:user.id,accessScope:'creator',updatedAt:'2026-10-13T15:00:00Z'};if(window.failAuditConfirmation){const error=new Error('Network request failed');error.savedTemplate={...saved,auditPending:true};throw error}return saved},async access(user,template,accessScope){window.calls.push(['access',user.id,accessScope]);return {...template,accessScope}}};
function App(){const[mode,setMode]=useState('light'),[open,setOpen]=useState(true),[account,setAccount]=useState('coach-a');window.mode=setMode;window.open=setOpen;window.account=setAccount;
const palette=createCoachTheme({mode}).tokens,styles=phaseStyles(palette);
const user={id:account,clubId:'club',activeTeamId:'team',role:'team_admin',roleRank:50,hasActivePlanAccess:true,planKey:'small_club',planStatus:'active',isPlanComped:true};const context={id:'team',clubId:'club',teamId:'team',authorityId:account,role:'team_admin'};
return <MobileActivityProvider><View style={{height:844,backgroundColor:palette.background}}><View style={{height:60,flexShrink:0,flexDirection:'row',justifyContent:'space-between',alignItems:'center',padding:12}}><Text style={styles.heading}>FP TEST</Text><MobileHeaderActivity styles={styles}/></View><ScrollView testID="template-scroll" style={{flex:1,minHeight:0}}>{open?<CoachDevelopmentTemplateBuilder key={account} context={context} styles={styles} stale={false} user={user} onBack={()=>setOpen(false)} onSaved={template=>window.confirmed.push([account,template])} onUse={template=>window.used.push([account,template])}/>:<Text style={styles.heading}>Development home</Text>}</ScrollView><Pressable accessibilityRole="button" accessibilityLabel="Home tab" onPress={()=>setOpen(false)} style={{height:60,flexShrink:0,justifyContent:'center',padding:12}}><Text style={styles.heading}>Home</Text></Pressable></View></MobileActivityProvider>}
createRoot(document.getElementById('root')).render(<App/>);`
const mocks={
  'coachPhase31EData.js':`export const saveCoachDevelopmentTemplate=(...args)=>window.templateFixture.save(...args);export const setCoachDevelopmentTemplateAccess=(...args)=>window.templateFixture.access(...args)`,
  'offline.js':`export const readCoachOfflineResources=(...args)=>window.templateFixture.read(...args);export const createCoachOfflineResourceSaver=(...args)=>window.templateFixture.saver(...args)`,
  'expo-crypto':`let id=0;export const randomUUID=()=> '10000000-0000-4000-8000-'+String(++id).padStart(12,'0')`,
}
const bundled=await build({stdin:{contents:entry,resolveDir:root,loader:'jsx'},bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx','.ttf':'dataurl','.png':'dataurl'},nodePaths:[modules],conditions:['browser'],mainFields:['browser','module','main'],resolveExtensions:['.web.tsx','.web.ts','.web.js','.tsx','.ts','.jsx','.js','.json'],alias:{react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom'),'react-native':path.join(modules,'react-native-web')},define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'},banner:{js:'globalThis.process={env:{NODE_ENV:"production"}};'},plugins:[{name:'authorised-template-fixtures',setup(builder){builder.onResolve({filter:/.*/},args=>{const key=Object.keys(mocks).find(key=>args.path===key||args.path.endsWith('/'+key));if(key&&(args.importer.endsWith('CoachDevelopmentTemplateBuilder.js')||key==='expo-crypto'))return {path:key,namespace:'fixture'}});builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'js'}))}}]})
const browser=await chromium.launch({headless:true}),out='output/playwright/coach-development-template'
await mkdir(out,{recursive:true})
try{
  for(const width of [320,390])for(const mode of ['light','dark']){
    const page=await browser.newPage({viewport:{width,height:844}}),errors=[]
    page.on('pageerror',error=>{errors.push(error.message);console.error(error.message)})
    await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}</style><div id="root"></div>')
    await page.addScriptTag({content:bundled.outputFiles[0].text});await page.evaluate(mode=>window.mode(mode),mode)
    await page.getByLabel('Template name',{exact:true}).fill('FP TEST Skills')
    await page.getByLabel('Field name',{exact:true}).fill('Technical')
    await page.getByRole('button',{name:'Save field',exact:true}).click()
    await page.getByRole('button',{name:'Add another field',exact:true}).waitFor()
    assert.equal(await page.evaluate(()=>Object.values(window.cache)[0].developmentTemplateDraft.draft.fields.length),1,'Save field persists before acknowledging')
    await page.getByRole('button',{name:'Add another field',exact:true}).click()
    await page.getByLabel('Field name',{exact:true}).fill('Readiness')
    await page.getByRole('radio',{name:'Yes / No',exact:true}).click()
    await page.getByRole('button',{name:'Save field',exact:true}).click()
    await page.getByRole('button',{name:'Save template',exact:true}).click()
    const sharing=page.getByRole('radio',{name:'Whole coaching team',exact:true})
    await sharing.waitFor()
    assert.equal(await page.getByRole('radio',{name:'Only me',exact:true}).getAttribute('aria-checked'),'true')
    assert.equal(await page.evaluate(()=>window.calls[0][2].fields.length),2)
    assert.equal(await page.evaluate(()=>window.calls[0][2].fields[0].metricKey.startsWith('custom.')),true)
    await sharing.click();await page.getByRole('button',{name:'Save access and use template',exact:true}).click()
    await page.waitForFunction(()=>window.used.length===1)
    assert.deepEqual(await page.evaluate(()=>window.calls[1]),['access','coach-a','team'])
    assert.equal(await page.evaluate(()=>window.used[0][1].accessScope),'team')
    await assertRenderedTextContrast(page)
    await page.screenshot({path:out+'/'+mode+'-'+width+'.png'})
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'The template builder fits the phone width')
    assert.equal(await page.evaluate(()=>window.confirmed[0][1].accessScope),'creator','Confirmed server creation is published to the available forms before choosing access')
    for(const failure of ['phone','audit','server']){
      await page.getByRole('button',{name:'Build another template',exact:true}).click()
      await page.getByLabel('Template name',{exact:true}).fill('FP TEST '+failure)
      await page.getByLabel('Field name',{exact:true}).fill('Passing')
      await page.getByRole('button',{name:'Save field',exact:true}).click()
      await page.evaluate(kind=>{window.failPhoneCopy=kind==='phone';window.failAuditConfirmation=kind==='audit';window.failServerSave=kind==='server'},failure)
      await page.getByRole('button',{name:'Save template',exact:true}).click()
      if(failure==='server'){
        await page.getByText('The template save could not be confirmed. Your fields are still on this phone. Retry saving when connected.',{exact:true}).waitFor()
        assert.equal(await page.getByRole('radio',{name:'Only me',exact:true}).count(),0,'An unconfirmed server save never claims success')
        await page.evaluate(()=>window.failServerSave=false)
        await page.getByRole('button',{name:'Save template',exact:true}).click()
      }else if(failure==='phone'){
        await page.getByText('Template saved. Its phone copy could not be updated. The saved template is available online.',{exact:true}).waitFor()
        assert.equal(await page.getByRole('radio',{name:'Only me',exact:true}).getAttribute('aria-checked'),'true')
        await page.evaluate(()=>window.failPhoneCopy=false)
      }else{
        await page.getByRole('button',{name:'Retry activity confirmation',exact:true}).waitFor()
        const before=await page.evaluate(()=>window.calls.at(-1)[2].id)
        await page.evaluate(()=>window.failAuditConfirmation=false)
        await page.getByRole('button',{name:'Retry activity confirmation',exact:true}).click()
        await page.getByRole('button',{name:'Retry activity confirmation',exact:true}).waitFor({state:'hidden'})
        assert.equal(await page.evaluate(()=>window.calls.at(-1)[2].id),before,'Activity retries preserve the same server template identity')
      }
      await page.getByRole('radio',{name:'Only me',exact:true}).waitFor()
    }
    await page.getByRole('button',{name:'Build another template',exact:true}).click()
    await page.getByLabel('Template name',{exact:true}).fill('FP TEST Pending')
    await page.getByLabel('Field name',{exact:true}).fill('Passing')
    await page.getByRole('button',{name:'Save field',exact:true}).click()
    await page.evaluate(()=>{window.used=[];window.confirmed=[];window.holdSave=true})
    await page.getByRole('button',{name:'Save template',exact:true}).click()
    await page.waitForFunction(()=>Boolean(window.finishSave))
    assert.notEqual(await page.getByRole('button',{name:'Home tab',exact:true}).getAttribute('aria-disabled'),'true')
    await page.getByRole('button',{name:'Home tab',exact:true}).click()
    await page.getByText('Development home',{exact:true}).waitFor()
    await page.evaluate(()=>{window.account('coach-b');window.open(true);window.finishSave()})
    await page.getByLabel('Template name',{exact:true}).waitFor()
    await page.waitForTimeout(150)
    assert.equal(await page.getByLabel('Template name',{exact:true}).inputValue(),'','Changing account cannot restore the other Coach template')
    assert.deepEqual(await page.evaluate(()=>window.used),[],'A late save cannot choose a template in the new account')
    assert.deepEqual(await page.evaluate(()=>window.confirmed),[],'A late save cannot add a template to the new account form list')
    assert.deepEqual(errors,[])
    await page.close()
  }
  console.log('PASS: actual Coach template builder, field persistence, rating/yes-no, private-first creation, explicit team access, navigable pending save, account isolation, compact light/dark layout at 320/390px. Handset confirmation remains separate.')
}finally{await browser.close()}
