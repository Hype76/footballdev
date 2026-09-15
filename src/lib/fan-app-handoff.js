import { APP_DOWNLOAD_LINKS } from './app-download-links.js'
export const PARENT_APP_STORE_URL = APP_DOWNLOAD_LINKS.parent.apple
export const PARENT_PLAY_STORE_URL = APP_DOWNLOAD_LINKS.parent.android

export function fanAppHandoffLinks(token, { accepted = false } = {}) {
  const value = String(token || '').trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return null
  return {
    app: accepted ? 'footballplayerparents://fans' : `footballplayerparents://fan-invite/${value}`,
    invitation: `https://parent.footballplayer.online/fan-invite/${value}`,
    apple: PARENT_APP_STORE_URL,
    android: PARENT_PLAY_STORE_URL,
  }
}
