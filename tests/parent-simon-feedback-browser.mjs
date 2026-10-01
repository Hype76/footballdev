import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { parse } from '@babel/parser'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root = process.cwd()
const modules = path.join(root, 'apps/coach-mobile/node_modules')
const output = 'output/playwright/parent-simon-feedback'
const appSource = await readFile('apps/parent-mobile/App.js', 'utf8')
const portalSource = await readFile('apps/parent-mobile/src/ParentPortalScreens.js', 'utf8')
function extract(source, names) {
  const declarations = parse(source, { sourceType: 'module', plugins: ['jsx'] }).program.body.map(node => node.declaration || node)
  return names.map(name => {
    const node = declarations.find(node => node.type === 'FunctionDeclaration' && node.id.name === name)
    assert.ok(node, `Missing actual function ${name}`)
    return source.slice(node.start, node.end)
  }).join('\n')
}
const backCondition = appSource.match(/\{renderedActiveTab === 'more' && renderedMoreSection \? <BackButton[^\n]+/)[0]
const source = `
import React,{useState,useEffect,useMemo,useContext,createContext} from 'react';
import {createRoot} from 'react-dom/client';
import {View,Text,Pressable,StyleSheet,Platform,TextInput,Switch} from 'react-native';
import ParentIcon from './apps/parent-mobile/src/ParentIcon.js';
import {IconSettings,SettingsSection} from './apps/mobile-core/src/IconSettings.js';
import {createParentMobileTheme,DEFAULT_PARENT_MOBILE_THEME} from './apps/mobile-core/src/parentThemeCore.js';
import {formatParentProductDateTime,formatParentProductTime} from './apps/mobile-core/src/parentDateTimeCore.js';
import {buildFinalMatchReportSummary,buildCompletedMatchGoalScorerLines,buildCompletedMatchEventPresentation} from './src/lib/matchday-final-report.js';
import {getParentMatchGroups} from './apps/parent-mobile/src/parentExperience.js';
import {getParentMatchTimeline} from './apps/parent-mobile/src/parentScorerCore.js';
import {getMatchDayDisplayName} from './src/lib/matchday-display.js';
Platform.OS='ios';
const ParentThemeContext=createContext(null),Application={nativeApplicationVersion:'1.0.22',nativeBuildVersion:'44'},Constants={};
const MOBILE_SETTING_LOAD_STATES={READY:'ready',LOADING:'loading',STALE:'stale'};
const getBuildClassification=()=> 'Production build',config={isProduction:true,isUsable:true};
const ParentPlayerAccessControls=()=>null,DeviceThemeChoices=()=>null,PasswordInput=()=>null,NotificationCategorySettings=()=>null,BrandLoader=()=>null;
const getParentNotificationStatusLabel=()=> 'Enabled';
window.calls=[];window.confirmation=null;
const Alert={alert:(title,message,buttons)=>{window.confirmation={title,message,buttons}}};
const Share={share:async item=>{window.calls.push({action:'share',item})}};
const getStoredParentCalendarFeedUrl=async(user,link)=>'https://calendar.example.invalid/feed?token='+link.id+'-synthetic-private-token-'+ 'a'.repeat(96);
const changeParentCalendarFeed=async(user,link,action)=>{window.calls.push({action,link:link.id});return action==='revoke'?'':'https://calendar.example.invalid/feed?token='+link.id+'-replacement'};
${extract(appSource,['SettingsScreen','ScreenIntro','InfoPanel','InfoRow','Badge','PrimaryAction','BackButton','useParentTheme','createParentAppPalette','createParentAppStyles','labelize','formatDateTime','normalizeText'])}
${extract(portalSource,['colorsFor','usePortalStyles','Button','ResourceState','ResultsScreen','ParentMatchReportCard','formatDate'])}
const fixture={id:'result-one',status:'full_time',matchDate:'2026-09-26',clubName:'Synthetic Town FC',teamName:'U14 Synthetic Town FC',opponent:'Synthetic Elite',homeAway:'away',homeScore:0,awayScore:5,events:[],squadDecisions:[],playerNames:{}};
function App(){
 const [mode,setMode]=useState('light'),[screen,setScreen]=useState('calendar'),[offline,setOffline]=useState(false),[linkId,setLinkId]=useState('player-one'),[renderedMoreSection,setMoreSection]=useState('fans'),[busy,setBusy]=useState(false);
 window.mode=setMode;window.screen=setScreen;window.offline=setOffline;window.player=setLinkId;window.busy=setBusy;
 const theme=createParentMobileTheme({mode}),value=useMemo(()=>({palette:createParentAppPalette(theme.tokens),styles:createParentAppStyles(theme.tokens)}),[mode]);
 const user=useMemo(()=>({id:'synthetic-user'}),[]),selectedLink=useMemo(()=>({id:linkId,playerName:linkId==='player-one'?'Synthetic Player':'Other Player'}),[linkId]);
 const renderedActiveTab='more',setSelectedInvitationId=()=>{},setSelectedMessageId=()=>{},setSelectedPollId=()=>{};
 return <ParentThemeContext.Provider value={value}><View style={{padding:16,backgroundColor:theme.tokens.background,minHeight:'100vh'}}>
 {screen==='calendar'?<SettingsScreen user={user} selectedLink={selectedLink} links={[]} cacheState={{source:'live'}} syncSummary={{waiting:0,needsAttention:0}} notificationState={{}} communicationPreference={{}} notificationCategoryKeys={[]} isOffline={offline} onSignOut={()=>{}}/>:screen==='results'?<ResultsScreen activeActionId={busy?'match-report:result-one':''} link={selectedLink} resource={{items:[fixture],loading:false,error:''}} themeTokens={theme.tokens} onDownloadPdf={match=>window.calls.push({action:'pdf',id:match.id})}/>:<View>${backCondition}<Text>{renderedMoreSection?'Players and Fans':'More menu'}</Text></View>}
 </View></ParentThemeContext.Provider>
}
createRoot(document.getElementById('root')).render(<App/>);
`
const result = await build({ stdin:{contents:source,resolveDir:root,loader:'jsx'},bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx','.ttf':'dataurl'},platform:'browser',conditions:['browser'],mainFields:['browser','module','main'],resolveExtensions:['.web.tsx','.web.ts','.web.js','.tsx','.ts','.jsx','.js','.json'],nodePaths:[modules],alias:{react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom'),'react-native':path.join(modules,'react-native-web')},define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'},banner:{js:'globalThis.process={env:{NODE_ENV:"production"}};'} })
await mkdir(output,{recursive:true})
const browser=await chromium.launch({headless:true})
try {
 const page=await browser.newPage({viewport:{width:390,height:850}}),errors=[]
 page.on('pageerror',error=>{errors.push(error.message);console.error(error.message)})
 page.setDefaultTimeout(10000)
 await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div></body></html>')
 await page.addScriptTag({content:result.outputFiles[0].text})
 const button=name=>['How to add your calendar','Manage calendar link'].includes(name)?page.getByRole('button').filter({hasText:name}):page.getByRole('button',{name,exact:true})
 await button('Calendar sync').click()
 await button('Share calendar link').waitFor()
 assert.equal(await page.getByLabel('Private calendar link',{exact:true}).count(),0,'Stored private link hidden on load')
 assert.equal(await button('Replace calendar link').count(),0)
 assert.equal(await page.getByText(/In iPhone Calendar/).count(),0)
 await page.screenshot({path:output+'/calendar-default-light-390.png',fullPage:true})
 await button('Show secure calendar link').click()
 await page.getByLabel('Private calendar link',{exact:true}).waitFor()
 await button('Share calendar link').click()
 assert.match((await page.evaluate(()=>window.calls))[0].item.url,/player-one-synthetic-private-token/)
 await button('Hide secure calendar link').click()
 assert.equal(await page.getByLabel('Private calendar link',{exact:true}).count(),0)
 await button('How to add your calendar').click()
 await page.getByText(/In iPhone Calendar/).waitFor()
 await button('How to add your calendar').click()
 await button('Manage calendar link').click()
 await button('Replace calendar link').click()
 await page.evaluate(()=>window.confirmation.buttons.find(b=>b.text==='Cancel').onPress?.())
 assert.equal((await page.evaluate(()=>window.calls)).filter(c=>c.action==='generate').length,0)
 await button('Replace calendar link').click()
 await page.evaluate(()=>window.confirmation.buttons.find(b=>b.text==='Replace link').onPress())
 await page.getByText('Calendar link replaced. Add the new link in your calendar app.',{exact:true}).waitFor()
 assert.equal(await page.getByLabel('Private calendar link',{exact:true}).count(),0)
 await page.evaluate(()=>window.offline(true))
 assert.equal(await button('Show secure calendar link').isDisabled(),true)
 assert.equal(await button('Replace calendar link').isDisabled(),true)
 assert.equal(await button('Revoke calendar link').isDisabled(),true)
 await page.evaluate(()=>window.offline(false))
 await button('Show secure calendar link').click()
 await page.getByLabel('Private calendar link',{exact:true}).waitFor()
 await page.evaluate(()=>window.player('player-two'))
 await page.getByText(/Accepted events for Other Player/).waitFor()
 assert.equal(await page.getByLabel('Private calendar link',{exact:true}).count(),0,'Player switch hides old token')
 await button('Show secure calendar link').click()
 assert.match(await page.getByLabel('Private calendar link',{exact:true}).innerText(),/player-two/)
 await button('Hide secure calendar link').click()
 for(const width of [320,390])for(const mode of ['light','dark']){
  await page.setViewportSize({width,height:850});await page.evaluate(mode=>window.mode(mode),mode)
  for(const label of ['Show secure calendar link','Share calendar link','How to add your calendar','Manage calendar link','Replace calendar link','Revoke calendar link']){const box=await button(label).boundingBox();assert.ok(box.width>=44&&box.height>=44,label+' tap target')}
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Calendar overflow')
  await page.screenshot({path:output+'/calendar-'+mode+'-'+width+'.png',fullPage:true})
  await button('Show secure calendar link').click()
  await page.getByLabel('Private calendar link',{exact:true}).waitFor()
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Long visible private URL wraps')
  await button('Hide secure calendar link').click()
 }
 await button('Revoke calendar link').click()
 await page.evaluate(()=>window.confirmation.buttons.find(b=>b.text==='Revoke link').onPress())
 await page.getByText('Calendar link revoked.',{exact:true}).waitFor()
 assert.equal(await button('Share calendar link').count(),0)
 assert.deepEqual((await page.evaluate(()=>window.calls)).filter(call=>['generate','revoke'].includes(call.action)).map(call=>call.action),['generate','revoke'])
 await page.evaluate(()=>window.screen('fans'))
 await button('Back to More').click()
 await page.getByText('More menu',{exact:true}).waitFor()
 assert.equal(await button('Back to More').count(),0)
 await page.evaluate(()=>window.screen('results'))
 await button('Download match report PDF').click()
 assert.equal((await page.evaluate(()=>window.calls)).at(-1).action,'pdf')
 await page.evaluate(()=>window.busy(true))
 assert.equal(await button('Preparing match report...').isDisabled(),true)
 await page.evaluate(()=>window.busy(false))
 for(const width of [320,390])for(const mode of ['light','dark']){
  await page.setViewportSize({width,height:850});await page.evaluate(mode=>window.mode(mode),mode)
  const box=await button('Download match report PDF').boundingBox();assert.ok(box.height>=44)
  assert.equal(await button('Download match report PDF').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)')
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Results overflow')
  await page.screenshot({path:output+'/results-'+mode+'-'+width+'.png',fullPage:true})
 }
 assert.deepEqual(errors,[])
 console.log('PASS: actual Settings calendar privacy, show/hide/share, help/manage, replace cancellation and completion, revoke, offline, player switch; actual shell Fans Back to More; Results PDF action/busy state, compact transparent style; 320/390 light/dark, 44px targets, long URL wraps, no overflow, 9 screenshots. Native saving remains separately unverified.')
} finally {await browser.close()}
