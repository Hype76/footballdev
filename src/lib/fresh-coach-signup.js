async function request(apiBaseUrl, body) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const response = await fetch(`${String(apiBaseUrl || '').replace(/\/$/, '')}/.netlify/functions/fresh-coach-signup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal,
    })
    const result = await response.json()
    if (!response.ok || result.success !== true) throw new Error(result.message || 'We could not finish that signup. Please try again.')
    return result
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('This is taking a little longer. Check your connection and try again. If setup completed, you can sign in using the password you chose.')
    throw error
  } finally { clearTimeout(timer) }
}

export async function requestFreshCoachSignup({ apiBaseUrl = '', email, name, teamName }) {
  const result = await request(apiBaseUrl, { action: 'request', email, name, teamName })
  if (!/^[a-f0-9-]{36}$/i.test(result.requestId || '')) throw new Error('A verification code could not be requested. Please try again.')
  return result.requestId
}

export async function verifyFreshCoachSignup({ apiBaseUrl = '', requestId, code, password }) {
  return request(apiBaseUrl, { action: 'verify', requestId, code: String(code || '').trim(), password })
}
