import AsyncStorage from '@react-native-async-storage/async-storage'
import { createDeviceThemePreference } from '../../mobile-core/src/deviceThemePreferenceCore'

// Keep the existing key so installed apps retain their saved choice after an update.
export const PARENT_THEME_STORAGE_KEY = 'fp.parent.display-theme.v1'
export const parentThemePreference = createDeviceThemePreference({
  read: () => AsyncStorage.getItem(PARENT_THEME_STORAGE_KEY),
  write: mode => AsyncStorage.setItem(PARENT_THEME_STORAGE_KEY, mode),
})
