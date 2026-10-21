import assert from 'node:assert/strict'
import test from 'node:test'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import {transform} from 'esbuild'
import {PGlite} from '@electric-sql/pglite'
import {isStaffInvitationAdmin} from '../src/lib/staff-invite-access.js'
import {canManageUsers} from '../src/lib/auth-permissions.js'
import {assertStaffInviteAuthority} from '../netlify/functions/lib/_staff-invite-authority.js'
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const migration=await readFile('supabase/migrations/20261021063202_staff_invitation_admin_authority.sql','utf8')
const original=await readFile('supabase/migrations/20261007071022_coach_team_administration_reminders.sql','utf8')
const user=(role,roleRank)=>({id:id(1),clubId:id(10),activeTeamId:id(20),role,roleRank,planKey:'single_team',planStatus:'active'})
test('staff controls allow Team Admin and existing Club Admin, denying coaching roles and forged rank',()=>{
 for(const [role,rank,allowed]of [['assistant_coach',20,false],['coach',30,false],['manager',50,false],['head_manager',50,false],['coach',70,false],['head_manager',70,true],['admin',90,true],['super_admin',100,true]]){assert.equal(isStaffInvitationAdmin(user(role,rank)),allowed,role+rank);assert.equal(canManageUsers(user(role,rank)),allowed,role+rank)}
})
test('mail transport requires fresh scoped database authority for every role',async()=>{
 const invite={id:id(30),club_id:id(10),team_id:id(20),role_rank:30};let checks=0
 const invoke=(profile,allowed=true)=>assertStaffInviteAuthority({event:{},invite,authenticatedActorId:id(1),getPlanProfile:async()=>profile,assertFeature:()=>{},client:{rpc:async(name,args)=>{assert.equal(name,'staff_invite_actor_can_send');assert.deepEqual(args,{actor_value:id(1),invite_value:id(30)});checks++;return{data:allowed}}}})
 for(const role of ['coach','manager'])await assert.rejects(invoke(user(role,role==='coach'?30:50),false),e=>e.statusCode===403)
 assert.equal(checks,2)
 for(const profile of [user('head_manager',70),user('admin',90)]){assert.equal(await invoke(profile),profile);await assert.rejects(invoke(profile,false),e=>e.statusCode===403)}
 const scoped=user('coach',30);assert.equal(await invoke(scoped),scoped)
 await assert.rejects(invoke({...user('head_manager',70),id:id(2)}),e=>e.statusCode===403)
})
async function fixture(t){const db=new PGlite();t.after(()=>db.close());await db.exec(`
 create role anon;create role authenticated;create role service_role;create schema auth;create schema app_private;
 create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table auth.users(id uuid primary key,email_confirmed_at timestamptz,banned_until timestamptz);
 create table public.clubs(id uuid primary key,status text default 'active',archived_at timestamptz);
 create table public.users(id uuid primary key,club_id uuid,role text,role_rank int,role_label text,status text default 'active');
 create table public.user_club_memberships(auth_user_id uuid,club_id uuid,role text,role_rank int,role_label text,updated_at timestamptz);
 create table public.teams(id uuid primary key,club_id uuid,status text default 'active',archived_at timestamptz);
 create table public.team_staff(team_id uuid,user_id uuid,role_key text,role_rank int,primary key(team_id,user_id));
 create table public.club_roles(id uuid default gen_random_uuid(),club_id uuid,role_key text,role_label text,role_rank int);
 create table public.audit_logs(club_id uuid,actor_id uuid,action text,entity_type text,entity_id uuid,metadata jsonb);
 create table public.club_user_invites(id uuid primary key default gen_random_uuid(),club_id uuid,team_id uuid,role_rank int,email text,status text default 'pending',accepted_at timestamptz,cancelled_at timestamptz,replaced_at timestamptz,expires_at timestamptz default now()+interval '7 days',invite_token text default 'synthetic');
 create function public.current_user_role()returns text language sql stable security definer as $$select role from public.users where id=auth.uid()$$;
 create function public.current_user_role_rank()returns int language sql stable security definer as $$select role_rank from public.users where id=auth.uid()$$;
 create function public.current_user_club_id()returns uuid language sql stable security definer as $$select club_id from public.users where id=auth.uid()$$;
 create function public.is_club_plan_access_active(uuid)returns boolean language sql stable as $$select true$$;
 create function public.can_insert_staff_invite_for_plan(uuid,text)returns boolean language sql stable as $$select true$$;
 create function public.can_use_plan_feature(uuid,text)returns boolean language sql stable as $$select true$$;
 insert into clubs(id)values('${id(10)}'),('${id(11)}');insert into teams(id,club_id)values('${id(20)}','${id(10)}'),('${id(21)}','${id(10)}'),('${id(22)}','${id(11)}');
 insert into users(id,club_id,role,role_rank)values('${id(1)}','${id(10)}','head_manager',70),('${id(2)}','${id(10)}','coach',30),('${id(3)}','${id(10)}','manager',50),('${id(4)}','${id(10)}','admin',90),('${id(5)}','${id(11)}','admin',90);
 insert into auth.users(id,email_confirmed_at)select id,now()from public.users;
 insert into user_club_memberships(auth_user_id,club_id,role,role_rank) select id,club_id,role,role_rank from users;
 insert into club_roles(club_id,role_key,role_label,role_rank)values('${id(10)}','coach','Coach',30);
 insert into team_staff values('${id(20)}','${id(1)}','head_manager',70),('${id(20)}','${id(2)}','coach',30),('${id(20)}','${id(3)}','manager',50);
 alter table club_user_invites enable row level security;grant usage on schema public,auth to authenticated,service_role,anon;grant select,insert,update on club_user_invites to authenticated;
 create policy invite_read on club_user_invites for select to authenticated using(club_id=public.current_user_club_id());
 `);await db.exec(original.match(/create function app_private\.team_admin_can_manage\([^]*?revoke all on function app_private\.team_admin_can_manage[^;]*;/)[0]);await db.exec((await readFile('supabase/migrations/20260719071505_p0_shared_authority_profile_containment.sql','utf8')).match(/create or replace function public\.set_club_user_role\([^]*?\$\$;/)[0]);await db.exec(migration);return db}
async function actor(db,n){await db.exec(`reset role;select set_config('request.jwt.claim.sub','${id(n)}',false);set role authenticated;`)}
test('RLS blocks Coach/Manager writes, preserves scoped Team Admin and Club Admin, and protects scope changes',async t=>{
 const db=await fixture(t)
 for(const n of [2,3,5]){await actor(db,n);await assert.rejects(db.exec(`insert into club_user_invites(club_id,team_id,role_rank,email)values('${id(10)}','${id(20)}',30,'synthetic@example.test')`),e=>e.code==='42501')}
 await actor(db,1);await db.exec(`insert into club_user_invites(id,club_id,team_id,role_rank,email)values('${id(30)}','${id(10)}','${id(20)}',30,'synthetic@example.test')`)
 for(const team of [id(21),id(22)])await assert.rejects(db.exec(`update club_user_invites set team_id='${team}' where id='${id(30)}'`),e=>e.code==='42501')
 await assert.rejects(db.exec(`insert into club_user_invites(club_id,role_rank,email)values('${id(10)}',30,'club@example.test')`),e=>e.code==='42501')
 await actor(db,3);assert.equal((await db.query(`update club_user_invites set email='forged@example.test'where id='${id(30)}'returning id`)).rows.length,0)
 await actor(db,4);await db.exec(`insert into club_user_invites(club_id,role_rank,email)values('${id(10)}',30,'club@example.test')`)
})
test('mail RPC is service-only and rejects removed, banned, expired or cross-scope authority',async t=>{
 const db=await fixture(t);await db.exec(`insert into club_user_invites(id,club_id,team_id,role_rank,email)values('${id(30)}','${id(10)}','${id(20)}',30,'synthetic@example.test')`)
 await actor(db,1);await assert.rejects(db.query(`select public.staff_invite_actor_can_send('${id(1)}','${id(30)}')`),e=>e.code==='42501');await db.exec('reset role;set role service_role;');
 const allowed=async n=>(await db.query(`select public.staff_invite_actor_can_send('${id(n)}','${id(30)}')as allowed`)).rows[0].allowed
 assert.equal(await allowed(1),true);assert.equal(await allowed(4),true);for(const n of[2,3,5])assert.equal(await allowed(n),false)
 await db.exec(`reset role;delete from team_staff where user_id='${id(1)}';set role service_role;`);assert.equal(await allowed(1),false)
 await db.exec(`reset role;update auth.users set banned_until=now()+interval '1 day'where id='${id(4)}';set role service_role;`);assert.equal(await allowed(4),false)
 await db.exec(`reset role;update club_user_invites set expires_at=now()-interval '1 day';set role service_role;`);assert.equal(await allowed(1),false)
})

test('scoped Team Admin with global Coach authority can invite only for the assigned team',async t=>{
 const db=await fixture(t)
 await db.exec(`update users set role='coach',role_rank=30 where id='${id(1)}';update user_club_memberships set role='coach',role_rank=30 where auth_user_id='${id(1)}'`)
 await actor(db,1);await db.exec(`insert into club_user_invites(club_id,team_id,role_rank,email)values('${id(10)}','${id(20)}',30,'scoped@example.test')`)
 await assert.rejects(db.exec(`insert into club_user_invites(club_id,team_id,role_rank,email)values('${id(10)}','${id(21)}',30,'denied@example.test')`),e=>e.code==='42501')
 await assert.rejects(db.exec(`insert into club_user_invites(club_id,team_id,role_rank,email)values('${id(10)}','${id(20)}',90,'elevated@example.test')`),e=>e.code==='42501')
})
test('legacy role endpoint requires admin authority and its implementation cannot be called directly',async t=>{
 const db=await fixture(t)
 for(const n of[2,3]){await actor(db,n);await assert.rejects(db.query(`select public.set_club_user_role('${id(2)}','coach','${id(20)}')`),e=>e.code==='42501')}
 await actor(db,1);assert.equal((await db.query(`select public.set_club_user_role('${id(2)}','coach','${id(20)}')as result`)).rows[0].result.role,'coach')
 await assert.rejects(db.query(`select app_private.set_club_user_role('${id(2)}','coach','${id(20)}')`),e=>e.code==='42501')
 await actor(db,4);assert.equal((await db.query(`select public.set_club_user_role('${id(2)}','coach',null)as result`)).rows[0].result.role,'coach')
})

test('direct staff creation checks trusted database authority before any account writes',async()=>{
 const source=(await readFile('supabase/functions/create-staff-user/index.ts','utf8')).replace(/^import .*\n/,'')
 const {code}=await transform(source,{loader:'ts',format:'iife'});let handler,writes=0,checks=0
 const requester={id:id(1),club_id:id(10),role:'manager',role_rank:50}
 const userClient={auth:{getUser:async()=>({data:{user:{id:id(1)}}})},rpc:async(name,args)=>{assert.equal(name,'current_user_can_invite_staff');assert.equal(args.club_value,id(10));assert.equal(args.team_value,null);checks++;return{data:false}}}
 const query={select(){return this},eq(){return this},single:async()=>({data:requester})}
 const adminClient={from:()=>query,auth:{admin:{createUser:async()=>{writes++;throw Error('unexpected account write')}}}}
 vm.runInNewContext(code,{createClient:(_url,key)=>key==='anon'?userClient:adminClient,Deno:{env:{get:key=>key==='SUPABASE_ANON_KEY'?'anon':'configured'},serve:fn=>{handler=fn}},Response,Request,console})
 const response=await handler(new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer synthetic'},body:JSON.stringify({email:'synthetic@example.test',password:'Synthetic!123',clubId:id(10),roleKey:'coach',roleLabel:'Coach',roleRank:30})}))
 assert.equal(response.status,403);assert.equal(checks,1);assert.equal(writes,0)
})
