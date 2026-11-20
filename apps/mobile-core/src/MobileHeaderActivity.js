import { Text, View } from 'react-native'
import { BrandLoader } from './BrandLoader'
import { useMobileActivity } from './MobileActivityContext'

export function MobileHeaderActivity({ live = false, test = false, offline = false, connectionOffline, styles = {} }) {
  const activity = useMobileActivity()
  const disconnected = connectionOffline ?? (offline || activity?.offline)
  const showLive = live && !disconnected
  return <View testID="mobile-header-activity" style={{ width: 52, height: 36, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
    {activity?.active ? <BrandLoader header accessibilityLabel="Updating" size={28} />
      : live || test ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {showLive ? <View accessible={false} testID="mobile-live-dot" style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#258748' }} /> : null}
        <Text accessibilityLabel={disconnected ? 'Offline' : showLive ? 'Live' : 'Test'} style={styles.testBadgeText}>{disconnected ? 'OFFLINE' : showLive ? 'LIVE' : 'TEST'}</Text>
      </View> : null}
  </View>
}

export function MobileLoadingStatus({ message = 'Loading', style }) {
  const activity = useMobileActivity(true, message)
  if (activity) return null
  return <View accessibilityLiveRegion="polite" style={style}><BrandLoader accessibilityLabel={message} /></View>
}
