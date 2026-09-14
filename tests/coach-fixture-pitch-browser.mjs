import assert from 'node:assert/strict'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const rootDir = process.cwd()
const modules = path.join(rootDir, 'apps/coach-mobile/node_modules')
const entry = `
  import React from 'react'; import {createRoot} from 'react-dom/client';
  import {CoachFixtureForm} from './apps/coach-mobile/src/CoachFixtureForm.js';
  const styles=new Proxy({input:{color:'#123',borderWidth:1,padding:8},tabs:{flexDirection:'row',flexWrap:'wrap'},chip:{padding:10},card:{padding:16},action:{padding:12}}, {get:(target,key)=>target[key]||{}});
  const user={id:'staff',activeTeamId:'team'};
  window.saved=null;
  function App(){const [version,setVersion]=React.useState(0);const [match,setMatch]=React.useState(null);
    window.reopen=()=>{setMatch({...window.saved,kickoffTime:'10:45:00',arrivalTime:'10:00:00'});setVersion(value=>value+1)};
    window.newFixture=()=>{setMatch(null);setVersion(value=>value+1)};
    return <CoachFixtureForm key={version} match={match} matches={[]} players={[]} styles={styles} user={user}
      onCreated={result=>{window.saved=result}} onUpdated={result=>{window.saved=result}} onCancel={()=>{}}/>;
  }
  createRoot(document.getElementById('root')).render(<App/>);
`
const mocks = [
  [/coachCarpoolData$/, `let enabled=true; export const getCoachCarpoolDefault=async()=>enabled; export const setCoachCarpoolDefault=async(user,value)=>{enabled=value;return value};`],
  [/coachMatchDayData(?:\.js)?$/, `
    import {validateCoachFixtureForm} from './apps/mobile-core/src/coachFixtureCore.js';
    export const getCoachMatchLocations=async()=>[];
    export const archiveCoachMatchLocation=async()=>{};
    export const createCoachMatchDayFixture=async(user,form)=>({id:'fixture',...validateCoachFixtureForm(form)});
    export const updateCoachMatchDayFixture=async(user,match,form)=>({id:match.id,...validateCoachFixtureForm(form)});
  `],
  [/coachFixturePreferences$/, `export const readCoachFixturePreferences=async()=>({duration:90});export const writeCoachFixturePreferences=async()=>{};`],
  [/coachTeamNotificationData$/, `export const getCoachTeamNotificationDisplayName=async()=>'';export const getCoachOwnTeamFixturePreferences=async()=>({found:false});export const saveCoachOwnTeamFixturePreferences=async()=>{};`],
  [/CoachDateTimeField$/, `export const CoachDateTimeField=({label,onChange,value})=><input aria-label={label} value={value} onChange={event=>onChange(event.target.value)}/>;`],
  [/coachFriendlyErrors$/, `export const getCoachFriendlyError=error=>error.message;`],
]
const bundle = await build({ stdin: {contents:entry,resolveDir:rootDir,loader:'jsx'}, bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx'},
  alias:{'react-native':path.join(modules,'react-native-web'),react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom')},
  define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'},
  plugins:[{name:'fixture-transport',setup(builder){
    for(const [index,[filter]] of mocks.entries()) builder.onResolve({filter},()=>({path:String(index),namespace:'mock'}))
    builder.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[Number(args.path)][1],loader:'jsx',resolveDir:rootDir}))
  }}],
})
const browser = await chromium.launch({headless:true})
try {
  const page = await browser.newPage({viewport:{width:390,height:844}})
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>')
  await page.addScriptTag({content:bundle.outputFiles[0].text})
  await page.getByLabel('Opponent',{exact:true}).fill('FP TEST Visitors')
  await page.getByRole('button',{name:'League',exact:true}).click()
  await page.getByLabel('Match date',{exact:true}).fill('2099-09-20')
  await page.getByRole('button',{name:'3G',exact:true}).click()
  await page.getByRole('button',{name:'Create fixture and request availability',exact:true}).click()
  await page.waitForFunction(()=>window.saved?.pitchType==='3g')
  await page.evaluate(()=>window.reopen())
  await page.getByText('Edit fixture',{exact:true}).waitFor()
  assert.equal(await page.getByLabel('Kick-off time',{exact:true}).inputValue(),'10:45')
  await page.evaluate(()=>{window.saved=null})
  await page.getByRole('button',{name:'Save fixture changes',exact:true}).click()
  await page.waitForFunction(()=>window.saved?.pitchType==='3g')
  await page.getByRole('button',{name:'4G',exact:true}).click()
  await page.getByRole('button',{name:'Save fixture changes',exact:true}).click()
  await page.waitForFunction(()=>window.saved?.pitchType==='4g')
  await page.evaluate(()=>window.reopen())
  await page.getByRole('button',{name:'Not specified',exact:true}).click()
  await page.getByRole('button',{name:'Save fixture changes',exact:true}).click()
  await page.waitForFunction(()=>window.saved?.pitchType==='')
  await page.getByRole('switch',{name:'Car pool',exact:true}).uncheck();
  await page.getByRole('button',{name:'Save fixture changes',exact:true}).click();
  await page.waitForFunction(()=>window.saved?.carpoolEnabled===false);
  await page.evaluate(()=>window.newFixture());
  await page.getByText('Create match',{exact:true}).waitFor();
  assert.equal(await page.getByRole('switch',{name:'Car pool',exact:true}).isChecked(),false);
  await page.getByRole('switch',{name:'Car pool',exact:true}).check();
  await page.evaluate(()=>window.newFixture());
  await page.getByRole('switch',{name:'Car pool',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('[role="switch"][aria-label="Car pool"]')?.checked===true);
  assert.deepEqual(errors,[])
  console.log('PASS: Coach fixture pitch create, reopen, edit, and clear at 390px')
} finally {
  await browser.close()
}
