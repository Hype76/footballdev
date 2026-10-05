import assert from 'node:assert/strict'
import path from 'node:path'
import {readFileSync} from 'node:fs'
const fsImage=readFileSync('apps/mobile-core/assets/formation-shirt-white.png')
import { build } from 'esbuild'
import { chromium } from 'playwright'

const root=process.cwd(), modules=path.join(root,'apps/coach-mobile/node_modules')
const entry=`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {ClubKitDisplay} from './apps/mobile-core/src/ClubKitDisplay.js';
function App(){
 const [context,setContext]=React.useState({planKey:'team',clubId:'a',teamId:'t'});
 const [choice,setChoice]=React.useState('home');
 window.setContext=setContext;window.setChoice=setChoice;
 return <div style={{width:110}}><ClubKitDisplay compact clubId={context.clubId} teamId={context.teamId} kitContext={context} shirtChoice={choice} textStyle={{color:'#111111'}} /></div>;
}
createRoot(document.getElementById('root')).render(<App/>);
`
const cache=`
import {mergeTeamKits} from './src/lib/team-kits.js';
const clubs={a:{home:{colour:'#111111',imagePath:'a/home.png'},away:{colour:'#ffffff',imagePath:'a/away.png'}},b:{home:{colour:'#123456',imagePath:'b/home.png'}}};
const team={home:{colour:'#ff0000',source:'team',imagePath:null},away:{colour:'#00ff00',source:'team',imagePath:null}};
export function peekMobileClubKits(id){return clubs[id]||{}};
export function peekMobileTeamKits(id,teamId,context){return mergeTeamKits(team,clubs[id]||{},context)};
export async function loadMobileClubKits(id,publish){const kits=clubs[id]||{};publish?.(kits);return kits};
export async function loadMobileTeamKits(id,teamId,publish,supplied,context){
 const kits=mergeTeamKits(team,clubs[id]||{},context);await new Promise(r=>setTimeout(r,50));publish?.(kits);return kits;
};
`
const result=await build({
 stdin:{contents:entry,resolveDir:root,loader:'jsx'},bundle:true,write:false,jsx:'automatic',
 loader:{'.js':'jsx','.png':'dataurl','.ttf':'dataurl'},platform:'browser',conditions:['browser'],mainFields:['browser','module','main'],
 resolveExtensions:['.web.tsx','.web.ts','.web.js','.tsx','.ts','.jsx','.js','.json'],nodePaths:[modules],
 alias:{'react-native':path.join(modules,'react-native-web'),react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom')},
 define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'},banner:{js:'globalThis.process={env:{NODE_ENV:"production"}};'},
 plugins:[{name:'kits',setup(b){
  b.onResolve({filter:/mobileKitCache$/},()=>({path:'cache',namespace:'kit'}));
  b.onResolve({filter:/\/supabase$/},()=>({path:'supabase',namespace:'kit'}));
  b.onLoad({filter:/^cache$/,namespace:'kit'},()=>({contents:cache,loader:'js',resolveDir:root}));
  b.onLoad({filter:/^supabase$/,namespace:'kit'},()=>({contents:"export const supabase={storage:{from:()=>({getPublicUrl:path=>({data:{publicUrl:'http://localhost:9878/'+path}})})}}",loader:'js'}));
 }}],
})
const browser=await chromium.launch({headless:true})
try{
 const page=await browser.newPage({viewport:{width:320,height:640}}),errors=[]
 page.on('pageerror',error=>errors.push(error.message))
 await page.route('http://localhost:9878/**',route=>route.fulfill(route.request().url().endsWith('.png') ? {contentType:'image/png', body:fsImage} : {contentType:'text/html',body:'<html><body><div id="root"></div></body></html>'}))
 await page.goto('http://localhost:9878');await page.addScriptTag({content:result.outputFiles[0].text})
 await page.getByText('Home kit',{exact:true}).waitFor()
 assert.equal(await page.getByText('Managed by your Club Admin').count(),0)
 assert.equal(await page.getByRole('button',{name:'Enlarge home kit image'}).count(),0)
 for(const planKey of ['club','small_club','development_club','large_club','pilot']){
  await page.evaluate(planKey=>window.setContext({planKey,clubId:'a',teamId:'t',roleRank:20}),planKey)
  await page.getByText('Managed by your Club Admin').waitFor()
  await page.getByRole('button',{name:'Enlarge home kit image'}).waitFor()
  await page.locator('img[src="http://localhost:9878/a/home.png"]').waitFor()
 }
 await page.getByRole('button',{name:'Enlarge home kit image'}).click()
 await page.getByRole('button',{name:'Close kit image'}).waitFor()
 await page.evaluate(()=>window.setContext({planKey:'club',clubId:'b',teamId:'t'}))
 await page.locator('img[src="http://localhost:9878/b/home.png"]').waitFor()
 await page.getByRole('button',{name:'Close kit image'}).waitFor({state:'hidden'})
 // Return to the exact identity/scope that opened the modal, without unmounting.
 await page.evaluate(()=>window.setContext({planKey:'pilot',clubId:'a',teamId:'t',roleRank:20}))
 await page.locator('img[src="http://localhost:9878/a/home.png"]').waitFor()
 assert.equal(await page.getByRole('button',{name:'Close kit image'}).count(),0)
 await page.getByRole('button',{name:'Enlarge home kit image'}).click()
 await page.getByRole('button',{name:'Close kit image'}).waitFor()
 await page.evaluate(()=>window.setContext({planKey:'club',clubId:'b',teamId:'t'}))
 await page.locator('img[src="http://localhost:9878/b/home.png"]').waitFor()
 await page.getByRole('button',{name:'Close kit image'}).waitFor({state:'hidden'})
 await page.evaluate(()=>window.setChoice('away'))
 await page.getByText('Away kit',{exact:true}).waitFor()
 assert.equal(await page.getByRole('button',{name:'Enlarge away kit image'}).count(),0)
 await page.evaluate(()=>window.setChoice('tbc'))
 await page.getByText('Kit to be confirmed',{exact:true}).waitFor()
 await page.evaluate(()=>{window.setContext({planKey:'team',clubId:'a',teamId:'t'});window.setChoice('home')})
 await page.getByText('Home kit',{exact:true}).waitFor()
 await page.waitForTimeout(80)
 assert.equal(await page.getByText('Managed by your Club Admin').count(),0)
 assert.equal(await page.getByRole('button',{name:'Enlarge home kit image'}).count(),0)
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
 assert.deepEqual(errors,[])
 console.log('PASS: shared Coach/Parent kit display inherits uploaded club artwork, keeps standalone colours and Home/Away/TBC, handles absent kits and closes previews on scope switches.')
}finally{await browser.close()}
