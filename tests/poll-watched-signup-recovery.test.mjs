import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {requiresWatchedMatch} from '../src/lib/poll-watched-match.js';
import {getLinkableCoachFormationMatches} from '../apps/coach-mobile/src/coachFormationEntryCore.js';
import {createBoundedMobileFetch,getMobileRequestTimeout} from '../apps/mobile-core/src/mobileFetchCore.js';
import {createParentOfflineDocument,enqueueParentOfflineCommand,classifyParentCommandError} from '../apps/mobile-core/src/parentOfflineCore.js';

test('only match awards require watching, including older cached poll titles',()=>{
 assert.equal(requiresWatchedMatch({pollType:'awards',title:'Player of the Match'}),true);
 assert.equal(requiresWatchedMatch({pollType:'awards',title:'Man of the Match: United'}),true);
 assert.equal(requiresWatchedMatch({requiresWatchedMatch:true,title:'Renamed award'}),true);
 assert.equal(requiresWatchedMatch({pollType:'awards',title:'Player of the Season'}),false);
 assert.equal(requiresWatchedMatch({pollType:'text',title:'Transport'}),false);
});
test('formation picker orders dates before statuses without mutating input or including closed matches',()=>{
 const matches=[{id:'later',teamId:'team',matchDate:'2026-10-24',status:'live'},{id:'next',teamId:'team',matchDate:'2026-10-03',status:'scheduled'},{id:'other',teamId:'other',matchDate:'2026-10-01',status:'scheduled'},{id:'closed',teamId:'team',matchDate:'2026-10-01',status:'concluded'}];
 assert.deepEqual(getLinkableCoachFormationMatches(matches,{teamId:'team',now:new Date('2026-09-29T12:00:00Z')}).map(x=>x.id),['next','later']);assert.equal(matches[0].id,'later');
});
test('signup allows a slow confirmation response and still aborts after 30 seconds',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});let complete;let aborted=false;
 const request=createBoundedMobileFetch((_url,{signal})=>new Promise((resolve,reject)=>{complete=resolve;signal.addEventListener('abort',()=>{aborted=true;reject(new Error('aborted'))})}))('https://example.test/auth/v1/signup?redirect_to=https%3A%2F%2Fexample.test',{method:'POST'});
 t.mock.timers.tick(10000);assert.equal(aborted,false);complete({status:200});assert.equal((await request).status,200);
 const timeout=createBoundedMobileFetch((_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')))))('https://example.test/auth/v1/signup',{method:'POST'});
 const rejected=assert.rejects(timeout,{code:'MOBILE_REQUEST_TIMEOUT'});t.mock.timers.tick(30000);await rejected;
 assert.equal(getMobileRequestTimeout('https://example.test/rest/v1/users'),8000);
});
test('signup transport errors do not silently resubmit account creation',async()=>{
 let calls=0;await assert.rejects(createBoundedMobileFetch(async()=>{calls++;throw new TypeError('Network request failed')})('https://example.test/auth/v1/signup',{method:'POST'}),/Network/);assert.equal(calls,1);
});
test('offline confirmation remains explicit in the stored command',()=>{
 const doc=createParentOfflineDocument({userScope:'parent',profile:{id:'parent',parentPortalLinks:[{id:'link',playerId:'player',clubId:'club',teamId:'team',status:'active'}]}});
 const queued=enqueueParentOfflineCommand(doc,{actorScope:'parent',childScope:'link',entityId:'poll',type:'poll_vote',payload:{optionId:'player',watchedMatch:true}},{commandId:'command'});
 assert.equal(queued.command.payload.watchedMatch,true);
});
test('database blocks unconfirmed match votes and old clients, preserves ordinary polls and authority',async()=>{
 const db=new PGlite();
 const actor='10000000-0000-4000-8000-000000000001', link='20000000-0000-4000-8000-000000000001', poll='30000000-0000-4000-8000-000000000001', general='30000000-0000-4000-8000-000000000002', own='40000000-0000-4000-8000-000000000001';
 try {
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql as $$select '{}'::jsonb$$;
 create table users(id uuid primary key,email text,name text,display_name text,username text);
 create table parent_player_links(id uuid primary key,auth_user_id uuid,club_id uuid,team_id uuid,player_id uuid,status text,email text,created_at timestamptz default now());
 create table polls(id uuid primary key,club_id uuid,team_id uuid,title text,description text,audience text,poll_type text,options jsonb,status text,closes_at timestamptz,allow_multiple boolean default false,max_choices int,allow_own_child_votes boolean default false,allow_vote_changes boolean default true,hide_votes boolean default false,allow_comments boolean default false,created_at timestamptz default now());
 create table match_days(id uuid primary key,motm_poll_id uuid);
 create table poll_votes(id uuid primary key default gen_random_uuid(),poll_id uuid,club_id uuid,team_id uuid,auth_user_id uuid,voter_email text,voter_name text,option_id text,parent_link_id uuid,updated_at timestamptz,unique(poll_id,voter_email,option_id));
 create table audit_logs(club_id uuid,actor_id uuid,action text,entity_type text,entity_id uuid,metadata jsonb);
 create function submit_parent_portal_poll_vote(uuid,uuid,text) returns uuid language sql as $$select null::uuid$$;
 create function get_parent_portal_polls(uuid) returns jsonb language sql as $$select '[]'::jsonb$$;
 insert into parent_player_links(id,auth_user_id,club_id,team_id,player_id,status,email) values('${link}','${actor}','${actor}','${actor}','${own}','active','synthetic@example.test');
 insert into polls(id,club_id,team_id,title,audience,poll_type,options,status) values('${poll}','${actor}','${actor}','Renamed match award','parents','awards','[{"id":"yes","label":"Other player"},{"id":"own","playerId":"${own}"}]','open'),('${general}','${actor}','${actor}','Transport','parents','text','[{"id":"yes","label":"Yes"}]','open');
 insert into match_days values('${actor}','${poll}');
 select set_config('request.jwt.claim.sub','${actor}',false);`);
 await db.exec(await readFile(new URL('../supabase/migrations/20260929132106_parent_poll_watched_match.sql',import.meta.url),'utf8'));
 const read=await db.query(`select id,requires_watched_match from get_parent_portal_polls('${link}')`);
 assert.equal(read.rows.find(x=>x.id===poll).requires_watched_match,true);assert.equal(read.rows.find(x=>x.id===general).requires_watched_match,false);
 await assert.rejects(db.query(`select submit_parent_portal_poll_vote('${link}','${poll}','yes')`),/I watched the match/);
 await assert.rejects(db.query(`select submit_parent_portal_poll_vote('${link}','${poll}','yes',false)`),/I watched the match/);
 await assert.rejects(db.query(`select submit_parent_portal_poll_vote('${link}','${poll}','yes',null)`),/I watched the match/);
 await assert.rejects(db.query(`select submit_parent_portal_poll_vote('${link}','${poll}','own',true)`),/not_permitted/);
 await db.query(`select submit_parent_portal_poll_vote('${link}','${poll}','yes',true)`);
 await db.query(`select submit_parent_portal_poll_vote('${link}','${general}','yes')`);
 assert.equal((await db.query('select count(*)::int as n from poll_votes')).rows[0].n,2);
 assert.equal((await db.query(`select metadata->>'watchedMatch' as watched from audit_logs where entity_id='${poll}'`)).rows[0].watched,'true');
 await db.exec(`select set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000001',false)`);
 await assert.rejects(db.query(`select submit_parent_portal_poll_vote('${link}','${poll}','yes',true)`),/unavailable/);
 assert.equal((await db.query(`select has_function_privilege('anon','public.submit_parent_portal_poll_vote(uuid,uuid,text,boolean)','EXECUTE') as allowed`)).rows[0].allowed,false);
 } finally {await db.close()}
});


test('old unconfirmed queued votes require attention instead of endlessly retrying',()=>{
 assert.equal(classifyParentCommandError({code:'22023',message:'Confirm "I watched the match" before voting.'}),'conflict');
 assert.equal(classifyParentCommandError(new Error('Network request failed')),'retryable_failure');
});
