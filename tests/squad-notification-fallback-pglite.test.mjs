import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const load = (name) => readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8')
const migration = await load('20260903120639_squad_notification_email_fallback') + '\n' + await load('20260903120851_coach_conclusion_authority') + '\n' + await load('20260903125603_squad_notification_copy_branding') + '\n' + await load('20260918185407_squad_notification_channel_preferences')
const outbox = (await load('20260903091914_coach_squad_decision_notifications')).split('-- Saving a decision')[0]
const canonicalRecipients = await load('20260823135328_promoted_player_matchday_recipient_fix_78')
const bulkSource = await load('20260903095629_coach_squad_bulk_notify')
const bulk = bulkSource.slice(bulkSource.indexOf('create or replace function public.notify_match_day_squad_decisions('), bulkSource.indexOf('-- Include current linked'))
const id = (n) => `9a090305-0000-4000-8000-${String(n).padStart(12, '0')}`

test('squad notifications honour independent recipient channels and preserve authority', async (t) => {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema private;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table auth.users(id uuid primary key,email text,deleted_at timestamptz,banned_until timestamptz,email_confirmed_at timestamptz default now(),raw_user_meta_data jsonb default '{}');
    create table public.users(id uuid primary key,club_id uuid,status text,role text,role_rank integer);
    create table public.clubs(id uuid primary key,status text);
    create table public.teams(id uuid primary key,club_id uuid,status text);
    create table public.players(id uuid primary key,club_id uuid,team_id uuid,player_name text,status text,archived_at timestamptz,parent_email text,parent_name text,parent_contacts jsonb default '[]',contact_type text default 'parent');
    create table public.player_team_memberships(player_id uuid,club_id uuid,team_id uuid,status text,ended_at timestamptz);
    create table public.parent_player_links(id uuid primary key,player_id uuid,club_id uuid,team_id uuid,auth_user_id uuid,status text,email text,link_type text default 'parent',guardian_id uuid,receives_communications boolean default false);
    create table public.adult_player_account_links(player_id uuid,club_id uuid,team_id uuid,user_id uuid,status text,verified_at timestamptz,revoked_at timestamptz);
    create table public.parent_communication_preferences(auth_user_id uuid primary key,communication_channel text);
    create table public.parent_mobile_app_installations(auth_user_id uuid);
    create table public.parent_push_subscriptions(auth_user_id uuid,status text);
    create table public.match_days(id uuid primary key,club_id uuid,team_id uuid,opponent text,match_date date,status text,parent_visible boolean,deleted_at timestamptz,previous_hidden_at timestamptz,concluded_at timestamptz);
    create table public.match_day_player_squad_decisions(id uuid primary key default gen_random_uuid(),match_day_id uuid,club_id uuid,team_id uuid,player_id uuid,status text);
    create table public.parent_mobile_notification_events(id uuid default gen_random_uuid(),auth_user_id uuid,parent_link_id uuid,club_id uuid,team_id uuid,intent_type text,title text,body text,data jsonb,status text,sent_at timestamptz,created_at timestamptz,read_at timestamptz,dedupe_key text unique);
    create table public.match_day_event_log(club_id uuid,team_id uuid,match_day_id uuid,player_id uuid,actor_user_id uuid,event_type text,event_label text,new_value jsonb,metadata jsonb);
    create function public.canonical_calendar_invite_recipient_type(text) returns text language sql immutable as $$select case when $1='parent' then 'parent_guardian' else $1 end$$;
    create function public.set_match_day_timer_state(uuid,text) returns jsonb language plpgsql as $$declare normalized_action text := $2; is_staff_actor boolean; is_scorer_actor boolean := true; begin
  if not is_staff_actor and not is_scorer_actor then
    return null;
  end if; return '{}'::jsonb; end;$$;
    create function public.can_manage_match_day(uuid) returns boolean language sql stable as $$select auth.uid()='${id(1)}' and $1='${id(3)}'$$;
    insert into auth.users(id,email) values('${id(1)}','coach@example.test');
    insert into public.users values('${id(1)}','${id(2)}','active','coach',30);
    insert into public.clubs values('${id(2)}','active');
    insert into public.teams values('${id(3)}','${id(2)}','active');
    insert into public.match_days(id,club_id,team_id,opponent,match_date,status,parent_visible) values('${id(4)}','${id(2)}','${id(3)}','Visitors','2026-09-03','scheduled',true);
    select set_config('request.jwt.claim.sub','${id(1)}',false);
  `)
  await db.exec(canonicalRecipients)
  await db.exec(outbox)
  await db.exec(migration)
  await db.exec(bulk)
  await assert.rejects(db.query("select public.set_match_day_timer_state($1,'conclude')", [id(4)]), /Only a coach or manager/)
  const player = async (n, email = null) => {
    await db.query('insert into public.players(id,club_id,team_id,player_name,status,parent_email) values($1,$2,$3,$4,$5,$6)', [id(n), id(2), id(3), `Player ${n}`, 'active', email])
    await db.query('insert into public.player_team_memberships values($1,$2,$3,$4,null)', [id(n), id(2), id(3), 'active'])
    await db.query('insert into public.match_day_player_squad_decisions(match_day_id,club_id,team_id,player_id,status) values($1,$2,$3,$4,$5)', [id(4), id(2), id(3), id(n), 'selected'])
  }
  const link = async (n, user, email, installed = false, linkNumber = n + 1000) => {
    if (user) await db.query('insert into auth.users(id,email) values($1,$2) on conflict do nothing', [id(user), email])
    await db.query("insert into public.parent_player_links(id,player_id,club_id,team_id,auth_user_id,status,email) values($1,$2,$3,$4,$5,'active',$6)", [id(linkNumber), id(n), id(2), id(3), user ? id(user) : null, email])
    if (installed) await db.query('insert into public.parent_mobile_app_installations values($1)', [id(user)])
  }
  const recipients = async (n) => (await db.query('select * from private.squad_notification_recipients($1,$2,$3)', [id(2), id(3), id(n)])).rows
  const notify = async (n) => (await db.query('select public.notify_match_day_squad_decision($1,$2,(select decision_revision from public.match_day_player_squad_decisions where player_id=$2)) as result', [id(4), id(n)])).rows[0].result
  const claim = async (receipt) => (await db.query('select public.claim_squad_notification_push($1) as result', [receipt])).rows[0].result
  await player(101, 'app@example.test'); await link(101, 201, 'app@example.test', true)
  await player(102, 'email@example.test'); await link(102, 202, 'email@example.test')
  await player(103, 'unsigned@example.test')
  await player(104)
  await player(105, 'guardian@example.test'); await link(105, 205, 'guardian@example.test', true)
  await db.query('update public.parent_player_links set guardian_id=$1 where player_id=$2', [id(500), id(105)])
  await player(106, 'revoked@example.test'); await link(106, 206, 'revoked@example.test')
  await db.query("update public.parent_player_links set status='revoked' where player_id=$1", [id(106)])

  await t.test('both uses app and email for linked accounts, while unsigned parents use email', async () => {
    assert.deepEqual((await recipients(101)).map((row) => row.delivery_channel).sort(), ['app', 'email'])
    assert.deepEqual((await recipients(102)).map((row) => row.delivery_channel).sort(), ['app', 'email'])
    assert.equal((await recipients(103))[0].delivery_channel, 'email')
    assert.deepEqual(await recipients(104), [])
    const flags = (await db.query('select * from public.get_match_day_squad_notification_contacts($1)', [id(4)])).rows
    assert.equal(flags.find((r) => r.player_id === id(103)).email_recipient_count, 1)
    assert.equal(flags.find((r) => r.player_id === id(104)).has_contact, false)
    assert.equal(flags.find((r) => r.player_id === id(105)).can_notify, false)
    assert.ok(flags.every((r) => !('recipient_email' in r)))
  })
  await t.test('duplicate parent account links resolve once and guardian opt-outs and revocation cannot fall back to email', async () => {
    await db.query('insert into public.parent_player_links select $1,player_id,club_id,team_id,auth_user_id,status,email,link_type,guardian_id,receives_communications from public.parent_player_links where player_id=$2', [id(9999), id(101)])
    assert.equal((await recipients(101)).length, 2)
    assert.equal((await recipients(105))[0].delivery_channel, null)
    assert.deepEqual(await recipients(106), [])
    await assert.rejects(notify(104), /No contact details/)
    await assert.rejects(notify(105), /switched off/)
    await assert.rejects(notify(106), /No contact details/)
  })
  await t.test('channel preferences choose email explicitly and never bypass app-only preference', async () => {
    await db.query("insert into public.parent_communication_preferences values($1,'email'),($2,'app')", [id(201), id(202)])
    assert.equal((await recipients(101))[0].delivery_channel, 'email')
    assert.equal((await recipients(102))[0].delivery_channel, 'app')
    await db.exec('delete from public.parent_communication_preferences')
  })
  await t.test('both sends each selected channel and app-only keeps the linked inbox route', async () => {
    await player(109, 'browser@example.test'); await link(109, 209, 'browser@example.test')
    await db.query("insert into public.parent_push_subscriptions values($1,'active')", [id(209)])
    assert.deepEqual((await recipients(109)).map((row) => row.delivery_channel).sort(), ['app', 'email'])
    await db.query("insert into public.parent_communication_preferences values($1,'app')", [id(209)])
    assert.deepEqual((await recipients(109)).map((row) => row.delivery_channel), ['app'])
  })
  await t.test('two linked parents keep independent app-only and email-only preferences', async () => {
    await player(110, 'first@example.test'); await link(110, 210, 'first@example.test', true)
    await link(110, 211, 'second@example.test', false, 9998)
    await db.query("insert into public.parent_communication_preferences values($1,'app'),($2,'email')", [id(210), id(211)])
    const rows = await recipients(110)
    assert.equal(rows.length, 2)
    assert.deepEqual(rows.map((row) => row.delivery_channel).sort(), ['app', 'email'])
    assert.equal(new Set(rows.map((row) => row.auth_user_id)).size, 2)
  })
  await t.test('explicit notification creates a single durable receipt, with app inbox only for app delivery', async () => {
    await db.query("insert into public.parent_communication_preferences values($1,'app') on conflict(auth_user_id) do update set communication_channel='app'", [id(201)])
    const app = await notify(101); const email = await notify(103)
    assert.equal(app.notificationIds.length, 1); assert.equal(email.notificationIds.length, 1)
    assert.equal((await notify(103)).alreadySent, true)
    assert.equal((await db.query('select * from public.parent_mobile_notification_events')).rows.length, 1)
    const receipt = await claim(email.notificationIds[0])
    assert.equal(receipt.decision_status, 'selected')
    assert.equal(receipt.delivery_channel, 'email'); assert.equal(receipt.recipient_email, 'unsigned@example.test')
    assert.equal(await claim(email.notificationIds[0]), null)
  })
  await t.test('both persists two independent receipts and retries do not duplicate either channel', async () => {
    const result = await notify(102)
    assert.equal(result.notificationIds.length, 2)
    const rows = (await db.query('select delivery_channel from public.match_day_squad_notifications where id = any($1::uuid[])', [result.notificationIds])).rows
    assert.deepEqual(rows.map(row => row.delivery_channel).sort(), ['app', 'email'])
    assert.equal((await notify(102)).alreadySent, true)
  })
  await t.test('changing a decision retires its old receipt and enables the new decision', async () => {
    const previous = await notify(102)
    await db.query("update public.match_day_player_squad_decisions set status='not_selected' where player_id=$1", [id(102)])
    assert.equal(await claim(previous.notificationIds[0]), null)
    const next = await notify(102)
    assert.equal(next.sent, true); assert.notEqual(next.notificationIds[0], previous.notificationIds[0])
    const receipt = await claim(next.notificationIds[0])
    assert.match(receipt.body, /has not been selected.*this time\.$/)
    assert.doesNotMatch(receipt.body, /Thank you for your support/)
    assert.equal(receipt.decision_status, 'not_selected')
  })
  await t.test('email changed or preference disabled before delivery retires the receipt', async () => {
    await player(107, 'old@example.test'); const before = await notify(107)
    await db.query('update public.players set parent_email=$1 where id=$2', ['new@example.test', id(107)])
    assert.equal(await claim(before.notificationIds[0]), null)
    await player(108, 'pref@example.test'); await link(108, 208, 'pref@example.test')
    const pref = await notify(108)
    await db.query("insert into public.parent_communication_preferences values($1,'app')", [id(208)])
    const emailReceipt = (await db.query("select n.id from public.match_day_squad_notifications n join public.match_day_player_squad_decisions d on d.id=n.decision_id where d.player_id=$1 and n.delivery_channel='email'", [id(108)])).rows[0].id
    assert.equal(await claim(emailReceipt), null)
  })
  await t.test('suspended accounts and inactive membership never receive a fallback', async () => {
    await db.query("insert into public.users values($1,$2,'suspended','parent_portal',0)", [id(201), id(2)])
    assert.equal((await recipients(101))[0].delivery_channel, null)
    await db.query("update public.player_team_memberships set status='ended' where player_id=$1", [id(103)])
    assert.deepEqual(await recipients(103), [])
  })
  await t.test('other staff scope, parent and anonymous callers cannot read contact flags or notify', async () => {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id(201)])
    await assert.rejects(db.query('select * from public.get_match_day_squad_notification_contacts($1)', [id(4)]), /Coach access/)
    await assert.rejects(notify(104), /Coach access/)
    await db.exec('set role authenticated')
    await assert.rejects(recipients(101), /permission denied/)
    await db.exec('reset role; set role anon')
    await assert.rejects(db.query('select * from public.get_match_day_squad_notification_contacts($1)', [id(4)]), /permission denied/)
    await db.exec('reset role')
  })
})
