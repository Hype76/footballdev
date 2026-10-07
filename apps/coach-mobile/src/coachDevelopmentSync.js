import { applyCoachContext } from '../../mobile-core/src/coachContextCore'
import { finalizeCoachDevelopmentRecord, getCoachDevelopmentWorkspace, saveCoachDevelopmentDraft } from '../../mobile-core/src/coachPhase31EData'
import { prepareDevelopmentAttempt, acknowledgeDevelopmentAttempt, developmentFormFingerprint } from '../../mobile-core/src/developmentOfflineCore'
import { withMobileAsyncTimeout } from '../../mobile-core/src/http'
import { developmentSyncFailure } from '../../mobile-core/src/developmentSaveStatusCore'
import { readCoachDevelopmentDrafts, updateCoachDevelopmentDraft } from './offline'

const active = new Map()
const listeners = new Set()
export const subscribeDevelopmentSync = listener => { listeners.add(listener); return () => listeners.delete(listener) }
export const notifyDevelopmentSync = event => listeners.forEach(listener => listener(event))

export function syncCoachDevelopmentDrafts(user, context, isCurrent = () => true) {
  const scope = JSON.stringify([user.id, context.id, context.authorityId, context.authoritySource, context.clubId, context.role, context.teamId])
  if (active.has(scope)) return active.get(scope)
  if (user.isOfflineProfile) return Promise.resolve()
  const task = (async () => {
    const drafts = await readCoachDevelopmentDrafts(user.id, context)
    if (!isCurrent()) return
    if (!Object.values(drafts).some(draft => draft.status !== 'synced' || draft.finalisation)) return
    const scopedUser = applyCoachContext(user, context)
    const recordFailure = async (key, draft, error, stage) => {
      if (!isCurrent()) return
      const message = developmentSyncFailure(error, stage)
      const failed = await updateCoachDevelopmentDraft(user.id, context, key, current => {
        if (!isCurrent() || !current) return current
        if (draft.finalisation && (current.id !== draft.id
          || current.finalisation?.requestedAt !== draft.finalisation.requestedAt)) return current
        if (draft.finalisation) return { ...current, finalisationError:
          `Your saved record is kept on this phone. Sending needs a retry. ${error.message || 'Check your connection.'}` }
        return { ...current, status: 'pending', error: message }
      }).catch(() => { throw new Error(message) })
      if (draft.finalisation && isCurrent() && failed?.id === draft.id && failed.finalisationError) {
        notifyDevelopmentSync({ kind: 'finalisation_failed', userId: user.id, contextId: context.id, key,
          draftId: draft.id, copy: failed.finalisationError, shared: draft.finalisation.shareWithParent !== false })
      } else notifyDevelopmentSync()
    }
    let workspace
    try { workspace = await withMobileAsyncTimeout(() => getCoachDevelopmentWorkspace(scopedUser)) }
    catch (error) {
      for (const [key, draft] of Object.entries(drafts)) {
        if (draft.status !== 'synced' || draft.finalisation) await recordFailure(key, draft, error, 'preparing')
      }
      return
    }
    if (!isCurrent()) return
    for (const [key, draft] of Object.entries(drafts)) {
      if (!isCurrent()) return
      if (draft.status === 'synced' && !draft.finalisation) continue
      let stage = 'preparing'
      try {
        const player = workspace.players.find(item => item.id === draft.playerId)
        const form = workspace.forms.find(item => item.id === draft.formId)
        if (!player || !form) throw new Error('This Player or form is no longer available. Your saved work is kept on this phone.')
        if (draft.finalisation) {
          const request = draft.finalisation
          if (draft.status !== 'synced' || draft.serverVersion !== request.serverVersion
            || (request.revision !== undefined && draft.revision !== request.revision)) {
            throw new Error('The saved record changed. Reopen Development to review it before sending.')
          }
          if (developmentFormFingerprint(request.form) !== developmentFormFingerprint(form)) {
            throw new Error('This form changed. Reopen Development to review the saved record before sending.')
          }
          stage = 'finalising'
          await finalizeCoachDevelopmentRecord(scopedUser, { draftId: draft.id, clientSaveVersion: request.serverVersion,
            player, form, values: request.values, notes: request.notes, shareWithParent: request.shareWithParent !== false,
            isCurrent })
          if (!isCurrent()) return
          let removed = false
          await updateCoachDevelopmentDraft(user.id, context, key, current => {
            if (!isCurrent()) return current
            if (current?.id !== draft.id || current.finalisation?.requestedAt !== request.requestedAt
              || current.serverVersion !== request.serverVersion || current.revision !== draft.revision) return current
            removed = true
            return null
          })
          if (removed && isCurrent()) notifyDevelopmentSync({ kind: 'finalised', userId: user.id, contextId: context.id,
            key, draftId: draft.id, shared: request.shareWithParent !== false })
          continue
        }
        const prepared = await updateCoachDevelopmentDraft(user.id, context, key, current => current ? prepareDevelopmentAttempt(current) : null)
        if (!prepared || !isCurrent()) continue
        const attempt = prepared.attempt
        if (attempt.formFingerprint && attempt.formFingerprint !== developmentFormFingerprint(form)) throw new Error('This form changed since you saved it. Review your saved values against the current form before syncing.')
        stage = 'saving'
        const result = await withMobileAsyncTimeout(() => saveCoachDevelopmentDraft(scopedUser, {
          draftId: prepared.id, player, form, values: attempt.values, notes: attempt.notes,
          clientSaveVersion: attempt.baseVersion, offlineDraft: true,
        }))
        if (!isCurrent()) return
        stage = 'acknowledging'
        await updateCoachDevelopmentDraft(user.id, context, key, current => current ? acknowledgeDevelopmentAttempt(current, attempt, result) : null)
      } catch (error) {
        await recordFailure(key, draft, error, stage)
      }
      notifyDevelopmentSync()
    }
  })().finally(() => active.delete(scope))
  active.set(scope, task)
  return task
}
