import { Text, View } from 'react-native'
import { BrandLoader } from './BrandLoader'
import { useMobileActivity } from './MobileActivityContext'

export function MobileHeaderActivity({ live = false, test = false, offline = false, styles = {} }) {
  const activity = useMobileActivity()
  const disconnected = offline || activity?.offline
  return <View testID="mobile-header-activity" style={{ width: 52, height: 36, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
    {activity?.active ? <BrandLoader header accessibilityLabel="Updating" size={28} />
      : live || test ? <Text accessibilityLabel={disconnected ? 'Offline' : live ? 'Live' : 'Test'} style={styles.testBadgeText}>{disconnected ? 'OFFLINE' : live ? 'LIVE' : 'TEST'}</Text> : null}
  </View>
}

export function MobileLoadingStatus({ message = 'Loading', style }) {
  const activity = useMobileActivity(true, message)
  if (activity) return null
  return <View accessibilityLiveRegion="polite" style={style}><BrandLoader accessibilityLabel={message} /></View>
}
