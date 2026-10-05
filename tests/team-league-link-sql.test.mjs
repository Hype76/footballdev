import assert from 'node:assert/strict'
import test from 'node:test'
import {readFile} from 'node:fs/promises'
import {PGlite} from '@electric-sql/pglite'

const draft=await readFile(new URL('../supabase/migration-drafts/20261003175613_team_current_league_url_draft.sql',import.meta.url),'utf8')
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
// Execute the unchanged draft against a synthetic local PostgreSQL schema.
// Authority and billing helpers below are explicit controllable seams. This
// proves the draft consumes those decisions, not full deployed RLS correctness.
async function setup(t){
 const db=new PGlite();t.after(()=>db.close())
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create schema app_private;
 create function auth.uid() returns uuid language sql as $$select '${id(1)}'::uuid$$;
 create table auth.users(id uuid,deleted_at timestamptz,banned_until timestamptz);
 create table public.users(id uuid,display_name text,name text,email text);
 create table public.clubs(id uuid,status text,archived_at timestamptz);
 create table public.teams(id uuid primary key,club_id uuid,name text,status text,archived_at timestamptz,updated_at timestamptz,updated_by uuid,updated_by_name text,updated_by_email text);
 create table public.team_staff(team_id uuid,user_id uuid,role_rank integer);
 create table public.audit_logs(club_id uuid,actor_id uuid,action text,entity_type text,entity_id uuid,metadata jsonb);
 create table public.parent_player_links(id uuid,player_id uuid,club_id uuid,auth_user_id uuid,link_type text,status text,team_id uuid);
 create table public.players(id uuid,team_id uuid,club_id uuid,status text,archived_at timestamptz);
 create table public.fan_connections(id uuid,player_id uuid,club_id uuid,auth_user_id uuid,relationship_type text,status text,parent_link_id uuid,invited_by uuid);
 create function app_private.actor_can_manage_team_resource(uuid,uuid,uuid,integer) returns boolean language sql as $$select true$$;
 create function public.current_user_billing_staff_mutation_allowed(uuid) returns boolean language sql as $$select case current_setting('synthetic.billing',true) when 'blocked' then false when 'unknown' then null else true end$$;
 create function public.current_user_can_access_parent_link(uuid,uuid) returns boolean language sql as $$select true$$;
 create function app_private.fan_scope_active(uuid,uuid,uuid,uuid) returns boolean language sql as $$select true$$;
 create function app_private.fan_account_active(uuid,uuid) returns boolean language sql as $$select true$$;
 insert into auth.users(id) values('${id(1)}');insert into public.users(id,email) values('${id(1)}','synthetic@example.invalid');
 insert into public.clubs values('${id(2)}','active',null);
 insert into public.teams(id,club_id,name,status) values('${id(3)}','${id(2)}','Synthetic U14','active');
 insert into public.team_staff values('${id(3)}','${id(1)}',50);
 grant usage on schema public,auth to authenticated;
 grant select,update on public.teams to authenticated;`)
 await db.exec(draft)
 return db
}
for(const state of ['blocked','unknown'])test(`league SQL denies ${state} billing for setter and direct writes without losing existing URL`,async t=>{
 const db=await setup(t)
 await db.query('select public.set_team_league_url($1,$2,true)',[id(3),'https://league.example/retained'])
 await db.exec(`set role authenticated;set synthetic.billing='${state}'`)
 const read=await db.query('select public.get_team_league_url($1) as value',[id(3)])
 assert.equal(read.rows[0].value.can_edit,false)
 await assert.rejects(db.query('select public.set_team_league_url($1,$2,false)',[id(3),'https://league.example/replaced']),/Team Admin access/)
 await assert.rejects(db.query('update public.teams set league_url=$1 where id=$2',['https://league.example/replaced',id(3)]),/Team Admin access/)
 await assert.rejects(db.query('update public.teams set league_link_enabled=false where id=$1',[id(3)]),/Team Admin access/)
 await db.exec('reset role')
 const row=(await db.query('select league_url,league_link_enabled from public.teams')).rows[0]
 assert.deepEqual(row,{league_url:'https://league.example/retained',league_link_enabled:true})
 assert.equal((await db.query('select count(*)::integer as n from public.audit_logs')).rows[0].n,1)
})
test('league SQL allows assigned Team Admin edits with allowed billing and hides disabled viewer URL',async t=>{
 const db=await setup(t);await db.exec('set role authenticated')
 const saved=(await db.query('select public.set_team_league_url($1,$2,false) as value',[id(3),'https://league.example/retained'])).rows[0].value
 assert.equal(saved.can_edit,true);assert.equal(saved.league_url,'https://league.example/retained');assert.equal(saved.league_link_enabled,false)
 await db.exec('reset role;delete from public.team_staff;set role authenticated')
 const read=(await db.query('select public.get_team_league_url($1) as value',[id(3)])).rows[0].value
 assert.equal(read.can_edit,false);assert.equal(read.league_url,null)
 await assert.rejects(db.query('select public.set_team_league_url($1,$2,true)',[id(3),'https://league.example/other']),/Team Admin access/)
})
