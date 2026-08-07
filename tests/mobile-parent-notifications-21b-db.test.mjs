import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migration = await readFile(new URL('../mobile-test-api/migrations/20260807070500_parent_push_installations.sql', import.meta.url), 'utf8')
const ids = {
  otherLink: '44444444-4444-4444-8444-444444444444',
  otherUser: '33333333-3333-4333-8333-333333333333',
  parentLink: '22222222-2222-4222-8222-222222222222',
  parentUser: '11111111-1111-4111-8111-111111111111',
  samsung: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  secondAndroid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
}

async function createDatabase() {
  const db = new PGlite()
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create table public.users (
      id uuid primary key references auth.users (id),
      role text not null,
      status text not null
    );
    create table public.parent_player_links (
      id uuid primary key,
      auth_user_id uuid not null references auth.users (id),
      status text not null
    );
    create or replace function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    insert into auth.users (id) values ('${ids.parentUser}');
    insert into public.users (id, role, status)
    values ('${ids.parentUser}', 'parent_portal', 'active');
    insert into public.parent_player_links (id, auth_user_id, status)
    values ('${ids.parentLink}', '${ids.parentUser}', 'active');
  `)
  await db.exec(migration)
  return db
}

test('test-only push migration applies and seeds exactly two authorised platform slots', async () => {
  const db = await createDatabase()
  try {
    const rows = await db.query(`
      select auth_user_id, platform, installation_id, enabled
      from public.mobile_test_parent_push_allowlist
      order by platform
    `)
    assert.deepEqual(rows.rows, [
      { auth_user_id: ids.parentUser, platform: 'android', installation_id: null, enabled: true },
      { auth_user_id: ids.parentUser, platform: 'ios', installation_id: null, enabled: true },
    ])
  } finally {
    await db.close()
  }
})

test('registration is atomic, private, preference-aware, and duplicate-safe', async () => {
  const db = await createDatabase()
  try {
    await db.exec(`select set_config('request.jwt.claim.sub', '${ids.parentUser}', false);`)
    const first = await db.query(`
      select public.register_mobile_test_parent_push_installation(
        '${ids.samsung}',
        '${ids.parentLink}',
        'ExponentPushToken[synthetic_android_token]',
        'android',
        '1.0.1',
        '9',
        'minimal'
      ) as result
    `)
    assert.equal(first.rows[0].result.registered, true)
    assert.equal(first.rows[0].result.detailLevel, 'minimal')

    const duplicate = await db.query(`
      select public.register_mobile_test_parent_push_installation(
        '${ids.samsung}',
        '${ids.parentLink}',
        'ExponentPushToken[synthetic_android_token_rotated]',
        'android',
        '1.0.1',
        '10',
        'detailed'
      ) as result
    `)
    assert.equal(duplicate.rows[0].result.detailLevel, 'detailed')

    const state = await db.query(`
      select public.get_mobile_test_parent_push_installation('${ids.samsung}') as result
    `)
    assert.deepEqual(state.rows[0].result, {
      detailLevel: 'detailed',
      enabled: true,
      platform: 'android',
      registered: true,
    })
    assert.equal(JSON.stringify(state.rows[0]).includes('synthetic_android_token'), false)

    await assert.rejects(() => db.query(`
      select public.register_mobile_test_parent_push_installation(
        '${ids.secondAndroid}',
        '${ids.parentLink}',
        'ExponentPushToken[second_android_token]',
        'android',
        '1.0.1',
        '11',
        'minimal'
      )
    `), /slot_already_claimed/)

    await db.query(`
      select public.update_mobile_test_parent_push_preference(
        '${ids.samsung}', false, 'minimal'
      )
    `)
    const disabledTargets = await db.query(`
      select * from public.prepare_mobile_test_parent_push('${ids.samsung}', 'parent_poll')
    `)
    assert.equal(disabledTargets.rows.length, 0)

    await db.query(`
      select public.update_mobile_test_parent_push_preference(
        '${ids.samsung}', true, 'detailed'
      )
    `)
    const enabledTargets = await db.query(`
      select * from public.prepare_mobile_test_parent_push('${ids.samsung}', 'parent_poll')
    `)
    assert.deepEqual(enabledTargets.rows, [{
      expo_push_token: 'ExponentPushToken[synthetic_android_token_rotated]',
      detail_level: 'detailed',
      platform: 'android',
    }])
  } finally {
    await db.close()
  }
})

test('logout unbind and non-allowlisted user both fail closed', async () => {
  const db = await createDatabase()
  try {
    await db.exec(`select set_config('request.jwt.claim.sub', '${ids.parentUser}', false);`)
    await db.query(`
      select public.register_mobile_test_parent_push_installation(
        '${ids.samsung}',
        '${ids.parentLink}',
        'ExponentPushToken[synthetic_android_token]',
        'android',
        '1.0.1',
        '9',
        'minimal'
      )
    `)
    const unbound = await db.query(`
      select public.unbind_mobile_test_parent_push_installation('${ids.samsung}') as result
    `)
    assert.equal(unbound.rows[0].result, true)
    const target = await db.query(`
      select * from public.prepare_mobile_test_parent_push('${ids.samsung}', 'parent_message')
    `)
    assert.equal(target.rows.length, 0)
    const installation = await db.query(`
      select auth_user_id, parent_link_id, expo_push_token, enabled, status
      from public.mobile_test_parent_push_installations
      where installation_id = '${ids.samsung}'
    `)
    assert.deepEqual(installation.rows[0], {
      auth_user_id: null,
      parent_link_id: null,
      expo_push_token: null,
      enabled: false,
      status: 'unbound',
    })

    await db.exec(`
      insert into auth.users (id) values ('${ids.otherUser}');
      insert into public.users (id, role, status)
      values ('${ids.otherUser}', 'parent_portal', 'active');
      insert into public.parent_player_links (id, auth_user_id, status)
      values ('${ids.otherLink}', '${ids.otherUser}', 'active');
      select set_config('request.jwt.claim.sub', '${ids.otherUser}', false);
    `)
    await assert.rejects(() => db.query(`
      select public.register_mobile_test_parent_push_installation(
        '${ids.secondAndroid}',
        '${ids.otherLink}',
        'ExponentPushToken[not_allowlisted]',
        'android',
        '1.0.1',
        '9',
        'minimal'
      )
    `), /not_allowlisted/)
  } finally {
    await db.close()
  }
})
