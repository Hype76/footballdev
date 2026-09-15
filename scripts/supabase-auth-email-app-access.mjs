import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { buildEmailAppAccess } from '../netlify/functions/lib/_email-app-access.js'

const start = '<!-- fp-auth-app-access:start -->'
const end = '<!-- fp-auth-app-access:end -->'
const authTypes = ['confirmation', 'invite', 'magic_link', 'email_change', 'recovery', 'reauthentication']
const notificationTypes = ['password_changed', 'email_changed', 'phone_changed', 'mfa_factor_enrolled', 'mfa_factor_unenrolled', 'identity_linked', 'identity_unlinked']

export function buildAuthEmailAppTemplate(body) {
  if (typeof body !== 'string' || !body.trim()) throw new Error('An existing Auth email body is required.')
  const original = body.replace(/<!-- fp-auth-app-access:start -->[\s\S]*?<!-- fp-auth-app-access:end -->/g, '')
  // This metadata chooses presentation only. printf keeps unexpected metadata types safe for Go equality checks.
  const choose = values => values.map(value => `(eq $appType "${value}")`).join(' ')
  const footer = `${start}{{ $appType := "" }}{{ with .Data }}{{ $appType = printf "%v" .account_type }}{{ end }}{{ if or ${choose(['parent', 'fan', 'player', 'family'])} }}${buildEmailAppAccess({ role: 'parent' }).html}{{ else if or ${choose(['coach', 'staff', 'coach_owner', 'team_admin', 'club_admin', 'workspace_user'])} }}${buildEmailAppAccess({ role: 'coach' }).html}{{ else }}${buildEmailAppAccess({ role: 'both' }).html}{{ end }}${end}`
  return /<\/body\s*>/i.test(original) ? original.replace(/<\/body\s*>/i, footer + '</body>') : original + footer
}

export function buildAuthEmailAppTemplatePatch(config) {
  const patch = {}
  for (const type of authTypes) {
    const key = `mailer_templates_${type}_content`
    patch[key] = buildAuthEmailAppTemplate(config[key])
  }
  // Disabled security messages stay disabled. Prepare their existing content without changing any enable flag.
  for (const type of notificationTypes) {
    const key = `mailer_templates_${type}_notification_content`
    if (typeof config[key] === 'string' && config[key].trim()) patch[key] = buildAuthEmailAppTemplate(config[key])
  }
  return patch
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output] = process.argv.slice(2)
  if (!input || !output) throw new Error('Provide an existing settings backup path and an output patch path. This command never applies settings.')
  const config = JSON.parse((await readFile(input, 'utf8')).replace(/^\uFEFF/, ''))
  const patch = buildAuthEmailAppTemplatePatch(config)
  await writeFile(output, JSON.stringify(patch, null, 2) + '\n')
  console.log(`Prepared ${Object.keys(patch).length} Auth email template bodies. Subjects, enable flags, SMTP settings and primary actions are unchanged.`)
}
