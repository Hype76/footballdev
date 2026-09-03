import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

test('staff unread summary counts current context messages and respects membership read state', async () => {
  const db = new PGlite()
  try {
    await db.exec(await readFile(new URL('./fixtures/mobile-speed-baseline.sql', import.meta.url), 'utf8'))
    const staffSql = await readFile(new URL('../supabase/migrations/20260702055000_staff_chat_v1.sql', import.meta.url), 'utf8')
    await db.exec(staffSql)
    const contextFile = await readFile(new URL('../supabase/migrations/20260810110534_active_team_chat_context_36b.sql', import.meta.url), 'utf8')
    const contextStart = contextFile.indexOf('create or replace function public.staff_chat_active_team_is_valid')
    const contextEnd = contextFile.indexOf('create or replace function public.create_staff_chat_conversation', contextStart)
    await db.exec(contextFile.slice(contextStart, contextEnd))
    await db.exec(await readFile(new URL('../supabase/migrations/20260903151551_mobile_chat_unread_summary.sql', import.meta.url), 'utf8'))
    await db.query('insert into clubs(id,name) values ($1,$2),($3,$4)', [uuid(1), 'FP TEST One', uuid(2), 'FP TEST Two'])
    await db.query('insert into teams(id,club_id,name) values ($1,$2,$3),($4,$5,$6)', [uuid(10), uuid(1), 'Team One', uuid(20), uuid(2), 'Team Two'])
    for (const [id, club] of [[100, 1], [101, 1], [102, 2]]) {
      await db.query("insert into users(id,club_id,role,role_rank,status) values ($1,$2,'coach',40,'active')", [uuid(id), uuid(club)])
    }
    await db.query('insert into user_club_memberships values ($1,$2,$3,$4)', [uuid(100), uuid(1), 'coach', 40])
    await db.query('insert into team_staff values ($1,$2)', [uuid(100), uuid(10)])
    await db.query("insert into staff_chat_conversations(id,club_id,team_id,type,title,created_by) values ($1,$2,$3,'team_staff','Own Team',$4),($5,$6,$7,'team_staff','Other Club',$8)", [uuid(30), uuid(1), uuid(10), uuid(100), uuid(31), uuid(2), uuid(20), uuid(102)])
    await db.query('insert into staff_chat_members(conversation_id,club_id,user_id,added_by,last_read_at) values ($1,$2,$3,$3,$4),($1,$2,$5,$3,null)', [uuid(30), uuid(1), uuid(100), '2026-09-03T12:00:00Z', uuid(101)])
    for (const [id, sender, body, deleted, at] of [[40,101,'unread',null,'2026-09-03T13:00Z'],[41,101,'read',null,'2026-09-03T11:00Z'],[42,100,'self',null,'2026-09-03T13:00Z'],[43,101,'deleted','2026-09-03T13:30Z','2026-09-03T13:00Z']]) {
      await db.query('insert into staff_chat_messages(id,conversation_id,club_id,sender_id,body,deleted_at,created_at) values ($1,$2,$3,$4,$5,$6,$7)', [uuid(id), uuid(30), uuid(1), uuid(sender), body, deleted, at])
    }
    await db.query('update staff_chat_members set last_read_at=$1 where conversation_id=$2 and user_id=$3', ['2026-09-03T12:00:00Z', uuid(30), uuid(100)])
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uuid(100)}',false)`)
    const { rows } = await db.query('select * from get_staff_chat_unread_summary($1)', [uuid(10)])
    assert.deepEqual(rows.map((row) => ({ id: row.id, count: Number(row.unread_count) })), [{ id: uuid(30), count: 1 }])
    await assert.rejects(db.query('select * from get_staff_chat_unread_summary($1)', [uuid(20)]), /active Team/)
    await db.query('select mark_staff_chat_conversation_read($1)', [uuid(30)])
    assert.equal(Number((await db.query('select * from get_staff_chat_unread_summary($1)', [uuid(10)])).rows[0].unread_count), 0)
    await db.query('update staff_chat_members set archived_at=now() where conversation_id=$1 and user_id=$2', [uuid(30), uuid(100)])
    assert.equal((await db.query('select * from get_staff_chat_unread_summary($1)', [uuid(10)])).rows.length, 0)
    await db.exec('reset role; set role anon')
    await assert.rejects(db.query('select * from get_staff_chat_unread_summary($1)', [uuid(10)]), /permission denied/)
  } finally { await db.close() }
})
