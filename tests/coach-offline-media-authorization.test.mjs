import assert from 'node:assert/strict'
import test from 'node:test'

process.env.VITE_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-service'
const { createCoachOfflineMediaHandler }=await import('../netlify/functions/coach-offline-media.js')
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const userId=id(1),clubId=id(2),teamId=id(3),resourceId=id(4)

function fixture(overrides={}) {
  const signed=[],lookups=[]
  const source={id:resourceId,club_id:clubId,team_id:teamId,storage_bucket:'resource-library',storage_path:`${clubId}/${teamId}/private.pdf`,mime_type:'application/pdf',file_size_bytes:100,updated_at:'2026-11-18T12:00:00Z',expires_at:null,...overrides.source}
  let sourceCalls=0,authorityCalls=0
  const display={teamId,clubId,source:'paid_club',logoAllowed:true,logoUrl:`https://fixture.supabase.co/storage/v1/object/public/club-logos/${clubId}/logo.png?v=1777036386462`,...overrides.display}
  const admin={auth:{getUser:async token=>{assert.equal(token,'fixture');return {data:{user:{id:userId,email_confirmed_at:'2026-11-01',...overrides.identity}}}}},
    rpc:async(name,params)=>{
      assert.equal(params.actor_value,userId)
      assert.equal(params.club_value,clubId)
      assert.equal(params.team_value,teamId)
      if(name==='get_coach_offline_read_authority') {
        authorityCalls++
        return overrides.authorityError ? {error:overrides.authorityError} : {data:{userId,clubId,teamId}}
      }
      if(name==='get_coach_offline_kit_source') {
        assert.equal(params.version_value,resourceId)
        return {data:{id:resourceId,club_id:clubId,team_id:teamId,storage_bucket:'club-kits',storage_path:`${clubId}/home/kit.png`,updated_at:`${clubId}/home/kit.png`}}
      }
      assert.equal(name,'get_coach_offline_file_source')
      assert.equal(params.resource_value,resourceId)
      sourceCalls++
      if(overrides.sourceError) return {error:overrides.sourceError}
      return {data:sourceCalls===2 && overrides.changeBeforeSign ? {...source,updated_at:'changed'} : source}
    },
    storage:{from:bucket=>({info:async path=>{lookups.push({bucket,path});return {data:{size:100,contentType:['club-logos','club-kits'].includes(bucket) ? 'image/png' : 'application/pdf',...overrides.info}}},
      createSignedUrl:async(path,expires)=>{signed.push({bucket,path,expires});return {data:{signedUrl:`https://fixture.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=fixture`}}}})},
  }
  const handler=createCoachOfflineMediaHandler({createAdmin:()=>admin,createUser:(_event,options)=>{assert.equal(options.global.headers.Authorization,'Bearer fixture');return {rpc:async(name)=>{assert.equal(name,'get_team_branding_display');return {data:display}}}},environment:()=>({supabaseUrl:'https://fixture.supabase.co'})})
  return {signed,lookups,counts:()=>({sourceCalls,authorityCalls}),run:body=>handler({httpMethod:'POST',headers:{Authorization:'Bearer fixture'},body:JSON.stringify({clubId,teamId,...body})})}
}

test('file signing uses actual target-authorised resource metadata, exact object info and rechecks before signing',async()=>{
  const value=fixture()
  const response=await value.run({kind:'file',resourceId,storagePath:'attacker/path',actorId:id(99)})
  assert.equal(response.statusCode,200)
  const body=JSON.parse(response.body)
  assert.equal(body.resource.id,resourceId)
  assert.equal(body.resource.fileSizeBytes,100)
  assert.deepEqual(value.signed,[{bucket:'resource-library',path:`${clubId}/${teamId}/private.pdf`,expires:60}])
  assert.deepEqual(value.counts(),{sourceCalls:2,authorityCalls:2})
  assert.equal(response.headers['Cache-Control'],'no-store')
})

test('revocation, mismatched paths, replaced files and unverified Auth fail closed before a URL is issued',async()=>{
  for(const overrides of [{authorityError:{code:'42501'}},{identity:{email_confirmed_at:null}},{identity:{deleted_at:'2026-11-18'}},
    {source:{storage_path:`${id(99)}/${teamId}/private.pdf`}},{source:{storage_path:`${clubId}/${teamId}/../private.pdf`}},
    {source:{storage_bucket:'other'}},{info:{size:99}},{info:{contentType:'text/plain'}},{changeBeforeSign:true}]) {
    const value=fixture(overrides)
    assert.equal((await value.run({kind:'file',resourceId})).statusCode,403)
    assert.equal(value.signed.length,0)
  }
  const transient=fixture({sourceError:{code:'PGRST000',message:'Temporary unavailable'}})
  assert.equal((await transient.run({kind:'file',resourceId})).statusCode,503)
  assert.equal(transient.signed.length,0)
})

test('badge signs the currently entitled canonical path and supports the real numeric cache-buster URL',async()=>{
  const value=fixture()
  const response=await value.run({kind:'badge',resourceId:'ignored',url:'https://attacker.test/logo'})
  assert.equal(response.statusCode,200)
  const body=JSON.parse(response.body)
  assert.equal(body.resource.id,`badge:${teamId}`)
  assert.match(body.resource.updatedAt,/\?v=1777036386462$/)
  assert.equal(body.resource.mimeType,'image/png')
  assert.equal(body.resource.fileSizeBytes,100)
  assert.deepEqual(value.signed,[{bucket:'club-logos',path:`${clubId}/logo.png`,expires:60}])
  for(const overrides of [{display:{logoAllowed:false}},{authorityError:{code:'42501'}},{display:{logoUrl:'https://attacker.test/storage/v1/object/public/club-logos/path.png'}},
    {display:{logoUrl:'https://fixture.supabase.co/storage/v1/object/public/club-logos/path.png?token=secret'}},{info:{size:undefined}}]) {
    const denied=fixture(overrides)
    assert.equal((await denied.run({kind:'badge'})).statusCode,403)
    assert.equal(denied.signed.length,0)
  }
})

test('kit signing uses only the current authorised saved-version source and preserves the image size bound',async()=>{
  const value=fixture()
  const result=await value.run({kind:'kit',resourceId,storagePath:'foreign/kit.png'})
  assert.equal(result.statusCode,200)
  const canonical=JSON.parse(result.body).resource
  assert.equal(canonical.id,`kit:${resourceId}`)
  assert.equal(canonical.sourceId,resourceId)
  assert.equal(canonical.updatedAt,`${clubId}/home/kit.png`)
  assert.deepEqual(value.signed,[{bucket:'club-kits',path:`${clubId}/home/kit.png`,expires:60}])
  const large=fixture({info:{size:2*1024*1024+1}})
  assert.equal((await large.run({kind:'kit',resourceId})).statusCode,403)
  assert.equal(large.signed.length,0)
})
