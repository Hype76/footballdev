import assert from 'node:assert/strict'
import test from 'node:test'
import {readdir,readFile} from 'node:fs/promises'
const functionsRoot=new URL('../netlify/functions/',import.meta.url)
async function sources(dir,prefix='') {const result=[];for(const e of await readdir(dir,{withFileTypes:true})){if(e.isDirectory()) result.push(...await sources(new URL(`${e.name}/`,dir),`${prefix}${e.name}/`));else if(/\.(?:[cm]?js|ts)$/.test(e.name))result.push([`${prefix}${e.name}`,await readFile(new URL(e.name,dir),'utf8')])}return result}
const sendRoutes={
 'calendar-change-notifications.js':'parent','create-fan-account.js':'delegate:lib/_fan-account.js','create-parent-account.js':'parent','email-diagnostics.js':'both','fans.js':'parent','lib/_fan-account.js':'parent','lib/_squad-decision-notifications.js':'parent','platform-club-access.js':'coach','platform-create-club.js':'coach','process-billing-access-reminders.js':'coach','retry-failed-emails.js':'parent','send-contact-request.js':'both','send-demo-request.js':'both','send-parent-email.js':'parent','send-parent-password-reset.js':'parent','send-parent-portal-invite.js':'parent','send-password-reset.js':'dynamic','send-poll-result-notifications.js':'parent','send-staff-invite.js':'coach','submit-tester-feedback.js':'both',
}
test('every production email-provider caller has an audited app audience or explicit delegate',async()=>{
 const files=await sources(functionsRoot)
 const actual=files.filter(([name,s])=>name!=='lib/_email-provider.js'&&/import\s*\{[^}]*\bsendEmail\b[^}]*\}\s*from\s*['"][^'"]*_email-provider\.js['"]/.test(s)).map(([name])=>name).sort()
 const expected=Object.keys(sendRoutes).filter(n=>n!=='lib/_fan-account.js').sort()
 assert.deepEqual(actual,expected,'A new provider caller needs audience classification in this independent inventory.')
 for(const [name,role]of Object.entries(sendRoutes)){
  const code=files.find(([n])=>n===name)?.[1];assert.ok(code,name)
  if(role.startsWith('delegate:')){assert.ok(code.includes('_fan-account.js'));continue}
  assert.match(code,/emailAppRole/,`${name} must preserve app audience at its send boundary`)
  if(role!=='dynamic')assert.match(code,new RegExp(`emailAppRole\\s*:\\s*['"]${role}['"]`),`${name} app audience differs from the audited recipient role`)
 }
})
test('Resend transport has one boundary and queue processors reach it through prepared parent dispatch',async()=>{
 const files=await sources(functionsRoot)
 const transports=files.filter(([,s])=>/\.emails\.send\s*\(|api\.resend\.com\/emails|from ['"](?:nodemailer|@sendgrid\/mail|postmark)['"]/.test(s)).map(([n])=>n)
 assert.deepEqual(transports,['lib/_email-provider.js'])
 assert.match(files.find(([n])=>n==='process-scheduled-emails.js')[1],/await sendPreparedParentEmail\(/)
 assert.match(files.find(([n])=>n==='send-scheduled-emails.js')[1],/await processScheduledEmails\(/)
 for(const name of ['notify-match-day-squad.mjs','process-squad-decision-notifications.mjs']) assert.match(files.find(([n])=>n===name)[1],/deliverSquadDecisionNotifications/)
})
test('billing reminder sends the owner a Coach-targeted payload without changing its billing action',async()=>{
 process.env.VITE_SUPABASE_URL||='https://fixture.supabase.test';process.env.SUPABASE_SERVICE_ROLE_KEY||='fixture-only-service-key';process.env.VITE_SUPABASE_PUBLISHABLE_KEY||='fixture-key'
 const {processBillingAccessReminders}=await import('../netlify/functions/process-billing-access-reminders.js')
 const workspace={id:'synthetic-club',name:'Synthetic Club',plan_key:'single_team',plan_status:'pending',billing_start_at:'2026-10-25T00:00:00.000Z',workspace_owner_user_id:'synthetic-owner'}
 const client={from(table){let operation='read';const q={select(){return q},eq(){return q},is(){return q},not(){return q},gte(){return q},order(){return q},in(){return q},upsert(){operation='insert';return q},update(){operation='update';return q},maybeSingle(){return q},then(resolve){return Promise.resolve({data:table==='clubs'?[workspace]:table==='user_club_memberships'?[{auth_user_id:'synthetic-owner',email:'owner@example.test',status:'active',role:'team_admin',role_rank:60}]:operation==='insert'?{id:'reminder',status:'pending',attempt_count:0}:{id:'reminder',attempt_count:1},error:null}).then(resolve)}};return q}}
 const sent=[];const result=await processBillingAccessReminders({client,now:new Date('2026-10-18T12:00:00Z'),sendEmailImpl:async(payload)=>{sent.push(payload);return{id:'synthetic-send'}}})
 assert.equal(result.sent,1);assert.equal(sent[0].emailAppRole,'coach');assert.deepEqual(sent[0].to,['owner@example.test']);assert.match(sent[0].text,/footballplayer.online\/billing/)
})
