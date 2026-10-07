import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const id = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const authority = (await readFile('supabase/migrations/20260720173941_p2_privileged_function_authority_hardening.sql', 'utf8'))
  .match(/create or replace function app_private\.actor_can_manage_team_resource[\s\S]*?\$\$;/)[0]
const migration = (await readFile('supabase/migrations/20261007114801_phone_team_coach_roster_removal.sql', 'utf8'))
  .split('-- BEGIN COACH ASSESSMENT PARENT NOTIFICATIONS')[1].split('-- END COACH ASSESSMENT PARENT NOTIFICATIONS')[0]

// Synthetic tables and controlled plan switches isolate the actual notification SQL
// and canonical actor helper. Native full-schema rehearsal remains a separate gate.
async function fixture(t, devices = 2) {
  const db = new PGlite(); t.after(() => db.close())
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema app_private;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz default now(),banned_until timestamptz);
    create table clubs(id uuid primary key,name text,status text default 'active',archived_at timestamptz);
    create table teams(id uuid primary key,club_id uuid,name text,notification_display_name text,status text default 'active',archived_at timestamptz);
    create table users(id uuid primary key,club_id uuid,role text,role_rank integer,status text default 'active');
    create table user_club_memberships(auth_user_id uuid,club_id uuid,role text,role_rank integer);
    create table team_staff(id uuid primary key,team_id uuid,user_id uuid,role_key text,role_rank integer);
    create table players(id uuid primary key,club_id uuid,team_id uuid,status text default 'active');
    create table evaluations(id uuid primary key,club_id uuid,team_id uuid,player_id uuid,coach_id uuid,status text);
    create table development_parent_reports(evaluation_id uuid primary key,club_id uuid,report_snapshot jsonb,finalized_by uuid);
    create table parent_player_links(id uuid primary key,auth_user_id uuid,club_id uuid,team_id uuid,player_id uuid,link_type text default 'parent',status text default 'active',receives_communications boolean default true);
    create table parent_communication_preferences(auth_user_id uuid primary key,communication_channel text);
    create table parent_mobile_push_installations(installation_id uuid primary key,auth_user_id uuid,parent_link_id uuid,club_id uuid,team_id uuid,expo_push_token text,enabled boolean default true,status text default 'active',detail_level text default 'detailed',updated_at timestamptz);
    create table parent_mobile_notification_events(id bigint generated always as identity primary key,auth_user_id uuid,parent_link_id uuid,club_id uuid,team_id uuid,intent_type text,title text,body text,data jsonb,status text,sent_at timestamptz,dedupe_key text unique);
    create function public.is_club_plan_access_active(uuid) returns boolean language sql as $$select coalesce(current_setting('test.plan',true),'yes')<>'no'$$;
    create function public.can_use_plan_feature(uuid,text) returns boolean language sql as $$select coalesce(current_setting('test.feature',true),'yes')<>'no'$$;
    insert into auth.users(id) values('${id(1)}'),('${id(2)}'),('${id(3)}');
    insert into clubs(id,name) values('${id(10)}','Club');
    insert into teams(id,club_id,name) values('${id(20)}','${id(10)}','U14'),('${id(21)}','${id(10)}','U12');
    insert into users(id,club_id,role,role_rank) values('${id(1)}','${id(10)}','coach',30),('${id(2)}','${id(10)}','parent_portal',0),('${id(3)}','${id(10)}','coach',30);
    insert into user_club_memberships select id,club_id,role,role_rank from users;
    insert into team_staff values('${id(30)}','${id(20)}','${id(1)}','coach',30);
    insert into players(id,club_id,team_id) values('${id(40)}','${id(10)}','${id(20)}'),('${id(41)}','${id(10)}','${id(21)}');
    insert into parent_player_links(id,auth_user_id,club_id,team_id,player_id) values('${id(50)}','${id(2)}','${id(10)}','${id(20)}','${id(40)}'),('${id(51)}','${id(2)}','${id(10)}','${id(21)}','${id(41)}');
    insert into evaluations values('${id(60)}','${id(10)}','${id(20)}','${id(40)}','${id(1)}','Submitted');
    insert into development_parent_reports values('${id(60)}','${id(10)}',jsonb_build_object('evaluationId','${id(60)}','club',jsonb_build_object('id','${id(10)}'),'team',jsonb_build_object('id','${id(20)}'),'player',jsonb_build_object('id','${id(40)}'),'author',jsonb_build_object('id','${id(1)}'),'recipients',jsonb_build_array(jsonb_build_object('linkId','${id(50)}'))),'${id(1)}');`)
  for (let i = 0; i < devices; i++) {
    const otherChild = i % 2 === 1
    await db.query(`insert into parent_mobile_push_installations(installation_id,auth_user_id,parent_link_id,club_id,team_id,expo_push_token) values($1,$2,$3,$4,$5,$6)`,
      [id(100 + i), id(2), id(otherChild ? 51 : 50), id(10), id(otherChild ? 21 : 20), `ExpoPushToken[device_${i}]`])
  }
  await db.exec(authority); await db.exec(migration)
  const rpc = async (name, args) => (await db.query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args)).rows[0].result
  const claim = (links = [id(50)]) => rpc('claim_coach_assessment_notifications', [id(1), id(60), links])
  const complete = (d, delivered = true, invalid = false, skipped = false) => rpc('complete_coach_assessment_notification', [d.id, d.lease, delivered, invalid, skipped])
  return { db, rpc, claim, complete }
}

test('actual notification SQL creates one targeted inbox item and each active installation once, including other selected child', async t => {
  const { db, claim, complete } = await fixture(t)
  const first = await claim([id(50), id(50)])
  assert.equal(first.inboxRecipients, 1); assert.equal(first.deliveries.length, 2); assert.equal(first.remaining, 2)
  assert.ok(first.deliveries.every(d => d.parentLinkId === id(50) && d.teamId === id(20)))
  const concurrent = await claim(); assert.equal(concurrent.deliveries.length, 0); assert.equal(concurrent.remaining, 2)
  for (const d of first.deliveries) assert.equal(await complete(d), true)
  const again = await claim(); assert.equal(again.deliveries.length, 0); assert.equal(again.remaining, 0)
  const inbox = (await db.query('select * from parent_mobile_notification_events')).rows
  assert.equal(inbox.length, 1); assert.equal(inbox[0].intent_type, 'parent_message'); assert.equal(inbox[0].data.type, 'development_report')
  assert.equal(inbox[0].data.reportId, id(60)); assert.equal(inbox[0].data.parentLinkId, id(50))
})

test('inbox persists with no registered device and 12-device batches retain pending work', async t => {
  const { db, claim, complete } = await fixture(t, 13)
  const first = await claim(); assert.equal(first.deliveries.length, 12); assert.equal(first.remaining, 13)
  for (const d of first.deliveries) await complete(d)
  const second = await claim(); assert.equal(second.deliveries.length, 1); await complete(second.deliveries[0])
  await db.exec('delete from parent_mobile_push_installations')
  assert.equal((await claim()).remaining, 0)
  assert.equal((await db.query('select count(*) n from parent_mobile_notification_events')).rows[0].n, 1)
})

test('lease failure is recoverable, wrong or expired lease denied, invalid token only revokes matching current installation', async t => {
  const { db, rpc, claim, complete } = await fixture(t, 1)
  const d = (await claim()).deliveries[0]
  assert.equal(await complete({ ...d, lease: id(999) }), false)
  assert.equal(await complete(d, false), true)
  const retry = (await claim()).deliveries[0]; assert.notEqual(retry.lease, d.lease)
  await db.query("update app_private.coach_assessment_notification_deliveries set leased_until=now()-interval '1 second' where id=$1", [retry.id])
  assert.equal(await complete(retry), false)
  const valid = (await claim()).deliveries[0]
  await db.exec("update parent_mobile_push_installations set expo_push_token='ExpoPushToken[rotated]'")
  assert.equal(await rpc('coach_assessment_notification_is_current', [valid.id, valid.lease]), false)
  assert.equal(await complete(valid, false, true), true)
  const i = (await db.query('select * from parent_mobile_push_installations')).rows[0]
  assert.equal(i.enabled, true); assert.equal(i.expo_push_token, 'ExpoPushToken[rotated]')
  assert.equal((await claim()).remaining, 0)
})

test('invalid matching provider token is terminal and disabled without duplicating inbox', async t => {
  const { db, claim, complete } = await fixture(t, 1)
  const d = (await claim()).deliveries[0]; assert.equal(await complete(d, false, true), true)
  const i = (await db.query('select * from parent_mobile_push_installations')).rows[0]
  assert.equal(i.enabled, false); assert.equal(i.status, 'revoked'); assert.equal(i.expo_push_token, null)
  assert.equal((await claim()).remaining, 0)
  assert.equal((await db.query('select count(*) n from parent_mobile_notification_events')).rows[0].n, 1)
})

test('fresh recipient, bound-child, preference, installation and target authority prevent delivery after claim', async t => {
  const { db, rpc, claim } = await fixture(t, 2)
  const deliveries = (await claim()).deliveries
  const targetDevice = deliveries.find(d => d.to === 'ExpoPushToken[device_0]')
  const otherDevice = deliveries.find(d => d.to === 'ExpoPushToken[device_1]')
  const current = d => rpc('coach_assessment_notification_is_current', [d.id, d.lease])
  for (const [apply, restore, affected] of [
    [`update parent_player_links set status='revoked' where id='${id(51)}'`,`update parent_player_links set status='active' where id='${id(51)}'`, [otherDevice]],
    [`update players set status='inactive' where id='${id(41)}'`,`update players set status='active' where id='${id(41)}'`, [otherDevice]],
    [`update parent_player_links set status='revoked' where id='${id(50)}'`,`update parent_player_links set status='active' where id='${id(50)}'`, deliveries],
    [`update parent_player_links set receives_communications=false where id='${id(50)}'`,`update parent_player_links set receives_communications=true where id='${id(50)}'`, deliveries],
    [`update auth.users set banned_until=now()+interval '1 day' where id='${id(2)}'`,`update auth.users set banned_until=null where id='${id(2)}'`, deliveries],
    [`update auth.users set email_confirmed_at=null where id='${id(2)}'`,`update auth.users set email_confirmed_at=now() where id='${id(2)}'`, deliveries],
    [`update users set status='suspended' where id='${id(2)}'`,`update users set status='active' where id='${id(2)}'`, deliveries],
    [`update players set team_id='${id(21)}' where id='${id(40)}'`,`update players set team_id='${id(20)}' where id='${id(40)}'`, deliveries],
    [`insert into parent_communication_preferences values('${id(2)}','email')`,`delete from parent_communication_preferences`, deliveries],
    [`update parent_mobile_push_installations set enabled=false where installation_id='${id(100)}'`,`update parent_mobile_push_installations set enabled=true where installation_id='${id(100)}'`, [targetDevice]],
    [`update teams set archived_at=now() where id='${id(20)}'`,`update teams set archived_at=null where id='${id(20)}'`, deliveries],
    [`set test.plan='no'`,`set test.plan='yes'`, deliveries],
    [`set test.feature='no'`,`set test.feature='yes'`, deliveries],
    [`delete from team_staff`,`insert into team_staff values('${id(30)}','${id(20)}','${id(1)}','coach',30)`, deliveries],
  ]) {
    await db.exec(apply)
    for (const d of affected) assert.equal(await current(d), false, apply)
    if (affected.length === 1) assert.equal(await current(affected[0] === otherDevice ? targetDevice : otherDevice), true, 'unaffected installation')
    await db.exec(restore)
    for (const d of deliveries) assert.equal(await current(d), true, restore)
  }
})

test('claim fails closed for wrong actor, recipient or snapshot and all public callers/private direct reads', async t => {
  const { db, rpc, claim } = await fixture(t, 1)
  await assert.rejects(rpc('claim_coach_assessment_notifications', [id(3), id(60), [id(50)]]), /authority/)
  for (const links of [[], [id(51)], [null], Array(33).fill(id(50))]) await assert.rejects(claim(links), /selected parents/)
  await db.exec(`update development_parent_reports set report_snapshot=jsonb_set(report_snapshot,'{author,id}','"${id(3)}"')`)
  await assert.rejects(claim(), /authority/)
  assert.equal((await db.query('select count(*) n from parent_mobile_notification_events')).rows[0].n, 0)
  await db.exec(`update development_parent_reports set report_snapshot=jsonb_set(report_snapshot,'{author,id}','"${id(1)}"')`)
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`); await assert.rejects(claim(), /permission denied/)
    await assert.rejects(db.query('select * from app_private.coach_assessment_notification_deliveries'), /permission denied/)
    await db.exec('reset role')
  }
  await db.exec('set role service_role')
  await assert.rejects(db.query('select * from app_private.coach_assessment_notification_deliveries'), /permission denied/)
  assert.equal((await claim()).deliveries.length, 1); await db.exec('reset role')
})
