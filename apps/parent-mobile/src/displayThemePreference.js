import AsyncStorage from '@react-native-async-storage/async-storage'
import { createDeviceThemePreference } from '../../mobile-core/src/deviceThemePreferenceCore'
import { getDeviceThemeStorageKey } from '../../mobile-core/src/deviceThemeCore'

export const PARENT_THEME_STORAGE_KEY = getDeviceThemeStorageKey('parent')
export const parentThemePreference = createDeviceThemePreference({
  read: () => AsyncStorage.getItem(PARENT_THEME_STORAGE_KEY),
  write: mode => AsyncStorage.setItem(PARENT_THEME_STORAGE_KEY, mode),
})
