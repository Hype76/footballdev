import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { canManageResourceLibrary } from '../src/lib/auth-permissions.js'

const source = (await readFile(new URL('../src/lib/domain/resource-library.js', import.meta.url),'utf8')).replace(/^import .*\r?\n/gm,'').replace(/export /g,'')
const user = {id:'manager',clubId:'club',activeTeamId:'team',role:'manager',roleRank:50,planKey:'small_club',planStatus:'active'}
const resource = {id:'resource',clubId:'club',teamId:'team',title:'Old',resourceType:'file',updatedAt:'2026-09-17T10:00:00Z',originalFilename:'old.pdf',links:[{id:'kept',parentVisible:true}]}
function harness({uploadError=null,rpcError=null}={}) {
  const calls=[]
  const api = {storage:{from:bucket=>({upload:async(path,file,options)=>{calls.push({upload:{bucket,path,file,options}});return {error:uploadError}}})},
    rpc:async(name,args)=>{calls.push({rpc:{name,args}});return {error:rpcError,data:{id:resource.id,club_id:'club',team_id:'team',title:args.title_value,description:args.description_value,category:args.category_value,updated_at:'2026-09-17T11:00:00Z',original_filename:args.replacement_file?.original_filename||'old.pdf'}}}}
  const edit = new Function('supabase','canManageResourceLibrary','blockDemoMutation','invalidateMemoryCacheByPrefix','clearViewCaches','createAuditLog',`${source}; return updateResourceLibraryItem`)(api,canManageResourceLibrary,async()=>{},key=>calls.push({invalidate:key}),()=>{},async()=>{})
  return {edit,calls}
}
test('metadata edit uses original id and concurrency token, keeps links, and does not upload',async()=>{
  const {edit,calls}=harness()
  const result=await edit({resource,user,title:' Revised ',description:'Notes',category:'training'})
  assert.equal(result.title,'Revised');assert.equal(result.links,resource.links)
  assert.equal(calls[0].rpc.args.target_resource_id,resource.id)
  assert.equal(calls[0].rpc.args.expected_updated_at,resource.updatedAt)
  assert.equal(calls[0].rpc.args.replacement_file,null)
  assert.ok(calls.some(call=>call.invalidate))
})
test('replacement uploads a new path first; failed upload never changes the record',async()=>{
  const file={name:'new.pdf',type:'application/pdf',size:120}
  const good=harness()
  await good.edit({resource,user,title:'New file',file})
  assert.match(good.calls[0].upload.path,/^club\/team\/resource\/.+-new.pdf$/)
  assert.equal(good.calls[0].upload.options.upsert,false)
  assert.equal(good.calls[1].rpc.args.replacement_file.storage_path,good.calls[0].upload.path)
  const failed=harness({uploadError:new Error('Upload failed')})
  await assert.rejects(failed.edit({resource,user,title:'New file',file}),/Upload failed/)
  assert.equal(failed.calls.length,1)
})
test('save errors do not report success or delete potentially committed uploads',async()=>{
  const {edit,calls}=harness({rpcError:new Error('Save failed')})
  await assert.rejects(edit({resource,user,title:'New file',file:{name:'new.pdf',type:'application/pdf',size:120}}),/Save failed/)
  assert.equal(calls.length,2)
})
test('edit validates permissions, resource scope and unsafe links before writes',async()=>{
  const {edit,calls}=harness()
  await assert.rejects(edit({resource,user:{...user,role:'coach',roleRank:30},title:'Denied'}),/Only Club Admins/)
  await assert.rejects(edit({resource:{...resource,teamId:'other'},user,title:'Denied'}),/this team/)
  await assert.rejects(edit({resource:{...resource,resourceType:'external_link'},user,title:'Unsafe',externalUrl:'javascript:alert(1)'}),/valid http/)
  await assert.rejects(edit({resource,user,title:''}),/Add a title/)
  assert.equal(calls.length,0)
})
