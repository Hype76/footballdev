import assert from 'node:assert/strict'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'
import { chromium, devices, webkit } from 'playwright'

const modules = path.resolve('apps/parent-mobile/node_modules')
const sharedBadge = 'https://assets.example.test/cambourne.png'
const bundle = await build({
  stdin: {
    resolveDir: process.cwd(),
    loader: 'jsx',
    contents: `
      import React, { useState } from 'react'
      import { createRoot } from 'react-dom/client'
      import { AppState } from 'react-native'
      import { AdultPlayerEntry } from './apps/parent-mobile/src/AdultPlayerEntry.js'
      AppState.addEventListener = (_event, handler) => {
        window.refreshAccess = () => handler('active')
        return { remove() { window.refreshAccess = null } }
      }
      function App() {
        const [id, setId] = useState('adult')
        window.changeAccount = setId
        return <AdultPlayerEntry key={id} userId={id} links={window.parentLinks}
          onSignOut={async () => setId('signed-out')}
          renderParent={({ openPlayer, playerAccess }) => <main>
            <h1>{window.parentLinks.length ? 'Parent Home' : 'Welcome to Football Player'}</h1>
            {openPlayer ? <button onClick={openPlayer}>Open Player account</button> : null}
            {playerAccess.error ? <p role="alert">{playerAccess.error}</p> : null}
            <button onClick={playerAccess.refresh}>Check for access</button>
          </main>}
          renderFan={openPlayer => <main>Fan Home{openPlayer ? <button onClick={openPlayer}>Open Player account</button> : null}</main>} />
      }
      createRoot(document.getElementById('root')).render(<App />)
    `,
  },
  bundle: true,
  write: false,
  platform: 'browser',
  jsx: 'automatic',
  loader: { '.js': 'jsx', '.png': 'dataurl' },
  nodePaths: [modules],
  alias: {
    'react-native': path.join(modules, 'react-native-web'),
    react: path.join(modules, 'react'),
    'react-dom': path.join(modules, 'react-dom'),
  },
  plugins: [{
    name: 'adult-player-device-services',
    setup(builder) {
      builder.onResolve({ filter: /(^|\/)(supabase|adultPlayerWorkspace|expo-status-bar|react-native-safe-area-context)$/ }, args => ({ path: args.path, namespace: 'fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => {
        if (args.path.endsWith('/adultPlayerWorkspace')) return { contents: `export const requestAdultPlayerWorkspace = async () => ({planKey:'club', link:{id:'adult-link',playerId:'adult-player',teamId:'ladies',clubId:'cambourne'}})` }
        if (args.path.endsWith('/supabase')) return { contents: 'export const supabase = { rpc: (...args) => window.rpc(...args) }' }
        if (args.path === 'expo-status-bar') return { contents: 'export const StatusBar = () => null' }
        return { contents: 'import { View } from "react-native"; export const SafeAreaView = View', resolveDir: process.cwd() }
      })
    },
  }],
})


// Render the production shared shell with deterministic service responses.
const serviceMocks = {
  config: `export const getMobileRuntimeConfig=()=>({apiBaseUrl:'https://fixture.example.test',supabaseUrl:'https://fixture.example.test',isUsable:true,isProduction:false})`,
  auth: `export const useMobileAuth=()=>({user:window.mobileUser,signOut:async()=>{},refreshUserProfile:async()=>{},replaceCurrentUserProfile:async()=>{},isProfileLoading:false});export const AuthProvider=({children})=>children`,
  supabase: `export const supabase={rpc:(...a)=>window.rpc(...a),auth:{getSession:async()=>({data:{session:{user:{id:'adult'},access_token:'test'}}})}};export const getAccessToken=async()=>'test'`,
  adultPlayerWorkspaceData: `export const loadAdultPlayerWorkspace=async()=>{window.workspaceLoads++;return {}}`,
  appBadge: `export const getParentAppBadgeCount=()=>0;export const getParentAppBadgeUpdate=()=>0;export const readMobileAppBadgeEnabled=async()=>true;export const syncMobileAppBadge=async()=>{};export const writeMobileAppBadgeEnabled=async(a,v)=>v`,
  biometrics: `export const getBiometricAvailability=async()=>({available:false});export const getBiometricEnabled=async()=>false;export const setBiometricEnabled=async()=>{};export const clearBiometricPreference=async()=>{}`,
  communicationPreferences: `export const getParentCommunicationPreference=async()=>({communicationChannel:'both'});export const updateParentCommunicationPreference=async(a,v)=>({communicationChannel:v})`,
  mobileKitCache: `export const loadMobileClubKits=async()=>({});export const loadMobileTeamKits=async()=>({});export const peekMobileClubKits=()=>({});export const peekMobileTeamKits=()=>({})`,
  TeamLeagueLink: `export const TeamLeagueLinkRow=()=>null`,
  PartnersScreen: `export const PartnersScreen=()=>null;export const PartnersBanner=()=>null`,
  ParentIcon: `export default function Icon(){return null}`,
  'expo-constants': `export default {expoConfig:{version:'test',extra:{}},easConfig:{}}`,
  'expo-application': `export const nativeApplicationVersion='test';export const nativeBuildVersion='1'`,
  'expo-status-bar': `export const StatusBar=()=>null`,
  'expo-crypto': `export const randomUUID=()=>String(Math.random());export const digestStringAsync=async()=>'';export const CryptoDigestAlgorithm={SHA256:'SHA256'}`,
  'expo-secure-store': `export const getItemAsync=async()=>null;export const setItemAsync=async()=>{};export const deleteItemAsync=async()=>{};export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY=1`,
  'expo-font': `export const useFonts=()=>[true];export const loadAsync=async()=>{};export const isLoaded=()=>true`,
  'expo-asset': `export const Asset={fromModule:()=>({uri:''})}`,
  'expo-updates': `export const useUpdates=()=>({});export const checkForUpdateAsync=async()=>({isAvailable:false});export const reloadAsync=async()=>{};export const isEnabled=false;export const channel='test';export const runtimeVersion='test';export const updateId='test';export const isEmbeddedLaunch=true;export const fetchUpdateAsync=async()=>({})`,
  'expo': `export const registerRootComponent=()=>{};export const requireOptionalNativeModule=()=>null`,
  'expo-keep-awake': `export const useKeepAwake=()=>{};export const activateKeepAwakeAsync=async()=>{};export const deactivateKeepAwake=()=>{};export const isAvailableAsync=async()=>false`,
  'expo-modules-core': `export const requireOptionalNativeModule=()=>null`,
  '@expo/vector-icons': `export const MaterialIcons=()=>null;export const FontAwesome5=()=>null;export const Ionicons=()=>null`,
  '@react-native-async-storage/async-storage': `const values=new Map();export default {getItem:async k=>values.get(k)||null,setItem:async(k,v)=>{values.set(k,v)},removeItem:async k=>values.delete(k),multiRemove:async ks=>ks.forEach(k=>values.delete(k))}`,
  '@react-native-community/netinfo': `export default {addEventListener:cb=>{cb({isConnected:true,isInternetReachable:true});return()=>{}}}`,
  'react-native-safe-area-context': `import {View} from 'react-native';export const SafeAreaView=View;export const SafeAreaProvider=View;export const useSafeAreaInsets=()=>({top:0,bottom:0,left:0,right:0})`,
}
const shellBundle = await build({
  stdin:{resolveDir:process.cwd(),loader:'jsx',contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {ParentHome} from './apps/parent-mobile/App.js';
    createRoot(document.getElementById('root')).render(<ParentHome adultLink={window.mobileLink}/>);
  `},define:{__DEV__:'false',global:'globalThis','process.env.NODE_ENV':'"test"'},bundle:true,write:false,platform:'browser',jsx:'automatic',loader:{'.js':'jsx','.png':'dataurl','.ttf':'dataurl'},nodePaths:[modules],
  alias:{'react-native':path.join(modules,'react-native-web'),react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom')},
  plugins:[{name:'shared-shell-fixture',setup(builder){
    builder.onLoad({filter:/parent-mobile[\\/]App\.js$/},args=>({contents:readFileSync(args.path,'utf8').replace('  ToastAndroid,','')+'\nconst ToastAndroid={show(){},SHORT:0};',loader:'jsx'}));
    builder.onResolve({filter:/.*/},args=>{
      const key=args.path.split('/').at(-1).replace(/\.js$/,'');
      if(serviceMocks[args.path]||serviceMocks[key]) return {path:serviceMocks[args.path]?args.path:key,namespace:'shell-mock'};
      if(['offline','notifications','parentDevelopment','parentMatchReport','parentPortalData','data','LiveMatchFollowAction'].includes(key)) return {path:args.path,namespace:'shell-services',pluginData:{key,resolveDir:args.resolveDir}};
      if(args.path==='expo-notifications')return {path:args.path,namespace:'shell-mock'};
    });
    builder.onLoad({filter:/.*/,namespace:'shell-mock'},args=>({contents:serviceMocks[args.path]||`export const useLastNotificationResponse=()=>null;export const clearLastNotificationResponseAsync=async()=>{};export const addNotificationResponseReceivedListener=()=>({remove(){}});export const addPushTokenListener=()=>({remove(){}});export const requestPermissionsAsync=async()=>({granted:false});export const getExpoPushTokenAsync=async()=>({data:''});export const setNotificationHandler=()=>{};export const getPermissionsAsync=async()=>({status:'denied'})`,loader:'jsx',resolveDir:process.cwd()}));
    builder.onLoad({filter:/.*/,namespace:'shell-services'},args=>{
      const {key,resolveDir}=args.pluginData;
      if(key==='LiveMatchFollowAction')return {contents:'export const LiveMatchFollowAction=()=>null'};
      const file=path.resolve(resolveDir,args.path+(args.path.endsWith('.js')?'':'.js'));
      const source=readFileSync(file,'utf8');
      const names=[...source.matchAll(/export (?:async )?(?:function|const) (\w+)/g)].map(m=>m[1]);
      const overrides={
        getParentInvitations:'async()=>window.mobileInvitations',getParentPortalMatchDays:'async()=>window.mobileMatches',
        getParentPortalMatchDayPlayers:'async()=>[]',getParentChatRooms:'async()=>[]',
        isParentInvitationActionable:'i=>i.canRespond===true',
        getInvitationResponseOptions:`()=>[{label:'Available',value:'available'},{label:'Unavailable',value:'unavailable'},{label:'Maybe',value:'maybe'}]`,
        getParentVolunteerRoleLabel:`()=>''`,
        respondToParentInvitation:`async(u,i,v)=>{if(u.role!=='adult_player'||i.adultPlayerLinkId!==window.mobileLink.id)throw Error('Wrong authority');await window.rpc('respond_own_adult_player_match_invitation',{request_id_value:i.sourceRecordId,response_value:v});window.mobileInvitations=window.mobileInvitations.map(x=>({...x,responseState:v}));}`,
        openParentDevelopmentReport:'async()=>({})',
      };
      return {contents:names.map(name=>`export const ${name}=${overrides[name]||(key==='offline'?`async()=>{window.parentOnlyCalls.push('${name}');return []}`:'async()=>[]')};`).join('\n')};
    });
  }}],
})

async function launchSharedShell(page) {
  await page.route('https://fixture.example.test/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>'}));
  await page.goto('https://fixture.example.test/');
  await page.evaluate(()=>{
    window.workspaceLoads=0;window.calls=[];window.parentOnlyCalls=[];
    window.mobileUser={id:'adult',email:'player@example.test',displayName:'Test Player'};
    window.mobileLink={id:'adult-link',linkType:'adult_player',playerId:'adult-player',playerName:'Test Player',clubId:'cambourne',clubName:'Cambourne Town FC',teamId:'ladies',teamName:'Ladies',planKey:'club'};
    window.mobileInvitations=[{invitationId:'match:invite',invitationType:'match_attendance',sourceRecordId:'invite',adultPlayerLinkId:'adult-link',childId:'adult-player',eventId:'fixture',eventTitle:'Ladies league match',eventStart:'2026-11-22T10:00:00Z',responseState:'awaiting_response',invitationState:'active',selectionState:'selected',canRespond:true}];
    window.mobileMatches=[{id:'fixture',teamId:'ladies',clubId:'cambourne',title:'Ladies league match',opponentName:'Visitors',teamName:'Ladies',status:'scheduled',matchDate:'2026-11-22',kickoffTime:'10:00',availabilityStatus:'no_response',squadDecisionState:'selected',confirmedTeam:[],events:[]}];
    window.rpc=async(name,args)=>{window.calls.push([name,args]);return {data:{success:true}}};
  });
  await page.addScriptTag({content:shellBundle.outputFiles[0].text});
}

async function launchFixture(page, { links = [], state = 'linked' } = {}) {
  await page.route('https://fixture.example.test/', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div>',
  }))
  await page.route(sharedBadge, route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="navy"/></svg>',
  }))
  await page.goto('https://fixture.example.test/')
  await page.evaluate(({ links, state, sharedBadge }) => {
    window.parentLinks = links
    window.playerAccess = state
    window.calls = []
    let response = 'awaiting_response'
    window.rpc = async (name, args) => {
      window.calls.push([name, args])
      if (name === 'get_own_adult_player_account_state') {
        if (window.playerAccess === 'unlinked') return { data: [] }
        if (window.playerAccess === 'error') return { error: { message: 'Network unavailable' } }
        return { data: [{
          access_granted: window.playerAccess === 'linked', access_mode: 'player',
          user_id: 'adult', verified_at: '2026-11-20T09:00:00Z',
          link_id: 'adult-link', link_status: window.playerAccess === 'linked' ? 'active' : 'revoked',
          player_id: 'adult-player', player_name: 'Test Player',
          team_id: 'ladies', team_name: 'Ladies', club_id: 'cambourne', club_name: 'Cambourne Town FC',
        }] }
      }
      if (name === 'get_team_branding_display') {
        if (args.team_value !== 'ladies' || args.club_value !== 'cambourne') throw Error('Unexpected scope')
        return { data: { teamId: 'ladies', clubId: 'cambourne', source: 'team', logoAllowed: true, coloursAllowed: true, logoUrl: sharedBadge, accent: '#193e7c' } }
      }
      if (name === 'get_own_adult_player_invitation_state') return { data: [{
        invitation_id: 'match:invite', invitation_type: 'match_attendance', source_record_id: 'invite',
        event_title: 'Ladies league match', event_start: '2026-11-22T10:00:00Z', response_state: response,
        can_respond: true,
      }] }
      if (name === 'respond_own_adult_player_match_invitation') {
        response = args.response_value
        return { data: { success: true } }
      }
      throw Error(`Unexpected call ${name}`)
    }
  }, { links, state, sharedBadge })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
}

for (const [engine, device] of [[webkit, 'iPhone 13'], [chromium, 'Pixel 7']]) {
  const browser = await engine.launch()
  try {
    const shell = await browser.newPage(devices[device])
    shell.on('pageerror', error => console.error('Shared shell error:', error.message))
    await launchSharedShell(shell)
    await shell.getByLabel('Player app navigation').waitFor()
    for (const name of ['Home','Calendar','Matchday','Chat','More']) await shell.getByRole('tab',{name,exact:true}).waitFor()
    for (const name of ['Calendar','Matchday','Chat']) {
      await shell.getByRole('tab',{name,exact:true}).click()
      await shell.getByRole('heading',{name,exact:true}).waitFor()
    }
    await shell.getByRole('tab',{name:'More',exact:true}).click()
    await shell.getByRole('button',{name:'Settings, App and alerts',exact:true}).click()
    await shell.getByRole('heading',{name:'Settings',exact:true}).waitFor()
    await shell.getByRole('button',{name:'Display',exact:true}).click()
    for (const name of ['Light','Dark','System']) {
      const choice=shell.getByRole('radio',{name,exact:true})
      await choice.click()
      await shell.waitForFunction(label=>document.querySelector('[role="radio"][aria-label="'+label+'"]')?.getAttribute('aria-checked')==='true',name)
    }
    await shell.getByRole('button',{name:'Back to Settings',exact:true}).click()
    assert.equal(await shell.getByRole('button',{name:'Calendar sync',exact:true}).count(),0)
    await shell.getByRole('button',{name:'Players',exact:true}).click()
    await shell.getByText('This is your own Player account.',{exact:false}).waitFor()
    assert.equal(await shell.getByRole('button',{name:/Remove.*access/}).count(),0)
    await shell.getByRole('button',{name:'Back to More',exact:true}).click()
    await shell.getByRole('button',{name:/^Invites,/}).click()
    await shell.getByRole('radio',{name:'Attendance, Attending',exact:true}).click({timeout:3000})
    await shell.getByText("You've confirmed your own attendance.",{exact:true}).waitFor()
    const selfResponses=await shell.evaluate(()=>window.calls.filter(([name])=>name.startsWith('respond_')))
    assert.deepEqual(selfResponses,[['respond_own_adult_player_match_invitation',{request_id_value:'invite',response_value:'available'}]])
    assert.deepEqual(await shell.evaluate(()=>window.parentOnlyCalls),[])
    console.log(`${device} shared Player shell tabs, appearance settings, self identity and own RSVP passed`)
    await shell.close()
    const page = await browser.newPage(devices[device])
    await launchFixture(page)
    await page.getByRole('heading', { name: 'Cambourne Town FC' }).waitFor()
    await page.getByText('Ladies', { exact: true }).waitFor()
    await page.getByText('22:11:2026 at 10:00', { exact: true }).waitFor()
    await page.waitForFunction(url => Array.from(document.images).some(image => image.src === url && image.naturalWidth > 0), sharedBadge)
    const available = page.getByRole('button', { name: 'Available', exact: true })
    await available.click()
    await page.getByText('Your response has been saved.', { exact: true }).waitFor()
    await page.getByText('Response: Available', { exact: true }).waitFor()
    const mutations = await page.evaluate(() => window.calls.filter(([name]) => name.startsWith('respond_')))
    assert.deepEqual(mutations, [['respond_own_adult_player_match_invitation', { request_id_value: 'invite', response_value: 'available' }]])
    await page.evaluate(() => { window.playerAccess = 'revoked'; window.refreshAccess() })
    await page.getByText('Your Player access is unavailable.', { exact: false }).waitFor()
    assert.equal(await page.getByText('Ladies league match', { exact: true }).count(), 0)
    await page.evaluate(() => { window.playerAccess = 'linked'; window.changeAccount('wrong-account') })
    await page.getByText('Your Player access is unavailable.', { exact: false }).waitFor()
    assert.equal(await page.getByText('Cambourne Town FC', { exact: true }).count(), 0)
    await page.close()

    const dual = await browser.newPage(devices[device])
    await launchFixture(dual, { links: [{ linkType: 'parent' }] })
    await dual.getByText('Parent Home', { exact: true }).waitFor()
    await dual.getByRole('button', { name: 'Open Player account' }).click()
    await dual.getByRole('heading', { name: 'Cambourne Town FC' }).waitFor()
    await dual.getByRole('button', { name: 'Open Parent account' }).click()
    await dual.getByText('Parent Home', { exact: true }).waitFor()
    await dual.close()

    const recover = await browser.newPage(devices[device])
    await launchFixture(recover, { state: 'unlinked' })
    await recover.getByText('Welcome to Football Player').waitFor()
    await recover.evaluate(() => { window.playerAccess = 'error' })
    await recover.getByRole('button', { name: 'Check for access' }).click()
    await recover.getByRole('alert').waitFor()
    await recover.getByText('Welcome to Football Player', { exact: true }).waitFor()
    await recover.evaluate(() => { window.playerAccess = 'linked' })
    await recover.getByRole('button', { name: 'Check for access' }).click()
    await recover.getByRole('heading', { name: 'Cambourne Town FC' }).waitFor()
    console.log(`${device} Player-only branding, RSVP, revoked access, Parent switching and access retry passed`)
  } finally {
    await browser.close()
  }
}
