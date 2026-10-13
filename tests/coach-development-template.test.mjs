import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { parse } from '@babel/parser'
import { CAPABILITIES, getFeatureAccess } from '../src/lib/paywall-access.js'
import { buildCoachDevelopmentTemplateField, canBuildCoachDevelopmentTemplate, validateCoachDevelopmentTemplate } from '../apps/mobile-core/src/coachDevelopmentTemplateCore.js'
import { normalizeCoachDevelopmentForm } from '../apps/mobile-core/src/coachPhase31ECore.js'

const id='00000000-0000-4000-8000-000000000001'
const user={id:'creator',clubId:'club',activeTeamId:'team',role:'team_admin',roleRank:50,hasActivePlanAccess:true,planKey:'small_club',planStatus:'active',isPlanComped:true}
const field=buildCoachDevelopmentTemplateField({id:'technical',label:'Technical',type:'score_1_10'})
const draft={id,name:'FP TEST Skills',fields:[field]}

test('template building retains the current manager, team and plan permission boundary',()=>{
  assert.equal(canBuildCoachDevelopmentTemplate(user),true)
  for(const overrides of [{roleRank:30},{activeTeamId:''},{clubId:''},{id:''},{hasActivePlanAccess:false},{role:'super_admin'},{role:'parent_portal'},{role:'admin'},{planKey:'free',isPlanComped:false}]) assert.equal(canBuildCoachDevelopmentTemplate({...user,...overrides}),false,JSON.stringify(overrides))
})
test('new fields preserve rating metadata, marking options and Parent sharing in the actual assessment normalizer',()=>{
  const form=normalizeCoachDevelopmentForm({...draft,team_id:'team',created_by:'creator',access_scope:'creator',updated_at:'2026-10-13T14:00:00Z'})
  assert.equal(form.fields[0].metricKey,'custom.technical')
  assert.equal(form.fields[0].categoryKey,'custom')
  assert.equal(form.fields[0].includeInProgressChart,true)
  assert.equal(form.fields[0].parentVisible,true)
  assert.equal(form.accessScope,'creator')
  assert.equal(form.createdBy,'creator')
  assert.deepEqual(buildCoachDevelopmentTemplateField({id:'readiness',label:'Ready',type:'yes_no'}).options,['Yes','No'])
  assert.deepEqual(buildCoachDevelopmentTemplateField({id:'traffic',label:'Traffic',type:'traffic_light'}).options,['Green','Amber','Red'])
  const dropdown=buildCoachDevelopmentTemplateField({id:'position',label:'Position',type:'select',options:'GK\nCB\nGK'})
  assert.deepEqual(dropdown.options,['GK','CB'])
  assert.equal(dropdown.includeInProgressChart,false)
})
test('incomplete and oversized templates fail before a server write',()=>{
  for(const invalid of [{...draft,name:''},{...draft,id:''},{...draft,fields:[]},{...draft,fields:Array.from({length:51},(_,i)=>({...field,id:String(i)}))},{...draft,fields:[field,field]}]) assert.throws(()=>validateCoachDevelopmentTemplate(invalid))
  assert.throws(()=>buildCoachDevelopmentTemplateField({id:'field',label:'Dropdown',type:'select',options:''}),/dropdown options/)
  assert.throws(()=>buildCoachDevelopmentTemplateField({id:'field',label:'Name',type:'script'}),/marking type/)
})

async function helpers(file,names){const source=await readFile(new URL(file,import.meta.url),'utf8');const nodes=parse(source,{sourceType:'module'}).program.body.map(node=>node.declaration||node);return names.map(name=>{const node=nodes.find(node=>node.type==='FunctionDeclaration'&&node.id?.name===name);assert.ok(node,name);return source.slice(node.start,node.end)}).join('\n')}
const operational=await helpers('../apps/mobile-core/src/coachOperationalData.js',['assertCoachOperationalRead','assertCoachOperationalMutation','assertCoachCapability','getCoachEntryIdentity'])
const data=await helpers('../apps/mobile-core/src/coachPhase31EData.js',['normalize','assertCanonicalMutation','saveCoachDevelopmentTemplate','setCoachDevelopmentTemplateAccess'])
function fixture({duplicate=false,insertError=null,throws=false,missing=false,auditError=null}={}){
  const calls=[],audits=[]
  const saved={...draft,club_id:'club',team_id:'team',created_by:'creator',access_scope:'creator',updated_at:'2026-10-13T14:00:00Z'}
  const supabase={from(table){assert.equal(table,'feedback_forms');let payload;const filters=[];const query={insert(value){payload=value;calls.push(['insert',value]);return query},update(value){payload=value;calls.push(['update',value]);return query},select(){return query},eq(key,value){filters.push([key,value]);return query},async single(){if(throws)throw insertError;return insertError?{error:insertError}:duplicate?{error:{code:'23505'}}:{data:{...saved,...payload}}},async maybeSingle(){calls.push(['filters',filters]);return{data:missing?null:payload?{...saved,...payload}:{...saved,fields:saved.fields.map(item=>Object.fromEntries(Object.entries(item).reverse()))}}}};return query}}
  const dependencies={config:{isUsable:true,supabaseEnvironment:'production'},CAPABILITIES,getFeatureAccess,canBuildCoachDevelopmentTemplate,validateCoachDevelopmentTemplate,normalizeCoachDevelopmentForm,supabase,recordCoachOperationalAudit:async value=>{audits.push(value);if(auditError)throw auditError}}
  const api=new Function(...Object.keys(dependencies),`${operational}\n${data}\nreturn {saveCoachDevelopmentTemplate,setCoachDevelopmentTemplateAccess}`)(...Object.values(dependencies))
  return{...api,calls,audits}
}
test('actual template save creates a scoped private form and a lost acknowledgement retries the same identity',async()=>{
  for(const duplicate of [false,true]){
    const h=fixture({duplicate})
    const saved=await h.saveCoachDevelopmentTemplate(user,draft)
    assert.equal(saved.id,id)
    assert.equal(saved.accessScope,'creator')
    assert.equal(saved.createdBy,'creator')
    assert.equal(h.calls[0][1].club_id,'club')
    assert.equal(h.calls[0][1].team_id,'team')
    assert.equal(h.calls[0][1].created_by,'creator')
    assert.equal(h.audits[0].action,'feedback_form_created')
  }
})
test('actual sharing write uses creator, club, team and version filters and rejects foreign owners',async()=>{
  const h=fixture()
  const saved=await h.saveCoachDevelopmentTemplate(user,draft)
  const shared=await h.setCoachDevelopmentTemplateAccess(user,saved,'team')
  assert.equal(shared.accessScope,'team')
  assert.deepEqual(h.calls.at(-1)[1],[['id',id],['club_id','club'],['team_id','team'],['created_by','creator'],['updated_at','2026-10-13T14:00:00Z']])
  const before=h.calls.length
  await assert.rejects(h.setCoachDevelopmentTemplateAccess(user,{...saved,createdBy:'other'},'team'),/creator/)
  await assert.rejects(h.setCoachDevelopmentTemplateAccess(user,{...saved,teamId:'other'},'team'),/creator/)
  await assert.rejects(h.setCoachDevelopmentTemplateAccess({...user,roleRank:30},saved,'team'),/Coach role/)
  assert.equal(h.calls.length,before)
})

test('uncertain transport results reconcile the same committed template without another insert',async()=>{
  for(const throws of [false,true]){
    const h=fixture({insertError:new Error('Network request failed'),throws})
    const saved=await h.saveCoachDevelopmentTemplate(user,draft)
    assert.equal(saved.id,id)
    assert.equal(saved.accessScope,'creator')
    assert.equal(h.calls.filter(c=>c[0]==='insert').length,1)
    assert.deepEqual(h.calls.at(-1)[1],[['id',id],['club_id','club'],['team_id','team'],['created_by','creator']])
  }
  const absent=fixture({insertError:new Error('Network request failed'),missing:true})
  await assert.rejects(absent.saveCoachDevelopmentTemplate(user,draft),/Network request failed/)
  const denied=fixture({insertError:{code:'42501',message:'Network role is not authorised'}})
  await assert.rejects(denied.saveCoachDevelopmentTemplate(user,draft))
  assert.equal(denied.calls.length,1,'Permission failures never use acknowledgement recovery')
})

test('audit transport failure preserves confirmed server identity and explicitly marks pending activity confirmation',async()=>{
  const h=fixture({auditError:new Error('Network request failed')})
  await assert.rejects(h.saveCoachDevelopmentTemplate(user,draft),failure=>{
    assert.equal(failure.savedTemplate.id,id)
    assert.equal(failure.savedTemplate.createdBy,user.id)
    assert.equal(failure.savedTemplate.accessScope,'creator')
    assert.equal(failure.savedTemplate.auditPending,true)
    return true
  })
  assert.equal(h.audits.length,1,'The audit is attempted and never silently omitted')
})
