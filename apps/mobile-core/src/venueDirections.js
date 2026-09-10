import { Alert, Linking, Platform } from 'react-native'
import { getDirectionsLocation, getVenueDirectionsOptions } from '../../../src/lib/venue-directions.js'

export function openVenueDirections(locationOrUrl) {
  const options = getVenueDirectionsOptions(getDirectionsLocation(locationOrUrl), { apple: Platform.OS === 'ios' })
  if (!options.length) return Promise.reject(new Error('This event has no venue address.'))
  return new Promise((resolve, reject) => {
    Alert.alert('Open directions', 'Choose your maps app.', [
      ...options.map(option => ({ text: option.label, onPress: () => { Linking.openURL(option.url).then(resolve, reject) } })),
      { text: 'Cancel', style: 'cancel', onPress: () => resolve() },
    ], { cancelable: true, onDismiss: () => resolve() })
  })
}
