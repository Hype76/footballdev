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
const entry=`import {formatFixtureDateTime} from './src/lib/calendar-datetime-integrity.js';
import {formatUkDate} from './src/lib/date-format.js';
import {PitchTypeIcon} from './apps/parent-mobile/src/PitchTypeIcon.js';
import {MatchTypeIcon} from './apps/parent-mobile/src/MatchTypeIcon.js';
import {HomeAwayIcon} from './apps/parent-mobile/src/HomeAwayIcon.js';
import {VenueMapPreview} from './apps/mobile-core/src/VenueMapPreview.js';
import {PinnedEventNotes} from './apps/mobile-core/src/PinnedEventNotes.js';
import {canEditCoachFixture} from './apps/mobile-core/src/coachFixtureEditCore.js';
import React,{useState,useMemo,useEffect,useCallback,useRef} from 'react';import{createRoot}from'react-dom/client';import{View,Text,StyleSheet,Pressable,TextInput,Switch,Platform}from'react-native';import MaterialIcons from'@expo/vector-icons/MaterialIcons';
import{createCoachTheme}from'./apps/coach-mobile/src/coachThemeCore.js';import{createParentMobileTheme,DEFAULT_PARENT_MOBILE_THEME}from'./apps/mobile-core/src/parentThemeCore.js';
import{getPitchTypeLabel,normalizePitchType}from'./src/lib/pitch-type.js';import{getMatchDayShirtChoiceLabel,normalizeMatchDayShirtChoice}from'./src/lib/matchday-model.js';import{normalizePersonName}from'./src/lib/person-name.js';import{getMatchDayDisplayName}from'./src/lib/matchday-display.js';import{getParentMatchStatusLabel}from'./apps/parent-mobile/src/parentExperience.js';import{formatParentProductDateTime,formatParentProductTime}from'./apps/mobile-core/src/parentDateTimeCore.js';import{formatMatchAddedTimeClock}from'./src/lib/matchday-event-time.js';${calendarImport}
const ClubKitDisplay=()=>null, link=null, clubKits=undefined;
const CoachOfflineReadiness=()=>null; // Readiness download is covered by its dedicated browser journey.
const BrandLoader=()=>null, useConfirmedConnectionIssue=v=>v,useConfirmedConnectionMessage=v=>v,getMobileIconName=()=> 'event';
const deriveTeamNotificationDisplayName=v=>v,getCoachTeamNotificationDisplayName=async()=> 'FP TEST',message=e=>e.message;
const readCoachOfflineResources=async()=>null,saveCoachOfflineResources=async()=>{},peekMobileResource=()=>undefined,readMobileResource=async(u,k,fn)=>fn(),getCoachPlayerList=async()=>[],getCoachResources=async()=>{if(window.failResourceLoad)throw Error('Resource load failed');return window.resources};
const invalidateMobileResource=()=>{},syncCoachCalendarEventResources=async(u,event,ids,date)=>{if(window.failResourceSave)throw Error('Resource save failed');window.resourceSaves.push({eventId:event.sourceId,ids,date})};
const CoachDateTimeField=()=>null;const getCoachCalendarResources=async()=>{await new Promise(r=>setTimeout(r,30));return window.events};
${calendar}
const useCoachTheme=()=>({styles:{}}),formatDateTime=v=>v,HomeNextRow=({label,onPress,value})=><Pressable accessibilityRole="button" onPress={onPress}><Text>{label}</Text><Text>{value}</Text></Pressable>,IconSection=({children})=><View>{children}</View>,IconAction=()=>null,IconStat=()=>null,EmptyPanel=()=>null,LoadingPanel=()=>null,StatePanel=()=>null;
${homeScreen}
${normalizer}
const labelize=v=>String(v||''),formatDateOnly=v=>formatParentProductDateTime(v,{includeTime:false,year:'numeric'});
${parentStyles}
const context={id:'team',teamId:'team',teamName:'FP TEST',role:'head_coach',roleRank:90,paymentAccess:{canMutate:true}},user={id:'coach',activeTeamId:'team',roleRank:90};const contexts=[context];window.calendarContext=context;window.calendarUser=user;
const first={id:'calendar_event:repeat:2099-09-10',sourceId:'repeat',sourceType:'calendar_event',occurrenceDate:'2099-09-10',calendarDate:'2099-09-10',calendarTime:'18:45',startsAt:'2099-09-10T17:45:00Z',title:'First occurrence',teamId:'team',eventType:'training',status:'scheduled',canEdit:true,notes:'First notes'};
const chosen={...first,id:'calendar_event:repeat:2099-09-17',occurrenceDate:'2099-09-17',calendarDate:'2099-09-17',startsAt:'2099-09-17T17:45:00Z',title:'Chosen occurrence',notes:'Chosen event notes'};window.events=[first,chosen];window.calls=[];window.resourceSaves=[];window.resources=[{id:'existing',title:'Existing plan',category:'training',links:[{linkedType:'calendar_event',linkedId:'repeat',calendarOccurrenceDate:'2099-09-17'}]},{id:'new',title:'Passing practice',category:'training',links:[]},{id:'other',title:'Match guide',category:'match_day',links:[]}];
function ParentHero({mode,pitch,fixtureType,homeAway}){const{colors,styles}=usePortalStyles(createParentMobileTheme({mode}).tokens),selectedMatch=normalizeMatchDay({id:'match',opponent:'Visitors',club_name:'FP TEST Club',teamName:'FP TEST',pitch_type:pitch,fixture_type:fixtureType,match_date:'2099-09-12',kickoff_time:'11:00:00',arrival_time:'10:00:00',venue_name:'FP TEST ground',home_away:homeAway}),selectedMatchIsLive=false,matchStarted=false,presentation=null,now=Date.now();window.normalized=selectedMatch;return ${hero}}
function App(){const[screen,setScreen]=useState('home'),[target,setTarget]=useState(null),[mode,setMode]=useState('light'),[pitch,setPitch]=useState('3g'),[fixtureType,setFixtureType]=useState('league'),[homeAway,setHomeAway]=useState('away'),[key,setKey]=useState(0);window.homeAway=setHomeAway;window.fixtureType=setFixtureType;window.mode=setMode;window.pitch=setPitch;window.parent=()=>setScreen('parent');window.home=()=>{setTarget(null);setScreen('home')};window.target=t=>{setTarget(t);setKey(v=>v+1);setScreen('calendar')};const palette=createCoachTheme({mode}).tokens;
return <View style={{backgroundColor:palette.background,minHeight:'100vh',padding:12}}>{screen==='home'?<HomeScreen user={user} context={context} homeState={{matches:[],sessions:[],nextCalendar:chosen}} onNavigate={(route,t)=>{window.calls.push({route,target:t});setTarget(t);setScreen('calendar')}} reloadHome={()=>{}}/>:screen==='calendar'?<CoachCalendarScreen key={key} calendarTarget={target} context={context} contexts={contexts} user={user} palette={palette} onNavigate={(route,target)=>window.calls.push({route,target})}/>:<ParentHero mode={mode} pitch={pitch} fixtureType={fixtureType} homeAway={homeAway}/>}</View>};createRoot(document.getElementById('root')).render(<App/>);`
const result=await build({stdin:{contents:entry,resolveDir:root,loader:'jsx'},bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx','.ttf':'dataurl','.png':'dataurl'},platform:'browser',conditions:['browser'],mainFields:['browser','module','main'],nodePaths:[modules],resolveExtensions:['.web.tsx','.web.ts','.web.js','.tsx','.ts','.jsx','.js','.json'],alias:{react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom'),'react-native':path.join(modules,'react-native-web')},define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'},banner:{js:'globalThis.process={env:{NODE_ENV:"production"}};'}})
const browser=await chromium.launch({headless:true})
try {
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)})
 await page.setContent('<body style="margin:0"><div id="root"></div>');await page.addScriptTag({content:result.outputFiles[0].text})
 await page.getByRole('button',{name:/Next Calendar item/}).click();await page.getByText('Chosen event notes',{exact:true}).waitFor()
 assert.equal(await page.getByText('First occurrence',{exact:true}).count(),0);assert.equal(await page.getByText('Calendar scope',{exact:true}).count(),0)
 assert.ok((await page.getByText('Chosen occurrence',{exact:true}).boundingBox()).y<300)
 assert.deepEqual(await page.evaluate(()=>window.calls[0].target),{eventId:'calendar_event:repeat:2099-09-17',sourceId:'repeat',sourceType:'calendar_event',occurrenceDate:'2099-09-17'})
 for(const mode of ['light','dark']){await page.evaluate(mode=>window.mode(mode),mode);await page.screenshot({path:out+'/calendar-'+mode+'.png',fullPage:true})}
 await page.getByRole('button',{name:'Add resource',exact:true}).click()
 await page.getByRole('button',{name:'Attached Existing plan',exact:true}).waitFor()
 assert.equal(await page.getByRole('button',{name:'Attached Existing plan',exact:true}).isDisabled(),true)
 assert.equal(await page.getByRole('button',{name:'Save event',exact:true}).count(),0)
 await page.getByRole('textbox',{name:'Search event Resources'}).fill('Pass')
 await page.getByRole('button',{name:'Add Passing practice',exact:true}).click()
 assert.equal(await page.getByRole('button',{name:'Add Match guide',exact:true}).count(),0)
 await page.getByRole('textbox',{name:'Search event Resources'}).fill('')
 await page.getByRole('button',{name:'match day',exact:true}).click()
 assert.equal(await page.getByRole('button',{name:'Selected Passing practice',exact:true}).count(),0)
 await page.getByRole('button',{name:'Add Match guide',exact:true}).waitFor()
 await page.getByRole('button',{name:'All categories',exact:true}).click()
 for(const mode of ['light','dark'])for(const width of [320,390]){
   await page.evaluate(mode=>window.mode(mode),mode);await page.setViewportSize({width,height:844})
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:out+'/calendar-resource-'+mode+'-'+width+'.png',fullPage:true})
 }
 await page.evaluate(()=>{window.failResourceSave=true;window.resources.push({id:'concurrent',title:'Added by another coach',category:'training',links:[{linkedType:'calendar_event',linkedId:'repeat',calendarOccurrenceDate:'2099-09-17'}]})})
 await page.getByRole('button',{name:'Add selected Resources (1)',exact:true}).click()
 await page.getByText('Resource save failed',{exact:true}).waitFor()
 await page.getByRole('button',{name:'Selected Passing practice',exact:true}).waitFor()
 assert.equal(await page.evaluate(()=>window.resourceSaves.length),0)
 await page.evaluate(()=>{window.failResourceSave=false})
 await page.getByRole('button',{name:'Add selected Resources (1)',exact:true}).click()
 await page.getByText('Resources added to this event.',{exact:true}).waitFor()
 assert.deepEqual(await page.evaluate(()=>window.resourceSaves),[{eventId:'repeat',ids:['existing','concurrent','new'],date:'2099-09-17'}])
 await page.evaluate(()=>window.failResourceLoad=true)
 await page.getByRole('button',{name:'Add resource',exact:true}).click()
 await page.getByText('Resource load failed',{exact:true}).waitFor()
 assert.equal(await page.getByRole('button',{name:/Add selected Resources/}).count(),0)
 await page.evaluate(()=>window.failResourceLoad=false)
 await page.getByRole('button',{name:'Retry Resources',exact:true}).click()
 await page.getByRole('button',{name:'Attached Existing plan',exact:true}).waitFor()
 await page.getByRole('button',{name:'Back to event',exact:true}).click()
 assert.equal(await page.evaluate(()=>window.resourceSaves.length),1)
 await page.getByRole('button',{name:'Back to Calendar'}).click();await page.getByText('Calendar scope',{exact:true}).waitFor()
 await page.evaluate(()=>window.target({sourceId:'repeat',sourceType:'calendar_event',occurrenceDate:'2099-09-10'}));await page.getByText('First notes',{exact:true}).waitFor();assert.equal(await page.getByText('Chosen occurrence',{exact:true}).count(),0)
 for(const change of [{roleRank:30},{payment:false},{offline:true}]){
   await page.evaluate(change=>{
     window.calendarContext.roleRank=change.roleRank??90;window.calendarUser.roleRank=change.roleRank??90
     window.calendarContext.paymentAccess.canMutate=change.payment!==false;window.calendarUser.isOfflineProfile=Boolean(change.offline)
     window.target({sourceId:'repeat',sourceType:'calendar_event',occurrenceDate:'2099-09-10'})
   },change)
   await page.getByText('First notes',{exact:true}).waitFor()
   assert.equal(await page.getByRole('button',{name:'Add resource',exact:true}).count(),0)
 }
 await page.evaluate(()=>{window.calendarContext.roleRank=90;window.calendarUser.roleRank=90;window.calendarContext.paymentAccess.canMutate=true;window.calendarUser.isOfflineProfile=false})
 await page.evaluate(()=>window.target({sourceId:'foreign',sourceType:'calendar_event',occurrenceDate:'2099-09-10'}));await page.getByText('Calendar scope',{exact:true}).waitFor();assert.equal(await page.getByText('Chosen event notes',{exact:true}).count(),0)
 await page.evaluate(()=>{window.events=[{id:'match_day:fixture',sourceId:'fixture',sourceType:'match_day',calendarDate:'2099-09-19',calendarTime:'10:45',teamId:'team',title:'FP TEST v Visitors',eventType:'fixture',status:'scheduled'}];window.target({sourceId:'fixture',sourceType:'match_day'})})
 await page.getByRole('button',{name:'Add resource',exact:true}).waitFor()
 await page.getByRole('button',{name:'Add resource',exact:true}).click()
 await page.getByRole('button',{name:'Add Match guide',exact:true}).click()
 await page.getByRole('button',{name:'Add selected Resources (1)',exact:true}).click()
 await page.getByText('Resources added to this event.',{exact:true}).waitFor()
 assert.deepEqual(await page.evaluate(()=>window.resourceSaves.at(-1)),{eventId:'fixture',ids:['other'],date:'2099-09-19'})
 await page.getByRole('button',{name:'Edit fixture',exact:true}).click()
 assert.deepEqual(await page.evaluate(()=>window.calls.at(-1)),{route:'matchday',target:{fixtureId:'fixture',intent:'edit-fixture',returnCalendarTarget:{sourceId:'fixture',sourceType:'match_day'}}})
 assert.equal(await page.getByText('Edit this item from its Match Day screen.',{exact:true}).count(),0)
 for(const mode of ['light','dark']){await page.evaluate(mode=>window.mode(mode),mode);await page.screenshot({path:out+'/calendar-fixture-edit-'+mode+'.png',fullPage:true})}
 for(const change of [{status:'live'},{teamId:'other-team'}]){
   await page.evaluate(change=>{window.events=[{...window.events[0],status:'scheduled',teamId:'team',...change}];window.target({sourceId:'fixture',sourceType:'match_day'})},change)
   await page.getByRole('button',{name:'Open Match Day',exact:true}).waitFor()
   await page.getByRole('button',{name:'Edit fixture',exact:true}).waitFor({state:'hidden'})
 }
 await page.evaluate(()=>{window.events=[{id:'assessment_session:assessment',sourceId:'assessment',sourceType:'assessment_session',calendarDate:'2099-09-20',calendarTime:'10:45',teamId:'team',title:'Player assessment',eventType:'assessment',status:'scheduled'}];window.target({sourceId:'assessment',sourceType:'assessment_session'})})
 await page.getByRole('button',{name:'Add resource',exact:true}).click()
 await page.getByRole('button',{name:'Add Passing practice',exact:true}).click()
 await page.getByRole('button',{name:'Add selected Resources (1)',exact:true}).click()
 await page.getByText('Resources added to this event.',{exact:true}).waitFor()
 assert.deepEqual(await page.evaluate(()=>window.resourceSaves.at(-1)),{eventId:'assessment',ids:['new'],date:'2099-09-20'})
 await page.evaluate(()=>window.parent())
 for(const [pitch,label] of [['grass','Grass'],['3g','3G'],['4g','4G'],['astro','Astro'],['indoor','Indoor'],['other','Other'],['','Not specified']]){await page.evaluate(v=>window.pitch(v),pitch);await page.getByLabel('Surface: '+label,{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.normalized.pitchType),pitch);assert.equal(await page.locator('[data-testid^="pitch-type-"]').count(),pitch?1:0)}
 for(const [type,label] of [['league','League'],['cup','Cup'],['tournament','Tournament'],['friendly','Friendly'],[' CUP ','Cup'],['match','Not specified'],['','Not specified'],['unknown','Not specified']]){await page.evaluate(v=>window.fixtureType(v),type);await page.getByLabel('Match type: '+label,{exact:true}).waitFor();assert.equal(await page.locator('[data-testid^="match-type-"]').count(),label==='Not specified'?0:1)}
 for(const [venue,label] of [['home','Home game'],['away','Away game'],[' HOME ','Home game'],['neutral','Neutral venue'],['unknown','Venue type not specified']]){await page.evaluate(v=>window.homeAway(v),venue);await page.getByLabel(label,{exact:true}).waitFor();assert.equal(await page.locator('[data-testid^="home-away-"]').count(),label.endsWith('game')?1:0)}
 await page.evaluate(()=>{window.pitch('3g');window.fixtureType('league');window.homeAway('away')})
 for(const mode of ['light','dark'])for(const width of [390,320]){await page.evaluate(mode=>window.mode(mode),mode);await page.setViewportSize({width,height:844});await page.getByText('3G',{exact:true}).waitFor();await assertRenderedTextContrast(page,'Parent surface '+mode+' '+width);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:out+'/surface-'+mode+'-'+width+'.png',fullPage:true})}
 for(const type of ['league','cup','tournament','friendly']){await page.evaluate(v=>window.fixtureType(v),type);await page.getByTestId('match-type-'+type).waitFor();await page.getByTestId('match-type-'+type).screenshot({path:out+'/match-type-'+type+'.png'})}
for(const mode of ['light','dark'])for(const venue of ['home','away']){await page.evaluate(v=>{window.mode(v.mode);window.homeAway(v.venue)},{mode,venue});await page.getByTestId('home-away-'+venue).waitFor();await page.getByText(venue==='away'?'Visitors v FP TEST Club':'FP TEST Club v Visitors',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.normalized.teamName),'FP TEST');await page.screenshot({path:out+'/venue-'+venue+'-'+mode+'.png',fullPage:true})}
 assert.deepEqual(errors,[]);console.log('PASS: recurring Calendar navigation; resource search/categories, exact occurrence attachments, preserved existing/concurrent links, save/load failure retry, cancellation and role/offline/source restrictions; Parent match normalization and surface display; light/dark 320/390px.')
}finally{await browser.close()}
