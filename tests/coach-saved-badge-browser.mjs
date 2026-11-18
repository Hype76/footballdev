import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import path from 'node:path'
const modules=path.resolve('apps/coach-mobile/node_modules')
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import{useCoachSavedBadge}from'./apps/coach-mobile/src/useCoachSavedBadge.js';
const remote='https://example.test/logo.png';const expiry=new Date(Date.now()+2500).toISOString();
const context={id:'team:t',teamId:'t',clubId:'club',authorityId:'a',authoritySource:'team_staff',role:'coach',teamBrandingDisplay:{teamId:'t',clubId:'club',source:'team',logoAllowed:true,baseLogoAllowed:false,coloursAllowed:false,baseColoursAllowed:false,logoUrl:remote,expiresAt:expiry}};
function App(){const[id,setId]=React.useState('one');window.switchAccount=()=>setId('two');const user=React.useMemo(()=>({id}),[id]);const logo=useCoachSavedBadge(user,context,remote);return <div data-testid="logo">{logo}</div>};createRoot(document.getElementById('root')).render(<App/>);`
const result=await build({stdin:{contents:entry,resolveDir:process.cwd(),loader:'jsx'},bundle:true,write:false,jsx:'automatic',loader:{'.js':'jsx'},alias:{react:path.join(modules,'react'),'react-dom':path.join(modules,'react-dom'),'react-native':path.join(modules,'react-native-web')},define:{'process.env.NODE_ENV':'"production"',__DEV__:'false',global:'globalThis'},plugins:[{name:'badge-service',setup(b){b.onResolve({filter:/coachAccountOfflineService$/},()=>({path:'badge',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:`export const resolveCoachSavedBadge=async user=>{if(user.id==='one')await new Promise(resolve=>{window.releaseOld=resolve});return 'data:image/png;base64,'+user.id}`,loader:'js'}))}}]})
const browser=await chromium.launch({headless:true})
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message))
 await page.setContent('<div id="root"></div>');await page.addScriptTag({content:result.outputFiles[0].text})
 await page.waitForFunction(()=>typeof window.releaseOld==='function')
 await page.evaluate(()=>window.switchAccount())
 await page.getByTestId('logo').getByText('data:image/png;base64,two').waitFor()
 await page.evaluate(()=>window.releaseOld())
 await page.waitForTimeout(50)
 assert.equal(await page.getByTestId('logo').textContent(),'data:image/png;base64,two')
 await page.waitForFunction(()=>document.querySelector('[data-testid="logo"]').textContent==='',{timeout:5000})
 assert.deepEqual(errors,[])
 console.log('PASS: actual badge hook uses cached image, rejects delayed prior-account result and removes image on branding expiry.')
}finally{await browser.close()}
