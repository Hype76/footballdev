import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Calendar from 'expo-calendar'
import { Platform } from 'react-native'
import { buildAcceptedParentCalendarEvents, getParentCalendarEventFingerprint } from './parentDeviceCalendarCore'

const STORAGE_PREFIX = 'football-player-parent-phone-calendar-v1'
const pendingSyncs = new Map()

function storageKey(userId, linkId) {
  return `${STORAGE_PREFIX}:${userId}:${linkId}`
}

async function readState(userId, linkId) {
  const raw = await AsyncStorage.getItem(storageKey(userId, linkId))
  if (!raw) return { enabled: false, calendarId: '', events: {} }
  try {
    const parsed = JSON.parse(raw)
    return {
      enabled: parsed.enabled === true,
      calendarId: String(parsed.calendarId || ''),
      events: parsed.events && typeof parsed.events === 'object' ? parsed.events : {},
    }
  } catch {
    return { enabled: false, calendarId: '', events: {} }
  }
}

async function writeState(userId, linkId, state) {
  await AsyncStorage.setItem(storageKey(userId, linkId), JSON.stringify(state))
}

export async function getParentPhoneCalendarEnabled(userId, linkId) {
  if (!userId || !linkId) return false
  return (await readState(userId, linkId)).enabled
}

async function getWritableCalendarId(existingId = '') {
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT)
  const writable = calendars.filter((calendar) => calendar.allowsModifications !== false)
  const selected = writable.find((calendar) => calendar.id === existingId)
    || (Platform.OS === 'ios' ? await Calendar.getDefaultCalendarAsync() : null)
    || writable.find((calendar) => calendar.isPrimary)
    || writable[0]
  if (!selected?.id || selected.allowsModifications === false) {
    throw new Error('No writable phone calendar is available. Add a calendar in your device settings and try again.')
  }
  return selected.id
}

async function ensurePermission(request = false) {
  const permission = request
    ? await Calendar.requestCalendarPermissionsAsync()
    : await Calendar.getCalendarPermissionsAsync()
  if (!permission.granted) {
    throw new Error('Allow calendar access in your device settings to synchronise accepted events.')
  }
}

async function deleteManagedEvent(id) {
  try {
    await Calendar.deleteEventAsync(id)
  } catch (error) {
    const event = await Calendar.getEventAsync(id).catch(() => null)
    if (event) throw error
  }
}

export async function setParentPhoneCalendarEnabled({ userId, linkId, enabled, items = [] }) {
  if (!userId || !linkId) throw new Error('Choose a player before changing calendar synchronisation.')
  if (Platform.OS === 'web' || !(await Calendar.isAvailableAsync())) {
    throw new Error('Phone calendar synchronisation is available in the iOS and Android apps.')
  }
  const pending = pendingSyncs.get(storageKey(userId, linkId))
  if (pending) await pending.catch(() => {})
  if (enabled) await ensurePermission(true)
  const state = await readState(userId, linkId)
  if (enabled) {
    state.enabled = true
    await writeState(userId, linkId, state)
    try {
      return await syncParentPhoneCalendar({ userId, linkId, items })
    } catch (error) {
      state.enabled = false
      await writeState(userId, linkId, state)
      throw error
    }
  }
  if (Object.keys(state.events).length) await ensurePermission()
  for (const [key, entry] of Object.entries(state.events)) {
    await deleteManagedEvent(entry.id)
    delete state.events[key]
    await writeState(userId, linkId, state)
  }
  state.enabled = false
  await writeState(userId, linkId, state)
  return { count: 0 }
}

async function performParentPhoneCalendarSync({ userId, linkId, items = [] }) {
  if (!userId || !linkId || Platform.OS === 'web') return { count: 0 }
  const state = await readState(userId, linkId)
  if (!state.enabled) return { count: 0 }
  await ensurePermission()
  const calendarId = await getWritableCalendarId(state.calendarId)
  const desired = buildAcceptedParentCalendarEvents(items)
  const desiredByKey = new Map(desired.map((event) => [event.key, event]))

  for (const [key, entry] of Object.entries(state.events)) {
    if (desiredByKey.has(key) && state.calendarId === calendarId) continue
    await deleteManagedEvent(entry.id)
    delete state.events[key]
    await writeState(userId, linkId, state)
  }

  state.calendarId = calendarId
  for (const event of desired) {
    const fingerprint = getParentCalendarEventFingerprint(event)
    const existing = state.events[event.key]
    if (existing?.fingerprint === fingerprint) continue
    const details = {
      title: event.title,
      startDate: event.startDate,
      endDate: event.endDate,
      location: event.location,
      notes: event.notes,
    }
    let id = existing?.id || ''
    if (id) {
      try {
        await Calendar.updateEventAsync(id, details)
      } catch (error) {
        const oldEvent = await Calendar.getEventAsync(id).catch(() => null)
        if (oldEvent) throw error
        id = ''
      }
    }
    if (!id) id = await Calendar.createEventAsync(calendarId, details)
    state.events[event.key] = { id, fingerprint }
    await writeState(userId, linkId, state)
  }
  return { count: desired.length }
}

export function syncParentPhoneCalendar({ userId, linkId, items = [] }) {
  if (!userId || !linkId || Platform.OS === 'web') return Promise.resolve({ count: 0 })
  const key = storageKey(userId, linkId)
  const pending = pendingSyncs.get(key)
  if (pending) return pending
  const next = performParentPhoneCalendarSync({ userId, linkId, items })
    .finally(() => { if (pendingSyncs.get(key) === next) pendingSyncs.delete(key) })
  pendingSyncs.set(key, next)
  return next
}
