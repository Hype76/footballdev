import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const migrationUrl = new URL('../supabase/migrations/20260721161858_m2_database_function_and_club_logo_hardening.sql', import.meta.url)

const publicTokenFunctions = [
  'confirm_match_day_availability(text, text)',
  'get_match_day_availability_response(text)',
  'get_match_day_availability_response_v2(text)',
  'get_training_availability_response(text)',
  'submit_match_day_availability_response(text, text, text, text, text, boolean, boolean, integer)',
  'submit_training_availability_response(text, text, text)',
]

async function createFixture(db) {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema storage;
    create schema app_private;

    create table storage.buckets (
      id text primary key,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    create table storage.objects (
      id bigint generated always as identity primary key,
      bucket_id text,
      name text
    );
    alter table storage.objects enable row level security;
    insert into storage.buckets(id) values ('club-logos');

    create table public.clubs (id uuid primary key, logo_url text);
    create table public.resource_library_items (
      id uuid primary key,
      club_id uuid,
      team_id uuid,
      archived_at timestamptz
    );
    create table public.resource_library_links (
      id uuid primary key,
      resource_id uuid,
      club_id uuid,
      team_id uuid,
      linked_type text,
      linked_id uuid,
      assigned_by_profile_id uuid,
      removed_at timestamptz,
      removed_by_profile_id uuid
    );
    alter table public.resource_library_links enable row level security;

    create function auth.uid() returns uuid language sql stable as 'select null::uuid';
    create function public.current_user_can_manage_resource_library(uuid, uuid) returns boolean language sql stable as 'select false';
    create function public.current_user_can_view_resource_library(uuid, uuid) returns boolean language sql stable as 'select false';
    create function public.resource_library_link_target_allowed(text, uuid, uuid, uuid) returns boolean language sql stable as 'select false';

    create function public.test_privileged() returns integer language sql security definer set search_path = pg_catalog as 'select 1';
    create function public.test_trigger() returns trigger language plpgsql security definer set search_path = pg_catalog as 'begin return new; end';
    grant execute on function public.test_privileged() to public, anon, authenticated, service_role;
    grant execute on function public.test_trigger() to public, anon, authenticated, service_role;

    create function public.data_transfer_external_dependency(uuid, text, uuid) returns text language sql security definer set search_path = pg_catalog as 'select null::text';

    create policy club_logos_public_read on storage.objects for select using (bucket_id = 'club-logos');
    create policy club_logos_manager_insert on storage.objects for insert with check (bucket_id = 'club-logos');
    create policy club_logos_manager_update on storage.objects for update using (bucket_id = 'club-logos');
    create policy club_logos_manager_delete on storage.objects for delete using (bucket_id = 'club-logos');
  `)

  for (const signature of publicTokenFunctions) {
    const name = signature.slice(0, signature.indexOf('('))
    const args = signature.slice(signature.indexOf('(') + 1, -1)
    const argList = args ? args.split(', ').map((type, index) => `p${index} ${type}`).join(', ') : ''
    await db.exec(`create function public.${name}(${argList}) returns text language sql security definer set search_path = pg_catalog as 'select null::text';`)
  }
}

test('forward migration executes and produces least-privilege grants and storage policy state', async () => {
  const db = new PGlite()

  try {
    await createFixture(db)
    await db.exec(await readFile(migrationUrl, 'utf8'))

    const grants = await db.query(`
      select
        has_function_privilege('anon', 'public.test_privileged()'::regprocedure, 'execute') as anon_privileged,
        has_function_privilege('authenticated', 'public.test_trigger()'::regprocedure, 'execute') as authenticated_trigger,
        has_function_privilege('service_role', 'public.test_trigger()'::regprocedure, 'execute') as service_trigger,
        has_function_privilege('anon', 'public.get_training_availability_response(text)'::regprocedure, 'execute') as anon_token
    `)
    assert.deepEqual(grants.rows[0], {
      anon_privileged: false,
      authenticated_trigger: false,
      service_trigger: false,
      anon_token: true,
    })

    const bucket = await db.query(`select file_size_limit, allowed_mime_types from storage.buckets where id = 'club-logos'`)
    assert.equal(Number(bucket.rows[0].file_size_limit), 2 * 1024 * 1024)
    assert.deepEqual(bucket.rows[0].allowed_mime_types, ['image/jpeg', 'image/png', 'image/webp'])

    const policies = await db.query(`select polname from pg_policy where polrelid = 'storage.objects'::regclass`)
    assert.deepEqual(policies.rows, [])
  } finally {
    await db.close()
  }
})
