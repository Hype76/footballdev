const EXPIRED_CONFIRMATION_MESSAGE = 'That confirmation link is no longer valid. Open the newest Football Player confirmation email for this account, then try its link. Older emails from a previous signup will not work.'

export function getAuthRedirectErrorMessage(search = '', hash = '') {
  const query = new URLSearchParams(String(search).replace(/^\?/, ''))
  const fragment = new URLSearchParams(String(hash).replace(/^#/, ''))
  const error = fragment.get('error') || query.get('error')
  const code = fragment.get('error_code') || query.get('error_code')

  if (code === 'otp_expired') return EXPIRED_CONFIRMATION_MESSAGE
  if (error === 'access_denied') return 'Email confirmation could not be completed. Open the newest confirmation email and try again.'
  return ''
}

let pendingAuthRedirectError = typeof window === 'undefined'
  ? ''
  : getAuthRedirectErrorMessage(window.location.search, window.location.hash)

export function readAuthRedirectError() {
  return pendingAuthRedirectError
}

export function clearAuthRedirectError() {
  pendingAuthRedirectError = ''
}
