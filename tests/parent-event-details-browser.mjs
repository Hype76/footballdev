import assert from 'node:assert/strict'
import {readFile,mkdir} from 'node:fs/promises'
import path from 'node:path'
import {parse} from '@babel/parser'
import {build} from 'esbuild'
import {chromium} from 'playwright'
const root=process.cwd(),modules=path.join(root,'apps/parent-mobile/node_modules')
async function extract(file,names){const source=await readFile(file,'utf8');const nodes=parse(source,{sourceType:'module',plugins:['jsx']}).program.body.map(n=>n.type==='ExportNamedDeclaration'?n.declaration:n);return names.map(name=>{const n=nodes.find(n=>n?.type==='FunctionDeclaration'&&n.id.name===name);assert.ok(n,name);return source.slice(n.start,n.end)}).join('\n')}
const home=await extract('apps/parent-mobile/App.js',['HomeScreen','CalendarCard','useParentTheme','createParentAppPalette','createParentAppStyles','SectionHeading','SummaryButton'])
const portal=await extract('apps/parent-mobile/src/ParentPortalScreens.js',['CalendarScreen','CalendarEventCard','CalendarEventDetail','colorsFor','usePortalStyles','Button','IconAction','normalizeText','labelize','formatCalendarDay'])
const entry=`
import React,{useState,useEffect,useMemo,useContext,createContext} from 'react';import {createRoot} from 'react-dom/client';
import {View,Text,Pressable,StyleSheet,Platform,BackHandler,useWindowDimensions} from 'react-native';
import {VenueMapPreview} from './apps/mobile-core/src/VenueMapPreview.js';
import {PinnedEventNotes} from './apps/mobile-core/src/PinnedEventNotes.js';
import ParentIcon from './apps/parent-mobile/src/ParentIcon.js';
import {DEFAULT_PARENT_MOBILE_THEME,createParentMobileTheme} from './apps/mobile-core/src/parentThemeCore.js';
import {getParentEventPresentation,getParentEventDateTimeLabel,getParentEventKey} from './apps/parent-mobile/src/parentEventPresentation.js';
import {formatParentProductDateTime,formatParentProductTime} from './apps/mobile-core/src/parentDateTimeCore.js';
import {getParentCalendarDirectionsUrl} from './apps/parent-mobile/src/parentExperience.js';
import {getParentCalendarMarkerTone,getParentCalendarMonthGrid,getParentCalendarWindow,groupParentCalendarEvents,isParentCalendarEventCancelled} from './apps/mobile-core/src/parentCalendarCore.js';
const PARENT_CALENDAR_VIEW_KEY='test',AsyncStorage={getItem:async()=>null,setItem:async()=>{}};
const ParentThemeContext=createContext(null),prepareParentUpdates=()=>[],getParentHomeFixtureCards=()=>[],getParentScorerMatches=()=>[],countUnreadGeneralNotifications=()=>0;
const ResourceState=()=>null,ResourceError=()=>null,EmptyPanel=()=>null;
${portal}\n${home}
const date=new Date();date.setDate(date.getDate()+1);const calendarDate=date.toISOString().slice(0,10);
const events=['Training','Meeting','Club event'].map((title,index)=>({id:'event-'+index,title,calendarDate,calendarTime:'18:45',startsAt:calendarDate+'T17:45:00Z',endsAt:calendarDate+'T19:00:00Z',notesPinned:index===0,eventType:title==='Training'?'training':'event',status:'scheduled',teamName:'U14 JPL',location:'Back Ln, Great Cambourne, Cambourne, Cambridge CB23 6FY',notes:'Please arrive in training kit. Bring water and shin pads.\\n\\nReview the attached training schedule before arriving.',resources:[{id:'resource-'+index,title:'Training schedule'}],sortKey:calendarDate+'T18:45'}));
window.opens=[];window.links=[];
function Preview(){const [tab,setTab]=useState('home'),[link,setLink]=useState('player-1'),[mode,setMode]=useState('light'),[items,setItems]=useState(events),[offline,setOffline]=useState(false);window.tab=setTab;window.player=setLink;window.mode=setMode;window.clear=()=>setItems([]);window.offline=setOffline;
const theme=createParentMobileTheme({mode,selectedLink:{themeAccent:'#174c92'}});const resource={items,loading:false,error:''};const props={link:{id:link,playerName:'Jenson'},themeTokens:theme.tokens,isOffline:offline,onOpenLink:(...args)=>window.links.push(args),onOpenResource:(event,resource)=>window.opens.push({id:event.id,startsAt:event.startsAt,resource:resource.id})};
return <ParentThemeContext.Provider value={{palette:createParentAppPalette(theme.tokens),styles:createParentAppStyles(theme.tokens)}}><View style={{padding:16,backgroundColor:theme.tokens.portalBackground,minHeight:'100%'}}>{tab==='home'?<HomeScreen {...props} calendar={resource} matches={{items:[]}} messages={{items:[]}} notifications={{items:[]}} homeModel={{nextActivity:items.length?{type:'calendar',item:items[0]}:null,upcomingCalendarEvents:items.slice(1),recentMatches:[]}}/>:<CalendarScreen {...props} upcomingOnly resource={resource}/>}</View></ParentThemeContext.Provider>}
createRoot(document.getElementById('root')).render(<Preview/>);`
const result=await build({stdin:{contents:entry,resolveDir:root,loader:'jsx'},bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx','.ttf':'dataurl'},platform:'browser',conditions:['browser'],mainFields:['browser','module','main'],resolveExtensions:['.web.tsx','.web.ts','.web.js','.tsx','.ts','.jsx','.js','.json'],nodePaths:[modules],alias:{'react-native':path.join(modules,'react-native-web'),react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom')},define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'},banner:{js:'globalThis.process={env:{NODE_ENV:"production"}};'}})
const browser=await chromium.launch({headless:true})
try{const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)});await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><div id="root"></div></body></html>');await page.addScriptTag({content:result.outputFiles[0].text});await mkdir('output/playwright/parent-event-details',{recursive:true});
for(const tab of ['home','calendar']){await page.evaluate(tab=>window.tab(tab),tab);for(const name of ['Training','Meeting','Club event']){await page.getByRole('button',{name,exact:true}).click();await page.getByRole('heading',{name,exact:true}).waitFor();assert.ok(await page.getByText('Back Ln, Great Cambourne, Cambourne, Cambridge CB23 6FY',{exact:true}).isVisible());assert.ok(await page.getByText(/Review the attached training schedule/).isVisible());assert.equal(await page.getByRole('button',{name:/^(Edit|Cancel|Delete) event$/}).count(),0);await page.getByRole('button',{name:'Open Training schedule',exact:true}).click();await page.getByRole('button',{name:'Get directions',exact:true}).click();await page.getByRole('button',{name:tab==='home'?'Back to Home':'Back to Calendar',exact:true}).click();}}
assert.equal((await page.evaluate(()=>window.opens)).length,6);assert.equal((await page.evaluate(()=>window.links)).length,6);assert.equal((await page.evaluate(()=>window.opens[0])).resource,'resource-0');
await page.getByRole('button',{name:'Training',exact:true}).click();await page.evaluate(()=>window.player('player-2'));await page.getByRole('button',{name:'Training',exact:true}).waitFor();
await page.getByRole('button',{name:'Training',exact:true}).click();await page.evaluate(()=>window.offline(true));await page.waitForFunction(()=>[...document.querySelectorAll('[role=button][aria-disabled=true]')].some(button=>button.textContent.includes('Training schedule')));assert.equal(await page.getByRole('button',{name:'Open Training schedule',exact:true}).isDisabled(),true);
for(const mode of ['light','dark']){await page.evaluate(mode=>window.mode(mode),mode);for(const width of [320,390]){await page.setViewportSize({width,height:844});await page.screenshot({path:'output/playwright/parent-event-details/'+mode+'-'+width+'.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)}}
await page.evaluate(()=>window.clear());await page.getByRole('heading',{name:'Calendar',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Open Training schedule',exact:true}).count(),0);assert.deepEqual(errors,[]);console.log('PASS: actual Home and Calendar open training, meetings and events without invitations; full read-only details, scoped attachments, directions, player reset, revocation, offline and 320/390px light/dark verified')
}finally{await browser.close()}
