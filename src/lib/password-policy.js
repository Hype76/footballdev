export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_POLICY_SUMMARY = 'Use at least 12 characters with uppercase, lowercase, number, and symbol characters.'

const OBVIOUSLY_WEAK_PASSWORDS = new Set([
  '123456789012',
  'admin123456!',
  'football123!',
  'footballplayer',
  'letmein12345!',
  'password123!',
  'qwerty123456!',
  'welcome12345!',
])

export function getPasswordPolicyErrors(password) {
  const value = String(password ?? '')
  const errors = []

  if (value.length < PASSWORD_MIN_LENGTH) {
    errors.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`)
  }

  if (!/[a-z]/.test(value)) {
    errors.push('Password must include a lowercase letter.')
  }

  if (!/[A-Z]/.test(value)) {
    errors.push('Password must include an uppercase letter.')
  }

  if (!/[0-9]/.test(value)) {
    errors.push('Password must include a number.')
  }

  if (!/[^A-Za-z0-9]/.test(value)) {
    errors.push('Password must include a symbol.')
  }

  if (OBVIOUSLY_WEAK_PASSWORDS.has(value.toLowerCase())) {
    errors.push('Choose a password that is not commonly used or easy to guess.')
  }

  return errors
}

export function assertPasswordPolicy(password) {
  const errors = getPasswordPolicyErrors(password)

  if (errors.length > 0) {
    throw Object.assign(new Error(errors[0]), {
      code: 'weak_password',
      policyErrors: errors,
    })
  }

  return String(password)
}
