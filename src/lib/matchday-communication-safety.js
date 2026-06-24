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

export function isLiveMatchdayCommunicationAllowed({ env = {}, location } = {}) {
  const liveEnabled = normalizeText(env.VITE_ENABLE_LIVE_MATCHDAY_COMMUNICATIONS) === 'true'
  const mode = normalizeText(env.MODE)
  const isProduction = env.PROD === true || mode === 'production'
  const hostname = normalizeText(location?.hostname)

  return liveEnabled && isProduction && !isLocalMatchdayCommunicationHost(hostname)
}

export function shouldSendMatchdayAvailabilityRequests({ parentVisible, runtime } = {}) {
  return parentVisible === true && isLiveMatchdayCommunicationAllowed(runtime)
}

export function shouldSendMatchdayPushNotification({ parentVisible, runtime } = {}) {
  return parentVisible === true && isLiveMatchdayCommunicationAllowed(runtime)
}
