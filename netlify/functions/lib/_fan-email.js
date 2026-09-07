import { buildEmailLogoMarkup } from '../../../src/lib/email-branding.js'
import { fanBrandTheme } from '../../../src/lib/fan-branding.js'
import { fanAccessSummary } from '../../../src/lib/fans.js'
const escape = (value) => String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')

export function buildFanEmail({ club, fan, url, verification = false }) {
  const brand = { club_name: club.name, club_logo_url: club.logo_url, theme_accent: club.theme_accent }
  const { tokens } = fanBrandTheme(brand, 'light')
  const logo = buildEmailLogoMarkup({ clubLogoUrl: club.logo_url, altText: `${club.name} logo`, origin: 'https://footballplayer.online' })
  const label = verification ? 'Confirm email' : 'Review and accept invitation'
  const copy = verification ? '<p>Confirm your email to continue your Fan invitation.</p>' : `<p>You have been invited as a Fan with ${escape(club.name)} on Football Player.</p><ul>${fanAccessSummary(fan.permissions).map((line) => `<li>${escape(line)}</li>`).join('')}</ul><p>Sign in with ${escape(fan.email)}. Your invitation expires after 24 hours. You can remove your access at any time.</p>`
  return { subject: verification ? `Confirm your Fan account for ${club.name}` : `Your Fan invitation from ${club.name}`,
    html: `<html><body style="margin:0;background:#f3f7f6;color:#132522;font-family:Arial,sans-serif"><div style="max-width:600px;margin:24px auto;padding:28px;background:#ffffff;border-top:6px solid ${tokens.buttonPrimary}">${logo}<h1 style="font-size:24px">${escape(club.name)}</h1><p>Hello ${escape(fan.name)},</p>${copy}<p style="margin:28px 0"><a href="${escape(url)}" style="display:inline-block;padding:14px 20px;background:${tokens.buttonPrimary};color:${tokens.accentForeground};font-weight:bold;text-decoration:none;border-radius:6px">${label}</a></p><p style="color:#536461;font-size:12px">Fans · Powered by Football Player</p></div></body></html>` }
}
