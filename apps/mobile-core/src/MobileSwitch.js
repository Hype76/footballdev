import { Switch } from 'react-native'

// A shared on colour keeps state recognisable across team colours and both apps.
export function MobileSwitch({ trackColor, thumbColor, activeThumbColor, value, ...props }) {
  return <Switch {...props} {...(activeThumbColor === undefined ? {} : { activeThumbColor: value ? '#ffffff' : activeThumbColor })} value={value} trackColor={{ ...trackColor, true: '#15803d' }} thumbColor={value ? '#ffffff' : thumbColor} />
}
