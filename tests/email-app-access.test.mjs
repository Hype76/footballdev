import assert from 'node:assert/strict'
import test from 'node:test'
import {addEmailAppAccess,buildEmailAppAccess} from '../netlify/functions/lib/_email-app-access.js'
import {APP_DOWNLOAD_LINKS} from '../src/lib/app-download-links.js'
import {sendEmail} from '../netlify/functions/lib/_email-provider.js'
const occurrences=(text,value)=>text.split(value).length-1
for(const role of ['parent','coach'])test(`${role} email preserves original action and includes exactly its verified app links and QR assets`,()=>{
 const html='<html><body><h1>Your invitation</h1><a href="https://footballplayer.online/accept?token=synthetic">Accept invitation</a></body></html>'
 const result=addEmailAppAccess({to:['recipient@example.test'],subject:'Invitation',html,text:'Accept here: https://footballplayer.online/accept?token=synthetic',emailAppRole:role})
 const app=APP_DOWNLOAD_LINKS[role],other=APP_DOWNLOAD_LINKS[role==='parent'?'coach':'parent']
 assert.ok(result.html.startsWith(html.slice(0,html.indexOf('</body>'))));assert.ok(result.html.endsWith('</body></html>'))
 for(const value of [app.apple,app.android,app.web,app.appleQr,app.androidQr])assert.ok(result.html.includes(value),value)
 assert.ok(!result.html.includes(other.apple));assert.ok(result.text.startsWith('Accept here: '));assert.ok(result.text.includes(app.apple));assert.ok(result.text.includes(app.android));assert.ok(result.text.includes(app.web))
 assert.equal(occurrences(result.html,'fp-app-access:start'),1);assert.ok(!('emailAppRole' in result))
})
test('unknown or missing audience explicitly presents both apps without guessing recipient role',()=>{
 for(const role of [undefined,'','invalid']){const result=addEmailAppAccess({emailAppRole:role,html:'<p>Support</p>'});for(const key of ['parent','coach'])assert.ok(result.html.includes(APP_DOWNLOAD_LINKS[key].name));assert.equal(occurrences(result.html,'fp-app-access:start'),1)}
})
test('mixed Parent mail and Coach CC retain addresses and receive labelled app access without extra sends',async()=>{
 const calls=[];const payload={from:'Football Player <feedback@footballplayer.online>',to:['parent@example.test'],cc:['coach@example.test'],subject:'Session invite',html:'<a href="https://example.test/respond">Respond</a>',emailAppRole:'parent',emailCcAppRole:'coach'}
 await sendEmail(payload,{env:{RESEND_API_KEY:'fixture-key',RESEND_FROM_EMAIL:'feedback@footballplayer.online'},resendClient:{emails:{send:async(p,options)=>{calls.push({p,options});return{data:{id:'synthetic'}}}}},idempotencyKey:'unchanged-id'})
 assert.equal(calls.length,1);assert.deepEqual(calls[0].p.to,payload.to);assert.deepEqual(calls[0].p.cc,payload.cc);assert.equal(calls[0].options.idempotencyKey,'unchanged-id')
 assert.ok(calls[0].p.html.includes('For Coaches receiving a copy'));assert.ok(calls[0].p.html.includes(APP_DOWNLOAD_LINKS.parent.apple));assert.ok(calls[0].p.html.includes(APP_DOWNLOAD_LINKS.coach.apple));assert.ok(!('emailAppRole'in calls[0].p));assert.ok(!('emailCcAppRole'in calls[0].p));assert.equal(payload.html,'<a href="https://example.test/respond">Respond</a>')
})
test('copy footer requires actual CC and never duplicates same app role',()=>{
 const noCc=addEmailAppAccess({html:'Original',emailAppRole:'parent',emailCcAppRole:'coach'});assert.ok(!noCc.html.includes(APP_DOWNLOAD_LINKS.coach.apple))
 const same=buildEmailAppAccess({role:'parent',copyRole:'parent'});assert.equal(occurrences(same.html,'Parents, Players and Fans'),1)
})
test('repeated delivery decoration preserves body and yields one HTML and text footer',()=>{
 const original={html:'<p>Original action</p>',text:'Original action',emailAppRole:'parent'}
 const first=addEmailAppAccess(original),second=addEmailAppAccess({...first,emailAppRole:'parent'})
 assert.deepEqual(second,first);assert.equal(occurrences(second.text,'--- Football Player app access ---'),1)
 const legacy=addEmailAppAccess({html:'<p>Legacy queued invitation</p>'});assert.ok(legacy.html.includes(APP_DOWNLOAD_LINKS.parent.apple));assert.ok(legacy.html.includes(APP_DOWNLOAD_LINKS.coach.apple))
})
test('plain text billing messages gain escaped HTML while retaining their billing URL and plain text action',()=>{
 const payload=addEmailAppAccess({emailAppRole:'coach',text:'<Billing & access>\nhttps://footballplayer.online/billing'})
 assert.ok(payload.html.includes('&lt;Billing &amp; access&gt;'));assert.ok(payload.html.includes('https://footballplayer.online/billing'));assert.ok(payload.text.startsWith('<Billing & access>\nhttps://footballplayer.online/billing'));assert.ok(payload.html.includes(APP_DOWNLOAD_LINKS.coach.apple))
})
test('metadata-less rendered retries retain their audience and rebuild one current footer',()=>{
 for(const role of ['parent','coach','both']){
  const first=addEmailAppAccess({emailAppRole:role,html:'<p>Original action</p>',text:'Original action'})
  assert.deepEqual(addEmailAppAccess(first),first)
  assert.deepEqual(addEmailAppAccess({...first,emailAppRole:'unknown'}),first)
  const legacy={...first,html:first.html.replace(/<!-- fp-app-access:role=[^>]+ -->/,'')}
  assert.deepEqual(addEmailAppAccess(legacy),first)
 }
 const mixed=addEmailAppAccess({html:'Original',text:'Original',cc:['coach@example.test'],emailAppRole:'parent',emailCcAppRole:'coach'})
 assert.deepEqual(addEmailAppAccess(mixed),mixed)
})
test('text-only retries strip the existing footer before generating HTML and preserve audience',()=>{
 for(const role of ['parent','coach','both']){
  const first=addEmailAppAccess({emailAppRole:role,text:'Original billing action'})
  const retried=addEmailAppAccess({text:first.text})
  assert.deepEqual(retried,first)
  assert.equal(occurrences(retried.html,'--- Football Player app access ---'),0)
  assert.equal(occurrences(retried.text,'--- Football Player app access ---'),1)
 }
})
test('reverse copied audience is labelled correctly in both formats and retained on retry',()=>{
 const result=addEmailAppAccess({html:'Original',text:'Original',emailAppRole:'coach',emailCcAppRole:'parent',cc:['parent@example.test']})
 assert.ok(result.html.includes('For Parents, Players and Fans receiving a copy'))
 assert.ok(result.text.includes('For Parents, Players and Fans receiving a copy'))
 assert.ok(!result.html.includes('For Coaches receiving a copy'))
 assert.deepEqual(addEmailAppAccess(result),result)
 assert.deepEqual(addEmailAppAccess({text:result.text,cc:result.cc}),addEmailAppAccess({text:'Original',emailAppRole:'coach',emailCcAppRole:'parent',cc:result.cc}))
})
test('new audience metadata overrides stored audience and removed CC removes its copy footer',()=>{
 const mixed=addEmailAppAccess({html:'Original',text:'Original',emailAppRole:'parent',emailCcAppRole:'coach',cc:['coach@example.test']})
 const changed=addEmailAppAccess({...mixed,emailAppRole:'coach'})
 assert.ok(changed.html.includes(APP_DOWNLOAD_LINKS.coach.name));assert.ok(!changed.html.includes(APP_DOWNLOAD_LINKS.parent.name))
 const noCopy=addEmailAppAccess({...mixed,cc:[]})
 assert.ok(noCopy.html.includes(APP_DOWNLOAD_LINKS.parent.name));assert.ok(!noCopy.html.includes(APP_DOWNLOAD_LINKS.coach.name))
})
