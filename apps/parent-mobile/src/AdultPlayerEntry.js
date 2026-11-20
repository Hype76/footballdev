import { useState } from 'react'
import { AdultPlayerScreen } from './AdultPlayerScreen'
import { selectAdultPlayerView } from './adultPlayerAccess.js'
import { useAdultPlayerAccess } from './useAdultPlayerAccess'

export function AdultPlayerEntry({ userId, links, parentProfilePending, onSignOut, renderParent, renderFan, renderPlayer }) {
  const { access, refresh } = useAdultPlayerAccess(userId)
  const hasParent = links.some(link => link.linkType !== 'fan')
  const hasFan = !hasParent && links.some(link => link.linkType === 'fan')
  const [preferredMode, setPreferredMode] = useState(null)
  const view = parentProfilePending ? 'checking' : selectAdultPlayerView({ access, hasParent, hasFan, preferredMode })

  const openPlayer = access.status === 'linked' ? () => setPreferredMode('player') : null
  if (view === 'fan') return renderFan(openPlayer)
  if (view === 'parent') return renderParent({ openPlayer, playerAccess: { refresh, error: access.message } })

  if (view === 'player' && access.link && renderPlayer) return renderPlayer({ link: access.link, openOtherAccount: hasParent || hasFan ? () => setPreferredMode(hasParent ? 'parent' : 'fan') : null })

  return (
    <AdultPlayerScreen key={access.link?.id || 'access'} access={parentProfilePending ? { status: 'checking' } : access} onRefresh={refresh} onSignOut={onSignOut}
      onSwitchAccount={hasParent || hasFan ? () => setPreferredMode(hasParent ? 'parent' : 'fan') : null}
      switchLabel={hasParent ? 'Open Parent account' : 'Open Fan account'} />
  )
}
