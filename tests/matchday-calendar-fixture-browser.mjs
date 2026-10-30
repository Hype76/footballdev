import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { coachCalendarSubscriptionFixture } from './helpers/coach-calendar-subscription-fixture.mjs'
import { chromium } from 'playwright'

const root = process.cwd()
const modules = process.env.COACH_BROWSER_MODULES || path.join(root, 'apps/coach-mobile/node_modules')
const source = await readFile('apps/coach-mobile/src/CoachOperationalScreens.js', 'utf8')
const appSource = await readFile('apps/coach-mobile/App.js', 'utf8')
const matchSource = await readFile('apps/coach-mobile/src/CoachMatchDayScreen.js', 'utf8')
const calendarImport = source.match(/import \{\s+buildCoachCalendarMonth,[\s\S]*?from '..\/..\/mobile-core\/src\/coachCalendarCore'/)[0].replace('../../mobile-core/src/coachCalendarCore', './apps/mobile-core/src/coachCalendarCore.js')
const screen = source.slice(source.indexOf('function useDomainStyles('), source.indexOf('export function CoachPlayersScreen('))
const navigation = appSource.slice(appSource.indexOf('  const navigate = useCallback('), appSource.indexOf('  const closeFormationWorkspace =', appSource.indexOf('  const navigate = useCallback(')))
const creationEffect = matchSource.match(/  useEffect\(\(\) => \{\s+if \(matchDayTarget\?\.intent !== 'create-fixture'[^]*?\n  \}, \[[^]*?\]\)/)[0]
const fixtureStyles = matchSource.match(/function createStyles\(palette\) \{[^]*?\n\}/)[0].replace('function createStyles', 'function createFixtureStyles')
const entry = `
import {getCoachFormationAuthorityScope} from './apps/coach-mobile/src/coachFormationEntryCore.js';
import {CoachCalendarSync} from './apps/coach-mobile/src/CoachCalendarSync.js';
import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';import {createRoot} from 'react-dom/client';
import {Keyboard,Pressable,StyleSheet,Switch,Text,TextInput,View} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {createCoachTheme} from './apps/coach-mobile/src/coachThemeCore.js';
import {formatUkDate} from './src/lib/date-format.js';
import {getMatchDayShirtChoiceLabel} from './src/lib/matchday-model.js';
import {CAPABILITIES,getFeatureAccess} from './src/lib/paywall-access.js';
import {MATCHDAY_DEFAULT_FLAGS} from './src/lib/matchday-policy.js';
import {resolveCoachRoute,getCoachRouteState} from './apps/coach-mobile/src/coachNavigationCore.js';
import {getCoachQuickActions} from './apps/coach-mobile/src/coachQuickActionsCore.js';
import {CoachFixtureForm} from './apps/coach-mobile/src/CoachFixtureForm.js';
import {CoachDateTimeField} from './apps/coach-mobile/src/CoachDateTimeField';
${calendarImport}
const BrandLoader=()=>null,useConfirmedConnectionIssue=v=>v,useConfirmedConnectionMessage=v=>v;
const deriveTeamNotificationDisplayName=v=>v,getCoachTeamNotificationDisplayName=async()=> 'FP TEST',message=e=>e.message;
const readCoachOfflineResources=async()=>null,saveCoachOfflineResources=async()=>{},peekMobileResource=()=>undefined;
const readMobileResource=async(_u,_key,loader)=>loader(),getCoachPlayerList=async()=>[],getCoachResources=async()=>[];
const getCoachCalendarResources=async()=>window.events;
const normalizeText=v=>String(v||'').trim();
${screen}
${fixtureStyles}
window.events=[];window.saved=null;window.nav=null;
const user={id:'FP TEST coach',clubId:'club',activeTeamId:'team',activeTeamName:'FP TEST',roleRank:70,role:'head_manager',hasActivePlanAccess:true};
const initialContext={id:'team',teamId:'team',clubId:'club',teamName:'FP TEST',planKey:'matchday',planStatus:'active',role:'head_manager',roleRank:70,paymentAccess:{canMutate:true}};
function FixtureDestination({context,matchDayTarget,onMatchDayTargetHandled,palette}){
 const styles=createFixtureStyles(palette),loading=false,stale=false,loadInFlight=useRef({current:false}).current;
 const [error,setError]=useState(''),[fixtureFormMatch,setFixtureFormMatch]=useState(null),[fixtureFormDate,setFixtureFormDate]=useState('');
 const [fixtureReturnTarget,setFixtureReturnTarget]=useState(null),[fixtureFormOpen,setFixtureFormOpen]=useState(false),[notice,setNotice]=useState('');
 const onRequestScrollTop=()=>{};
 ${creationEffect}
 return <><Text>{error}</Text>{fixtureFormOpen?<CoachFixtureForm defaultMatchDate={fixtureFormDate} matches={[]} players={[]} styles={styles} user={user} onCancel={()=>setFixtureFormOpen(false)} onCreated={result=>{window.saved=result;setFixtureFormOpen(false)}}/>:<Text>Match Day</Text>}</>;
}
function App(){
 const [activeRoute,setActiveRoute]=useState('calendar'),[activeContext,setContext]=useState(initialContext),[mode,setMode]=useState('light');
 const [matchDayTarget,setMatchDayTarget]=useState(null),[moreRoute,setMoreRoute]=useState('');
 const matchdayPlanConfig={flags:MATCHDAY_DEFAULT_FLAGS},formationReturnRef=useRef(null),scrollContentToTop=useCallback(()=>{},[]);
 const setChatNotificationTarget=()=>{},setNotice=()=>{},setCalendarTarget=()=>{};
 ${navigation}
 window.reset=(plan='matchday',theme='light')=>{setContext({...initialContext,planKey:plan});setMode(theme);setActiveRoute('calendar');setMatchDayTarget(null);window.saved=null};
 window.actions=getCoachQuickActions(activeContext,matchdayPlanConfig).map(action=>action.label);
 const palette=createCoachTheme({mode,context:activeContext}).tokens;
 const onNavigate=(route,target)=>{window.nav={route,target};return navigate(route,target)};
 return <View style={{backgroundColor:palette.background,minHeight:'100vh',padding:12}}>{activeRoute==='calendar'?<CoachCalendarScreen key={activeContext.planKey+mode} context={activeContext} contexts={[activeContext]} onNavigate={onNavigate} palette={palette} user={user}/>:<FixtureDestination key={mode} context={activeContext} matchDayTarget={matchDayTarget} onMatchDayTargetHandled={()=>setMatchDayTarget(null)} palette={palette}/>}</View>;
}
createRoot(document.getElementById('root')).render(<App/>);
`
const mocks = [
  [/coachCarpoolData$/, `export const getCoachCarpoolDefault=async()=>false;export const setCoachCarpoolDefault=async()=>false;`],
  [/coachCalendarData(?:\.js)?$/, `export const prepareCoachMatchCancellationNotification=async()=>({});export const commitCoachCalendarChangeNotification=async()=>({});`],
  [/coachMatchDayData(?:\.js)?$/, `import {validateCoachFixtureForm} from './apps/mobile-core/src/coachFixtureCore.js';export const getCoachMatchLocations=async()=>[];export const archiveCoachMatchLocation=async()=>{};export const createCoachMatchDayFixture=async(_u,form)=>({match:{id:'fixture',...validateCoachFixtureForm(form)}});export const updateCoachMatchDayFixture=async()=>{};export const cancelCoachMatchDayFixture=async()=>{};`],
  [/coachFixturePreferences$/, `export const readCoachFixturePreferences=async()=>({duration:90});export const writeCoachFixturePreferences=async()=>{};`],
  [/coachTeamNotificationData$/, `export const getCoachTeamNotificationDisplayName=async()=> 'FP TEST';export const getCoachOwnTeamFixturePreferences=async()=>({found:false});export const saveCoachOwnTeamFixturePreferences=async()=>{};`],
  [/CoachDateTimeField$/, `export const CoachDateTimeField=({label,onChange,value})=><input aria-label={label} value={value} onChange={e=>onChange(e.target.value)}/>;`],
  [/coachFriendlyErrors$/, `export const getCoachFriendlyError=e=>e.message;`],
]
const result = await build({stdin:{contents:entry,resolveDir:root,loader:'jsx'},bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx','.ttf':'dataurl'},platform:'browser',conditions:['browser'],mainFields:['browser','module','main'],nodePaths:[modules],resolveExtensions:['.web.tsx','.web.ts','.web.js','.tsx','.ts','.jsx','.js','.json'],alias:{react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom'),'react-native':path.join(modules,'react-native-web')},define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'},banner:{js:'globalThis.process={env:{NODE_ENV:"production"}};'},plugins:[coachCalendarSubscriptionFixture,{name:'fixture-transport',setup(builder){for(const[index,[filter]]of mocks.entries())builder.onResolve({filter},()=>({path:String(index),namespace:'mock'}));builder.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[Number(args.path)][1],loader:'jsx',resolveDir:root}))}}]})
const browser = await chromium.launch({headless:true})
try {
  const page = await browser.newPage({viewport:{width:390,height:844}})
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.setContent('<body style="margin:0"><div id="root"></div></body>')
  await page.addScriptTag({content:result.outputFiles[0].text})
  await mkdir('output/playwright/calendar-fixture',{recursive:true})
  for(const mode of ['light','dark'])for(const width of [320,390]){
    await page.evaluate(mode=>window.reset('matchday',mode),mode)
    await page.setViewportSize({width,height:844})
    await page.getByRole('button',{name:'Today',exact:true}).click()
    await page.getByRole('button',{name:'Create match',exact:true}).click()
    await page.getByLabel('Opponent',{exact:true}).waitFor()
    const target=await page.evaluate(()=>window.nav)
    assert.equal(target.route,'matchday');assert.equal(target.target.intent,'create-fixture');assert.match(target.target.matchDate,/^\d{4}-\d{2}-\d{2}$/)
    const date=await page.getByLabel('Match date',{exact:true}).inputValue()
    const [year,month,day]=target.target.matchDate.split('-')
    assert.equal(date,[day,month,year].join('-'))
    assert.deepEqual(await page.evaluate(()=>window.actions),['Add Player','Add Match','Game Day','Formation Board'])
    assert.equal(await page.getByRole('button',{name:'Save event',exact:true}).count(),0)
    await page.getByLabel('Opponent',{exact:true}).fill('FP TEST Visitors')
    await page.getByRole('button',{name:'Friendly',exact:true}).click()
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow')
    await page.screenshot({path:'output/playwright/calendar-fixture/'+mode+'-'+width+'.png',fullPage:true})
    await page.getByRole('button',{name:'Create fixture and request availability',exact:true}).click()
    await page.getByText('Add a venue before creating this fixture.',{exact:true}).waitFor()
    assert.equal(await page.evaluate(()=>window.saved),null)
    await page.getByLabel('Venue',{exact:true}).fill('FP TEST Ground')
    await page.getByRole('button',{name:'Create fixture and request availability',exact:true}).click()
    await page.waitForFunction(()=>window.saved?.match?.id==='fixture')
    assert.equal(await page.evaluate(()=>window.saved.match.opponent),'FP TEST Visitors')
    assert.equal(await page.evaluate(()=>window.saved.match.venueName),'FP TEST Ground')
  }
  await page.evaluate(()=>window.reset('team'))
  await page.getByRole('button',{name:'Create event',exact:true}).click()
  await page.getByRole('button',{name:'Save event',exact:true}).waitFor()
  await page.getByRole('button',{name:'training',exact:true}).waitFor()
  assert.deepEqual(errors,[])
  console.log('PASS: actual Calendar screen, App navigation, fixture-opening effect and fixture form at320/390px in light/dark; selected date and free-plan quick actions; paid Calendar event path preserved.')
} finally {await browser.close()}
