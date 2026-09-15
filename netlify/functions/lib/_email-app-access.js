import { APP_DOWNLOAD_LINKS } from '../../../src/lib/app-download-links.js'

const start = '<!-- fp-app-access:start -->'
const end = '<!-- fp-app-access:end -->'
const textStart = '\n\n--- Football Player app access ---\n'
const textEnd = '\n--- End app access ---'
const isRole = role => ['parent', 'coach', 'both'].includes(role)
const normalizeRole = role => isRole(role) ? role : 'both'
const copyHeading = role => role === 'coach' ? 'For Coaches receiving a copy' : 'For Parents, Players and Fans receiving a copy'
const htmlFooterPattern = /<!-- fp-app-access:start -->[\s\S]*?<!-- fp-app-access:end -->/g
const textFooterPattern = /\n\n--- Football Player app access ---\n[\s\S]*?\n--- End app access ---/g

function readStoredAudience(html, text) {
  const htmlFooter = html.match(htmlFooterPattern)?.[0] || ''
  const textFooter = text.match(textFooterPattern)?.[0] || ''
  const marker = /<!-- fp-app-access:role=(parent|coach|both);copy=(parent|coach|) -->/.exec(htmlFooter)
  if (marker) return { role: marker[1], copyRole: marker[2] }
  // Older rendered payloads and text-only retries retain their human-readable app names.
  const footer = htmlFooter || textFooter
  const roles = ['parent', 'coach'].filter(role => footer.includes(APP_DOWNLOAD_LINKS[role].name))
  if (roles.length === 1) return { role: roles[0], copyRole: '' }
  if (roles.length === 2) {
    const copyRole = roles.find(role => footer.includes(copyHeading(role))) || ''
    return { role: copyRole ? roles.find(role => role !== copyRole) : 'both', copyRole }
  }
  return { role: 'both', copyRole: '' }
}
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))

export function buildEmailAppAccess({ role = 'both', copyRole = '' } = {}) {
  const primary = normalizeRole(role)
  const roles = primary === 'both' ? ['parent', 'coach'] : [primary]
  if (['parent', 'coach'].includes(copyRole) && !roles.includes(copyRole)) roles.push(copyRole)
  const html = roles.map(key => {
    const app = APP_DOWNLOAD_LINKS[key]
    const copy = key === copyRole && primary !== 'both' && primary !== key
    return `<tr><td style="padding:20px 16px;font-family:Arial,sans-serif;color:#17382f;background:#f3f7f5"><h2 style="margin:0 0 8px;font-size:18px;line-height:24px">${copy ? copyHeading(key) : app.audience}</h2><p style="margin:0 0 16px;font-size:14px;line-height:21px">Use the ${app.name}, or sign in on the website. Use the action above first if this email asks you to confirm, accept or reset something.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="table-layout:fixed"><tr>${[['apple', 'App Store', 'iPhone'], ['android', 'Google Play', 'Android']].map(([store, label, device]) => `<td width="50%" valign="top" align="center" style="padding:4px"><a href="${app[store]}" style="color:#075e45;font-weight:bold;font-size:14px;line-height:22px">Download on ${label}</a><br><a href="${app[store]}"><img src="${app[`${store}Qr`]}" width="136" height="136" alt="Scan to download the ${key === 'parent' ? 'Parent' : 'Coach'} app for ${device}" style="display:block;width:100%;max-width:136px;height:auto;margin:12px auto;border:0;background:#fff"></a></td>`).join('')}</tr></table><p style="margin:16px 0 0;font-size:14px;line-height:22px"><a href="${app.web}" style="color:#075e45;font-weight:bold">Sign in on the website</a></p></td></tr>`
  }).join('')
  const text = roles.map(key => {
    const app = APP_DOWNLOAD_LINKS[key]
    const copy = key === copyRole && primary !== 'both' && primary !== key
    return `${copy ? copyHeading(key) : app.audience}\n${app.name}\niPhone: ${app.apple}\nAndroid: ${app.android}\nWebsite: ${app.web}`
  }).join('\n\n')
  return {
    html: `${start}<!-- fp-app-access:role=${primary};copy=${roles.includes(copyRole) && primary !== copyRole && primary !== 'both' ? copyRole : ''} --><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:24px auto 0;border-top:1px solid #d5e2db">${html}</table>${end}`,
    text: `${textStart}Use the main action above first if this email asks you to confirm, accept or reset something.\n\n${text}${textEnd}`,
  }
}

export function addEmailAppAccess(email = {}) {
  // Internal presentation metadata must never reach the email provider API.
  const { emailAppRole, emailCcAppRole, ...payload } = email
  const originalHtml = typeof payload.html === 'string' ? payload.html : ''
  const originalText = typeof payload.text === 'string' ? payload.text : ''
  const stored = readStoredAudience(originalHtml, originalText)
  const explicitRole = isRole(emailAppRole)
  const copyRole = ['parent', 'coach'].includes(emailCcAppRole) ? emailCcAppRole : explicitRole ? '' : stored.copyRole
  const footer = buildEmailAppAccess({ role: explicitRole ? emailAppRole : stored.role, copyRole: payload.cc?.length ? copyRole : '' })
  const html = originalHtml.replace(htmlFooterPattern, '')
  const text = originalText.replace(textFooterPattern, '')
  const body = html || `<div style="white-space:pre-wrap;font-family:Arial,sans-serif">${escape(text)}</div>`
  payload.html = /<\/body\s*>/i.test(body) ? body.replace(/<\/body\s*>/i, footer.html + '</body>') : body + footer.html
  if (typeof payload.text === 'string') payload.text = text + footer.text
  return payload
}
