import { supabase } from './supabase-client.js'

function normalizeText(value) {
  return String(value ?? '').trim()
}

export async function getMfaStatus() {
  const [{ data: factorsData, error: factorsError }, { data: assuranceData, error: assuranceError }] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ])

  if (factorsError || assuranceError) {
    throw factorsError || assuranceError
  }

  const factors = [
    ...(factorsData?.totp || []),
    ...(factorsData?.phone || []),
  ]

  return {
    currentLevel: normalizeText(assuranceData?.currentLevel) || 'aal1',
    nextLevel: normalizeText(assuranceData?.nextLevel) || 'aal1',
    verifiedFactors: factors.filter((factor) => factor.status === 'verified'),
  }
}

export async function beginTotpEnrollment() {
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'Football Player authenticator',
  })

  if (error) {
    throw error
  }

  return {
    factorId: normalizeText(data?.id),
    qrCode: normalizeText(data?.totp?.qr_code),
    secret: normalizeText(data?.totp?.secret),
    uri: normalizeText(data?.totp?.uri),
  }
}

export async function verifyTotpEnrollment({ code, factorId }) {
  const normalizedCode = normalizeText(code)
  const normalizedFactorId = normalizeText(factorId)

  if (!/^\d{6}$/.test(normalizedCode) || !normalizedFactorId) {
    throw new Error('Enter the 6-digit code from your authenticator app.')
  }

  const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId: normalizedFactorId,
  })

  if (challengeError) {
    throw challengeError
  }

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId: normalizedFactorId,
    challengeId: challengeData.id,
    code: normalizedCode,
  })

  if (verifyError) {
    throw verifyError
  }
}

export async function removeTotpFactor(factorId) {
  const { error } = await supabase.auth.mfa.unenroll({ factorId: normalizeText(factorId) })

  if (error) {
    throw error
  }
}
