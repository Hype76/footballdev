/* eslint-disable */
/* Ported trusted v70 reference; DOM and lifecycle access are scoped by React. */
export default function mountReference(scope) {
const { document, window, fetch, addEventListener, matchMedia, IntersectionObserver, setTimeout, clearTimeout, setInterval, clearInterval } = scope;
const menu=document.querySelector('.menu-toggle');
const nav=document.querySelector('.main-nav');
function closeMenu(){menu?.setAttribute('aria-expanded','false');nav?.classList.remove('open')}
menu?.addEventListener('click',()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));nav.classList.toggle('open',open)});
nav?.querySelectorAll('a').forEach(a=>a.addEventListener('click',closeMenu));
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu()});

const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
if(!reduced&&'IntersectionObserver' in window){document.documentElement.classList.add('js-motion');const io=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('visible');io.unobserve(e.target)}}),{threshold:.08});document.querySelectorAll('.reveal').forEach(el=>io.observe(el))}
const progress=document.querySelector('.scroll-progress');
function updateProgress(){const height=document.documentElement.scrollHeight-innerHeight;if(progress)progress.style.width=(height>0?scrollY/height*100:0)+'%'}
addEventListener('scroll',updateProgress,{passive:true});addEventListener('resize',updateProgress);updateProgress();

const views={coach:{image:'coach-light.png',alt:'Coach home with next session, next match and team activity',kind:'mobile',title:'Know what needs your attention.',copy:'See the next session, the next match and outstanding availability from your team home.'},parent:{image:'parent-matchday.png',alt:'Parent match details with venue, kit and player availability',kind:'mobile',title:'The plan, without the guesswork.',copy:'Parents see the fixture, arrival time, kit and availability for their linked player.'},club:{image:'club-teams-light.png',alt:'Club workspace with team structure and coach access controls in light mode',kind:'desktop',title:'A shared home for your teams.',copy:'Club tools and team access keep the organisation connected while each squad gets on with its football.'}};
document.querySelectorAll('.feature-layout').forEach(section=>{section.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{const view=views[button.dataset.view];section.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));const img=section.querySelector('[data-view-image]');img.src='/marketing-v70/assets/'+view.image;img.alt=view.alt;img.className=view.kind;section.querySelector('[data-view-kind]').dataset.viewKind=view.kind;section.querySelector('[data-view-title]').textContent=view.title;section.querySelector('[data-view-copy]').textContent=view.copy;const caption=section.querySelector('[data-view-caption]');if(caption)caption.textContent=view.kind==='desktop'?'Screens from Football Player in a web browser':'Screens from the Football Player mobile app'}))});

const screens={"setup-team":["setup-team.png","Create a team account with team name and sign-in details"], "setup-players":["setup-players.png","Add a player with squad details and parent contact options"], "setup-fixture":["setup-fixture.png","Create a match fixture with team, opponent and fixture type"], "setup-squad":["setup-squad.png","Select the matchday squad and choose who receives notifications"], "setup-game":["setup-game.png","Game Mode live controller with score, match timer and match event controls"], "setup-conclude":["setup-conclude.png","Confirm the final result to conclude a match"],coach:['coach-light.png','Coach team home'],squad:['lineup-mobile.png','Match squad and formation'],fixture:['fixture-mobile.png','Match details with arrival time, venue and kit'],live:['live-mobile.png','Game Mode live event controls'],alerts:['match-notifications.png','Football Player match alert notifications']};
// Keep the selected screenshot beside its step on phones, rather than below the whole list.
document.querySelectorAll('.walkthrough').forEach(walkthrough=>{
 const buttons=[...walkthrough.querySelectorAll('[data-walk]')];
 const visual=walkthrough.querySelector('.walk-visual');
 if(!visual||!buttons.length)return;
 const originalParent=visual.parentElement;
 const mobile=window.matchMedia('(max-width: 620px)');
 visual.id='walkthrough-preview';
 visual.setAttribute('role','region');
 visual.setAttribute('aria-label','Selected setup screenshot');
 let selected=buttons.find(button=>button.getAttribute('aria-pressed')==='true')||buttons[0];
 function placePreview(){
  buttons.forEach(button=>{
   button.setAttribute('aria-controls',visual.id);
   if(mobile.matches)button.setAttribute('aria-expanded',String(button===selected));
   else button.removeAttribute('aria-expanded');
  });
  if(mobile.matches)selected.after(visual);
  else originalParent.append(visual);
 }
 buttons.forEach(button=>button.addEventListener('click',()=>{
  selected=button;
  buttons.forEach(other=>other.setAttribute('aria-pressed',String(other===button)));
  const [file,alt]=screens[button.dataset.walk];
  const img=visual.querySelector('[data-walk-image]');
  img.src='/marketing-v70/assets/'+file;img.alt=alt;
  visual.querySelector('[data-walk-caption]').textContent=button.dataset.caption;
  placePreview();
  // Moving the previous panel can shift a later step above the viewport.
  if(mobile.matches)button.scrollIntoView({block:'start',behavior:'instant'});
 }));
 mobile.addEventListener('change',placePreview);
 placePreview();
});

const demo=document.querySelector('[data-demo]');
if(demo){
 const squad=[[1,'Oliver Reed','Goalkeeper'],[4,'Noah Brooks','Defender'],[7,'Maya Collins','Midfielder'],[8,'Leo Bennett','Midfielder'],[9,'Alex Morgan','Forward'],[10,'Amelia Shaw','Forward'],[11,'Theo Clarke','Winger'],[14,'Isla Parker','Winger']];
 const notifications=demo.querySelector('[data-notifications]'),original=notifications.innerHTML,picker=demo.querySelector('.scorer-picker'),screen=demo.querySelector('[data-scorer-screen]'),goal=demo.querySelector('[data-event="goal"]'),parent=demo.querySelector('.parent-device');
 const feedback=demo.querySelector('[data-demo-feedback]'),buttons=[...demo.querySelectorAll('[data-event]')];
 // A tab-local first-use hint, never a visitor identifier or network event.
 const goalCueKey='fp-demo-goal-used-v1';
 let goalUsed=false;
 try{goalUsed=sessionStorage.getItem(goalCueKey)==='1'}catch{}
 goal.classList.toggle('goal-first-use',!goalUsed);
 function dismissGoalCue(){
  goal.classList.remove('goal-first-use');
  if(goalUsed)return;
  goalUsed=true;
  try{sessionStorage.setItem(goalCueKey,'1')}catch{}
 }
 let home=0,away=0,phase='first',minute=23;
 function update(){demo.querySelector('[data-score]').textContent=`${home} : ${away}`;demo.querySelector('[data-match-phase]').textContent=phase==='finished'?'Full-time':phase==='half'?'Half-time':`${phase==='first'?'First':'Second'} half · ${minute}′`;demo.querySelector('[data-half-label]').textContent=phase==='half'?'Second half':'Half-time';buttons.forEach(button=>button.disabled=phase==='finished'||(phase==='half'&&['goal','opposition'].includes(button.dataset.event))||(phase==='second'&&button.dataset.event==='half'))}
 function closePicker(restore=true){picker.hidden=true;screen.inert=false;goal.setAttribute('aria-expanded','false');if(restore)goal.focus()}
 function notify(title,copy){
  const alert=document.createElement('div');alert.className='notification pop';const logo=document.createElement('img');logo.src='/marketing-v70/assets/fp-logo.png';logo.alt='';const body=document.createElement('div'),heading=document.createElement('div');heading.className='notification-head';const brand=document.createElement('strong');brand.textContent='Football Player';const time=document.createElement('span');time.textContent='now';heading.append(brand,time);const text=document.createElement('p'),bold=document.createElement('b');bold.textContent=title;text.append(bold,document.createElement('br'),document.createTextNode(copy));body.append(heading,text);alert.append(logo,body);notifications.querySelector('.notification-placeholder')?.remove();notifications.prepend(alert);while(notifications.children.length>3)notifications.lastElementChild.remove();
  if(matchMedia('(max-width: 700px)').matches){parent.focus({preventScroll:true});parent.scrollIntoView({behavior:reduced?'auto':'smooth',block:'center'})}
 }
 squad.forEach(([number,name,position])=>{const button=document.createElement('button');button.type='button';button.className='squad-player';const shirt=document.createElement('span');shirt.className='squad-shirt';shirt.textContent=number;const detail=document.createElement('span'),playerName=document.createElement('strong'),role=document.createElement('small');playerName.textContent=name;role.textContent=position;detail.append(playerName,role);button.append(shirt,detail);button.setAttribute('aria-label',`${name}, shirt ${number}`);button.addEventListener('click',()=>{if(picker.hidden||phase==='finished'||phase==='half')return;home++;closePicker();update();feedback.textContent=`Goal recorded for ${name}.`;notify('Goal update',`${name} scored for Riverside U14 (${minute}′). Riverside U14 v Oakfield U14. Score ${home} - ${away}.`)});demo.querySelector('[data-demo-squad]').append(button)});
 goal.setAttribute('aria-expanded','false');
 buttons.forEach(button=>button.addEventListener('click',()=>{
  if(phase==='finished')return;const type=button.dataset.event;
  if(type==='goal'){if(phase==='half')return;dismissGoalCue();picker.hidden=false;screen.inert=true;goal.setAttribute('aria-expanded','true');picker.querySelector('[data-cancel-scorer]').focus();return}
  if(type==='opposition'){if(phase==='half')return;away++;feedback.textContent='Goal recorded for Oakfield U14.';notify('Opposition goal',`Oakfield U14 scored (${minute}′). Riverside U14 v Oakfield U14. Score ${home} - ${away}.`)}
  if(type==='half'){if(phase==='first'){phase='half';minute=40;feedback.textContent='Half-time recorded.';notify('Half-time',`It is half-time for Riverside U14 v Oakfield U14. Score ${home} - ${away}.`)}else if(phase==='half'){phase='second';minute=41;feedback.textContent='Second half started.';notify('Second half started',`The second half has started for Riverside U14 v Oakfield U14. Score ${home} - ${away}.`)}}
  if(type==='full'){phase='finished';feedback.textContent='Full-time. Ready for the coach to review.';notify('Full time',`The match is full time for Riverside U14 v Oakfield U14. Score ${home} - ${away}.`)}
  update();
 }));
 picker.querySelector('[data-cancel-scorer]').addEventListener('click',()=>closePicker());
 picker.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closePicker()}});
 demo.querySelector('[data-reset]').addEventListener('click',()=>{home=0;away=0;phase='first';minute=23;closePicker(false);notifications.innerHTML=original;feedback.textContent='Try recording a goal.';update()});
 demo.querySelector('[data-back-scoring]').addEventListener('click',()=>{const target=goal.disabled?demo.querySelector('[data-event="half"]'):goal;(target.disabled?demo.querySelector('[data-reset]'):target).focus({preventScroll:true});demo.querySelector('.scorer-device').scrollIntoView({behavior:reduced?'auto':'smooth',block:'center'})});
}


document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));let count=0;document.querySelectorAll('[data-category]').forEach(row=>{const show=button.dataset.filter==='all'||row.dataset.category===button.dataset.filter;row.hidden=!show;if(show)count++});document.querySelector('[data-filter-status]').textContent=`Showing ${count} ${count===1?'area':'areas'}. On a phone, swipe across the table to compare providers.`}));

async function loadStats(){const els=document.querySelectorAll('[data-stat]');if(!els.length)return;const status=document.querySelector('[data-stats-status]');let stats=null;try{const stored=JSON.parse(sessionStorage.getItem('fp-v3-stats')||'null');if(stored&&Date.now()-stored.cachedAt<300000)stats=stored.data}catch{}
try{if(!stats){const config=window.FP_STATS;if(!config)throw Error('No configuration');const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),10000);try{const response=await fetch(config.endpoint,{headers:{apikey:config.key},signal:controller.signal});if(!response.ok)throw Error('Unavailable');[stats]=await response.json();if(!stats)throw Error('No totals')}finally{clearTimeout(timeout)}try{sessionStorage.setItem('fp-v3-stats',JSON.stringify({data:stats,cachedAt:Date.now()}))}catch{}}
els.forEach(el=>{const raw=stats[el.dataset.stat];const n=(typeof raw==='number'||(typeof raw==='string'&&raw.trim()!==''))?Number(raw):NaN;const valid=Number.isInteger(n)&&n>=0;el.toggleAttribute('data-unavailable',!valid);el.textContent=valid?new Intl.NumberFormat('en-GB').format(n):'Unavailable'});const date=new Date(stats.updated_at);status.textContent='Football Player activity'+(Number.isNaN(date.getTime())?'':' · Updated '+new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/London',timeZoneName:'short'}).format(date));}catch{els.forEach(el=>{el.setAttribute('data-unavailable','');el.textContent='Unavailable'});status.textContent='Activity totals are temporarily unavailable. Please try again later.'}}
loadStats();

}
