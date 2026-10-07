import { pathToFileURL } from 'node:url'

const START = '<!-- fp-mobile-verification:start -->'
const END = '<!-- fp-mobile-verification:end -->'
export function buildMobileConfirmationEmail(existing) {
  if (typeof existing !== 'string' || !existing.trim()) throw new Error('The existing confirmation template is required.')
  if (existing.startsWith(START) && existing.endsWith(END)) return existing
  const code = '<div style="font-family:Arial,sans-serif;padding:24px;color:#142a1d;"><h1>Verify your Football Player account</h1><p>Enter this code in the app to finish creating your account.</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px;">{{ .Token }}</p><p>If you did not request this account, ignore this email.</p></div>'
  return `${START}{{ $mode := "" }}{{ with .Data }}{{ $mode = printf "%v" .verification_mode }}{{ end }}{{ if eq $mode "app_code" }}${code}{{ else }}${existing}{{ end }}${END}`
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ref = process.argv[2]
  if (!/^[a-z]{20}$/.test(ref || '') || !process.env.SUPABASE_ACCESS_TOKEN) throw new Error('Provide the verified project reference and management access.')
  const endpoint = `https://api.supabase.com/v1/projects/${ref}/config/auth`
  const headers = { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }
  const read = async () => {
    const response = await fetch(endpoint, { headers })
    if (!response.ok) throw new Error(`Auth settings could not be read (${response.status}).`)
    return response.json()
  }
  const current = await read()
  if (current.mailer_otp_length !== undefined && (!Number.isInteger(Number(current.mailer_otp_length)) || Number(current.mailer_otp_length) < 6 || Number(current.mailer_otp_length) > 10)) throw new Error('Auth code length must match the app before applying this template.')
  const key = 'mailer_templates_confirmation_content'
  const value = buildMobileConfirmationEmail(current[key])
  if (process.argv.includes('--apply') && value !== current[key]) {
    const response = await fetch(endpoint, { method: 'PATCH', headers, body: JSON.stringify({ [key]: value }) })
    if (!response.ok) throw new Error(`Confirmation template update failed (${response.status}).`)
    if ((await read())[key] !== value) throw new Error('Confirmation template readback did not match.')
  }
  console.log(JSON.stringify({ projectRef: ref, mobileCodeTemplate: current[key] === value || process.argv.includes('--apply'), webTemplatePreserved: value.includes(current[key]), applied: process.argv.includes('--apply') }))
}
