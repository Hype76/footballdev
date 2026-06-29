import process from 'node:process'
import { Resend } from 'resend'

const DEFAULT_FROM_EMAIL = 'feedback@footballplayer.online'
const DEFAULT_PUBLIC_FAILURE_MESSAGE = 'Email could not be sent. Please try again in a moment.'

export class EmailProviderError extends Error {
  constructor(message, {
    cause,
    code = '',
    providerStatus = null,
    publicMessage = DEFAULT_PUBLIC_FAILURE_MESSAGE,
    statusCode = 502,
  } = {}) {
    super(message || DEFAULT_PUBLIC_FAILURE_MESSAGE, { cause })
    this.name = 'EmailProviderError'
    this.code = code
    this.providerStatus = providerStatus
    this.publicMessage = publicMessage
    this.statusCode = statusCode
  }
}

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase()
}

function isValidEmail(value) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(normalizeText(value))
}

function cleanHeaderPart(value, fallback = 'Football Player') {
  const cleanedValue = String(value ?? '')
    .split('')
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code >= 32 && code !== 127 && !'<>{}[]"\'`;\\'.includes(character)
    })
    .join('')
    .trim()

  return cleanedValue || fallback
}

function getPayloadReplyTo(payload) {
  return payload?.replyTo ?? payload?.reply_to
}

function normalizeResendPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return {}
  }

  if (!payload.reply_to || payload.replyTo) {
    return payload
  }

  const { reply_to, ...rest } = payload
  return {
    ...rest,
    replyTo: reply_to,
  }
}

function parseFromAddress(from) {
  const rawFrom = normalizeText(from)
  const bracketMatch = rawFrom.match(/<([^<>]+)>/)
  const email = normalizeEmail(bracketMatch?.[1] || rawFrom)
  return {
    raw: rawFrom,
    email,
    domain: email.includes('@') ? email.split('@').pop() : '',
  }
}

function getProviderResponseError(response) {
  return response?.error || response?.data?.error || null
}

function sanitizeProviderError(error) {
  const providerError = error?.error || error
  const message = normalizeText(providerError?.message || providerError?.name || providerError) || 'Email provider rejected the request.'
  const code = normalizeText(providerError?.code || providerError?.type || providerError?.name)
  const providerStatus = Number(providerError?.providerStatus ?? providerError?.status ?? providerError?.response?.status ?? providerError?.statusCode ?? 0) || null

  return {
    code,
    message,
    providerStatus,
  }
}

function safeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : normalizeText(value) ? [normalizeText(value)] : []
}

function createSafeLogPayload({ context = {}, payload = {}, response = null, error = null }) {
  const sanitizedError = error ? sanitizeProviderError(error) : null

  return {
    emailType: normalizeText(context.emailType || 'unknown'),
    userRole: normalizeText(context.userRole || ''),
    actorId: normalizeText(context.actorId || ''),
    actorEmail: normalizeEmail(context.actorEmail || ''),
    clubId: normalizeText(context.clubId || ''),
    teamId: normalizeText(context.teamId || ''),
    targetEntityType: normalizeText(context.targetEntityType || ''),
    targetEntityId: normalizeText(context.targetEntityId || ''),
    recipientCount: safeArray(payload.to).length,
    ccCount: safeArray(payload.cc).length,
    subjectLength: normalizeText(payload.subject).length,
    hasAttachments: Array.isArray(payload.attachments) && payload.attachments.length > 0,
    providerMessageId: normalizeText(response?.data?.id || response?.id || ''),
    providerStatus: sanitizedError?.providerStatus ?? null,
    providerCode: sanitizedError?.code ?? '',
    error: sanitizedError?.message ?? '',
  }
}

export function getEmailProviderConfig(env = process.env) {
  const apiKey = normalizeText(env.RESEND_API_KEY)
  const fromEmail = normalizeEmail(env.RESEND_FROM_EMAIL || env.EMAIL_FROM_ADDRESS || DEFAULT_FROM_EMAIL)
  const fromDomain = fromEmail.includes('@') ? fromEmail.split('@').pop() : ''
  const missing = []

  if (!apiKey) {
    missing.push('RESEND_API_KEY')
  }

  if (!fromEmail || !isValidEmail(fromEmail)) {
    missing.push('RESEND_FROM_EMAIL')
  }

  return {
    apiKey,
    configured: missing.length === 0,
    fromDomain,
    fromEmail,
    missing,
  }
}

export function assertEmailProviderConfig({ env = process.env, publicMessage = 'Email service is not configured.' } = {}) {
  const config = getEmailProviderConfig(env)

  if (!config.configured) {
    throw new EmailProviderError(`Missing email provider configuration: ${config.missing.join(', ')}`, {
      code: 'email_config_missing',
      publicMessage,
      statusCode: 500,
    })
  }

  return config
}

export function createFromAddress(name, env = process.env) {
  const config = getEmailProviderConfig(env)
  return `${cleanHeaderPart(name)} <${config.fromEmail}>`
}

export function getPublicEmailErrorMessage(error, fallback = DEFAULT_PUBLIC_FAILURE_MESSAGE) {
  return normalizeText(error?.publicMessage) || fallback
}

export async function sendEmail(emailPayload, {
  context = {},
  env = process.env,
  publicMessage = DEFAULT_PUBLIC_FAILURE_MESSAGE,
  resendClient = null,
} = {}) {
  const config = assertEmailProviderConfig({ env, publicMessage })
  const payload = normalizeResendPayload(emailPayload)
  const from = parseFromAddress(payload.from)

  if (!from.email || !isValidEmail(from.email)) {
    throw new EmailProviderError('Email from address is not valid.', {
      code: 'email_from_invalid',
      publicMessage,
      statusCode: 500,
    })
  }

  if (from.domain && config.fromDomain && from.domain !== config.fromDomain) {
    console.warn('email_provider_from_domain_mismatch', JSON.stringify({
      emailType: normalizeText(context.emailType || 'unknown'),
      fromDomain: from.domain,
      configuredDomain: config.fromDomain,
    }))
  }

  const safePayload = {
    ...payload,
    replyTo: getPayloadReplyTo(payload) || undefined,
  }

  delete safePayload.reply_to

  try {
    const resend = resendClient || new Resend(config.apiKey)
    const response = await resend.emails.send(safePayload)
    const providerError = getProviderResponseError(response)

    if (providerError) {
      const sanitizedError = sanitizeProviderError(providerError)
      throw new EmailProviderError(sanitizedError.message, {
        cause: providerError,
        code: sanitizedError.code,
        providerStatus: sanitizedError.providerStatus,
        publicMessage,
      })
    }

    console.info('email_provider_send_success', JSON.stringify(createSafeLogPayload({
      context,
      payload: safePayload,
      response,
    })))

    return response
  } catch (error) {
    const wrappedError = error instanceof EmailProviderError
      ? error
      : new EmailProviderError(sanitizeProviderError(error).message, {
          cause: error,
          ...sanitizeProviderError(error),
          publicMessage,
        })

    console.error('email_provider_send_failed', JSON.stringify(createSafeLogPayload({
      context,
      payload: safePayload,
      error: wrappedError,
    })))

    throw wrappedError
  }
}
