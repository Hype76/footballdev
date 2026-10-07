import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const migration = (await readFile('supabase/migrations/20261007071022_coach_team_administration_reminders.sql', 'utf8'))
  .split('-- BEGIN TEAM ADMINISTRATION REMINDERS')[1].split('-- END TEAM ADMINISTRATION REMINDERS')[0]
async function fixture(t) {
  const db = new PGlite(); t.after(() => db.close())
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema app_private;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz default now(),banned_until timestamptz);
    create table public.clubs(id uuid primary key,status text default 'active',archived_at timestamptz);
    create table public.teams(id uuid primary key,club_id uuid,status text default 'active',archived_at timestamptz,name text);
    create table public.users(id uuid primary key,club_id uuid,status text default 'active',role text,role_rank integer,email text);
    create table public.user_club_memberships(auth_user_id uuid,club_id uuid,role text,role_rank integer);
    create table public.team_staff(id uuid default gen_random_uuid(),team_id uuid,user_id uuid,role_key text,role_rank integer);
    create table public.club_user_invites(id uuid primary key default gen_random_uuid(),club_id uuid,email text,role_key text,role_label text,role_rank integer,
      created_by uuid,invite_token uuid,team_id uuid,expires_at timestamptz,status text,accepted_at timestamptz,cancelled_at timestamptz,replaced_at timestamptz,invite_sent_at timestamptz);
    create table public.match_days(id uuid primary key,club_id uuid,team_id uuid,match_date date,kickoff_time time,kickoff_time_tbc boolean default false,deleted_at timestamptz,status text default 'scheduled',opponent text);
    create table public.match_day_player_squad_decisions(id uuid,match_day_id uuid,player_id uuid,status text,notified_at timestamptz);
    create table public.match_day_availability_requests(id uuid,match_day_id uuid,team_id uuid,club_id uuid,player_id uuid,status text,responded_at timestamptz,token_revoked_at timestamptz,sent_at timestamptz);
    create table public.match_day_player_availability(match_day_id uuid,player_id uuid,status text);
    create table public.calendar_events(id uuid primary key,team_id uuid,club_id uuid,cancelled_at timestamptz);
    create table public.training_availability_requests(id uuid,calendar_event_id uuid,team_id uuid,club_id uuid,occurrence_date date,occurrence_starts_at timestamptz,status text);
    create table public.training_availability_request_players(id uuid,request_id uuid,player_id uuid,status text,email_sent_at timestamptz);
    create table public.training_availability_responses(request_id uuid,player_id uuid);
    create table public.coach_mobile_notification_events(id bigint generated always as identity primary key,auth_user_id uuid,user_profile_id uuid,club_id uuid,team_id uuid,intent_type text,title text,body text,data jsonb,status text);
    create function public.is_club_plan_access_active(uuid) returns boolean language sql as $$select coalesce(current_setting('test.plan',true),'yes')<>'no'$$;
    create function public.can_use_plan_feature(uuid,text) returns boolean language sql as $$select coalesce(current_setting('test.feature',true),'yes')<>'no'$$;
    create function app_private.actor_can_manage_team_resource(uuid,uuid,uuid,integer) returns boolean language sql as $$
      select exists(select 1 from public.users u join public.team_staff s on s.user_id=u.id and s.team_id=$3
        where u.id=$1 and u.club_id=$2 and u.status='active' and s.role_rank >= $4)$$;
    insert into auth.users(id) values('${id(1)}'),('${id(2)}'),('${id(3)}'),('${id(4)}');
    insert into clubs(id) values('${id(10)}'),('${id(11)}');
    insert into teams(id,club_id,name) values('${id(20)}','${id(10)}','Team A'),('${id(21)}','${id(11)}','Team B');
    insert into users(id,club_id,role,role_rank,email) values
      ('${id(1)}','${id(10)}','head_manager',70,'admin@example.com'),('${id(2)}','${id(10)}','coach',30,'coach@example.com'),
      ('${id(3)}','${id(10)}','manager',50,'manager@example.com'),('${id(4)}','${id(11)}','head_manager',70,'other@example.com');
    insert into user_club_memberships select id,club_id,role,role_rank from users;
    insert into team_staff(team_id,user_id,role_key,role_rank) values
      ('${id(20)}','${id(1)}','head_manager',70),('${id(20)}','${id(2)}','coach',30),('${id(20)}','${id(3)}','manager',50),('${id(21)}','${id(4)}','head_manager',70);
    insert into match_days(id,club_id,team_id,match_date,kickoff_time,opponent)
      values('${id(30)}','${id(10)}','${id(20)}',((now()+interval '24 hours') at time zone 'Europe/London')::date,((now()+interval '24 hours') at time zone 'Europe/London')::time,'Opposition');`)
  await db.exec(migration)
  const rpc = async (name, args) => (await db.query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args)).rows.map(row => row.result)
  return { db, rpc }
}
test('real SQL policy is opt-in, strict Team Admin only and denies revoked, suspended, banned or cross-team actors', async t => {
  const { db, rpc } = await fixture(t)
  const initial = (await rpc('manage_team_reminder_policy', [id(2), id(20), 'read']))[0]
  assert.equal(initial.canManage, false); assert.equal(initial.squadEnabled, false); assert.equal(initial.squadHoursBefore, 48)
  for (const actor of [id(2), id(3), id(4)]) await assert.rejects(rpc('manage_team_reminder_policy', [actor, id(20), 'save', true, 48, true, 48]), /team admin|Active access/)
  await assert.rejects(rpc('manage_team_reminder_policy', [id(1), id(20), 'save', true, null, true, 48]), /1 to 168/)
  const saved = (await rpc('manage_team_reminder_policy', [id(1), id(20), 'save', true, 48, true, 48]))[0]
  assert.equal(saved.canManage, true); assert.equal(saved.squadEnabled, true)
  for (const [apply, restore] of [
    [`update users set status='suspended' where id='${id(1)}'`,`update users set status='active' where id='${id(1)}'`],
    [`update auth.users set banned_until=now()+interval '1 day' where id='${id(1)}'`,`update auth.users set banned_until=null where id='${id(1)}'`],
    [`delete from user_club_memberships where auth_user_id='${id(1)}'`,`insert into user_club_memberships select id,club_id,role,role_rank from users where id='${id(1)}'`],
    [`update teams set archived_at=now() where id='${id(20)}'`,`update teams set archived_at=null where id='${id(20)}'`],
  ]) {
    await db.exec(apply)
    await assert.rejects(rpc('manage_team_reminder_policy', [id(1), id(20), 'save', true, 48, true, 48]))
    if (apply.includes('banned_until') || apply.includes('suspended')) await assert.rejects(rpc('manage_team_reminder_policy', [id(1), id(20), 'read']))
    await db.exec(restore)
  }
  await db.exec('set role authenticated')
  await assert.rejects(rpc('manage_team_reminder_policy', [id(1), id(20), 'read']), /permission denied/)
  await db.exec('reset role')
})
test('real SQL invitation reservation preserves existing invitations, denies elevated roles and enforces capacity', async t => {
  const { db, rpc } = await fixture(t)
  const invite = (await rpc('create_phone_team_coach_invite', [id(1), id(20), 'NEW@example.com', 'coach', 5]))[0]
  const repeat = (await rpc('create_phone_team_coach_invite', [id(1), id(20), 'new@example.com', 'coach', 5]))[0]
  assert.equal(invite.inviteId, repeat.inviteId)
  assert.equal((await db.query('select count(*) n from club_user_invites')).rows[0].n, 1)
  await assert.rejects(rpc('create_phone_team_coach_invite', [id(3), id(20), 'new@example.com', 'coach', 5]), /team admin/)
  await assert.rejects(rpc('create_phone_team_coach_invite', [id(1), id(20), 'new@example.com', 'admin', 5]), /valid coach/)
  await assert.rejects(rpc('create_phone_team_coach_invite', [id(1), id(20), 'another@example.com', 'coach', 4]), /allowance/)
  const existing = (await rpc('create_phone_team_coach_invite', [id(1), id(20), 'coach@example.com', 'coach', 5]))[0]
  assert.equal(existing.kind, 'existing'); assert.equal(existing.userId, id(2))
})
test('SQL worker uses exact pending responses, stable per-user squad receipts and current policy checks', async t => {
  const { db, rpc } = await fixture(t)
  assert.deepEqual(await rpc('claim_due_team_reminders', [25]), [])
  await rpc('manage_team_reminder_policy', [id(1), id(20), 'save', true, 48, true, 48])
  await db.exec(`insert into match_day_availability_requests values('${id(31)}','${id(30)}','${id(20)}','${id(10)}','${id(40)}','pending',null,null,now());`)
  const jobs = await rpc('claim_due_team_reminders', [25])
  assert.equal(jobs.filter(job => job.kind === 'squad').length, 3)
  assert.equal(jobs.filter(job => job.kind === 'availability').length, 1)
  assert.deepEqual(await rpc('claim_due_team_reminders', [25]), [], 'A second worker cannot claim an active lease')
  const squad = jobs.find(job => job.kind === 'squad')
  const inbox1 = (await rpc('record_team_reminder_inbox', [squad.deliveryKey]))[0]
  assert.equal((await rpc('record_team_reminder_inbox', [squad.deliveryKey]))[0], inbox1)
  assert.equal((await db.query('select count(*) n from coach_mobile_notification_events')).rows[0].n, 1)
  assert.equal((await rpc('finish_team_reminder', [squad.deliveryKey, id(99), '']))[0], false, 'An old or wrong lease cannot acknowledge the current job')
  assert.equal((await rpc('finish_team_reminder', [squad.deliveryKey, squad.leaseId, '']))[0], true)
  const availability = jobs.find(job => job.kind === 'availability')
  assert.equal((await rpc('team_reminder_is_current', [availability.deliveryKey]))[0], true)
  await db.exec(`insert into match_day_player_availability values('${id(30)}','${id(40)}','maybe')`)
  assert.equal((await rpc('team_reminder_is_current', [availability.deliveryKey]))[0], false, 'Any recorded response suppresses reminder delivery')
  await rpc('manage_team_reminder_policy', [id(1), id(20), 'save', false, 48, false, 48])
  assert.equal((await rpc('team_reminder_is_current', [squad.deliveryKey]))[0], false)
})


test('actual phone reservation and canonical email handler accept assigned head70/global coach30 only with fresh stored invitation authority', async t => {
  const { db, rpc } = await fixture(t)
  await db.exec(`update users set role='coach',role_rank=30 where id='${id(1)}';
    update user_club_memberships set role='coach',role_rank=30 where auth_user_id='${id(1)}';`)
  process.env.VITE_SUPABASE_URL = 'https://isolated.invalid'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'isolated-test-key'
  const { createStaffInviteHandler } = await import('../netlify/functions/send-staff-invite.js')
  const { createPhoneTeamAdministrationHandler } = await import('../netlify/functions/lib/_phone-team-administration.js')
  let actor = id(1), sent = [], profileOverride = null
  const profile = async () => {
    if (profileOverride) return profileOverride
    const row = (await db.query('select * from users where id=$1', [actor])).rows[0]
    return { id: row.id, clubId: row.club_id, role: row.role, roleRank: row.role_rank, email: row.email, name: 'Admin' }
  }
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: actor, email_confirmed_at: new Date().toISOString() } } }) },
    rpc: async (name, args) => {
      try { return { data: (await rpc(name, Object.values(args)))[0] } } catch (error) { return { error } }
    },
    from: table => ({
      select: () => ({ eq: (_, value) => ({ maybeSingle: async () => ({ data: (await db.query(`select * from ${table} where id=$1`, [value])).rows[0] }) }) }),
      update: values => ({ eq: async (_, value) => { await db.query(`update ${table} set invite_sent_at=$1 where id=$2`, [values.invite_sent_at, value]); return {} } }),
    }),
  }
  const canonicalSend = createStaffInviteHandler({ client, getRequestUser: async () => ({ id: actor, email: 'admin@example.com' }),
    getPlanProfile: profile, assertFeature: () => {}, getMissingEnvVars: () => [],
    sendEmail: async (payload, options) => { sent.push({ payload, options }); return { id: 'isolated-provider-receipt' } },
    createPendingEmailLog: async () => ({ record: {} }), markEmailLogSent: async () => {}, markEmailLogFailed: async () => {}, createEmailAuditLog: async () => {},
  })
  const phone = createPhoneTeamAdministrationHandler({ client, getPlanProfile: profile, getStaffLimit: () => 20, sendInvite: canonicalSend,
    authenticatedClient: () => { throw new Error('Unexpected existing account assignment') },
  })
  const request = body => ({ httpMethod: 'POST', headers: { authorization: 'Bearer isolated' }, body: JSON.stringify(body) })
  const result = await phone(request({ action: 'invite', teamId: id(20), email: 'new@example.com', role: 'coach' }))
  assert.equal(result.statusCode, 200, result.body)
  assert.equal(sent.length, 1)
  assert.match(sent[0].payload.html, /Accept your coach invitation/)
  assert.ok(sent[0].options.idempotencyKey)
  const invite = (await db.query('select * from club_user_invites')).rows[0]
  const envelope = { inviteId: invite.id, phoneTeamCommand: true, html: '<p>Invite</p>' }
  const retry = await canonicalSend(request(envelope))
  assert.equal(retry.statusCode, 200)
  assert.equal(sent[1].options.idempotencyKey, sent[0].options.idempotencyKey, 'Provider retry key must be stable for the stored invite, regardless of HTML')
  const web = await canonicalSend(request({ ...envelope, phoneTeamCommand: false }))
  assert.equal(web.statusCode, 403, 'Ordinary web transport retains global manager50 minimum')
  actor = id(3)
  assert.equal((await canonicalSend(request(envelope))).statusCode, 403, 'Client flag cannot grant manager50 Team Admin authority')
  actor = id(1)
  for (const [apply, restore] of [
    [`delete from team_staff where user_id='${id(1)}'`, `insert into team_staff(team_id,user_id,role_key,role_rank) values('${id(20)}','${id(1)}','head_manager',70)`],
    [`update auth.users set banned_until=now()+interval '1 day' where id='${id(1)}'`, `update auth.users set banned_until=null where id='${id(1)}'`],
    [`update users set status='suspended' where id='${id(1)}'`, `update users set status='active' where id='${id(1)}'`],
    [`update club_user_invites set team_id='${id(21)}'`, `update club_user_invites set team_id='${id(20)}'`],
    [`update club_user_invites set cancelled_at=now()`, `update club_user_invites set cancelled_at=null`],
    [`update club_user_invites set role_key='admin',role_rank=90`, `update club_user_invites set role_key='coach',role_rank=30`],
  ]) {
    await db.exec(apply)
    assert.equal((await canonicalSend(request(envelope))).statusCode, 403)
    await db.exec(restore)
  }
  profileOverride = { ...(await profile()), id: id(3) }
  assert.equal((await canonicalSend(request(envelope))).statusCode, 403, 'Fresh profile and authenticated actor must be identical')
  assert.equal(sent.length, 2, 'No rejected transport reached the provider')
  await db.exec('set role authenticated')
  await assert.rejects(rpc('phone_team_invite_can_send', [id(1), invite.id]), /permission denied/)
  await db.exec('reset role')
})


test('undelivered skipped reminder becomes eligible at revised timing while delivered inbox cannot repeat', async t => {
  const { db, rpc } = await fixture(t)
  await rpc('manage_team_reminder_policy', [id(1), id(20), 'save', true, 48, false, 48])
  const jobs = await rpc('claim_due_team_reminders', [25])
  const job = jobs.find(row => row.recipientId === id(1))
  const delivered = jobs.find(row => row.recipientId === id(2))
  assert.equal((await rpc('team_reminder_is_current', [job.deliveryKey, id(99)]))[0], false)
  await rpc('record_team_reminder_inbox', [delivered.deliveryKey, delivered.leaseId])
  await rpc('finish_team_reminder', [delivered.deliveryKey, delivered.leaseId, ''])
  await rpc('manage_team_reminder_policy', [id(1), id(20), 'save', true, 12, false, 48])
  assert.equal((await rpc('team_reminder_is_current', [job.deliveryKey, job.leaseId]))[0], false)
  await rpc('finish_team_reminder', [job.deliveryKey, job.leaseId, 'Skipped: not current.'])
  assert.deepEqual(await rpc('claim_due_team_reminders', [25]), [], 'No early retry while revised timing is not due')
  // Change only the disposable test clock for the fixture to simulate the later due window.
  await db.exec(`update team_reminder_policies set squad_hours_before=48 where team_id='${id(20)}'`)
  const later = await rpc('claim_due_team_reminders', [25])
  assert.equal(later.filter(row => row.deliveryKey === job.deliveryKey).length, 1)
  assert.ok(!later.some(row => row.deliveryKey === delivered.deliveryKey), 'An already delivered inbox is never reopened by policy edits')
})


test('SQL reminder currency suppresses confirmed squads, changed kickoff, training responses and archived teams', async t => {
  const { db, rpc } = await fixture(t)
  await rpc('manage_team_reminder_policy', [id(1), id(20), 'save', true, 48, true, 48])
  await db.exec(`insert into calendar_events values('${id(50)}','${id(20)}','${id(10)}',null);
    insert into training_availability_requests values('${id(51)}','${id(50)}','${id(20)}','${id(10)}',current_date,now()+interval '24 hours','sent');
    insert into training_availability_request_players values('${id(52)}','${id(51)}','${id(40)}','sent',now());`)
  const jobs = await rpc('claim_due_team_reminders', [25])
  const squad = jobs.find(row => row.kind === 'squad'), training = jobs.find(row => row.sourceType === 'calendar')
  assert.ok(training)
  await db.exec(`insert into match_day_player_squad_decisions values('${id(60)}','${id(30)}','${id(40)}','selected',now()),('${id(61)}','${id(30)}','${id(41)}','selected',null)`)
  assert.equal((await rpc('team_reminder_is_current', [squad.deliveryKey]))[0], true, 'Partially notified selected squad still needs staff reminder')
  await db.exec(`update match_day_player_squad_decisions set notified_at=now()`)
  assert.equal((await rpc('team_reminder_is_current', [squad.deliveryKey]))[0], false, 'Every selected player notified represents the existing sent squad state')
  await db.exec(`delete from match_day_player_squad_decisions;update match_days set match_date=match_date+1`)
  assert.equal((await rpc('team_reminder_is_current', [squad.deliveryKey]))[0], false, 'Rescheduling invalidates old reminder identity')
  assert.equal((await rpc('team_reminder_is_current', [training.deliveryKey]))[0], true)
  await db.exec(`insert into training_availability_responses values('${id(51)}','${id(40)}')`)
  assert.equal((await rpc('team_reminder_is_current', [training.deliveryKey]))[0], false)
  await db.exec(`delete from training_availability_responses;update teams set archived_at=now() where id='${id(20)}'`)
  assert.equal((await rpc('team_reminder_is_current', [training.deliveryKey]))[0], false)
})
