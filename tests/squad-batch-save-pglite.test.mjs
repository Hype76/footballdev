import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
const migration = await readFile('supabase/migrations/20260917100816_squad_atomic_batch_save.sql','utf8')
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`
test('batch RPC commits together, rolls back conflicts, validates input and enforces scope', async t => {
  const db = new PGlite(); t.after(()=>db.close())
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create table saved(player_id uuid primary key,status text,decided_at timestamptz);
    create function get_staff_match_day_detail(uuid,uuid) returns jsonb language plpgsql set search_path = public as $$begin
      if $2 <> '${id(2)}' then raise exception 'Wrong team';end if;
      return jsonb_build_object('id',$1,'squadDecisions',(select jsonb_agg(to_jsonb(s)) from saved s));end;$$;
    create function set_match_day_player_squad_decision(uuid,uuid,text) returns void language plpgsql set search_path = public as $$begin
      if current_setting('test.allowed',true)='no' then raise exception 'Permission denied';end if;
      if $2='${id(99)}' then raise exception 'Wrong player';end if;
    end;$$;
    create function set_match_day_player_squad_decision_v2(uuid,uuid,text,timestamptz) returns void language plpgsql set search_path = public as $$begin
      if exists(select 1 from saved where player_id=$2 and decided_at is distinct from $4) then raise exception 'Conflict';end if;
      perform set_match_day_player_squad_decision($1,$2,$3);
      insert into saved values($2,$3,now()) on conflict(player_id) do update set status=excluded.status,decided_at=excluded.decided_at;
    end;$$;
    select set_config('test.actor','${id(1)}',false);`)
  await db.exec(migration)
  const choice = n => ({playerId:id(n),decision:'selected',expectedDecidedAt:null})
  const save = (rows, team=id(2)) => db.query('select set_match_day_squad_decisions_batch($1,$2,$3) result',[id(3),team,JSON.stringify(rows)])
  const count = async()=>Number((await db.query('select count(*) n from saved')).rows[0].n)
  assert.equal((await save(Array.from({length:10},(_,i)=>choice(i+10)))).rows[0].result.squadDecisions.length,10)
  await assert.rejects(save([choice(4),choice(10)]),/Conflict/)
  assert.equal(await count(),10,'Earlier changes must roll back on a later conflict')
  await assert.rejects(save([choice(4),choice(99)]),/Wrong player/);assert.equal(await count(),10)
  await assert.rejects(save([choice(4)],id(90)),/Wrong team/)
  for(const bad of [[],{},null,[choice(4),choice(4)],[{decision:'selected'}],Array.from({length:101},(_,i)=>choice(i+100))]) await assert.rejects(save(bad))
  await db.exec("select set_config('test.allowed','no',false)")
  await assert.rejects(save([choice(4)]),/Permission denied/)
  await db.exec("select set_config('test.actor','',false)")
  await assert.rejects(save([choice(4)]),/Login/)
  const privileges=(await db.query("select has_function_privilege('anon','public.set_match_day_squad_decisions_batch(uuid,uuid,jsonb)','execute') anon,has_function_privilege('authenticated','public.set_match_day_squad_decisions_batch(uuid,uuid,jsonb)','execute') authenticated")).rows[0]
  assert.deepEqual(privileges,{anon:false,authenticated:true})
})
