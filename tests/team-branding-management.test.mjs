import assert from 'node:assert/strict'
import test from 'node:test'
import { createTeamBrandingManagementHandler } from '../netlify/functions/lib/_team-branding-management.js'
import { getScopedTeamBranding, loadTeamBrandingDisplay } from '../src/lib/team-branding-display.js'
import { resolveCoachBranding } from '../apps/coach-mobile/src/coachThemeCore.js'
import { resolveParentMobileBranding } from '../apps/mobile-core/src/parentThemeCore.js'
import { resolveParentPortalBranding } from '../src/lib/parent-portal-branding.js'
import { buildCompletedReportBranding } from '../src/lib/matchday-report-export.js'

const teamId='30000000-0000-4000-8000-000000000040',clubId='10000000-0000-4000-8000-000000000001'
const actorId='20000000-0000-4000-8000-000000000001'
function fixture({ enabled=true, logoAllowed=true, coloursAllowed=true, denied=false }={}) {
  const calls=[]
  const client={
    auth:{getUser:async()=>({data:{user:{id:actorId,email_confirmed_at:'2026-01-01T00:00:00Z'}}})},
    from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{id:teamId,club_id:clubId}})})})}),
    rpc:async(name,args)=>{ calls.push({name,args}); return denied ? {error:{code:'42501'}} : {data:
      name==='read_first_250_team_branding_management'?{enabled,logoAllowed,coloursAllowed,termsVersion:'v1'}:
        name==='claim_first_250_branding_team'?40:name==='read_branding_offer_counter'?{status:'not_active'}:true} },
    storage:{from:()=>({upload:async(path)=>{calls.push({upload:path});return{}},getPublicUrl:path=>({data:{publicUrl:`https://storage.test/storage/v1/object/public/club-logos/${path}`}})})},
  }
  return { calls, handler:createTeamBrandingManagementHandler({client,validateLogo:async()=>({buffer:Buffer.from('validated-png'),contentType:'image/png'})}) }
}
const event=(body,headers={authorization:'Bearer synthetic'})=>({httpMethod:'POST',headers,body:JSON.stringify({teamId,...body})})
test('adapter derives actor and club, rejects supplied authority/timestamps/counts, and keeps OFF mutations dormant',async()=>{
  const {handler,calls}=fixture()
  for(const field of ['actorId','clubId','startedAt','completedMatches','paidClubBrandingEligible']) assert.equal((await handler(event({action:'claim',termsVersion:'v1',[field]:'forged'}))).statusCode,400)
  assert.equal(calls.length,0)
  assert.equal((await handler(event({action:'claim',termsVersion:'v1'},{}))).statusCode,401)
  assert.equal((await handler(event({action:'claim',termsVersion:'v1'}))).statusCode,200)
  assert.deepEqual(calls.find(c=>c.name==='claim_first_250_branding_team').args,{actor_value:actorId,team_value:teamId,club_value:clubId,terms_value:'v1'})
  const off=fixture({enabled:false})
  assert.deepEqual(JSON.parse((await off.handler(event({action:'claim',termsVersion:'v1'}))).body),{enabled:false})
  assert.equal(off.calls.length,1)
})
test('upload checks authority and logo/colour gates independently before storage; paths come from validated bytes',async()=>{
  const body={action:'save',dataBase64:Buffer.from('source').toString('base64'),mimeType:'image/png',fileName:'logo.png'}
  const blocked=fixture({logoAllowed:false})
  assert.equal((await blocked.handler(event(body))).statusCode,403);assert(!blocked.calls.some(c=>c.upload))
  const denied=fixture({denied:true});assert.equal((await denied.handler(event(body))).statusCode,403);assert(!denied.calls.some(c=>c.upload))
  const allowed=fixture({coloursAllowed:false})
  assert.equal((await allowed.handler(event(body))).statusCode,200)
  assert.match(allowed.calls.find(c=>c.upload).upload,new RegExp(`^teams/${teamId}/logos/[a-f0-9]{64}\\.png$`))
  assert.equal(allowed.calls.find(c=>c.name==='save_first_250_team_branding').args.accent_value,null)
  assert.equal((await allowed.handler(event({action:'save',accent:'#047857'}))).statusCode,403)
})
test('extension passes only authenticated actor and audit reason to the existing admin-only RPC',async()=>{
  const {handler,calls}=fixture()
  assert.equal((await handler(event({action:'extend',reason:'Support approval'}))).statusCode,200)
  assert.deepEqual(calls.find(c=>c.name==='extend_branding_offer_team').args,{team_id_value:teamId,club_id_value:clubId,actor_id_value:actorId,reason_value:'Support approval'})
})
const payload={teamId,clubId,source:'team',logoAllowed:true,coloursAllowed:true,logoUrl:'https://storage.test/logo.png',accent:'#123456',buttonStyle:'solid'}
test('Coach and Parent consumers share exact scope and separate grants without upgrading the plan',()=>{
  const context={teamId,clubId,planKey:'matchday',teamBrandingDisplay:payload}
  assert.equal(resolveCoachBranding(context).logoUrl,payload.logoUrl)
  assert.equal(resolveParentMobileBranding(context).accent,payload.accent)
  assert.equal(resolveParentPortalBranding({selectedLink:context}).accent,payload.accent)
  const revoked={...context,teamBrandingDisplay:{...payload,logoAllowed:false}}
  assert.equal(resolveCoachBranding(revoked).logoUrl,'');assert.equal(resolveParentMobileBranding(revoked).accent,payload.accent)
  assert.equal(getScopedTeamBranding({...context,teamId:'another'}),null)
  assert.equal(context.planKey,'matchday')
  const expired={...context,teamBrandingDisplay:{...payload,expiresAt:'2020-01-01T00:00:00Z',baseLogoAllowed:false,baseColoursAllowed:false}}
  assert.equal(resolveCoachBranding(expired).logoUrl,'');assert.equal(resolveParentMobileBranding(expired).accent,'green')
})
test('missing migration preserves baseline, denied or malformed display clears the scoped grant',async()=>{
  const context={teamId,clubId,planKey:'matchday'}
  assert.equal(await loadTeamBrandingDisplay({rpc:async()=>({error:{code:'PGRST202'}})},context),context)
  const denied=await loadTeamBrandingDisplay({rpc:async()=>({error:{code:'42501'}})},context)
  assert.equal(denied.teamBrandingDisplay.logoAllowed,false)
  const malformed=await loadTeamBrandingDisplay({rpc:async()=>({data:{...payload,teamId:'another'}})},context)
  assert.equal(malformed.teamBrandingDisplay.coloursAllowed,false)
})
test('PDF discards cached badge aliases, preserves authorised colour and rejects cross-team display',()=>{
  const context={teamId,clubId,planKey:'matchday',teamBrandingDisplay:payload}
  const match={teamId,clubId,clubName:'Synthetic',teamName:'Synthetic',matchDate:'2026-10-03',clubLogoData:'cached-wrong-team',club_logo_data:'cached-wrong-team'}
  const branding=buildCompletedReportBranding(match,{accessContext:context})
  assert.equal(branding.clubLogoData,'');assert.equal(branding.primaryColour,'#123456')
  assert.throws(()=>buildCompletedReportBranding({...match,teamId:'another'},{accessContext:context}),/authorised team/)
})
