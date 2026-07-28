import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import {
  DEFAULT_LOGGED_IN_USERS_BANNER,
  DEFAULT_PARENT_PORTAL_BANNER,
  DEFAULT_PLATFORM_BANNERS,
  DEFAULT_PUBLIC_SITE_BANNER,
  LOGGED_IN_USERS_BANNER_KEY,
  PARENT_PORTAL_BANNER_KEY,
  PLATFORM_BANNER_AUDIENCES,
  getPlatformBannerTextColor,
  normalizePlatformBanner,
  validatePlatformBannerDraft,
} from '../src/lib/platform-banner-config.js'

const baseMigrationUrl = new URL('../supabase/migrations/20260726111558_platform_banner_controls.sql', import.meta.url)
const audienceMigrationUrl = new URL('../supabase/migrations/20260726114113_platform_banner_audiences.sql', import.meta.url)
const adminPageUrl = new URL('../src/pages/PlatformAdminPage.jsx', import.meta.url)
const adminSectionUrl = new URL('../src/components/platform/PlatformBannerManagementSection.jsx', import.meta.url)
const platformBannerNoticeUrl = new URL('../src/components/platform/PlatformBannerNotice.jsx', import.meta.url)
const platformBannerDomainUrl = new URL('../src/lib/domain/platform-banners.js', import.meta.url)
const layoutUrl = new URL('../src/components/layout/Layout.jsx', import.meta.url)
const loginHeaderUrl = new URL('../src/components/login/LoginHeader.jsx', import.meta.url)

test('banner audiences provide separate safe defaults and readable contrast', () => {
  assert.deepEqual(
    PLATFORM_BANNER_AUDIENCES.map((audience) => audience.bannerKey),
    ['public_site', LOGGED_IN_USERS_BANNER_KEY, PARENT_PORTAL_BANNER_KEY],
  )
  assert.equal(DEFAULT_PLATFORM_BANNERS.public_site.enabled, true)
  assert.equal(DEFAULT_LOGGED_IN_USERS_BANNER.enabled, false)
  assert.equal(DEFAULT_PARENT_PORTAL_BANNER.enabled, false)
  assert.deepEqual(
    normalizePlatformBanner({
      banner_key: LOGGED_IN_USERS_BANNER_KEY,
      enabled: true,
      message: '  Planned maintenance tonight.  ',
      background_color: '#0f172a',
    }),
    {
      bannerKey: LOGGED_IN_USERS_BANNER_KEY,
      enabled: true,
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

test('Platform Admin exposes independent controls for all three audiences', async () => {
  const [pageSource, sectionSource, domainSource] = await Promise.all([
    readFile(adminPageUrl, 'utf8'),
    readFile(adminSectionUrl, 'utf8'),
    readFile(platformBannerDomainUrl, 'utf8'),
  ])

  assert.match(pageSource, /PlatformBannerManagementSection/)
  assert.match(pageSource, /getPlatformBanners/)
  assert.match(pageSource, /bannerDrafts/)
  assert.match(pageSource, /savingBannerKey/)
  assert.match(sectionSource, /PLATFORM_BANNER_AUDIENCES\.map/)
  assert.match(sectionSource, /role="switch"/)
  assert.match(sectionSource, /type="color"/)
  assert.match(sectionSource, /Banner text/)
  assert.match(sectionSource, /aria-label="Banner preview"/)
  assert.match(domainSource, /\.in\('banner_key', PLATFORM_BANNER_KEYS\)/)
  assert.match(domainSource, /assertPlatformBannerKey/)
  assert.match(domainSource, /user\?\.role !== 'super_admin'/)
  assert.match(domainSource, /platform_banner_updated/)
})

test('each banner audience is mounted only in its intended application shell', async () => {
  const [noticeSource, layoutSource, loginHeaderSource] = await Promise.all([
    readFile(platformBannerNoticeUrl, 'utf8'),
    readFile(layoutUrl, 'utf8'),
    readFile(loginHeaderUrl, 'utf8'),
  ])

  assert.match(noticeSource, /getPlatformBannerByKey/)
  assert.match(noticeSource, /if \(!banner\?\.enabled\)/)
  assert.match(loginHeaderSource, /bannerKey=\{PUBLIC_SITE_BANNER_KEY\}/)
  assert.match(layoutSource, /isParentPortalUser\(user\)/)
  assert.match(layoutSource, /bannerKey=\{PARENT_PORTAL_BANNER_KEY\}/)
  assert.match(layoutSource, /user\?\.id/)
  assert.match(layoutSource, /bannerKey=\{LOGGED_IN_USERS_BANNER_KEY\}/)
})

test('audience migration seeds three rows and keeps internal banners hidden from anon', async () => {
  const [baseMigration, audienceMigration] = await Promise.all([
    readFile(baseMigrationUrl, 'utf8'),
    readFile(audienceMigrationUrl, 'utf8'),
  ])
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
  await db.exec(baseMigration)
  await db.exec(audienceMigration)

  const seeded = await db.query(`
    select banner_key, enabled, message, background_color
    from public.platform_banners
    order by banner_key
  `)
  assert.deepEqual(seeded.rows, [
    {
      banner_key: LOGGED_IN_USERS_BANNER_KEY,
      enabled: false,
      message: DEFAULT_LOGGED_IN_USERS_BANNER.message,
      background_color: '#93C5FD',
    },
    {
      banner_key: PARENT_PORTAL_BANNER_KEY,
      enabled: false,
      message: DEFAULT_PARENT_PORTAL_BANNER.message,
      background_color: '#86EFAC',
    },
    {
      banner_key: 'public_site',
      enabled: true,
      message: DEFAULT_PUBLIC_SITE_BANNER.message,
      background_color: '#FCD34D',
    },
  ])

  await db.exec('set role anon;')
  const anonRows = await db.query(`
    select banner_key
    from public.platform_banners
    order by banner_key
  `)
  assert.deepEqual(anonRows.rows, [{ banner_key: 'public_site' }])
  await db.exec('reset role; set role authenticated;')
  const authenticatedRows = await db.query(`
    select banner_key
    from public.platform_banners
    order by banner_key
  `)
  assert.deepEqual(
    authenticatedRows.rows.map((row) => row.banner_key),
    [LOGGED_IN_USERS_BANNER_KEY, PARENT_PORTAL_BANNER_KEY, 'public_site'],
  )

  await db.exec(`reset role; set app.test_role = 'manager'; set role authenticated;`)
  const deniedUpdate = await db.query(`
    update public.platform_banners
    set message = 'Manager should not change this'
    where banner_key = '${LOGGED_IN_USERS_BANNER_KEY}'
    returning banner_key
  `)
  assert.equal(deniedUpdate.rows.length, 0)
  await db.exec(`reset role; set app.test_role = 'super_admin'; set role authenticated;`)
  const allowedUpdate = await db.query(`
    update public.platform_banners
    set message = 'Platform controlled notice'
    where banner_key = '${PARENT_PORTAL_BANNER_KEY}'
    returning banner_key, message
  `)
  assert.deepEqual(allowedUpdate.rows, [{
    banner_key: PARENT_PORTAL_BANNER_KEY,
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
