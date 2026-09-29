import { createHash } from 'node:crypto'
import { buildEmailLogoMarkup } from '../../../src/lib/email-branding.js'
import { APP_DOWNLOAD_LINKS } from '../../../src/lib/app-download-links.js'

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode })

export function buildCoachReferral({ name, senderEmail, message }) {
  const subject = `${name} would like your team to try Football Player`
  const text = `${name} (${senderEmail}) has invited you to take a look at Football Player.\n\n${message ? `${message}\n\n` : ''}Start with free Match Day: create your team, add players and invite parents. Choose a squad and record goals, assists, substitutions, cards and breaks. A Coach or an assigned Parent can score the match, with live alerts keeping families up to date.\n\nFootball Player also offers team calendars, attendance, messaging and player development, plus club management options. Explore the plans to choose what your team needs.\n\nGet started: https://footballplayer.online/pricing\nExplore Football Player: https://footballplayer.online\n\nWhen your team is ready, invite ${senderEmail} from the player's contacts. This email does not give anyone access to your team or player information.`
  const badges = [['apple', 'app-store-badge.png', 'Download on the App Store'], ['android', 'google-play-badge.png', 'Get it on Google Play']].map(([store, file, label]) => `<a href="${APP_DOWNLOAD_LINKS.coach[store]}"><img src="https://footballplayer.online/email-apps/${file}" height="44" alt="${label}" style="height:44px;width:auto;border:0;margin:8px 12px 8px 0"></a>`).join('')
  return { subject, text, html: `<div style="max-width:600px;margin:auto;padding:24px;font:16px/1.6 Arial,sans-serif;color:#142b25">${buildEmailLogoMarkup({ altText: 'Football Player' })}<h1 style="font-size:28px;line-height:1.2">Bring your team together with Football Player</h1>${text.split('\n\n').map(paragraph => `<p>${escape(paragraph).replaceAll('\n', '<br>')}</p>`).join('')}<p><a href="https://footballplayer.online/pricing" style="display:inline-block;padding:12px 20px;background:#214c86;color:white;text-decoration:none;font-weight:bold">Get started with free Match Day</a></p>${badges}<p style="font-size:12px;color:#53665f">Sent at ${escape(name)}'s request. This is a one-off invitation, not a mailing-list subscription.</p></div>` }
}

export async function coachReferral({ db, user, body, send, from }) {
  if (!user?.id || !user.email || !user.email_confirmed_at) throw fail(403, 'Confirm your email address before inviting your Coach.')
  const recipient = String(body.email || '').trim().toLowerCase()
  const name = String(body.name || '').trim()
  const message = String(body.message || '').trim()
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient) || recipient.length > 254) throw fail(400, 'Enter a valid Coach email address.')
  if (!name || name.length > 100 || /[\r\n]/.test(name) || message.length > 1000) throw fail(400, 'Enter your name and a message of up to 1,000 characters.')
  if (recipient === user.email.toLowerCase()) throw fail(400, 'Enter your Coach email address rather than your own.')
  const payload = { emailAppRole: 'coach', from, to: [recipient], reply_to: user.email, ...buildCoachReferral({ name, senderEmail: user.email, message }) }
  if (body.action === 'preview') return { success: true, subject: payload.subject, text: payload.text }
  if (body.action !== 'send') throw fail(400, 'Preview your invitation before sending it.')
  const reservation = await db.rpc('reserve_parent_coach_referral', { p_actor: user.id, p_digest: createHash('sha256').update(recipient).digest('hex'), p_payload: payload })
  if (reservation.error) {
    if (reservation.error.code === 'P0001') throw fail(429, reservation.error.message)
    throw fail(503, 'Your invitation could not be prepared. Please try again.')
  }
  const row = Array.isArray(reservation.data) ? reservation.data[0] : reservation.data
  if (!row?.id || !row.payload) throw fail(503, 'Your invitation could not be prepared. Please try again.')
  if (row.sent_at) return { success: true, alreadySent: true }
  const response = await send(row.payload, { idempotencyKey: `coach-referral-${row.id}`, context: { emailType: 'parent_coach_referral', actorUserId: user.id, targetEntityType: 'coach_referral', targetEntityId: row.id }, publicMessage: 'The email could not be sent. Please try again.' })
  const saved = await db.from('parent_coach_referrals').update({ sent_at: new Date().toISOString(), provider_id: response?.data?.id || response?.id || null }).eq('id', row.id)
  if (saved.error) throw fail(503, 'The email was submitted, but its status could not be saved. You can safely retry.')
  return { success: true }
}
