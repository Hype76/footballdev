import { Switch } from 'react-native'

// A shared on colour keeps state recognisable across team colours and both apps.
export function MobileSwitch({ trackColor, thumbColor, value, ...props }) {
  return <Switch {...props} value={value} trackColor={{ ...trackColor, true: '#34c759' }} thumbColor={value ? '#ffffff' : thumbColor} />
}
