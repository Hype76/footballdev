import AsyncStorage from '@react-native-async-storage/async-storage'

function key(userId, teamId) {
  return `fp.coach.fixture.preferences.v1.${String(userId || '').trim()}.${String(teamId || '').trim()}`
}

export async function readCoachFixturePreferences(userId, teamId) {
  try {
    const value = JSON.parse(await AsyncStorage.getItem(key(userId, teamId)) || '{}')
    return {
      duration: Number.isInteger(Number(value.duration)) ? Number(value.duration) : 90,
      location: value.location && typeof value.location === 'object'
        ? { address: String(value.location.address || ''), name: String(value.location.name || '') }
        : null,
    }
  } catch {
    return { duration: 90, location: null }
  }
}

export async function writeCoachFixturePreferences(userId, teamId, preferences) {
  const value = {
    duration: Number(preferences?.duration || 90),
    location: preferences?.location?.name
      ? { address: String(preferences.location.address || ''), name: String(preferences.location.name || '') }
      : null,
  }
  await AsyncStorage.setItem(key(userId, teamId), JSON.stringify(value))
  return value
}
