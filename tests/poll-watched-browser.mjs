import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const root=process.cwd(),modules=path.join(root,'apps/coach-mobile/node_modules'),output='output/playwright/poll-watched';await mkdir(output,{recursive:true});
const mobile=await readFile('apps/parent-mobile/App.js','utf8');const screen=mobile.slice(mobile.indexOf('function PollsScreen('),mobile.indexOf('\nfunction SyncStatus('));
const web=await readFile('src/pages/ParentPollsPage.jsx','utf8');const helpers=web.slice(web.indexOf('const eyebrowClass'),web.indexOf('export function ParentPollsPage'));const card=web.slice(web.indexOf('function ParentPollCard('));
const entry=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {View,Text,Pressable} from 'react-native';
import {requiresWatchedMatch} from './src/lib/poll-watched-match.js';
import {canSubmitParentPoll,getPollDraftOption,rankParentPollResults} from './apps/parent-mobile/src/parentExperience.js';
const styles={bodyText:{color:'#142b25',fontSize:16},screenStack:{gap:12},cardTitle:{fontSize:22,fontWeight:'700'},optionButton:{minHeight:48,flexDirection:'row',gap:10,alignItems:'center'},optionButtonDisabled:{opacity:0.4}};
const useParentTheme=()=>({styles});const normalizeText=v=>String(v||'');const formatDateTime=v=>v;
const ResourceError=()=>null,LoadingPanel=()=>null,LoadingLine=()=>null,EmptyPanel=()=>null;
const Badge=({label})=><Text>{label}</Text>;const ScreenIntro=({title})=><Text>{title}</Text>;
const PrimaryAction=({disabled,loading,label,onPress})=><button disabled={disabled||loading} onClick={onPress}>{label}</button>;
const CompactIconAction=PrimaryAction;
${screen}
${helpers}
${card}
const base={id:'poll',title:'Player of the Match',pollType:'awards',status:'open',requiresWatchedMatch:true,allowVoteChanges:true,options:[{id:'alex',label:'Alex'},{id:'blake',label:'Blake'}],votes:[]};
function App(){const [mode,setMode]=useState('mobile');window.mode=setMode;const [ordinary,setOrdinary]=useState(false);window.ordinary=setOrdinary;const [link,setLink]=useState('link');window.link=setLink;const [drafts,setDrafts]=useState({});const poll=ordinary?{...base,id:'ordinary',title:'Transport',pollType:'text',requiresWatchedMatch:false}:base;const onSubmit=(...args)=>{window.votes=[...(window.votes||[]),args]};return <main style={{padding:20,fontFamily:'Arial'}}>{mode==='mobile'?<PollsScreen drafts={drafts} link={{id:link,playerName:'Alex'}} onDraftChange={(id,v)=>setDrafts({...drafts,[id]:v})} onSubmit={onSubmit} resource={{items:[poll]}}/>:<ParentPollCard poll={poll} selectedLink={{id:link}} onVote={onSubmit}/>}</main>};createRoot(document.getElementById('root')).render(<App/>);`;
const result=await build({stdin:{contents:entry,resolveDir:root,loader:'jsx'},bundle:true,write:false,jsx:'automatic',platform:'browser',loader:{'.js':'jsx'},nodePaths:[modules],alias:{'react-native':path.join(modules,'react-native-web'),react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom')},define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'}});
const browser=await chromium.launch();try {const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setContent('<div id="root"></div>');await page.addScriptTag({content:result.outputFiles[0].text});
for(const mode of ['mobile','web']){await page.evaluate(mode=>{window.mode(mode);window.link('link');window.ordinary(false);window.votes=[]},mode);const checkbox=page.getByRole('checkbox',{name:'I watched the match'});await checkbox.waitFor();assert.equal(await checkbox.getAttribute('aria-checked')==='true'||await checkbox.isChecked(),false);
 if(mode==='mobile')assert.equal(await page.getByRole('button',{name:'Submit response',exact:true}).isDisabled(),true);else assert.equal(await page.getByRole('button',{name:'Vote',exact:true}).first().isDisabled(),true);
 await checkbox.click();if(mode==='mobile'){await page.getByRole('radio').first().click();await page.getByRole('button',{name:'Submit response',exact:true}).click()}else await page.getByRole('button',{name:'Vote',exact:true}).first().click();assert.equal(await page.evaluate(()=>window.votes[0][2]),true);
 await page.screenshot({path:output+'/'+mode+'.png',fullPage:true});await page.evaluate(()=>window.link('another-link'));assert.equal(await checkbox.isChecked(),false);
 await page.evaluate(()=>window.ordinary(true));await page.getByText('Transport',{exact:true}).waitFor();assert.equal(await page.getByRole('checkbox',{name:'I watched the match'}).count(),0);
 if(mode==='mobile'){await page.getByRole('radio').first().click();await page.getByRole('button',{name:'Submit response',exact:true}).click()}else await page.getByRole('button',{name:'Vote',exact:true}).first().click();assert.equal(await page.evaluate(()=>window.votes.at(-1)[2]),false);
}
assert.deepEqual(errors,[]);console.log('PASS: Mobile and web match confirmation gates voting, resets per player link and leaves ordinary polls unchanged.');}finally{await browser.close()}
