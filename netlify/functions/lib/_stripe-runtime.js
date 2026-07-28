import process from 'node:process'
import Stripe from 'stripe'

export const STRIPE_API_VERSION = '2026-02-25.clover'

function normalizeEnvironmentMode(value) {
  const normalizedValue = String(value ?? '').trim().toLowerCase()

  if (normalizedValue === 'live' || normalizedValue === 'production') {
    return 'live'
  }

  if (normalizedValue === 'test' || normalizedValue === 'dev' || normalizedValue === 'development') {
    return 'test'
  }

  return ''
}

export function getExpectedStripeMode(env = process.env) {
  const explicitMode = normalizeEnvironmentMode(env.STRIPE_EXPECTED_MODE)

  if (explicitMode) {
    return explicitMode
  }

  const deployContext = String(env.CONTEXT ?? env.DEPLOY_CONTEXT ?? '').trim().toLowerCase()

  if (deployContext === 'production') {
    return 'live'
  }

  if (['dev', 'development', 'branch-deploy', 'deploy-preview'].includes(deployContext)) {
    return 'test'
  }

  return ''
}

export function inspectStripeServerKey(value, { expectedMode = '' } = {}) {
  const rawValue = String(value ?? '')
  const key = rawValue.trim()
  const normalizedExpectedMode = normalizeEnvironmentMode(expectedMode)
  let keyType = 'unknown'
  let mode = ''

  if (!key) {
    return {
      code: 'missing',
      keyType: 'missing',
      mode,
      valid: false,
    }
  }

  if (rawValue !== key || /^['"]|['"]$/.test(key) || /\s/.test(key)) {
    return {
      code: 'malformed',
      keyType,
      mode,
      valid: false,
    }
  }

  if (/^sk_live_\S+$/.test(key)) {
    keyType = 'secret'
    mode = 'live'
  } else if (/^rk_live_\S+$/.test(key)) {
    keyType = 'restricted'
    mode = 'live'
  } else if (/^sk_test_\S+$/.test(key)) {
    keyType = 'secret'
    mode = 'test'
  } else if (/^rk_test_\S+$/.test(key)) {
    keyType = 'restricted'
    mode = 'test'
  } else if (/^pk_(?:live|test)_\S+$/.test(key)) {
    return {
      code: 'publishable_key',
      keyType: 'publishable',
      mode: key.startsWith('pk_live_') ? 'live' : 'test',
      valid: false,
    }
  } else {
    return {
      code: 'unsupported_key',
      keyType,
      mode,
      valid: false,
    }
  }

  if (normalizedExpectedMode && normalizedExpectedMode !== mode) {
    return {
      code: 'wrong_mode',
      keyType,
      mode,
      valid: false,
    }
  }

  return {
    code: 'valid',
    keyType,
    mode,
    valid: true,
  }
}

export function createStripeConfigurationError(code = 'invalid_configuration') {
  return Object.assign(new Error('Stripe billing configuration is unavailable'), {
    code,
    isStripeConfigurationError: true,
    statusCode: 503,
  })
}

export function createStripeServerClient({
  env = process.env,
  expectedMode = getExpectedStripeMode(env),
  StripeConstructor = Stripe,
} = {}) {
  const keyInspection = inspectStripeServerKey(env.STRIPE_SECRET_KEY, { expectedMode })

  if (!keyInspection.valid) {
    throw createStripeConfigurationError(keyInspection.code)
  }

  return new StripeConstructor(String(env.STRIPE_SECRET_KEY).trim(), {
    apiVersion: STRIPE_API_VERSION,
  })
}

export function isStripeProviderError(error) {
  return Boolean(
    error?.isStripeConfigurationError ||
    String(error?.type ?? '').startsWith('Stripe') ||
    Number(error?.statusCode ?? error?.status ?? 0) >= 500,
  )
}

export function logStripeFailure(label, error) {
  console.error(label, {
    code: String(error?.code ?? '').slice(0, 80) || 'unknown',
    statusCode: Number(error?.statusCode ?? error?.status ?? 0) || null,
    type: String(error?.type ?? '').slice(0, 80) || 'unknown',
  })
}
