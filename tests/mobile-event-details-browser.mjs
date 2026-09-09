import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { assertRenderedTextContrast } from './helpers/rendered-text-contrast.mjs'

const root=process.cwd(), modules=path.join(root,'apps/coach-mobile/node_modules'), out='output/playwright/mobile-event-details'
await mkdir(out,{recursive:true})
const [coach,home,parent,data]=await Promise.all(['apps/coach-mobile/src/CoachOperationalScreens.js','apps/coach-mobile/App.js','apps/parent-mobile/src/ParentPortalScreens.js','apps/mobile-core/src/data.js'].map(p=>readFile(p,'utf8')))
const calendarImport=coach.match(/import \{\s+buildCoachCalendarMonth,[\s\S]*?from '..\/..\/mobile-core\/src\/coachCalendarCore'/)[0].replace('../../mobile-core/src/coachCalendarCore','./apps/mobile-core/src/coachCalendarCore.js')
const calendar=coach.slice(coach.indexOf('function useDomainStyles('),coach.indexOf('export function CoachPlayersScreen('))
const homeScreen=home.slice(home.indexOf('function HomeScreen('),home.indexOf('function FoundationRoute('))
const normalizer=data.slice(data.indexOf('function normalizeText('),data.indexOf('\n}',data.indexOf('export function normalizeMatchDay('))+2)
const parentStyles=parent.slice(parent.indexOf('function colorsFor('),parent.indexOf('\nfunction ',parent.indexOf('function usePortalStyles(')+10))
const hero=parent.slice(parent.indexOf('        <View style={[styles.gameDayHero,'),parent.indexOf('          {selectedMatch.notes ?'))+'</View>'
const entry=`import {VenueMapPreview} from './apps/mobile-core/src/VenueMapPreview.js';
import {PinnedEventNotes} from './apps/mobile-core/src/PinnedEventNotes.js';
import React,{useState,useMemo,useEffect,useCallback,useRef} from 'react';import{createRoot}from'react-dom/client';import{View,Text,StyleSheet,Pressable,TextInput,Switch}from'react-native';import MaterialIcons from'@expo/vector-icons/MaterialIcons';
import{createCoachTheme}from'./apps/coach-mobile/src/coachThemeCore.js';import{createParentMobileTheme,DEFAULT_PARENT_MOBILE_THEME}from'./apps/mobile-core/src/parentThemeCore.js';
import{getPitchTypeLabel,normalizePitchType}from'./src/lib/pitch-type.js';import{getMatchDayShirtChoiceLabel,normalizeMatchDayShirtChoice}from'./src/lib/matchday-model.js';import{normalizePersonName}from'./src/lib/person-name.js';import{getMatchDayDisplayName}from'./src/lib/matchday-display.js';import{getParentMatchStatusLabel}from'./apps/parent-mobile/src/parentExperience.js';import{formatParentProductDateTime,formatParentProductTime}from'./apps/mobile-core/src/parentDateTimeCore.js';import{formatMatchAddedTimeClock}from'./src/lib/matchday-event-time.js';${calendarImport}
const BrandLoader=()=>null, useConfirmedConnectionIssue=v=>v,useConfirmedConnectionMessage=v=>v,getMobileIconName=()=> 'event';
const deriveTeamNotificationDisplayName=v=>v,getCoachTeamNotificationDisplayName=async()=> 'FP TEST',message=e=>e.message;
const readCoachOfflineResources=async()=>null,saveCoachOfflineResources=async()=>{},peekMobileResource=()=>undefined,readMobileResource=async(u,k,fn)=>fn(),getCoachPlayerList=async()=>[],getCoachResources=async()=>[];
const CoachDateTimeField=()=>null;const getCoachCalendarResources=async()=>{await new Promise(r=>setTimeout(r,30));return window.events};
${calendar}
const useCoachTheme=()=>({styles:{}}),formatDateTime=v=>v,HomeNextRow=({label,onPress,value})=><Pressable accessibilityRole="button" onPress={onPress}><Text>{label}</Text><Text>{value}</Text></Pressable>,IconSection=({children})=><View>{children}</View>,IconAction=()=>null,IconStat=()=>null,EmptyPanel=()=>null,LoadingPanel=()=>null,StatePanel=()=>null;
${homeScreen}
${normalizer}
const labelize=v=>String(v||''),formatDateOnly=v=>formatParentProductDateTime(v,{includeTime:false,year:'numeric'});
${parentStyles}
const context={id:'team',teamId:'team',teamName:'FP TEST',role:'head_coach',roleRank:90},user={id:'coach',activeTeamId:'team',roleRank:90};const contexts=[context];
const first={id:'calendar_event:repeat:2099-09-10',sourceId:'repeat',sourceType:'calendar_event',occurrenceDate:'2099-09-10',calendarDate:'2099-09-10',calendarTime:'18:45',startsAt:'2099-09-10T17:45:00Z',title:'First occurrence',teamId:'team',eventType:'training',status:'scheduled',canEdit:true,notes:'First notes'};
const chosen={...first,id:'calendar_event:repeat:2099-09-17',occurrenceDate:'2099-09-17',calendarDate:'2099-09-17',startsAt:'2099-09-17T17:45:00Z',title:'Chosen occurrence',notes:'Chosen event notes'};window.events=[first,chosen];window.calls=[];
function ParentHero({mode,pitch}){const{colors,styles}=usePortalStyles(createParentMobileTheme({mode}).tokens),selectedMatch=normalizeMatchDay({id:'match',opponent:'Visitors',teamName:'FP TEST',pitch_type:pitch,match_date:'2099-09-12',kickoff_time:'11:00:00',arrival_time:'10:00:00',venue_name:'FP TEST ground',home_away:'away'}),selectedMatchIsLive=false,presentation=null,now=Date.now();window.normalized=selectedMatch;return ${hero}}
function App(){const[screen,setScreen]=useState('home'),[target,setTarget]=useState(null),[mode,setMode]=useState('light'),[pitch,setPitch]=useState('3g'),[key,setKey]=useState(0);window.mode=setMode;window.pitch=setPitch;window.parent=()=>setScreen('parent');window.home=()=>{setTarget(null);setScreen('home')};window.target=t=>{setTarget(t);setKey(v=>v+1);setScreen('calendar')};const palette=createCoachTheme({mode}).tokens;
return <View style={{backgroundColor:palette.background,minHeight:'100vh',padding:12}}>{screen==='home'?<HomeScreen context={context} homeState={{matches:[],sessions:[],nextCalendar:chosen}} onNavigate={(route,t)=>{window.calls.push({route,target:t});setTarget(t);setScreen('calendar')}} reloadHome={()=>{}}/>:screen==='calendar'?<CoachCalendarScreen key={key} calendarTarget={target} context={context} contexts={contexts} user={user} palette={palette} onNavigate={()=>{}}/>:<ParentHero mode={mode} pitch={pitch}/>}</View>};createRoot(document.getElementById('root')).render(<App/>);`
const result=await build({stdin:{contents:entry,resolveDir:root,loader:'jsx'},bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx','.ttf':'dataurl'},platform:'browser',conditions:['browser'],mainFields:['browser','module','main'],nodePaths:[modules],resolveExtensions:['.web.tsx','.web.ts','.web.js','.tsx','.ts','.jsx','.js','.json'],alias:{react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom'),'react-native':path.join(modules,'react-native-web')},define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'},banner:{js:'globalThis.process={env:{NODE_ENV:"production"}};'}})
const browser=await chromium.launch({headless:true})
try {
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)})
 await page.setContent('<body style="margin:0"><div id="root"></div>');await page.addScriptTag({content:result.outputFiles[0].text})
 await page.getByRole('button',{name:/Next Calendar item/}).click();await page.getByText('Chosen event notes',{exact:true}).waitFor()
 assert.equal(await page.getByText('First occurrence',{exact:true}).count(),0);assert.equal(await page.getByText('Calendar scope',{exact:true}).count(),0)
 assert.ok((await page.getByText('Chosen occurrence',{exact:true}).boundingBox()).y<300)
 assert.deepEqual(await page.evaluate(()=>window.calls[0].target),{eventId:'calendar_event:repeat:2099-09-17',sourceId:'repeat',sourceType:'calendar_event',occurrenceDate:'2099-09-17'})
 for(const mode of ['light','dark']){await page.evaluate(mode=>window.mode(mode),mode);await page.screenshot({path:out+'/calendar-'+mode+'.png',fullPage:true})}
 await page.getByRole('button',{name:'Back to Calendar'}).click();await page.getByText('Calendar scope',{exact:true}).waitFor()
 await page.evaluate(()=>window.target({sourceId:'repeat',sourceType:'calendar_event',occurrenceDate:'2099-09-10'}));await page.getByText('First notes',{exact:true}).waitFor();assert.equal(await page.getByText('Chosen occurrence',{exact:true}).count(),0)
 await page.evaluate(()=>window.target({sourceId:'foreign',sourceType:'calendar_event',occurrenceDate:'2099-09-10'}));await page.getByText('Calendar scope',{exact:true}).waitFor();assert.equal(await page.getByText('Chosen event notes',{exact:true}).count(),0)
 await page.evaluate(()=>window.parent())
 for(const [pitch,label] of [['grass','Grass'],['3g','3G'],['4g','4G'],['indoor','Indoor'],['other','Other'],['','Not specified']]){await page.evaluate(v=>window.pitch(v),pitch);await page.getByText('Surface: '+label,{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.normalized.pitchType),pitch)}
 await page.evaluate(()=>window.pitch('3g'))
 for(const mode of ['light','dark'])for(const width of [390,320]){await page.evaluate(mode=>window.mode(mode),mode);await page.setViewportSize({width,height:844});await page.getByText('Surface: 3G',{exact:true}).waitFor();await assertRenderedTextContrast(page,'Parent surface '+mode+' '+width);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:out+'/surface-'+mode+'-'+width+'.png',fullPage:true})}
 assert.deepEqual(errors,[]);console.log('PASS: actual Home callback opens the exact recurring Calendar event at the top, scoped target matching, back navigation, actual Parent match normalization and surface display, all surface choices, light/dark 320/390px.')
}finally{await browser.close()}
