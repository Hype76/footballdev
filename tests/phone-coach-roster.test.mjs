import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { createPhoneTeamAdministrationHandler } from '../netlify/functions/lib/_phone-team-administration.js'

const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const prior = await readFile('supabase/migrations/20261007071022_coach_team_administration_reminders.sql', 'utf8')
const boundary = prior.match(/create function app_private\.team_admin_can_manage[\s\S]*?revoke all on function app_private\.team_admin_can_manage[^;]*;/)[0]
const migration = (await readFile('supabase/migrations/20261007114801_phone_team_coach_roster_removal.sql', 'utf8')).split('-- END PHONE TEAM COACH ROSTER REMOVAL')[0]
async function fixture(t) {
  const db = new PGlite(); t.after(() => db.close())
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema app_private;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz default now(),banned_until timestamptz);
    create table clubs(id uuid primary key,status text default 'active',archived_at timestamptz);
    create table teams(id uuid primary key,club_id uuid,status text default 'active',archived_at timestamptz);
    create table users(id uuid primary key,club_id uuid,status text default 'active',role text,role_rank integer,email text,name text);
    create table user_club_memberships(auth_user_id uuid,club_id uuid,role text,role_rank integer);
    create table team_staff(id uuid primary key,team_id uuid,user_id uuid,role_key text,role_rank integer,role_label text);
    create function public.is_club_plan_access_active(uuid) returns boolean language sql as $$select coalesce(current_setting('test.plan',true),'yes')<>'no'$$;
    insert into auth.users(id) values('${id(1)}'),('${id(2)}'),('${id(3)}'),('${id(4)}'),('${id(5)}'),('${id(6)}');
    insert into clubs(id) values('${id(10)}'),('${id(11)}');
    insert into teams(id,club_id) values('${id(20)}','${id(10)}'),('${id(21)}','${id(10)}'),('${id(22)}','${id(11)}');
    insert into users(id,club_id,role,role_rank,email,name) values
    ('${id(1)}','${id(10)}','coach',30,'head@example.test','Team admin'),
    ('${id(2)}','${id(10)}','coach',30,'coach@example.test','Coach One'),
    ('${id(3)}','${id(10)}','manager',50,'manager@example.test','Manager'),
    ('${id(4)}','${id(11)}','admin',90,'other@example.test','Other club admin'),
    ('${id(5)}','${id(10)}','admin',90,'club@example.test','Club admin'),
    ('${id(6)}','${id(10)}','assistant_coach',20,'assistant@example.test','Assistant');
    insert into user_club_memberships select id,club_id,role,role_rank from users;
    insert into team_staff values
    ('${id(30)}','${id(20)}','${id(1)}','head_manager',70,'Team admin'),
    ('${id(31)}','${id(20)}','${id(2)}','coach',30,'Coach'),
    ('${id(32)}','${id(21)}','${id(2)}','coach',30,'Coach'),
    ('${id(33)}','${id(20)}','${id(3)}','manager',50,'Manager'),
    ('${id(34)}','${id(20)}','${id(6)}','assistant_coach',20,'Assistant coach'),
    ('${id(35)}','${id(20)}','${id(5)}','coach',30,'Coach');`)
  await db.exec(boundary); await db.exec(migration)
  const rpc = async (actor, team, action, target = null) => (await db.query('select manage_phone_team_coaches($1,$2,$3,$4) value',[actor,team,action,target])).rows[0].value
  return { db, rpc }
}
test('canonical head70/globalcoach30 roster and exact removal preserve account, other team and last admin', async t => {
  const {db,rpc}=await fixture(t)
  const read=await rpc(id(1),id(20),'read')
  assert.equal(read.canManage,true);assert.deepEqual(read.coaches.map(c=>c.id).sort(),[id(31),id(34),id(35)].sort())
  assert.equal(read.coaches.find(c=>c.id===id(31)).name,'Coach One')
  assert.equal(read.coaches.find(c=>c.id===id(35)).canRemove,false)
  assert.equal(read.coaches.find(c=>c.id===id(35)).roleLabel,'Club admin')
  await assert.rejects(rpc(id(1),id(20),'remove',id(35)),/Club admin/)
  const removed=await rpc(id(1),id(20),'remove',id(31));assert.equal(removed.removed,true)
  assert.equal((await db.query('select count(*) n from users where id=$1',[id(2)])).rows[0].n,1)
  assert.equal((await db.query('select count(*) n from team_staff where id=$1',[id(32)])).rows[0].n,1)
  assert.equal((await rpc(id(1),id(20),'remove',id(31))).removed,false)
  assert.equal((await rpc(id(1),id(20),'remove',id(32))).removed,false)
  await db.exec(`insert into team_staff values('${id(36)}','${id(20)}','${id(4)}','coach',30,'Coach')`)
  await assert.rejects(rpc(id(1),id(20),'remove',id(36)),/selected club/)
  assert.equal((await db.query('select count(*) n from team_staff where id=$1',[id(36)])).rows[0].n,1)
  await assert.rejects(rpc(id(1),id(20),'remove',id(30)),/coach or assistant/)
  await assert.rejects(rpc(id(1),id(20),'remove',id(33)),/coach or assistant/)
  assert.equal((await db.query('select count(*) n from team_staff where id=$1',[id(30)])).rows[0].n,1)
  assert.equal((await rpc(id(1),id(20),'remove',id(34))).removed,true)
})
test('fresh canonical authority rejects coach, manager, cross team/club, revoked, banned, inactive and expired plan', async t => {
  const {db,rpc}=await fixture(t)
  for(const [actor,team] of [[id(2),id(20)],[id(3),id(20)],[id(1),id(21)],[id(4),id(20)]])await assert.rejects(rpc(actor,team,'remove',id(31)),/team admin/)
  for(const [revoke,restore] of [
    [`update users set status='suspended' where id='${id(1)}'`,`update users set status='active' where id='${id(1)}'`],
    [`update auth.users set banned_until=now()+interval '1 day' where id='${id(1)}'`,`update auth.users set banned_until=null where id='${id(1)}'`],
    [`delete from user_club_memberships where auth_user_id='${id(1)}'`,`insert into user_club_memberships select id,club_id,role,role_rank from users where id='${id(1)}'`],
    [`update team_staff set role_key='coach',role_rank=30 where id='${id(30)}'`,`update team_staff set role_key='head_manager',role_rank=70 where id='${id(30)}'`],
    [`update teams set archived_at=now() where id='${id(20)}'`,`update teams set archived_at=null where id='${id(20)}'`],
    [`set test.plan='no'`,`set test.plan='yes'`],
  ]){await db.exec(revoke);await assert.rejects(rpc(id(1),id(20),'remove',id(31)),/team admin/);await db.exec(restore)}
  await db.exec(`update team_staff set role_key='head_manager',role_rank=70 where id='${id(31)}'`)
  await assert.rejects(rpc(id(1),id(20),'remove',id(31)),/coach or assistant/)
  assert.equal((await db.query('select count(*) n from team_staff where id=$1',[id(31)])).rows[0].n,1)
})
test('correct club admin can manage selected coaches, self removal and direct public invocation remain denied', async t => {
  const {db,rpc}=await fixture(t)
  await assert.rejects(rpc(id(5),id(20),'remove',id(35)),/coach or assistant/)
  assert.equal((await rpc(id(5),id(20),'remove',id(31))).removed,true)
  for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await assert.rejects(rpc(id(1),id(20),'read'),/permission denied/);await db.exec('reset role')}
  await db.exec('set role service_role');assert.equal((await rpc(id(1),id(20),'read')).canManage,true);await db.exec('reset role')
})
test('endpoint uses exact RPC actor/team/assignment and fails closed on fresh SQL revocation', async () => {
  let canManage=true,deny=false;const calls=[]
  const client={auth:{getUser:async()=>({data:{user:{id:id(1),email_confirmed_at:new Date().toISOString()}}})},rpc:async(name,args)=>{calls.push({name,args});if(name==='manage_team_reminder_policy')return{data:{teamId:id(20),clubId:id(10),canManage}};return deny?{error:{code:'42501',message:'Only the team admin can manage coaches.'}}:{data:{teamId:id(20),clubId:id(10),canManage:true,coaches:[],removed:true}}}}
  const handler=createPhoneTeamAdministrationHandler({client})
  const request=body=>handler({httpMethod:'POST',headers:{authorization:'Bearer synthetic'},body:JSON.stringify(body)})
  assert.equal((await request({action:'remove',teamId:id(20),assignmentId:id(31)})).statusCode,200)
  assert.deepEqual(calls.at(-1),{name:'manage_phone_team_coaches',args:{actor_value:id(1),team_value:id(20),action_value:'remove',assignment_value:id(31)}})
  deny=true;assert.equal((await request({action:'remove',teamId:id(20),assignmentId:id(31)})).statusCode,403)
  canManage=false;assert.equal((await request({action:'remove',teamId:id(20),assignmentId:id(31)})).statusCode,403)
  assert.deepEqual(JSON.parse((await request({action:'roster',teamId:id(20)})).body).coaches,[])
  assert.equal((await request({action:'remove',teamId:id(20),assignmentId:null})).statusCode,400)
  assert.equal((await request({action:'roster',teamId:id(20),assignmentId:id(31)})).statusCode,400)
})
