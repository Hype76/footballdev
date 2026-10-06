import assert from 'node:assert/strict'
import test from 'node:test'
import {readFile} from 'node:fs/promises'
import {coachTeamLeagueScope,parentPlayerTeamLeagueScope,normalizeTeamLeagueUrl,teamLeagueScopeKey,normalizeTeamLeagueState,readTeamLeagueLink,saveTeamLeagueLink,openTeamLeagueWebsite,createTeamLeagueRequestGate} from '../src/lib/team-league-link.js'

const coach=coachTeamLeagueScope({id:'coach',clubId:'club',activeTeamId:'a',role:'head_manager',roleRank:70,hasActivePlanAccess:true})
const row={team_id:'a',team_name:'Demo U14',league_url:'https://league.example/one',league_link_enabled:true,can_edit:true}
test('valid HTTP/S URLs, ports, IDN and query strings canonicalise without fetching',()=>{
  for(const url of ['https://example.com','http://example.com:8080/table?q=one&team=two#fixtures','HTTPS://Example.com/a','https://league.example:65535','https://bücher.example/table','https://system.gotsport.com/splash/27871/events/57217/schedules?team=4284647'])assert.match(normalizeTeamLeagueUrl(url),/^https?:\/\//)
  assert.equal(normalizeTeamLeagueUrl('https://bücher.example'),'https://xn--bcher-kva.example/')
  assert.equal(normalizeTeamLeagueUrl('   '),'')
  assert.equal(normalizeTeamLeagueUrl(null),'')
})
for(const url of ['javascript:alert(1)','data:text/html,hi','file:///tmp/demo','/relative','https://','https://user:pass@example.com','https://@example.com','https://example.com/a b','https://example.com/a\nb','https://example.com/a\u0000b','https://example.com:0','https://example.com:65536','https://example..com','https://-example.com','https://[::1]/','https://example.com\\@evil.example','https://example.com/'+ 'x'.repeat(2048)])test(`reject unsafe URL ${JSON.stringify(url).slice(0,85)}`,()=>assert.throws(()=>normalizeTeamLeagueUrl(url),/HTTP or HTTPS/))
test('Parent and accepted Player adapters use exact owned relationship; Fans excluded',()=>{
  const parent={id:'p',linkType:'parent',playerId:'child',teamId:'a',clubId:'club'}
  const player={...parent,id:'f',linkType:'fan',relationshipType:'player'}
  const user={id:'account',parentPortalLinks:[parent,player]}
  assert.equal(parentPlayerTeamLeagueScope(user,parent).kind,'parent')
  assert.equal(parentPlayerTeamLeagueScope(user,player).kind,'player')
  assert.equal(teamLeagueScopeKey(parentPlayerTeamLeagueScope(user,{...player,relationshipType:'fan'})),'')
  assert.equal(teamLeagueScopeKey(parentPlayerTeamLeagueScope({...user,parentPortalLinks:[]},parent)),'')
  assert.equal(teamLeagueScopeKey(parentPlayerTeamLeagueScope(user,parent,true)),'')
})
test('scope keys change across accounts, teams, clubs and revoked operational access',()=>{
  for(const patch of [{userId:'other'},{teamId:'b'},{clubId:'other'},{roleRank:20,canMutate:false}])assert.notEqual(teamLeagueScopeKey({...coach,...patch}),teamLeagueScopeKey(coach))
  for(const patch of [{offline:true},{active:false},{teamId:''}])assert.equal(teamLeagueScopeKey({...coach,...patch}),'')
  assert.equal(teamLeagueScopeKey(coachTeamLeagueScope({id:'x',clubId:'club',role:'super_admin',roleRank:100,activeTeamId:'a'})),'')
})
test('RPC read authority derives Parent/Player team from relationship, not caller-selected team',async()=>{
  const calls=[],client={rpc:async(name,args)=>{calls.push([name,args]);return {data:[row]}}}
  const scope={kind:'player',userId:'player',teamId:'a',clubId:'club',linkId:'connection',playerId:'child'}
  const result=await readTeamLeagueLink(client,scope)
  assert.deepEqual(calls,[['get_parent_player_team_league_url',{link_id_value:'connection',link_type_value:'player'}]])
  assert.equal(result.canEdit,false)
  await assert.rejects(()=>readTeamLeagueLink({rpc:async()=>({error:{code:'42501'}})},scope),/Refresh your team access/)
})
test('team movement and malformed response fail closed; strict booleans only',()=>{
  assert.throws(()=>normalizeTeamLeagueState({...row,team_id:'b'},coach),/selected team league/)
  assert.throws(()=>normalizeTeamLeagueState(null,coach))
  assert.equal(normalizeTeamLeagueState({...row,can_edit:'true',league_link_enabled:'true'},coach).canEdit,false)
  assert.equal(normalizeTeamLeagueState({...row,league_link_enabled:'true'},coach).enabled,false)
  assert.equal(normalizeTeamLeagueState({...row,league_url:null,league_link_enabled:false},coach).url,'')
})
test('turning off preserves exact canonical saved URL; clearing removes only URL',async()=>{
  const calls=[],client={rpc:async(name,args)=>{calls.push([name,args]);return {data:{...row,league_url:args.url_value,league_link_enabled:args.enabled_value}}}}
  const off=await saveTeamLeagueLink(client,coach,{url:row.league_url,enabled:false})
  assert.equal(off.url,row.league_url);assert.equal(off.enabled,false)
  await saveTeamLeagueLink(client,coach,{url:' ',enabled:true})
  assert.equal(calls[1][1].url_value,null)
  assert.equal(calls[0][1].enabled_value,false)
  for(const scope of [{...coach,kind:'parent'},{...coach,canMutate:false},{...coach,active:false}])await assert.rejects(()=>saveTeamLeagueLink(client,scope,{url:row.league_url,enabled:false}),/Team Admin/)
  const before=calls.length;await assert.rejects(()=>saveTeamLeagueLink(client,coach,{url:'javascript:alert(1)',enabled:true}));assert.equal(calls.length,before)
})
test('safe opening handles invalid URLs, browser failure and access change while awaiting opener',async()=>{
  const opened=[],opener={canOpenURL:async()=>true,openURL:async url=>opened.push(url)}
  assert.equal(await openTeamLeagueWebsite(row.league_url,opener),true)
  assert.deepEqual(opened,[row.league_url])
  let current=true
  assert.equal(await openTeamLeagueWebsite(row.league_url,{...opener,canOpenURL:async()=>{current=false;return true}},()=>current),false)
  assert.equal(opened.length,1)
  await assert.rejects(()=>openTeamLeagueWebsite('javascript:alert(1)',opener))
  await assert.rejects(()=>openTeamLeagueWebsite(row.league_url,{canOpenURL:async()=>false}),/No browser/)
  await assert.rejects(()=>openTeamLeagueWebsite(row.league_url,{canOpenURL:async()=>true,openURL:async()=>{throw new Error('private URL detail')}}),/could not be opened/)
})
test('request gates reject stale reads, A-B-A visits, unmounted callbacks and duplicate saves',()=>{
  const a=createTeamLeagueRequestGate(),b=createTeamLeagueRequestGate(),nextA=createTeamLeagueRequestGate()
  const read=a.begin();a.invalidate();b.begin();b.invalidate();const final=nextA.begin()
  assert.equal(a.isCurrent(read),false);assert.equal(b.isCurrent(1),false);assert.equal(nextA.isCurrent(final),true)
  assert.equal(a.isCurrent(a.begin()),false)
  const save=nextA.beginSave();assert.ok(save!==null);assert.equal(nextA.beginSave(),null);nextA.finishSave(save);assert.ok(nextA.beginSave()!==null)
})
test('unapplied SQL draft statically guards both fields, exact Team Admin assignment and audiences',async()=>{
  const sql=await readFile('supabase/migrations/20261006062722_team_current_league_url.sql','utf8')
  assert.match(sql,/league_link_enabled boolean not null default false/)
  assert.match(sql,/before insert or update of league_url, league_link_enabled/)
  assert.match(sql,/new.league_link_enabled is not distinct from old.league_link_enabled/)
  assert.equal((sql.match(/assignment.role_rank >= 50/g)||[]).length,3)
  assert.match(sql,/case when team.league_link_enabled then team.league_url else null end/)
  assert.match(sql,/connection.relationship_type = 'player'/)
  assert.match(sql,/link.auth_user_id = auth.uid\(\)/)
  assert.match(sql,/public.set_team_league_url\(uuid, text, boolean\)/)
  assert.doesNotMatch(sql,/grant (select|update|insert).*public.teams/i)
})
