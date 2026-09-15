import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { buildAuthEmailAppTemplate, buildAuthEmailAppTemplatePatch } from '../scripts/supabase-auth-email-app-access.mjs'

const config = Object.fromEntries(['confirmation', 'invite', 'magic_link', 'email_change', 'recovery', 'reauthentication'].map(type => [`mailer_templates_${type}_content`, type === 'reauthentication' ? '<h2>Reauthenticate</h2><p>{{ .Token }}</p>' : `<h2>${type}</h2><p>{{ .Email }} {{ .NewEmail }}</p><a href="{{ .ConfirmationURL }}">Primary action</a>`]))
for (const type of ['password_changed', 'email_changed', 'phone_changed', 'mfa_factor_enrolled', 'mfa_factor_unenrolled', 'identity_linked', 'identity_unlinked']) {
  config[`mailer_templates_${type}_notification_content`] = `<h2>${type}</h2><p>{{ .Email }} {{ .OldEmail }} {{ .Phone }} {{ .OldPhone }} {{ .Provider }} {{ .FactorType }}</p>`
  config[`mailer_notifications_${type}_enabled`] = false
}
config.mailer_subjects_confirmation = 'Existing subject'
config.smtp_host = 'smtp.example.test'

test('Auth template patch preserves all thirteen primary bodies, omits subjects, secrets and enabled flags, and is idempotent', () => {
  const patch = buildAuthEmailAppTemplatePatch(config)
  assert.equal(Object.keys(patch).length, 13)
  for (const [key, value] of Object.entries(patch)) {
    assert.ok(value.startsWith(config[key]), `${key} primary body remains byte-for-byte intact`)
    assert.equal(buildAuthEmailAppTemplate(value), value)
    assert.match(value, /fp-auth-app-access:start/)
  }
  assert.equal(Object.keys(patch).some(key => /enabled|subject|smtp/.test(key)), false)
  assert.throws(() => buildAuthEmailAppTemplatePatch({}), /existing Auth email body/)
  const document = buildAuthEmailAppTemplate('<html><body><p>Original action</p></body></html>')
  assert.ok(document.indexOf('fp-auth-app-access:start') < document.indexOf('</body>'))
})

const goBinary = process.env.FP_GO_BINARY || 'go'
const goAvailable = spawnSync(goBinary, ['version'], { encoding: 'utf8' }).status === 0
test('Real Go HTML templates retain authentication tokens and render only the intended app choice for safe or malformed metadata', { skip: !goAvailable && 'Set FP_GO_BINARY to an official Go runtime to run template-render proof.' }, () => {
  const patch = buildAuthEmailAppTemplatePatch(config)
  const cases = [
    ...['parent', 'fan', 'player', 'family'].map(account_type => ({ metadata: { account_type }, expected: 'parent' })),
    ...['coach', 'staff', 'coach_owner', 'team_admin', 'club_admin', 'workspace_user'].map(account_type => ({ metadata: { account_type }, expected: 'coach' })),
    ...[{}, null, { account_type: 123 }, { account_type: ['parent'] }, { account_type: { evil: 'coach' } }, { account_type: '{{ .ConfirmationURL }}' }].map(metadata => ({ metadata, expected: 'both' })),
  ]
  const requests = Object.entries(patch).flatMap(([key, template]) => cases.map(item => ({ key, expected: item.expected, template, data: { Data: item.metadata, ConfirmationURL: 'https://auth.example.test/verify?token=synthetic-secret&type=email', Token: '314159', Email: 'old@example.test', NewEmail: 'new@example.test', OldEmail: 'older@example.test', Phone: 'new-phone', OldPhone: 'old-phone', Provider: 'synthetic-provider', FactorType: 'totp' } })))
  const result = spawnSync(goBinary, ['run', 'tests/fixtures/render-auth-email-templates.go'], { input: JSON.stringify(requests), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 120000 })
  assert.equal(result.status, 0, result.stderr)
  const rendered = JSON.parse(result.stdout)
  assert.equal(rendered.length, requests.length)
  rendered.forEach((html, index) => {
    const request = requests[index]
    assert.equal(html.includes('id6772061464'), request.expected !== 'coach')
    assert.equal(html.includes('id6772059305'), request.expected !== 'parent')
    assert.equal(html.includes('{{'), false)
    if (request.key.includes('reauthentication')) assert.ok(html.includes('314159'))
    else if (!request.key.includes('_notification_')) assert.ok(html.includes('https://auth.example.test/verify?token=synthetic-secret&amp;type=email'))
    assert.ok(html.includes('old@example.test') || request.key.includes('reauthentication'))
  })
})
