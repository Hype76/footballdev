import process from 'node:process'

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeFlag(value) {
  return normalizeText(value).toLowerCase()
}

function getEnvList(value) {
  return normalizeText(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function isEnabledFlag(value) {
  return ['1', 'true', 'yes', 'on'].includes(normalizeFlag(value))
}

export function getTrainingAvailabilitySendGate(setting = {}, env = process.env) {
  if (isEnabledFlag(env.TRAINING_AVAILABILITY_REAL_EMAILS_ENABLED)) {
    return {
      allowed: true,
      mode: 'real-enabled',
    }
  }

  const fpTestClubIds = new Set(getEnvList(env.TRAINING_AVAILABILITY_FP_TEST_CLUB_IDS))
  const fpTestEnabled = isEnabledFlag(env.TRAINING_AVAILABILITY_FP_TEST_EMAILS_ENABLED)
  const isAllowlistedFpTest = fpTestEnabled && fpTestClubIds.has(normalizeText(setting.club_id))

  return {
    allowed: isAllowlistedFpTest,
    mode: isAllowlistedFpTest ? 'fp-test-allowlist' : 'real-disabled',
  }
}
