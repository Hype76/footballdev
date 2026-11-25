import assert from 'node:assert/strict'
import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'

const rootDir = process.cwd()
const modules = path.join(rootDir, 'apps/coach-mobile/node_modules')
const entry = `
  import React from 'react'; import {createRoot} from 'react-dom/client';
  import {CoachFixtureForm} from './apps/coach-mobile/src/CoachFixtureForm.js';
  import {CoachKeyboardFocusContext} from './apps/coach-mobile/src/CoachKeyboardFocusContext.js';
  const styles=new Proxy({input:{color:'#123',borderWidth:1,padding:8},tabs:{flexDirection:'row',flexWrap:'wrap'},chip:{padding:10},card:{padding:16},action:{padding:12},compactAction:{minHeight:44,paddingHorizontal:4,paddingVertical:8,alignSelf:'flex-start'},dangerText:{color:'#b42318'}}, {get:(target,key)=>target[key]||{}});
  const user={id:'staff',activeTeamId:'team'};
  window.saved=null;
  window.notificationCalls=[];
  window.setupAlerts=[];
  window.focusRequests=0;
  function App(){const [version,setVersion]=React.useState(0);const [match,setMatch]=React.useState(null);const [players,setPlayers]=React.useState([]);
    window.loadPlayers=()=>setPlayers([{id:'player-1',playerName:'Sample Player',section:'squad'}]);
    window.addPlayer=()=>setPlayers(current=>[...current,{id:'player-2',playerName:'Second Player',section:'squad'}]);
    window.reopen=()=>{setMatch({...window.saved,kickoffTime:'10:45:00',arrivalTime:'10:00:00'});setVersion(value=>value+1)};
    window.newFixture=()=>{setMatch(null);setVersion(value=>value+1)};
    return <CoachFixtureForm key={version} match={match} matches={[]} players={players} styles={styles} user={user}
      onCreated={result=>{window.saved=result}} onUpdated={result=>{window.saved=result}} onCancel={()=>{}}/>;
  }
  createRoot(document.getElementById('root')).render(<CoachKeyboardFocusContext.Provider value={()=>{window.focusRequests++}}><App/></CoachKeyboardFocusContext.Provider>);
`
const mocks = [
  [/^expo-notifications$/, `export const scheduleNotificationAsync=async({content})=>{window.setupAlerts.push(content.title);return 'setup-alert'};export const dismissNotificationAsync=async(id)=>{window.dismissedSetupAlert=id};`],
  [/coachCarpoolData$/, `let enabled=true; export const getCoachCarpoolDefault=async()=>enabled; export const setCoachCarpoolDefault=async(user,value)=>{enabled=value;return value};`],
  [/coachCalendarData(?:\.js)?$/, `export const prepareCoachMatchCancellationNotification=async()=>({preparationId:'prepared'});
    export const prepareCoachMatchChangeNotification=async(match,action)=>{
      window.notificationCalls.push(['prepare',match.id,action]);
      if(window.holdPreparation) await new Promise(resolve=>{ window.releasePreparation=resolve });
      return {preparationId:'edit-prepared',recipientCount:2}
    };
    export const commitCoachCalendarChangeNotification=async(id)=>{window.notificationCalls.push(['commit',id]);return {recipientCount:2}};`],
  [/coachMatchDayData(?:\.js)?$/, `
    import {validateCoachFixtureForm} from './apps/mobile-core/src/coachFixtureCore.js';
    export const getCoachMatchLocations=async()=>[];
    export const archiveCoachMatchLocation=async()=>{};
    export const getCoachFixtureInvitedPlayerIds=async(user,match)=>match.selectedPlayerIds||[];
    export const addCoachFixtureParents=async(user,match,playerIds)=>({match:{...match,parentVisible:true,selectedPlayerIds:[...(match.selectedPlayerIds||[]),...playerIds]},warning:''});
    export const createCoachMatchDayFixture=async(user,form)=>{if(window.holdCreate)await new Promise(resolve=>{window.releaseCreate=resolve});return {id:'fixture',...validateCoachFixtureForm(form)}};
    export const updateCoachMatchDayFixture=async(user,match,form)=>{
      const saved={id:match.id,...validateCoachFixtureForm({...form,parentVisible:false,selectedPlayerIds:[]})};
      window.notificationCalls.push(['save', match.id]);
      return saved
    };
    export const cancelCoachMatchDayFixture=async(user,match)=>({...match,status:'cancelled'});
  `],
  [/coachFixturePreferences$/, `export const readCoachFixturePreferences=async()=>{
    if(window.holdDefaults) await new Promise(resolve=>{window.releaseDefaults=resolve});
    return {duration:90};
  };export const writeCoachFixturePreferences=async()=>{};`],
  [/coachTeamNotificationData$/, `import {resolveTeamNotificationDisplayName} from './src/lib/team-notification-display.js';export const getCoachTeamNotificationDisplayName=async()=>resolveTeamNotificationDisplayName({name:'Tigers'});export const getCoachOwnTeamFixturePreferences=async()=>({found:false});export const saveCoachOwnTeamFixturePreferences=async()=>{if(window.holdSaveDefaults)await new Promise(resolve=>{window.releaseSaveDefaults=resolve})};`],
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
  for (const width of [320,390]) {
  const page = await browser.newPage({viewport:{width,height:844}})
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>')
  await page.evaluate(()=>{window.holdDefaults=true})
  await page.addScriptTag({content:bundle.outputFiles[0].text})
  const earlyOpponent = page.getByLabel('Opponent',{exact:true})
  await earlyOpponent.fill('FP TEST early draft')
  assert.ok(await page.getByText('Preparing fixture setup...',{exact:true}).isVisible())
  assert.equal(await page.getByRole('button',{name:'Create fixture and request availability',exact:true}).count(),0)
  await page.waitForFunction(()=>Boolean(window.releaseDefaults))
  await page.evaluate(()=>{window.holdDefaults=false;window.releaseDefaults()})
  await page.getByLabel('Your Team notification name',{exact:true}).waitFor()
  assert.equal(await earlyOpponent.inputValue(),'FP TEST early draft')
  assert.equal(await earlyOpponent.evaluate(element=>document.activeElement===element),true)
  const sharing = page.getByRole('switch', { name: 'Share with Players/Parents' })
  const calendar = page.getByRole('button', { name: 'Calendar', exact: true })
  const invited = 'Add to calendar of Invited players'
  const everyone = 'Add to calendar of Everyone'
  assert.equal(await sharing.isChecked(), true)
  assert.equal(await calendar.innerText().then(text => text.includes(invited)), true)
  await calendar.click()
  assert.deepEqual(await page.getByRole('radio').allTextContents().then(items => items.map(text => text.replace('✓', ''))), [invited, everyone])
  await page.getByRole('radio', { name: everyone }).click()
  await sharing.click()
  assert.equal(await calendar.count(), 0)
  await sharing.click()
  assert.equal(await calendar.innerText().then(text => text.includes(invited)), true)
  await calendar.click()
  await page.getByRole('radio', { name: everyone }).click()
  await page.evaluate(()=>window.loadPlayers())
  await page.getByRole('button',{name:'Remove Sample Player'}).waitFor()
  await page.evaluate(()=>window.addPlayer())
  await page.getByRole('button',{name:'Remove Second Player'}).waitFor()
  assert.equal(await page.getByLabel('Your Team notification name',{exact:true}).inputValue(), 'Tigers')
  const typeField = async (label, text) => {
    const field = page.getByLabel(label,{exact:true})
    const focusRequests = await page.evaluate(()=>window.focusRequests)
    await field.click()
    assert.ok(await page.evaluate(()=>window.focusRequests) > focusRequests, `${label} requests keyboard visibility on focus`)
    await field.fill('')
    await field.pressSequentially(text)
    assert.equal(await field.inputValue(),text)
    assert.equal(await field.evaluate(element=>document.activeElement===element),true)
  }
  await typeField('Your Team notification name','Tigers')
  await typeField('Opponent','FP TEST Visitors')
  await page.setViewportSize({width,height:500})
  await page.getByLabel('Opponent',{exact:true}).pressSequentially(' United')
  assert.equal(await page.getByLabel('Opponent',{exact:true}).inputValue(),'FP TEST Visitors United')
  await page.setViewportSize({width,height:844})
  await page.getByRole('button',{name:'League',exact:true}).click()
  await page.getByLabel('Match date',{exact:true}).fill('2099-09-20')
  await typeField('Venue','FP TEST Ground')
  await typeField('Address','FP TEST Road')
  await typeField('Match notes','Bring both kits')
  await page.getByRole('button',{name:'3G',exact:true}).click()
  if(width===390){
    await page.clock.install()
    await page.getByRole('switch',{name:'Save this duration as my default'}).check()
    await page.evaluate(()=>{window.holdSaveDefaults=true;window.holdCreate=true})
  }
  await page.getByRole('button',{name:'Create fixture and request availability',exact:true}).click()
  if(width===390){
    await page.waitForFunction(()=>Boolean(window.releaseSaveDefaults))
    await page.clock.fastForward(11000)
    assert.deepEqual(await page.evaluate(()=>window.setupAlerts),[],'Saving defaults does not trigger a setup warning')
    await page.evaluate(()=>{window.holdSaveDefaults=false;window.releaseSaveDefaults()})
    await page.waitForFunction(()=>Boolean(window.releaseCreate))
    await page.clock.fastForward(9000)
    assert.deepEqual(await page.evaluate(()=>window.setupAlerts),[],'No setup warning before ten seconds of fixture creation')
    await page.clock.fastForward(1100)
    assert.deepEqual(await page.evaluate(()=>window.setupAlerts),['Match setup is taking longer'])
    await page.evaluate(()=>{window.holdCreate=false;window.releaseCreate()})
    await page.waitForFunction(()=>window.dismissedSetupAlert==='setup-alert')
  }
  await page.waitForFunction(()=>window.saved?.pitchType==='3g').catch(async error=>{throw new Error(`${error.message}; page errors: ${errors.join(' | ')}; screen: ${(await page.locator('body').innerText()).slice(-1500)}`)})
  assert.deepEqual(await page.evaluate(()=>window.saved.selectedPlayerIds),['player-1','player-2'])
  assert.equal(await page.evaluate(()=>window.saved.parentAudience), 'all_team_parents')
  assert.equal(await page.evaluate(()=>window.saved.notificationTeamName), 'Tigers')
  assert.equal(await page.evaluate(()=>window.saved.opponent),'FP TEST Visitors United')
  assert.equal(await page.evaluate(()=>window.saved.venueAddress),'FP TEST Road')
  assert.equal(await page.evaluate(()=>window.saved.notes),'Bring both kits')
  await page.evaluate(()=>window.newFixture())
  await page.getByRole('button',{name:'Clear',exact:true}).click()
  await page.evaluate(()=>window.loadPlayers())
  await page.evaluate(()=>window.addPlayer())
  await page.getByRole('button',{name:'Add Second Player'}).waitFor()
  await page.evaluate(()=>window.reopen())
  await page.getByText('Edit fixture',{exact:true}).waitFor()
  assert.equal(await page.getByLabel('Your Team notification name',{exact:true}).inputValue(), 'Tigers')
  await typeField('Your Team notification name','Tiger squad')
  await typeField('Opponent','FP TEST Edited Visitors')
  const cancelFixture=page.getByRole('button',{name:'Cancel fixture',exact:true})
  const backWithoutSaving=page.getByRole('button',{name:'Back without saving',exact:true})
  assert.ok((await cancelFixture.boundingBox())?.y > (await backWithoutSaving.boundingBox())?.y)
  const cancelStyle=await cancelFixture.evaluate(element=>{const style=getComputedStyle(element);return {backgroundColor:style.backgroundColor,borderWidth:style.borderWidth,minHeight:style.minHeight}})
  assert.equal(cancelStyle.backgroundColor,'rgba(0, 0, 0, 0)')
  assert.equal(cancelStyle.borderWidth,'0px')
  assert.equal(cancelStyle.minHeight,'44px')
  assert.equal(await page.getByLabel('Kick-off time',{exact:true}).inputValue(),'10:45')
  await page.evaluate(()=>{window.saved=null})
  await page.getByRole('button',{name:'Save fixture changes',exact:true}).click()
  await page.waitForFunction(()=>window.saved?.pitchType==='3g').catch(async error=>{throw new Error(`${error.message}; page errors: ${errors.join(' | ')}; screen: ${(await page.locator('body').innerText()).slice(-1500)}`)})
  assert.equal(await page.evaluate(()=>window.saved.notificationTeamName), 'Tiger squad')
  assert.equal(await page.evaluate(()=>window.saved.opponent),'FP TEST Edited Visitors')
  assert.deepEqual(await page.evaluate(()=>window.notificationCalls), [['save','fixture']])
  await page.getByRole('button',{name:'4G',exact:true}).click()
  await page.getByRole('button',{name:'Notify everyone and save',exact:true}).click()
  await page.waitForFunction(()=>window.saved?.pitchType==='4g' && window.saved.notificationNotice)
  assert.deepEqual(await page.evaluate(()=>window.notificationCalls.slice(1)), [['prepare','fixture','rescheduled'],['save','fixture'],['commit','edit-prepared']])
  assert.equal(await page.evaluate(()=>window.saved.notificationNotice),'Notification requested for 2 parent contacts.')
  await page.evaluate(()=>{window.holdPreparation=true;window.reopen()})
  await page.getByRole('button',{name:'Notify everyone and save',exact:true}).click()
  await page.waitForFunction(()=>Boolean(window.releasePreparation))
  await page.evaluate(()=>window.newFixture())
  await page.getByText('Create match',{exact:true}).waitFor()
  assert.deepEqual(await page.evaluate(async()=>{
    window.releasePreparation();
    await new Promise(resolve=>setTimeout(resolve,0));
    return window.notificationCalls.slice(4);
  }),[['prepare','fixture','rescheduled']])
  await page.evaluate(()=>window.reopen())
  await page.getByRole('button',{name:'Not specified',exact:true}).click()
  await page.getByRole('button',{name:'Save fixture changes',exact:true}).click()
  await page.waitForFunction(()=>window.saved?.pitchType==='')
  await page.getByRole('switch',{name:'Car pool',exact:true}).uncheck();
  await page.getByRole('button',{name:'Save fixture changes',exact:true}).click();
  await page.waitForFunction(()=>window.saved?.carpoolEnabled===false);
  await page.evaluate(()=>window.newFixture());
  await page.getByText('Create match',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Your Team notification name',{exact:true}).inputValue(), 'Tigers')
  assert.equal(await page.getByRole('switch',{name:'Car pool',exact:true}).isChecked(),false);
  await page.getByRole('switch',{name:'Car pool',exact:true}).check();
  await page.evaluate(()=>window.newFixture());
  await page.getByRole('switch',{name:'Car pool',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('[role="switch"][aria-label="Car pool"]')?.getAttribute('aria-checked')==='true');
  assert.deepEqual(errors,[])
  console.log(`PASS: Coach fixture typing, focus visibility requests, resize, saved values, pitch create/reopen/edit at ${width}px`)
  await page.close()
  }
} finally {
  await browser.close()
}
