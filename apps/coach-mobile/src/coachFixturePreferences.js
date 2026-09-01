import AsyncStorage from '@react-native-async-storage/async-storage'
import { DEFAULT_EXPIRY_DURATION, parseExpiryDuration } from '../../../src/lib/expiry-duration.js'

function key(userId, teamId) {
  return `fp.coach.fixture.preferences.v1.${String(userId || '').trim()}.${String(teamId || '').trim()}`
}

export async function readCoachFixturePreferences(userId, teamId) {
  try {
    const value = JSON.parse(await AsyncStorage.getItem(key(userId, teamId)) || '{}')
    let motmPollExpiryDuration = DEFAULT_EXPIRY_DURATION
    try {
      parseExpiryDuration(value.motmPollExpiryDuration)
      motmPollExpiryDuration = String(value.motmPollExpiryDuration)
    } catch {
      motmPollExpiryDuration = DEFAULT_EXPIRY_DURATION
    }
    return {
      arrivalPreset: ['15', '30', '45', '60', 'custom'].includes(String(value.arrivalPreset)) ? String(value.arrivalPreset) : '30',
      arrivalTime: String(value.arrivalTime || ''),
      duration: Number.isInteger(Number(value.duration)) ? Number(value.duration) : 90,
      location: value.location && typeof value.location === 'object'
        ? { address: String(value.location.address || ''), name: String(value.location.name || '') }
        : null,
      motmPollExpiryDuration,
    }
  } catch {
    return { arrivalPreset: '30', arrivalTime: '', duration: 90, location: null, motmPollExpiryDuration: DEFAULT_EXPIRY_DURATION }
  }
}

export async function writeCoachFixturePreferences(userId, teamId, preferences) {
  const value = {
    arrivalPreset: ['15', '30', '45', '60', 'custom'].includes(String(preferences?.arrivalPreset)) ? String(preferences.arrivalPreset) : '30',
    arrivalTime: String(preferences?.arrivalTime || ''),
    duration: Number(preferences?.duration || 90),
    location: preferences?.location?.name
      ? { address: String(preferences.location.address || ''), name: String(preferences.location.name || '') }
      : null,
    motmPollExpiryDuration: String(preferences?.motmPollExpiryDuration || DEFAULT_EXPIRY_DURATION),
  }
  await AsyncStorage.setItem(key(userId, teamId), JSON.stringify(value))
  return value
}
