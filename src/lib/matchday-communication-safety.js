function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase()
}

export function isLocalMatchdayCommunicationHost(hostname) {
  const normalizedHostname = normalizeText(hostname)
  return normalizedHostname === 'localhost'
    || normalizedHostname === '127.0.0.1'
    || normalizedHostname === '::1'
    || normalizedHostname.endsWith('.local')
}

export function isProductionMatchdayCommunicationHost(hostname) {
  const normalizedHostname = normalizeText(hostname)
  return normalizedHostname === 'footballplayer.online'
    || normalizedHostname === 'www.footballplayer.online'
}

export function isPreviewMatchdayCommunicationHost(hostname) {
  const normalizedHostname = normalizeText(hostname)
  return normalizedHostname.endsWith('.netlify.app')
}

export function isLiveMatchdayCommunicationAllowed({ env = {}, location } = {}) {
  const liveEnabled = normalizeText(env.VITE_ENABLE_LIVE_MATCHDAY_COMMUNICATIONS) === 'true'
  const mode = normalizeText(env.MODE)
  const isProduction = env.PROD === true || mode === 'production'
  const hostname = normalizeText(location?.hostname)

  if (isLocalMatchdayCommunicationHost(hostname)) {
    return false
  }

  if (isPreviewMatchdayCommunicationHost(hostname)) {
    return false
  }

  if (isProductionMatchdayCommunicationHost(hostname)) {
    return true
  }

  return liveEnabled && isProduction
}

export function shouldSendMatchdayAvailabilityRequests({ parentVisible, runtime } = {}) {
  return parentVisible === true && isLiveMatchdayCommunicationAllowed(runtime)
}

export function shouldSendMatchdayPushNotification({ parentVisible, runtime } = {}) {
  return parentVisible === true && isLiveMatchdayCommunicationAllowed(runtime)
}
