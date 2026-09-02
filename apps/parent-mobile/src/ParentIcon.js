import FontAwesome5 from '@expo/vector-icons/FontAwesome5'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { View } from 'react-native'
import { getMobileIconName } from '../../mobile-core/src/mobileIconSystem'

const FOOTBALL_KEYS = new Set([
  'action.add-match',
  'coach.match',
  'football',
  'match.goal',
  'parent.match',
  'route.matchday',
])

const PARENT_ICONS = Object.freeze({
  'action.calendar': 'event-available',
  'action.edit': 'edit',
  'action.hide': 'visibility-off',
  'action.open': 'chevron-right',
  'attendance.available': 'check-circle-outline',
  'attendance.maybe': 'help-outline',
  'attendance.unavailable': 'cancel',
  'carpool.need': 'directions-car',
  'carpool.none': 'block',
  'carpool.offer': 'airport-shuttle',
  child: 'account-circle',
  development: 'trending-up',
  invite: 'group-add',
  'parent.training': 'sports',
  location: 'location-on',
  message: 'chat-bubble-outline',
  poll: 'poll',
  resource: 'folder-open',
  result: 'emoji-events',
  'role.linesman': 'flag',
  'role.referee': 'style',
  'role.scorer': 'star',
  settings: 'settings',
  shirt: 'checkroom',
  'time.arrival': 'schedule',
  'time.kickoff': 'sports',
})

function normalize(value) {
  return String(value ?? '').trim().toLowerCase()
}

export function isParentFootballIcon(iconKey) {
  return FOOTBALL_KEYS.has(normalize(iconKey))
}

export function getParentIconName(iconKey) {
  const key = normalize(iconKey)
  return PARENT_ICONS[key] || getMobileIconName(key, key || 'radio-button-unchecked')
}

export default function ParentIcon({ color, iconKey, size = 24, style }) {
  if (['invite', 'parent.invites'].includes(normalize(iconKey))) {
    return (
      <View accessible={false} style={[{ height: size, width: size }, style]}>
        <MaterialIcons color={color} name="mail-outline" size={size * 0.88} style={{ left: 0, position: 'absolute', top: 0 }} />
        <View style={{ backgroundColor: color, borderRadius: size * 0.24, bottom: 0, height: size * 0.48, position: 'absolute', right: 0, width: size * 0.48 }}>
          <MaterialIcons color="#ffffff" name="check" size={size * 0.42} style={{ left: size * 0.03, top: size * 0.03 }} />
        </View>
      </View>
    )
  }
  if (isParentFootballIcon(iconKey)) {
    return <FontAwesome5 accessible={false} color={color} name="futbol" size={size} solid style={style} />
  }

  return <MaterialIcons accessible={false} color={color} name={getParentIconName(iconKey)} size={size} style={style} />
}
