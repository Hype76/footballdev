import { createCoachAccountPreparationCoordinator, coachPreparationScopeKey } from './coachAccountPreparationCoordinator'
import { getMobileRuntimeConfig } from '../../mobile-core/src/config'
import { COACH_PHASE_31F_MAX_CACHE_BYTES } from '../../mobile-core/src/coachPhase31FCore'
import { authorizeCoachOfflineMedia, loadCoachOfflineContext } from '../../mobile-core/src/coachOfflineReadData'
import { getScopedTeamBranding } from '../../../src/lib/team-branding-display.js'
import { createCoachOfflineMedia } from './coachOfflineMedia'
import { createCoachOfflineResourceSaver, measureCoachOfflineDocumentBytes, readCoachAccountPreparation, readCoachOfflineResources, registerCoachOfflineMediaHooks, saveCoachAccountPreparation, saveCoachPreparedMatchDays } from './offline'
import { prepareCoachAccountOffline } from './coachAccountOfflinePreparation'
import { captureCoachOfflineAccount } from './coachOfflineAccountSession'
import { applyCoachContext } from '../../mobile-core/src/coachContextCore'
import { buildCoachHomeOperationalSnapshot } from '../../mobile-core/src/coachPhase31GCore'
import { resolveCoachBranding } from './coachThemeCore'

const config = getMobileRuntimeConfig('coach')
let media, startup
const projectRef = config.isUsable ? new URL(config.supabaseUrl).hostname.split('.')[0] : ''
function ensureMedia() {
  if (!media) {
    media = createCoachOfflineMedia({
      remainingBudget: async mediaBytes => Math.max(0, COACH_PHASE_31F_MAX_CACHE_BYTES - mediaBytes - await measureCoachOfflineDocumentBytes()),
      fetchAuthorized: ({ context, resource }) => authorizeCoachOfflineMedia(applyCoachContext(currentUser, context), context, resource),
    })
    startup = media.startup()
  }
  return media
}
registerCoachOfflineMediaHooks({
  measureBytes: async () => {
    try { return await ensureMedia().measureBytes() } catch (error) {
      if (error?.message === 'offline_media_native_unavailable') return 0
      throw error
    }
  },
  clearAccount: async userId => {
    if (!userId) return
    try { await ensureMedia().clearAccountScope({ environment: config.isProduction ? 'live' : 'test', projectRef, userId }) } catch (error) {
      if (error?.message !== 'offline_media_native_unavailable') throw error
    }
    currentUser = null
  },
  verifyInventory: async (userId, context, resources, profile) => {
    const user = currentUser?.id === userId ? currentUser : profile
    if (user?.id !== userId) return false
    const nativeMedia = getMedia(user)
    await startup
    return nativeMedia.verifyInventory({ context, resources, guard: captureAuthority(user, context) })
  },
})
function getMedia(user) {
  captureCoachOfflineAccount(user.id)()
  ensureMedia()
  currentUser = user
  media.activate({ environment: config.isProduction ? 'live' : 'test', projectRef, userId: user.id })
  return media
}
let currentUser

function captureAuthority(user, context, isCurrent = () => true) {
  const accountGuard = captureCoachOfflineAccount(user.id)
  const generation = user.getCoachAuthorityGeneration?.()
  return () => {
    accountGuard()
    if (!isCurrent() || currentUser?.id !== user.id || generation !== user.getCoachAuthorityGeneration?.()) throw new Error('Your account or team access changed. Reopen the team to continue.')
    const authority = user.coachContexts?.find(item => item.id === context.id)
    if (!authority || ['authorityId', 'authoritySource', 'clubId', 'role', 'teamId'].some(key => String(authority[key] || '') !== String(context[key] || ''))) throw new Error('Your saved information belongs to a different workspace.')
  }
}

const preparationCoordinator = createCoachAccountPreparationCoordinator()
export async function prepareCoachAccount(user, contexts, selectedContextId, callerIsCurrent = () => true) {
  const accountGuard = captureCoachOfflineAccount(user.id)
  await user.waitForCoachAuthority?.()
  try { accountGuard() } catch { return { cancelled: true } }
  if (!callerIsCurrent()) return { cancelled: true }
  const generation = user.getCoachAuthorityGeneration?.()
  const caller = () => {
    try { accountGuard(); return callerIsCurrent() && generation === user.getCoachAuthorityGeneration?.() } catch { return false }
  }
  const key = coachPreparationScopeKey(user.id, generation, contexts)
  return preparationCoordinator.run(key, caller, async isCurrent => {
    // Records remain useful when a native media capability is unavailable. Every
    // failed media item is retained in the incomplete status for an honest retry.
    let nativeMedia
    try { nativeMedia = getMedia(user); await startup } catch { /* Per-file preparation reports unavailable capability below. */ }
    return prepareCoachAccountOffline({ user, contexts, selectedContextId, isCurrent,
      createSaver: createCoachOfflineResourceSaver, saveStatus: saveCoachAccountPreparation,
      readBackResources: readCoachOfflineResources,
      saveMatches: (profile, context, details) => saveCoachPreparedMatchDays(profile.id, context, details, isCurrent),
      prepareMedia: async (profile, context, resource, current) => {
        if (!nativeMedia) throw new Error('File downloads are unavailable on this device. Records can still be saved.')
        return nativeMedia.save({ context, resource, guard: captureAuthority(profile, context, current) })
      },
      loadContext: async (profile, context, options) => {
        if (!context.teamId) return prepareClubOverview(profile, context, options)
        const scopedProfile = applyCoachContext(profile, context)
        const display = getScopedTeamBranding(context)
        if (display?.logoUrl) {
          try {
            const badge = await authorizeCoachOfflineMedia(scopedProfile, context, { kind: 'badge' })
            if (!isCurrent()) throw new Error('offline_preparation_cancelled')
            await options.onMedia({ ...badge.resource, kind: 'badge' })
          } catch (error) { options.onIncomplete(error) }
        }
        return loadCoachOfflineContext(scopedProfile, context, { ...options,
          onMedia: async resource => {
            try {
              const authorized = await authorizeCoachOfflineMedia(scopedProfile, context, resource)
              if (!isCurrent()) throw new Error('offline_preparation_cancelled')
              await options.onMedia(authorized.resource)
            } catch (error) { options.onIncomplete(error) }
          },
        })
      },
    })
  })
}

async function prepareClubOverview(user, context, options) {
  const teams = (user.coachContexts || []).filter(item => item.clubId === context.clubId && item.teamId)
  const caches = await Promise.all(teams.map(team => readCoachOfflineResources(user.id, team)))
  if (!options.isCurrent()) throw new Error('offline_preparation_cancelled')
  if (caches.some(cache => !cache?.resources?.home)) throw new Error('Some teams in this club still need downloading.')
  const unique = rows => [...new Map(rows.map(item => [item.id, item])).values()]
  const rows = key => unique(caches.flatMap(cache => cache.resources[key] || []))
  const chat = kind => unique(caches.flatMap(cache => cache.resources['phase31e:chat']?.[kind] || []))
  const value = { ...buildCoachHomeOperationalSnapshot({ matches: rows('matchDayList'), sessions: rows('sessions'), calendar: rows('calendar'),
    chatRooms: { staff: chat('staff'), parent: chat('parent') }, polls: rows('phase31e:polls'), messages: rows('phase31e:messages'),
    invites: { all: unique(caches.flatMap(cache => cache.resources['phase31e:invites']?.all || [])) },
    development: { drafts: unique(caches.flatMap(cache => cache.resources['phase31e:development']?.drafts || [])) },
  }), homeSources: { development: true, chatRooms: true, polls: true, invites: true }, savedAt: new Date().toISOString() }
  await options.onResource({ cacheKey: 'home', value, complete: true, count: teams.length })
  const statuses = await readCoachAccountPreparation(user.id, teams)
  if (teams.some(team => !statuses[team.id] || statuses[team.id].error || statuses[team.id].filesFailed || !statuses[team.id].savedAt)) options.onDependencyIncomplete()
  if (!teams.length && resolveCoachBranding(context).logoUrl) options.onDependencyIncomplete()
  return { complete: true, onlineOnly: unique(teams.flatMap(team => statuses[team.id]?.onlineOnly || [])) }
}

async function savedResource(user, context, resource) {
  const cache = await readCoachOfflineResources(user.id, context)
  return cache?.resources?.offlineMediaInventory?.find(item => item.id === resource.id && item.kind === (resource.kind || 'file'))
}

export async function openCoachSavedResource(user, context, resource) {
  let nativeMedia
  try { nativeMedia = getMedia(user) } catch (error) {
    if (error?.message === 'offline_media_native_unavailable') return false
    throw error
  }
  await startup
  const guard = captureAuthority(user, context)
  guard()
  const saved = await savedResource(user, context, resource)
  guard()
  if (!saved) return false
  if (resource.updatedAt && saved.updatedAt !== resource.updatedAt) return false
  if (!await nativeMedia.has({ context, resource: saved, guard })) return false
  await nativeMedia.open({ context, resource: saved, guard })
  return true
}

export async function resolveCoachSavedBadge(user, context) {
  if (!context.teamId) {
    const logoUrl = resolveCoachBranding(context).logoUrl
    const representative = user.coachContexts?.find(item => item.clubId === context.clubId && item.teamId && getScopedTeamBranding(item)?.logoUrl === logoUrl)
    return representative ? resolveCoachSavedBadge(user, representative) : ''
  }
  const display = getScopedTeamBranding(context)
  if (!display?.logoUrl) return ''
  const nativeMedia = getMedia(user)
  await startup
  const guard = captureAuthority(user, context)
  guard()
  const saved = await savedResource(user, context, { id: `badge:${context.teamId}`, kind: 'badge' })
  guard()
  if (!saved || saved.updatedAt !== display.logoUrl) return ''
  return nativeMedia.getDisplayUri({ context, resource: saved, guard })
}

export async function resolveCoachSavedKit(user, context, versionId, imagePath) {
  if (!versionId || !imagePath) return ''
  const nativeMedia = getMedia(user)
  await startup
  const guard = captureAuthority(user, context)
  guard()
  const saved = await savedResource(user, context, { id: `kit:${versionId}`, kind: 'kit' })
  guard()
  if (!saved || saved.sourceId !== versionId || saved.updatedAt !== imagePath) return ''
  return nativeMedia.getDisplayUri({ context, resource: saved, guard })
}
