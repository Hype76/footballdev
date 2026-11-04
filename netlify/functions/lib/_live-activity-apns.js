import { createPrivateKey, sign } from 'node:crypto'
import { connect as connectHttp2 } from 'node:http2'
import { Buffer } from 'node:buffer'

const BUNDLES = new Set(['com.footballplayer.coach', 'com.footballplayer.parents'])
const TOKEN_PATTERN = /^[a-f0-9]{64,256}$/i
const PROVIDER_ID_PATTERN = /^[A-Z0-9]{10}$/

// Build a short-lived provider token without retaining a key or logging tokens.
export function createLiveActivityProviderToken({ teamId, keyId, privateKey, nowSeconds }) {
  if (!PROVIDER_ID_PATTERN.test(teamId || '') || !PROVIDER_ID_PATTERN.test(keyId || '') || !Number.isInteger(nowSeconds) || nowSeconds <= 0) {
    throw new Error('live_activity_provider_configuration_invalid')
  }
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  const unsigned = `${encode({ alg: 'ES256', kid: keyId })}.${encode({ iss: teamId, iat: nowSeconds })}`
  const key = createPrivateKey(privateKey)
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new Error('live_activity_provider_key_invalid')
  }
  const signature = sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')
  return `${unsigned}.${signature}`
}

// The caller must check the current follower's authority before constructing
// each request. An activity token is not proof of match access.
export function createLiveActivityApnsRequest({ bundleId, activityToken, providerToken, contentState, timestamp, staleDate, end = false }) {
  if (!BUNDLES.has(bundleId) || !TOKEN_PATTERN.test(activityToken || '') || typeof providerToken !== 'string' || !providerToken) {
    throw new Error('live_activity_destination_invalid')
  }
  if (!Number.isInteger(timestamp) || timestamp <= 0 || !Number.isInteger(staleDate) || staleDate <= timestamp || !contentState || typeof contentState !== 'object' || Array.isArray(contentState)) {
    throw new Error('live_activity_payload_invalid')
  }
  const keys = ['homeName', 'awayName', 'homeScore', 'awayScore', 'phase', 'running', 'elapsedSeconds', 'sampledAtMs', 'homeShootoutScore', 'awayShootoutScore', 'homeYellowCards', 'homeRedCards', 'awayYellowCards', 'awayRedCards']
  const safeState = Object.fromEntries(keys.filter(key => Object.hasOwn(contentState, key)).map(key => [key, contentState[key]]))
  const score = value => Number.isSafeInteger(value) && value >= 0
  if (![safeState.homeName, safeState.awayName, safeState.phase].every(value => typeof value === 'string' && value.length <= 60)
    || !score(safeState.homeScore) || !score(safeState.awayScore) || typeof safeState.running !== 'boolean'
    || !(safeState.elapsedSeconds === null || score(safeState.elapsedSeconds)) || !score(safeState.sampledAtMs)
    || (safeState.homeShootoutScore !== undefined && !score(safeState.homeShootoutScore))
    || (safeState.awayShootoutScore !== undefined && !score(safeState.awayShootoutScore))
    || ['homeYellowCards', 'homeRedCards', 'awayYellowCards', 'awayRedCards'].some(key => safeState[key] !== undefined && !score(safeState[key]))) {
    throw new Error('live_activity_payload_invalid')
  }
  const body = JSON.stringify({ aps: { timestamp, event: end ? 'end' : 'update', 'content-state': safeState, 'stale-date': staleDate } })
  if (Buffer.byteLength(body, 'utf8') > 4096) throw new Error('live_activity_payload_too_large')
  return {
    headers: {
      ':method': 'POST',
      ':path': `/3/device/${activityToken}`,
      'apns-topic': `${bundleId}.push-type.liveactivity`,
      'apns-push-type': 'liveactivity',
      'apns-priority': '10',
      authorization: `bearer ${providerToken}`,
      'content-type': 'application/json',
    },
    body,
  }
}

export function createLiveActivityStartRequest({ bundleId, startToken, providerToken, contentState, timestamp, staleDate, activityKey, followId = null, handoffToken, clubIsHome, badgeData = null }) {
  if (typeof activityKey !== 'string' || !/^[0-9a-f-]{36}$/i.test(activityKey)
    || (followId !== null && (typeof followId !== 'string' || !/^[0-9a-f-]{36}$/i.test(followId)))
    || !/^[0-9a-f]{64}$/.test(handoffToken || '')
    || typeof clubIsHome !== 'boolean' || (badgeData !== null && (typeof badgeData !== 'string' || badgeData.length > 3000))) {
    throw new Error('live_activity_start_attributes_invalid')
  }
  const update = createLiveActivityApnsRequest({ bundleId, activityToken: startToken, providerToken,
    contentState, timestamp, staleDate })
  const payload = JSON.parse(update.body)
  payload.aps.event = 'start'
  payload.aps['attributes-type'] = 'MatchActivityAttributes'
  payload.aps.attributes = { activityKey, followId, handoffToken, badgeData, clubIsHome }
  payload.aps.alert = { title: 'Match started', body: `${contentState.homeName} v ${contentState.awayName}` }
  const body = JSON.stringify(payload)
  if (Buffer.byteLength(body, 'utf8') > 4096) throw new Error('live_activity_payload_too_large')
  return { ...update, body }
}

// One request is intentionally bounded. Retry and token retirement belong to
// the durable delivery queue, after its access check has been repeated.
export function sendLiveActivityApns(request, { production = true, connect = connectHttp2, timeoutMs = 8000 } = {}) {
  if (!request?.headers || typeof request.body !== 'string' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000) {
    return Promise.reject(new Error('live_activity_request_invalid'))
  }
  return new Promise((resolve, reject) => {
    const client = connect(production ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com')
    let stream, settled = false, status = 0, response = ''
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      client.close()
      if (error) reject(error)
      else resolve(value)
    }
    const timer = setTimeout(() => {
      stream?.close()
      client.destroy()
      finish(new Error('live_activity_apns_timeout'))
    }, timeoutMs)
    client.on('error', () => finish(new Error('live_activity_apns_connection_failed')))
    try {
      stream = client.request(request.headers)
      stream.setEncoding('utf8')
      stream.on('response', headers => { status = Number(headers[':status']) || 0 })
      stream.on('data', chunk => { response = (response + chunk).slice(0, 4096) })
      stream.on('error', () => finish(new Error('live_activity_apns_request_failed')))
      stream.on('end', () => {
        let reason = ''
        try { reason = JSON.parse(response).reason || '' } catch { /* A success response has no body. */ }
        finish(null, { accepted: status === 200, status, reason: typeof reason === 'string' ? reason.slice(0, 80) : '' })
      })
      stream.end(request.body)
    } catch {
      finish(new Error('live_activity_apns_request_failed'))
    }
  })
}
