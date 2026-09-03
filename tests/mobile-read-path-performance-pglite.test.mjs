import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const availabilityTables = ['match_day_availability_requests', 'training_availability_requests', 'training_availability_request_players', 'training_availability_responses']

test('optimized reads preserve canonical staff, Parent, child, squad, archive and platform authority', async () => {
  const db = new PGlite()
  try {
    await db.exec(await readFile(new URL('./fixtures/mobile-speed-baseline.sql', import.meta.url), 'utf8'))
    for (const club of [1, 2]) await db.query('insert into clubs(id,name) values ($1,$2)', [uuid(club), `FP TEST Club ${club}`])
    for (const [team, club, archived] of [[10, 1, false], [11, 1, false], [12, 2, false], [13, 1, true]]) {
      await db.query('insert into teams(id,club_id,name,archived_at) values ($1,$2,$3,$4)', [uuid(team), uuid(club), `FP TEST Team ${team}`, archived ? '2026-01-01' : null])
      for (const table of availabilityTables) {
        const extra = table === 'match_day_availability_requests' ? ',match_day_id' : ''
        await db.query(`insert into ${table}(club_id,team_id${extra}) values ($1,$2${extra ? ',$3' : ''})`, extra ? [uuid(club), uuid(team), uuid(90)] : [uuid(club), uuid(team)])
      }
      await db.query('insert into parent_chat_rooms(id,room_type,club_id,team_id) values ($1,\'team\',$2,$3)', [uuid(100 + team), uuid(club), uuid(team)])
    }
    for (const [actor, role, rank, club] of [[20, 'coach', 40, 1], [21, 'admin', 100, 1], [22, 'parent_portal', 0, 1], [23, 'super_admin', 1000, 1], [24, 'coach', 40, 2], [25, 'coach', 40, 1], [26, 'coach', 40, 1]]) {
      await db.query('insert into users(id,role,role_rank,club_id) values ($1,$2,$3,$4)', [uuid(actor), role, rank, uuid(club)])
      if (actor !== 25) await db.query('insert into user_club_memberships values ($1,$2,$3,$4)', [uuid(actor), uuid(club), role, rank])
    }
    await db.query('insert into platform_admins(id) values ($1)', [uuid(23)])
    for (const [actor, team] of [[20, 10], [20, 13], [21, 10], [24, 12], [25, 10], [26, 10]]) await db.query('insert into team_staff values ($1,$2)', [uuid(actor), uuid(team)])
    await db.query('update users set status=\'suspended\' where id=$1', [uuid(26)])
    for (const [player, team] of [[30, 10], [31, 11]]) {
      await db.query('insert into players(id,club_id,team_id,player_name) values ($1,$2,$3,$4)', [uuid(player), uuid(1), uuid(team), `FP TEST Child ${player}`])
      await db.query('insert into parent_player_links(id,player_id,auth_user_id,club_id,team_id,created_at) values ($1,$2,$3,$4,$5,\'2026-08-01\')', [uuid(player + 10), uuid(player), uuid(22), uuid(1), uuid(team)])
      await db.query('insert into parent_chat_rooms(id,room_type,club_id,team_id,player_id) values ($1,\'parent_staff\',$2,$3,$4)', [uuid(100 + player), uuid(1), uuid(team), uuid(player)])
    }
    await db.query('insert into match_days(id,club_id,team_id) values ($1,$2,$3)', [uuid(90), uuid(1), uuid(10)])
    await db.query('insert into parent_chat_rooms(id,room_type,club_id,team_id,match_day_id) values ($1,\'match_squad\',$2,$3,$4)', [uuid(190), uuid(1), uuid(10), uuid(90)])
    await db.query('insert into match_day_player_squad_decisions(match_day_id,player_id,status,club_id,team_id) values ($1,$2,\'selected\',$3,$4)', [uuid(90), uuid(30), uuid(1), uuid(10)])
    await db.query('insert into parent_chat_memberships(room_id,auth_user_id,notifications_muted,last_read_at) values ($1,$2,true,\'2026-08-02\')', [uuid(110), uuid(22)])
    await db.exec(`insert into parent_chat_messages(room_id,sender_id,body,created_at) select id,'${uuid(20)}','old hidden message','2026-07-01' from parent_chat_rooms;
      insert into parent_chat_messages(room_id,sender_id,body,created_at) select id,'${uuid(20)}','current message','2026-08-03' from parent_chat_rooms;`)

    const actor = async (id) => {
      await db.exec('reset role')
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id ? uuid(id) : ''])
      await db.exec('set role authenticated')
    }
    const snapshot = async () => {
      const result = {}
      for (const id of [20, 21, 22, 23, 24, 25, 26, null]) {
        await actor(id)
        result[id] = { rooms: (await db.query('select * from get_parent_chat_rooms() order by id')).rows }
        for (const table of availabilityTables) result[id][table] = (await db.query(`select id from ${table} order by id`)).rows
      }
      await actor(22)
      result.parent = {}
      for (const link of [40, 41]) for (const childOnly of [true, false]) {
        result.parent[`${link}:${childOnly}`] = {
          rooms: (await db.query('select * from get_parent_portal_chat_rooms($1,$2) order by id', [uuid(link), childOnly])).rows,
          preferences: (await db.query('select * from get_parent_portal_chat_notification_preferences($1,$2) order by room_id', [uuid(link), childOnly])).rows,
        }
      }
      return result
    }
    const before = await snapshot()
    assert.equal(before[20].match_day_availability_requests.length, 1)
    assert.equal(before[21].match_day_availability_requests.length, 2)
    for (const id of [22, 25, 26, null]) assert.equal(before[id].match_day_availability_requests.length, 0)
    assert.equal(before[23].match_day_availability_requests.length, 4)
    await db.exec('reset role')
    const migration = await readFile(new URL('../supabase/migrations/20260903134841_mobile_read_path_performance.sql', import.meta.url), 'utf8')
    await db.exec(migration)
    await db.exec(migration)
    assert.deepEqual(await snapshot(), before)
    await actor(22)
    const joined = (await db.query('select * from get_parent_portal_chat_rooms_with_preferences($1,true) order by id', [uuid(40)])).rows
    assert.deepEqual(joined.map(({ notifications_muted, ...room }) => room), before.parent['40:true'].rooms)
    assert.equal(joined.find((room) => room.id === uuid(110)).notifications_muted, true)
    await assert.rejects(db.query('select * from get_parent_chat_rooms($1)', [uuid(10)]), /active Team/)
    await assert.rejects(db.query('select * from private.mobile_accessible_parent_chat_rooms(null)'), /permission denied/)
    await actor(20)
    assert.ok((await db.query('select * from get_parent_chat_rooms($1)', [uuid(10)])).rows.every((room) => room.team_id === uuid(10)))
    await assert.rejects(db.query('select * from get_parent_chat_rooms($1)', [uuid(11)]), /active Team/)
    await db.exec('reset role')
    await db.query('update parent_player_links set status=\'revoked\' where id=$1', [uuid(40)])
    await actor(22)
    await assert.rejects(db.query('select * from get_parent_portal_chat_rooms_with_preferences($1,true)', [uuid(40)]), /Parent access/)
    assert.ok((await db.query('select * from get_parent_chat_rooms()')).rows.every((room) => room.team_id !== uuid(10)))
  } finally { await db.close() }
})
