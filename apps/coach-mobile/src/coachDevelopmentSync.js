import { applyCoachContext } from '../../mobile-core/src/coachContextCore'
import { getCoachDevelopmentWorkspace, saveCoachDevelopmentDraft } from '../../mobile-core/src/coachPhase31EData'
import { prepareDevelopmentAttempt, acknowledgeDevelopmentAttempt, developmentFormFingerprint } from '../../mobile-core/src/developmentOfflineCore'
import { withMobileAsyncTimeout } from '../../mobile-core/src/http'
import { readCoachDevelopmentDrafts, updateCoachDevelopmentDraft } from './offline'

const active = new Map()
const listeners = new Set()
export const subscribeDevelopmentSync = listener => { listeners.add(listener); return () => listeners.delete(listener) }
export const notifyDevelopmentSync = () => listeners.forEach(listener => listener())

export function syncCoachDevelopmentDrafts(user, context, isCurrent = () => true) {
  const scope = `${user.id}:${context.id}`
  if (active.has(scope)) return active.get(scope)
  if (user.isOfflineProfile) return Promise.resolve()
  const task = (async () => {
    const drafts = await readCoachDevelopmentDrafts(user.id, context)
    if (!Object.values(drafts).some(draft => draft.status !== 'synced')) return
    const scopedUser = applyCoachContext(user, context)
    const workspace = await withMobileAsyncTimeout(() => getCoachDevelopmentWorkspace(scopedUser))
    for (const [key, draft] of Object.entries(drafts)) {
      if (!isCurrent()) return
      if (draft.status === 'synced') continue
      try {
        const player = workspace.players.find(item => item.id === draft.playerId)
        const form = workspace.forms.find(item => item.id === draft.formId)
        if (!player || !form) throw new Error('This Player or form is no longer available. Your saved work is kept on this phone.')
        const prepared = await updateCoachDevelopmentDraft(user.id, context, key, current => current ? prepareDevelopmentAttempt(current) : null)
        if (!prepared || !isCurrent()) continue
        const attempt = prepared.attempt
        if (attempt.formFingerprint && attempt.formFingerprint !== developmentFormFingerprint(form)) throw new Error('This form changed since you saved it. Review your saved values against the current form before syncing.')
        const result = await withMobileAsyncTimeout(() => saveCoachDevelopmentDraft(scopedUser, {
          draftId: prepared.id, player, form, values: attempt.values, notes: attempt.notes,
          clientSaveVersion: attempt.baseVersion, offlineDraft: true,
        }))
        if (!isCurrent()) return
        await updateCoachDevelopmentDraft(user.id, context, key, current => current ? acknowledgeDevelopmentAttempt(current, attempt, result) : null)
      } catch (error) {
        if (!isCurrent()) return
        await updateCoachDevelopmentDraft(user.id, context, key, current => current ? {
          ...current, status: 'pending', error: error.message || 'Waiting for a connection. Your work is saved on this phone.',
        } : null).catch(() => {})
      }
      notifyDevelopmentSync()
    }
  })().finally(() => active.delete(scope))
  active.set(scope, task)
  return task
}
