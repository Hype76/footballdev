import process from 'node:process'
import { createHash } from 'node:crypto'
import { getPlan, getPlanKey, PLAN_KEYS } from '../../../src/lib/plans.js'
import { quoteSubscription } from '../../../src/lib/subscription-pricing.js'
import { createFromAddress, sendEmail } from './_email-provider.js'
import {
  createEmailDedupeKey,
  createEmailRecipientDedupeKeys,
  createPendingEmailLog,
  markEmailLogFailed,
  markEmailLogSent,
} from './_email-log-store.js'

const DEFAULT_RECIPIENTS = Object.freeze(['steve@jelumalabs.com', 'simon@jelumalabs.com'])
const TEAM_PLAN_KEYS = new Set([PLAN_KEYS.matchday, PLAN_KEYS.team, PLAN_KEYS.individual, PLAN_KEYS.singleTeam])

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase()
}

function envValue(name, env = process.env) {
  return globalThis.Netlify?.env?.get?.(name) || env[name]
}

function normalizeHost(value) {
  return normalizeText(value).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '')
}

function escapeHtml(value) {
  return normalizeText(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function isValidEmail(value) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(normalizeText(value))
}

function isSyntheticSignup({ contactEmail, workspaceName }) {
  const email = normalizeEmail(contactEmail)
  const name = normalizeText(workspaceName).toUpperCase()
  return email.endsWith('.invalid') || email.endsWith('.test') || name.startsWith('FP TEST')
}

function formatPence(value) {
  if (value === null || value === undefined || value === '') return ''
  const pence = Number(value)
  return Number.isInteger(pence) && pence >= 0 ? `GBP ${(pence / 100).toFixed(2)}` : ''
}

function getPriceDetails({ billingCycle, checkoutAmountPence, discountAmountPence, offerLabel, offerKey, planKey, teamCapacity }) {
  const normalizedPlanKey = getPlanKey(planKey)
  const plan = getPlan({ planKey: normalizedPlanKey })
  const normalizedCycle = normalizeText(billingCycle).toLowerCase()
  const capacityValue = teamCapacity === null || teamCapacity === undefined || teamCapacity === ''
    ? plan.limits?.teams
    : teamCapacity
  const capacity = Number(capacityValue)
  let planPrice = plan.headlineMonthlyPrice || 'Unknown'

  if (['matchday', 'team', 'club'].includes(normalizedPlanKey) && ['monthly', 'annual'].includes(normalizedCycle)) {
    const quote = quoteSubscription({ planKey: normalizedPlanKey, billingCycle: normalizedCycle, teamCapacity: capacity, offerKey })
    planPrice = `${formatPence(quote.chargePence)}/${normalizedCycle === 'annual' ? 'year' : 'month'}`
  }

  return {
    billingCycle: normalizedCycle ? `${normalizedCycle[0].toUpperCase()}${normalizedCycle.slice(1)}` : '',
    checkoutTotal: formatPence(checkoutAmountPence),
    discount: Number(discountAmountPence) > 0 ? formatPence(discountAmountPence) : '',
    offerLabel: normalizeText(offerLabel),
    planPrice,
    teamCapacity: Number.isInteger(capacity) && capacity > 0 ? capacity : null,
  }
}

function createStableSignupKey(details) {
  const seed = normalizeText(details?.notificationKey)
    || `${normalizeText(details?.source || 'signup')}:${normalizeText(details?.clubId)}:${getPlanKey(details?.planKey)}`
  return createHash('sha256').update(`football-player-signup:${seed}`).digest('hex')
}

export function resolveSignupNotificationRecipients(env = process.env) {
  const configured = normalizeText(envValue('SIGNUP_NOTIFICATION_RECIPIENTS', env))
    .split(',')
    .map(normalizeEmail)
    .filter(isValidEmail)
  return Object.freeze(Array.from(new Set(configured.length > 0 ? configured : DEFAULT_RECIPIENTS)))
}

export function shouldSendSignupNotification(event = {}, env = process.env) {
  const context = normalizeText(envValue('CONTEXT', env)).toLowerCase()
  const branch = normalizeText(envValue('BRANCH', env)).toLowerCase()
  const host = normalizeHost(event.headers?.['x-forwarded-host'] || event.headers?.host)
  const productionHosts = new Set(['footballplayer.online'])

  for (const value of [envValue('URL', env), envValue('VITE_APP_URL', env), envValue('PRODUCTION_URL', env)]) {
    const configuredHost = normalizeHost(value)
    if (configuredHost) productionHosts.add(configuredHost)
  }

  if (context === 'deploy-preview' || context === 'branch-deploy' || branch.includes('staging')) return false
  return context === 'production' || productionHosts.has(host)
}

export function buildSignupNotificationEmail({
  billingMode = '',
  billingCycle = '',
  checkoutAmountPence = null,
  clubId,
  contactEmail,
  contactName,
  createdAt = new Date().toISOString(),
  discountAmountPence = null,
  isPlanComped = false,
  offerKey = '',
  offerLabel = '',
  planKey,
  source = 'signup',
  teamCapacity = null,
  workspaceName,
} = {}, env = process.env) {
  const normalizedPlanKey = getPlanKey(planKey)
  const plan = getPlan({ planKey: normalizedPlanKey })
  const workspaceType = TEAM_PLAN_KEYS.has(normalizedPlanKey) ? 'Team' : 'Club'
  const safeWorkspaceName = normalizeText(workspaceName) || 'Unnamed workspace'
  const recipients = resolveSignupNotificationRecipients(env)
  const timestamp = new Date(createdAt)
  const createdLabel = Number.isNaN(timestamp.getTime())
    ? normalizeText(createdAt) || 'Unknown'
    : timestamp.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' })
  const priceDetails = getPriceDetails({ billingCycle, checkoutAmountPence, discountAmountPence, offerKey, offerLabel, planKey: normalizedPlanKey, teamCapacity })
  const billingLabel = plan.isFree ? 'Free' : normalizeText(billingMode) === 'unpaid' || isPlanComped ? 'Complimentary' : 'Paid'
  const subject = `New Football Player ${workspaceType.toLowerCase()} signup | ${safeWorkspaceName} | ${plan.displayName}`
  const rows = [
    ['Signup type', `${workspaceType} signup`],
    [workspaceType, safeWorkspaceName],
    ['Price plan', plan.displayName],
    ['Plan price', priceDetails.planPrice],
    ...(priceDetails.billingCycle ? [['Billing cycle', priceDetails.billingCycle]] : []),
    ...(workspaceType === 'Club' && priceDetails.teamCapacity ? [['Team capacity', `${priceDetails.teamCapacity} teams`]] : []),
    ...(priceDetails.offerLabel ? [['Offer', priceDetails.offerLabel]] : []),
    ...(priceDetails.checkoutTotal ? [['Checkout total', priceDetails.checkoutTotal]] : []),
    ...(priceDetails.discount ? [['Discount applied', priceDetails.discount]] : []),
    ['Billing', billingLabel],
    ['Contact', normalizeText(contactName) || 'Not supplied'],
    ['Email', normalizeEmail(contactEmail) || 'Not supplied'],
    ['Signed up', createdLabel],
    ['Source', normalizeText(source) || 'signup'],
    ['Workspace ID', normalizeText(clubId) || 'Unknown'],
  ]
  const htmlRows = rows.map(([label, value]) => `<tr><th style="padding:8px 12px;text-align:left;border-bottom:1px solid #e5e7eb">${escapeHtml(label)}</th><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${escapeHtml(value)}</td></tr>`).join('')
  const html = `<div style="font-family:Arial,sans-serif;color:#101828;line-height:1.5"><h1 style="font-size:22px;margin:0 0 12px">New ${workspaceType.toLowerCase()} signup</h1><p>A new Football Player ${workspaceType.toLowerCase()} workspace has been created.</p><table style="border-collapse:collapse;width:100%;max-width:640px">${htmlRows}</table></div>`

  return Object.freeze({
    recipients,
    resendPayload: {
      from: createFromAddress('Football Player Signups', env),
      to: recipients,
      subject,
      html,
      emailAppRole: 'both',
    },
    subject,
    workspaceType,
  })
}

async function deliverNewWorkspaceSignupNotification(details, {
  createPendingEmailLogImpl = createPendingEmailLog,
  env = process.env,
  markEmailLogFailedImpl = markEmailLogFailed,
  markEmailLogSentImpl = markEmailLogSent,
  sendEmailImpl = sendEmail,
} = {}) {
  if (!shouldSendSignupNotification(details?.event, env)) return Object.freeze({ status: 'skipped_environment' })
  if (isSyntheticSignup(details || {})) return Object.freeze({ status: 'skipped_synthetic' })

  const email = buildSignupNotificationEmail(details, env)
  const stableKey = createStableSignupKey(details)
  const providerIdempotencyKey = `fp-signup-${stableKey}`
  const storedPayload = {
    clubId: normalizeText(details?.clubId),
    emailType: 'new_workspace_signup',
    providerIdempotencyKey,
    resendPayload: email.resendPayload,
    source: normalizeText(details?.source || 'signup'),
  }
  const recipientDedupeKeys = createEmailRecipientDedupeKeys({ payload: email.resendPayload, recipients: email.recipients })
  const pending = await createPendingEmailLogImpl({
    recipients: email.recipients,
    subject: email.subject,
    payload: storedPayload,
    dedupeKey: createEmailDedupeKey(email.resendPayload),
    recipientDedupeKeys,
    idempotencyKey: stableKey,
  })

  if (pending?.blocked) return Object.freeze({ status: 'blocked' })
  if (pending?.skipped) return Object.freeze({ status: 'duplicate' })

  try {
    const response = await sendEmailImpl(email.resendPayload, {
      context: {
        emailType: 'new_workspace_signup',
        actorEmail: normalizeEmail(details?.contactEmail),
        clubId: normalizeText(details?.clubId),
        targetEntityType: 'club',
        targetEntityId: normalizeText(details?.clubId),
      },
      env,
      idempotencyKey: providerIdempotencyKey,
      publicMessage: 'Signup notification email could not be sent.',
    })
    await markEmailLogSentImpl(pending?.record, response, { recipientDedupeKeys })
    return Object.freeze({ status: 'sent', providerMessageId: normalizeText(response?.data?.id || response?.id) })
  } catch (error) {
    await markEmailLogFailedImpl(pending?.record, error)
    console.error('signup_notification_email_failed', JSON.stringify({
      clubId: normalizeText(details?.clubId),
      code: normalizeText(error?.code || error?.name || 'unknown'),
    }))
    return Object.freeze({ status: pending?.record?.id ? 'queued_for_retry' : 'failed' })
  }
}

export async function sendNewWorkspaceSignupNotification(details, options = {}) {
  try {
    return await deliverNewWorkspaceSignupNotification(details, options)
  } catch (error) {
    console.error('signup_notification_email_setup_failed', JSON.stringify({
      clubId: normalizeText(details?.clubId),
      code: normalizeText(error?.code || error?.name || 'unknown'),
    }))
    return Object.freeze({ status: 'failed' })
  }
}
