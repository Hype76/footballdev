import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import {
  DEFAULT_PUBLIC_SITE_BANNER,
  getPlatformBannerTextColor,
  normalizePlatformBanner,
  validatePlatformBannerDraft,
} from '../src/lib/platform-banner-config.js'

const migrationUrl = new URL('../supabase/migrations/20260726110413_platform_banner_controls.sql', import.meta.url)
const adminPageUrl = new URL('../src/pages/PlatformAdminPage.jsx', import.meta.url)
const adminSectionUrl = new URL('../src/components/platform/PlatformBannerManagementSection.jsx', import.meta.url)
const platformBannerDomainUrl = new URL('../src/lib/domain/platform-banners.js', import.meta.url)

test('banner drafts normalize safe colours and choose readable text contrast', () => {
  assert.deepEqual(
    normalizePlatformBanner({
      banner_key: 'public_site',
      enabled: false,
      message: '  Planned maintenance tonight.  ',
      background_color: '#0f172a',
    }),
    {
      bannerKey: 'public_site',
      enabled: false,
      message: 'Planned maintenance tonight.',
      backgroundColor: '#0F172A',
      updatedAt: '',
    },
  )
  assert.equal(getPlatformBannerTextColor('#FCD34D'), '#241A00')
  assert.equal(getPlatformBannerTextColor('#0F172A'), '#FFFFFF')
})

test('banner validation rejects empty, oversized, and unsafe colour values', () => {
  assert.throws(
    () => validatePlatformBannerDraft({ enabled: true, message: '', backgroundColor: '#FCD34D' }),
    /Banner text is required/,
  )
  assert.throws(
    () => validatePlatformBannerDraft({ enabled: true, message: 'x'.repeat(281), backgroundColor: '#FCD34D' }),
    /280 characters or fewer/,
  )
  assert.throws(
    () => validatePlatformBannerDraft({ enabled: true, message: 'Valid', backgroundColor: 'url(javascript:1)' }),
    /valid banner background colour/,
  )
  assert.deepEqual(
    validatePlatformBannerDraft(DEFAULT_PUBLIC_SITE_BANNER),
    {
      enabled: true,
      message: DEFAULT_PUBLIC_SITE_BANNER.message,
      backgroundColor: '#FCD34D',
    },
  )
})

test('Platform Admin exposes enable, text, colour, preview, and save controls', async () => {
  const [pageSource, sectionSource, domainSource] = await Promise.all([
    readFile(adminPageUrl, 'utf8'),
    readFile(adminSectionUrl, 'utf8'),
    readFile(platformBannerDomainUrl, 'utf8'),
  ])

  assert.match(pageSource, /PlatformBannerManagementSection/)
  assert.match(pageSource, /getPlatformBanner/)
  assert.match(pageSource, /updatePlatformBanner/)
  assert.match(sectionSource, /role="switch"/)
  assert.match(sectionSource, /type="color"/)
  assert.match(sectionSource, /Banner text/)
  assert.match(sectionSource, /Banner colour presets/)
  assert.match(sectionSource, /aria-label="Banner preview"/)
  assert.match(sectionSource, /Save banner/)
  assert.match(domainSource, /user\?\.role !== 'super_admin'/)
  assert.match(domainSource, /blockDemoMutation/)
  assert.match(domainSource, /platform_banner_updated/)
})

test('banner migration compiles, seeds the current banner, and enforces privileges and constraints', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const db = new PGlite()

  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create function auth.uid()
    returns uuid
    language sql
    stable
    as $$ select null::uuid $$;
    create function public.current_user_role()
    returns text
    language sql
    stable
    as $$ select current_setting('app.test_role', true) $$;
    grant execute on function public.current_user_role() to authenticated;
  `)
  await db.exec(migration)

  const seeded = await db.query(`
    select banner_key, enabled, message, background_color
    from public.platform_banners
  `)
  assert.deepEqual(seeded.rows, [{
    banner_key: 'public_site',
    enabled: true,
    message: DEFAULT_PUBLIC_SITE_BANNER.message,
    background_color: '#FCD34D',
  }])

  const privileges = await db.query(`
    select
      has_table_privilege('anon', 'public.platform_banners', 'select') as anon_select,
      has_table_privilege('anon', 'public.platform_banners', 'update') as anon_update,
      has_table_privilege('authenticated', 'public.platform_banners', 'select') as authenticated_select,
      has_column_privilege('authenticated', 'public.platform_banners', 'message', 'update') as authenticated_message_update,
      has_table_privilege('authenticated', 'public.platform_banners', 'insert') as authenticated_insert,
      has_table_privilege('authenticated', 'public.platform_banners', 'delete') as authenticated_delete
  `)
  assert.deepEqual(privileges.rows[0], {
    anon_select: true,
    anon_update: false,
    authenticated_select: true,
    authenticated_message_update: true,
    authenticated_insert: false,
    authenticated_delete: false,
  })

  await db.exec(`set app.test_role = 'manager'; set role authenticated;`)
  const deniedUpdate = await db.query(`
    update public.platform_banners
    set message = 'Manager should not change this'
    where banner_key = 'public_site'
    returning banner_key
  `)
  assert.equal(deniedUpdate.rows.length, 0)
  await db.exec(`reset role; set app.test_role = 'super_admin'; set role authenticated;`)
  const allowedUpdate = await db.query(`
    update public.platform_banners
    set message = 'Platform controlled notice'
    where banner_key = 'public_site'
    returning banner_key, message
  `)
  assert.deepEqual(allowedUpdate.rows, [{
    banner_key: 'public_site',
    message: 'Platform controlled notice',
  }])
  await db.exec('reset role;')

  await assert.rejects(
    db.query(`update public.platform_banners set background_color = 'red' where banner_key = 'public_site'`),
    /platform_banners_background_color_check/,
  )
  await assert.rejects(
    db.query(`update public.platform_banners set message = '' where banner_key = 'public_site'`),
    /platform_banners_message_check/,
  )

  await db.close()
})
