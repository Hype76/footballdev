import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const fixtureUrl = new URL('./adult-player-responses-pglite.test.mjs', import.meta.url)
const fixtureSource = await readFile(fixtureUrl, 'utf8')
const fixtureBody = fixtureSource.slice(fixtureSource.indexOf('const ids ='), fixtureSource.indexOf("test('adult player sees"))
  .replaceAll('import.meta.url', JSON.stringify(fixtureUrl.href))
const { ids, setClaims, createDatabase } = new Function('readFile', 'PGlite', 'migrationUrl', 'auditMigrationUrl', fixtureBody + ';return {ids,setClaims,createDatabase}')(readFile, PGlite,
  new URL('../supabase/migrations/20260730110000_adult_player_account_foundation.sql', import.meta.url),
  new URL('../supabase/migrations/20260730123000_adult_player_auth_only_audit_actor.sql', import.meta.url))
const sql = name => readFile(new URL('../supabase/migrations/' + name, import.meta.url), 'utf8')

test('real both-contact setup reserves, accepts existing auth-only Parent and creates new adult through link trigger and own-state RPC', async () => {
  const db = await createDatabase()
  try {
    const actor = '31000000-0000-4000-8000-000000000099'
    const fresh = '31000000-0000-4000-8000-000000000098'
    await db.exec(`
      delete from public.adult_player_account_links;
      alter table public.users add column role text, add column role_rank integer;
      alter table public.user_club_memberships add column club_id uuid, add column role text, add column role_rank integer;
      create table public.team_staff(id uuid, user_id uuid, team_id uuid, role_rank integer);
      insert into public.users(id,club_id,status,email,role,role_rank) values ('${actor}','${ids.club}','active','staff@example.test','admin',90);
      insert into public.user_club_memberships(auth_user_id,club_id,role,role_rank) values ('${actor}','${ids.club}','admin',90);
      update public.players set contact_type='both', parent_contacts='[{"type":"self","email":"adult@example.test"},{"type":"parent","email":"guardian@example.test"}]' where id='${ids.player}';
      update public.players set contact_type='parent',date_of_birth=current_date-interval '10 years' where id='${ids.otherPlayer}';
      insert into public.parent_player_links(auth_user_id,player_id,club_id,team_id,email) values ('${ids.user}','${ids.otherPlayer}','${ids.club}','${ids.team}','adult@example.test');
    `)
    const actorSource = await sql('20260728170000_staff_role_assignment_control.sql')
    await db.exec(actorSource.slice(actorSource.indexOf('create or replace function app_private.actor_can_manage_team_resource('), actorSource.indexOf('create or replace function app_private.record_staff_role_change_audit(')))
    for (const name of ['20261113114647_adult_player_setup_invites.sql', '20261116123543_adult_player_link_status.sql', '20261117100252_v1_adult_player_invitation_resend.sql', '20261117211430_adult_player_parent_access_coexistence.sql']) await db.exec(await sql(name))
    const call = async (name, args) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as result`, args)).rows[0].result
    const reserve = () => call('reserve_adult_player_setup_invite', [actor, ids.player])
    assert.equal((await reserve()).state, 'ineligible', 'proves original both-contact signup gap')
    await db.exec(await sql('20261118103811_adult_player_both_contact_setup_eligibility.sql'))
    assert.deepEqual((await call('list_adult_player_setup_resend_targets', [actor, ids.team])).player_ids, [ids.player])
    for (const change of ["date_of_birth=null", "date_of_birth=current_date-interval '17 years'", "parent_contacts='[{\"type\":\"parent\",\"email\":\"adult@example.test\"}]'", "parent_contacts='[{\"type\":\"self\",\"email\":\"adult@example.test\"},{\"type\":\"self\",\"email\":\"other@example.test\"}]'"]) {
      await db.exec('begin')
      await db.exec(`update public.players set ${change} where id='${ids.player}'`)
      assert.equal((await reserve()).state, 'ineligible')
      await db.exec('rollback')
    }
    const parentBefore = (await db.query('select * from public.parent_player_links order by id')).rows
    process.env.VITE_SUPABASE_URL ||= 'https://fixture.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-service-key'
    const { createAdultPlayerSetupHandler } = await import(pathToFileURL(process.cwd() + '/netlify/functions/adult-player-setup.js'))
    const handler = createAdultPlayerSetupHandler({
      getActor: async () => ({ id: ids.user, email: 'adult@example.test' }),
      client: {
        rpc: async (name, params) => {
          assert.equal(name, 'redeem_adult_player_setup_invite')
          return { data: await call(name, [params.invite_token, params.account_id ?? null]), error: null }
        },
        auth: { admin: { createUser: async options => {
          assert.equal(options.email, 'fresh@example.test')
          assert.equal(options.email_confirm, true)
          await db.query('insert into auth.users(id,email,email_confirmed_at) values ($1,$2,now())', [fresh, options.email])
          return { data: { user: { id: fresh } }, error: null }
        } } },
      },
    })
    const request = body => handler({ httpMethod: 'POST', body: JSON.stringify(body) })
    const invite = await reserve()
    assert.equal(invite.state, 'pending')
    assert.equal(invite.email, 'adult@example.test')
    assert.equal((await request({ action: 'accept', token: invite.token })).statusCode, 200)
    await setClaims(db, ids.user)
    assert.equal((await db.query('select * from public.get_own_adult_player_account_state()')).rows[0].access_granted, true)
    assert.equal((await db.query('select count(*)::integer as count from public.users where id=$1', [ids.user])).rows[0].count, 0)
    assert.deepEqual((await db.query('select * from public.parent_player_links order by id')).rows, parentBefore)
    await db.exec(`update public.adult_player_account_links set status='revoked'; update public.players set parent_contacts='[{"type":"self","email":"fresh@example.test"},{"type":"parent","email":"guardian@example.test"}]' where id='${ids.player}'`)
    const freshInvite = await reserve()
    assert.equal(freshInvite.state, 'pending')
    assert.equal((await request({ action: 'create', token: freshInvite.token, email: 'fresh@example.test', password: 'LongEnough123!' })).statusCode, 200)
    await setClaims(db, fresh)
    assert.equal((await db.query('select * from public.get_own_adult_player_account_state()')).rows[0].access_granted, true)
    assert.deepEqual((await db.query('select * from public.parent_player_links order by id')).rows, parentBefore)
  } finally {
    await db.close()
  }
})
