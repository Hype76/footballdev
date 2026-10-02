import AsyncStorage from '@react-native-async-storage/async-storage'
import { Image } from 'react-native'
import { kitImageUrl, readClubKits } from '../../../src/lib/club-kits.js'
import { isClubManagedTeamKit, mergeTeamKits, mobileTeamKitCacheKey, readTeamKits } from '../../../src/lib/team-kits.js'
import { supabase } from './supabase'
import { getMobileRuntimeConfig } from './config'

const entries = new Map()
const teamEntries = new Map()
const config = getMobileRuntimeConfig('shared')
const prefix = `fp.kits.v1:${config.supabaseUrl}:`
const teamPrefix = `fp.team-kits.v2:${config.supabaseUrl}:`
const legacyTeamPrefix = `fp.team-kits.v1:${config.supabaseUrl}:`
const MAX_AGE = 5 * 60 * 1000

export function peekMobileClubKits(clubId) { return entries.get(clubId)?.kits }
export function peekMobileTeamKits(clubId, teamId, context) {
  return isClubManagedTeamKit(context) ? peekMobileClubKits(clubId) : teamEntries.get(mobileTeamKitCacheKey(clubId, teamId, context))?.kits
}

// Only public kit artwork and colours are persisted here. Private account and
// team data stays in the encrypted, account-scoped offline store.
export async function loadMobileClubKits(clubId, onSaved) {
  if (!clubId) return {}
  let entry = entries.get(clubId)
  if (!entry) {
    entry = {}
    entries.set(clubId, entry)
    if (entries.size > 30) entries.delete(entries.keys().next().value)
  }
  if (entry.kits) onSaved?.(entry.kits)
  if (entry.pending) { const kits = await entry.pending; onSaved?.(kits); return kits }
  if (entry.kits && Date.now() - entry.checkedAt < MAX_AGE) return entry.kits
  entry.pending = (async () => {
    if (!entry.kits) {
      const saved = await AsyncStorage.getItem(prefix + clubId).then(value => JSON.parse(value || 'null')).catch(() => null)
      if (saved?.clubId === clubId && saved.kits && Date.now() - saved.checkedAt < 7 * 24 * 60 * 60 * 1000) {
        entry.kits = saved.kits
        entry.checkedAt = saved.checkedAt
        onSaved?.(saved.kits)
      }
    }
    if (entry.kits && Date.now() - entry.checkedAt < MAX_AGE) return entry.kits
    try {
      const kits = await readClubKits(supabase, clubId)
      entry.kits = kits
      entry.checkedAt = Date.now()
      void AsyncStorage.setItem(prefix + clubId, JSON.stringify({ clubId, kits, checkedAt: entry.checkedAt })).catch(() => {})
      for (const kit of Object.values(kits)) {
        const uri = kitImageUrl(supabase, kit)
        if (uri) void Image.prefetch(uri).catch(() => {})
      }
      return kits
    } catch (error) { if (entry.kits) return entry.kits; throw error }
  })().finally(() => { delete entry.pending })
  return entry.pending
}

export function setMobileTeamKits(clubId, teamId, teamKits, context) {
  const key = mobileTeamKitCacheKey(clubId, teamId, context)
  if (!clubId || !teamId) return {}
  if (isClubManagedTeamKit(context)) return peekMobileClubKits(clubId) || {}
  const kits = mergeTeamKits(teamKits, peekMobileClubKits(clubId) || {}, context)
  const checkedAt = Date.now()
  teamEntries.set(key, { kits, checkedAt })
  void AsyncStorage.setItem(teamPrefix + key, JSON.stringify({ clubId, teamId, kits, checkedAt })).catch(() => {})
  return kits
}

export async function loadMobileTeamKits(clubId, teamId, onSaved, providedClubKits, context) {
  // Club scope never reads merged team caches, including legacy persisted overrides.
  if (isClubManagedTeamKit(context)) {
    if (providedClubKits !== undefined) onSaved?.(providedClubKits)
    try { return await loadMobileClubKits(clubId, onSaved) }
    catch (error) { if (providedClubKits !== undefined) return providedClubKits; throw error }
  }
  if (!clubId || !teamId) return providedClubKits || loadMobileClubKits(clubId, onSaved)
  const key = mobileTeamKitCacheKey(clubId, teamId, context)
  let entry = teamEntries.get(key)
  if (!entry) {
    entry = {}
    teamEntries.set(key, entry)
    if (teamEntries.size > 50) teamEntries.delete(teamEntries.keys().next().value)
  }
  if (entry.kits) onSaved?.(entry.kits)
  if (entry.pending) { const kits = await entry.pending; onSaved?.(kits); return kits }
  if (entry.kits && Date.now() - entry.checkedAt < MAX_AGE) return entry.kits
  entry.pending = (async () => {
    if (!entry.kits) {
      const saved = await AsyncStorage.getItem(teamPrefix + key).then(value => JSON.parse(value || 'null')).catch(() => null)
        // Standalone teams retain their offline colours when upgrading the cache format.
        || await AsyncStorage.getItem(legacyTeamPrefix + `${String(clubId).trim()}:${String(teamId).trim()}`).then(value => JSON.parse(value || 'null')).catch(() => null)
      if (saved?.clubId === clubId && saved?.teamId === teamId && saved.kits && Date.now() - saved.checkedAt < 7 * 24 * 60 * 60 * 1000) {
        entry.kits = saved.kits
        entry.checkedAt = saved.checkedAt
        onSaved?.(saved.kits)
      }
    }
    if (entry.kits && Date.now() - entry.checkedAt < MAX_AGE) return entry.kits
    const clubKits = providedClubKits ?? await loadMobileClubKits(clubId)
    let teamKits
    try { teamKits = await readTeamKits(supabase, clubId, teamId) }
    catch (error) { if (entry.kits) return entry.kits; if (clubKits) return clubKits; throw error }
    const kits = mergeTeamKits(teamKits, clubKits)
    entry.kits = kits
    entry.checkedAt = Date.now()
    void AsyncStorage.setItem(teamPrefix + key, JSON.stringify({ clubId, teamId, kits, checkedAt: entry.checkedAt })).catch(() => {})
    return kits
  })().finally(() => { delete entry.pending })
  return entry.pending
}
