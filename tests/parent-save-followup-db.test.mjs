import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const followup = await readFile(new URL('../supabase/migrations/20260902104350_parent_save_notifications_followup.sql', import.meta.url), 'utf8')
const responseFunction = followup.match(/create or replace function public\.respond_parent_portal_training_invitation[\s\S]*?\$\$;/)[0]
const id = (n) => `80000000-0000-4000-8000-${String(n).padStart(12, '0')}`

test('Parent training response saves with failed email delivery and retains authority, expiry and idempotency', async () => {
  const source = await readFile(new URL('./event-invite-status-staff-acceptance-db.test.mjs', import.meta.url), 'utf8')
  const schema = source.match(/await db.exec\(`([\s\S]*?)`\)/)[1]
  const authority = await readFile(new URL('../supabase/migrations/20260825133414_cross_club_parent_link_authority_100.sql', import.meta.url), 'utf8')
  const db = new PGlite()
  try {
    await db.exec(schema)
    await db.exec(`
      create table auth.users (id uuid primary key, raw_user_meta_data jsonb default '{}'::jsonb);
      create table public.clubs (id uuid primary key, status text);
      create table public.parent_player_links (id uuid primary key, club_id uuid, team_id uuid, player_id uuid, auth_user_id uuid, status text, email text);
      alter table public.training_availability_request_players add column response_deadline_at timestamptz, add column recipient_type text, add column parent_link_id uuid, add column token_revoked_at timestamptz;
      alter table public.training_availability_responses add constraint response_parent_fkey foreign key (parent_link_id) references public.parent_player_links(id);
      alter table public.training_availability_responses add constraint response_player_fkey foreign key (request_player_id) references public.training_availability_request_players(id);
      insert into auth.users(id) values ('${id(1)}');
      insert into public.clubs values ('${id(2)}', 'active');
      insert into public.players(id, club_id, team_id, status) values ('${id(4)}','${id(2)}','${id(3)}','active');
      insert into public.parent_player_links values ('${id(5)}','${id(2)}','${id(3)}','${id(4)}','${id(1)}','active','parent@example.test');
      insert into public.calendar_events(id,club_id,team_id,event_type) values ('${id(6)}','${id(2)}','${id(3)}','training');
      insert into public.training_availability_requests(id,club_id,team_id,calendar_event_id,occurrence_date,occurrence_starts_at,status)
        values ('${id(7)}','${id(2)}','${id(3)}','${id(6)}',current_date+1,now()+interval '1 day','partial_failed');
      insert into public.training_availability_request_players(id,request_id,club_id,team_id,calendar_event_id,player_id,status,recipient_type)
        values ('${id(8)}','${id(7)}','${id(2)}','${id(3)}','${id(6)}','${id(4)}','failed','unavailable');
      select set_config('request.jwt.claims','{"sub":"${id(1)}"}',false);
    `)
    await db.exec(authority.match(/create or replace function public\.current_user_can_access_parent_link\([\s\S]*?\$\$;/)[0])
    await db.exec(responseFunction)
    const save = async (response = 'available', link = id(5)) => (await db.query('select public.respond_parent_portal_training_invitation($1,$2,$3) as result',[link,id(8),response])).rows[0].result
    const first = await save()
    assert.equal(first.changed,true)
    assert.equal(first.responseState,'available')
    assert.equal((await save()).changed,false)
    assert.equal((await save()).respondedAt,first.respondedAt)
    assert.equal((await db.query('select parent_link_id from public.training_availability_responses')).rows[0].parent_link_id,id(5))
    assert.equal((await db.query('select status from public.training_availability_request_players')).rows[0].status,'responded')
    assert.equal((await save('maybe')).responseState,'maybe')
    await assert.rejects(save('available',id(99)),/parent portal link/)
    await db.query("update public.parent_player_links set status='revoked'")
    await assert.rejects(save(),/parent portal link/)
    await db.query("update public.parent_player_links set status='active'")
    await db.query("insert into public.users(id,club_id,role,status) values ($1,$2,'parent_portal','suspended')",[id(1),id(2)])
    await assert.rejects(save(),/parent portal link/)
    await db.query('delete from public.users')
    await db.query("update public.training_availability_request_players set status='cancelled'")
    await assert.rejects(save(),/window has closed/)
    await db.query("update public.training_availability_request_players set status='responded',response_deadline_at=now()-interval '1 minute'")
    await assert.rejects(save(),/window has closed/)
    assert.equal((await db.query('select count(*)::integer as n from public.training_availability_responses')).rows[0].n,1)
  } finally { await db.close() }
})
