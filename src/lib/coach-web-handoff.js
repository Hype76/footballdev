const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ORIGINS = new Set(['https://footballplayer.online', 'https://footballplayer-mobile-test-api.netlify.app'])
const PURPOSES = new Set(['badge', 'upgrade'])

export function buildCoachWebHandoffUrl(apiBaseUrl, value) {
  const base = new URL(apiBaseUrl)
  if (!ORIGINS.has(base.origin) || base.username || base.password || base.pathname !== '/' || base.search || base.hash
    || !PURPOSES.has(value?.purpose) || !UUID.test(value?.actorId || '')
    || (value.purpose === 'badge' && !UUID.test(value.teamId || ''))
    || !/^[a-f0-9]{56}$/i.test(value?.tokenHash || '')) throw new Error('This website handoff could not be verified. Try again.')
  const url = new URL('/coach-app-handoff', base.origin)
  url.hash = new URLSearchParams({ token_hash: value.tokenHash, actor: value.actorId, purpose: value.purpose,
    ...(value.purpose === 'badge' ? { team: value.teamId } : {}) }).toString()
  return url.toString()
}

export async function exchangeCoachWebHandoff({ client, fragment, clearFragment }) {
  const params = new URLSearchParams(String(fragment || '').replace(/^#/, ''))
  // Clear the single-use credential before any request, navigation or rendering.
  clearFragment()
  const token = params.get('token_hash'), actor = params.get('actor'), purpose = params.get('purpose'), team = params.get('team')
  if (!/^[a-f0-9]{56}$/i.test(token || '') || !UUID.test(actor || '') || !PURPOSES.has(purpose)
    || (purpose === 'badge' && !UUID.test(team || ''))) throw new Error('This app link is invalid. Return to Coach and open it again.')
  const { data, error } = await client.auth.verifyOtp({ token_hash: token, type: 'magiclink' })
  if (error || !data?.session || data.session.user?.id !== actor) {
    if (!error && data?.session) await client.auth.signOut({ scope: 'local' })
    throw new Error('This app link has expired or was already used. Return to Coach and open it again.')
  }
  return { actorId: actor, destination: purpose === 'badge' ? `/team-branding?teamId=${encodeURIComponent(team)}&from=coach&uploadOnly=1` : '/app-upgrade' }
}
