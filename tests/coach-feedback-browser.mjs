import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { parse } from '@babel/parser'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const source = await readFile('apps/coach-mobile/src/CoachMatchDayScreen.js', 'utf8')
const functions = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body.filter(n => n.type === 'FunctionDeclaration')
const selected = ['FixtureHero', 'createStyles', 'formatFixtureDate', 'isLiveMatch'].map(name => {
  const node = functions.find(n => n.id.name === name)
  return source.slice(node.start, node.end)
}).join('\n')
const modules = path.resolve('apps/coach-mobile/node_modules')
const entry = `import React,{useState,useEffect} from 'react';import{createRoot}from'react-dom/client';
import{View,Text,Pressable,StyleSheet}from'react-native';import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import{getMobileIconName}from'./apps/mobile-core/src/mobileIconSystem.js';
import{getCoachMatchDayPresentation}from'./apps/mobile-core/src/coachMatchDayCore.js';
import{getMatchDayLifecycleState}from'./src/lib/matchday-lifecycle.js';
import{createCoachTheme}from'./apps/coach-mobile/src/coachThemeCore.js';
import{CoachNotificationHistoryScreen}from'./apps/coach-mobile/src/CoachNotificationHistoryScreen.js';
const normalize=v=>String(v??'').trim(),label=v=>normalize(v).replaceAll('_',' ');
${selected}
function App(){const[status,setStatus]=useState('scheduled'),[mode,setMode]=useState('light'),[history,setHistory]=useState(false);window.setMatchStatus=setStatus;window.mode=setMode;window.setHistoryScreen=setHistory;
const palette=createCoachTheme({mode}).tokens,styles=createStyles(palette);
return <View style={{backgroundColor:palette.background,padding:16,minHeight:'100vh'}}>{history?<CoachNotificationHistoryScreen user={{id:'test'}} context={{id:'test'}} palette={palette} styles={{...styles,bodyText:styles.body,helperText:styles.meta}} onOpenNotification={data=>window.opened=data}/>:<FixtureHero match={{id:'test',teamName:'Our team',opponent:'Visitors',status,timerStatus:status==='scheduled'?'not_started':status==='live'?'running':status==='half_time'?'half_time':'full_time',homeScore:0,awayScore:0,matchDate:'2026-09-14',matchDurationMinutes:60,halfDurationMinutes:30}} styles={styles}/>}</View>};createRoot(document.getElementById('root')).render(<App/>);`
const result=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'jsx'},banner:{js:'globalThis.process={env:{NODE_ENV:"production"}};'},bundle:true,write:false,nodePaths:[modules],platform:'browser',conditions:['browser'],mainFields:['browser','module','main'],resolveExtensions:['.web.tsx','.web.ts','.web.js','.tsx','.ts','.jsx','.js','.json'],jsx:'automatic',loader:{'.js':'jsx','.ttf':'dataurl','.png':'dataurl'},alias:{react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom'),'react-native':path.join(modules,'react-native-web')},define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'},plugins:[{name:'history',setup(b){b.onLoad({filter:/coachNotificationCache\.js$/},()=>({contents:`export async function loadCoachNotificationHistory(){return{items:[0,10,45,110].map((days,id)=>({id,title:'Notice '+id,body:'Update',created_at:new Date(Date.now()-days*86400000).toISOString(),data:{targetId:String(id)}}))}}`,loader:'js'}))}}]})
const browser=await chromium.launch({headless:true})
try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[]
  page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)})
  await page.setContent('<div id="root"></div>');await page.addScriptTag({content:result.outputFiles[0].text})
  await page.waitForFunction(() => typeof window.mode === 'function')
  await mkdir('output/playwright/coach-feedback',{recursive:true})
  for(const mode of ['light','dark']){
    await page.evaluate(mode=>{window.mode(mode);window.setMatchStatus('scheduled')},mode)
    await page.getByText('Our team v Visitors',{exact:true}).waitFor()
    assert.equal(await page.getByText('Score',{exact:true}).count(),0)
    assert.equal(await page.getByText('Match timer',{exact:true}).count(),0)
    await page.screenshot({path:`output/playwright/coach-feedback/prematch-${mode}.png`})
    for(const status of ['live','half_time','full_time']){
      await page.evaluate(status=>window.setMatchStatus(status),status)
      await page.getByText('Score',{exact:true}).waitFor()
      await page.getByText('Match timer',{exact:true}).waitFor()
    }
  }
  await page.evaluate(()=>window.setHistoryScreen(true))
  await page.getByRole('button',{name:'Open notification: Notice 0'}).waitFor()
  for(const [id,title] of [[1,'Older than 7 days'],[2,'Older than 1 month'],[3,'Archive: older than 3 months']]){
    assert.equal(await page.getByRole('button',{name:'Open notification: Notice '+id}).count(),0)
    await page.getByRole('button',{name:new RegExp(title)}).click()
    await page.getByRole('button',{name:'Open notification: Notice '+id}).click()
    assert.equal(await page.evaluate(()=>window.opened.targetId),String(id))
    await page.getByRole('button',{name:new RegExp(title)}).click()
  }
  await page.screenshot({path:'output/playwright/coach-feedback/history-dark.png'})
  assert.deepEqual(errors,[])
  console.log('PASS: pre-match score hidden; live, paused and final score retained; notification groups collapse and preserve navigation')
}finally{await browser.close()}
