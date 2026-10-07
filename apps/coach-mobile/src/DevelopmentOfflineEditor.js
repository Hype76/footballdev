import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Alert, Pressable, Text, TextInput, View } from 'react-native'
import { developmentDraftKey, developmentFormFingerprint } from '../../mobile-core/src/developmentOfflineCore'
import { developmentInputIsSaved, developmentSaveStatus } from '../../mobile-core/src/developmentSaveStatusCore'
import { finalizeCoachDevelopmentRecord } from '../../mobile-core/src/coachPhase31EData'
import { readCoachDevelopmentDrafts, saveLocalCoachDevelopmentDraft, updateCoachDevelopmentDraft } from './offline'
import { notifyDevelopmentSync, subscribeDevelopmentSync, syncCoachDevelopmentDrafts } from './coachDevelopmentSync'

export function DevelopmentOfflineEditor({ context: suppliedContext, form, player, serverDraft, styles, user, stale, onFinalised }) {
  const context = useMemo(() => ({ id: suppliedContext.id, authorityId: suppliedContext.authorityId,
    authoritySource: suppliedContext.authoritySource, role: suppliedContext.role, clubId: suppliedContext.clubId, teamId: suppliedContext.teamId }),
  [suppliedContext.id, suppliedContext.authorityId, suppliedContext.authoritySource, suppliedContext.role, suppliedContext.clubId, suppliedContext.teamId])
  const [input, setInput] = useState({ values: {}, notes: '' })
  const inputRef = useRef(input)
  const [draft, setDraft] = useState(null)
  const [readyScope, setReadyScope] = useState('')
  const [saving, setSaving] = useState(0)
  const [error, setError] = useState('')
  const [syncError, setSyncError] = useState('')
  const [finalising, setFinalising] = useState(false)
  const [finalisingShare, setFinalisingShare] = useState(true)
  const [finaliseError, setFinaliseError] = useState('')
  const key = developmentDraftKey(player.id, form.id)
  const scope = JSON.stringify([user.id, context, key, developmentFormFingerprint(form)])
  const ready = readyScope === scope
  const lifetime = useRef(null)
  useLayoutEffect(() => {
    const token = { scope, active: true, hydrated: false, edit: 0 }
    setReadyScope('')
    lifetime.current = token
    return () => { token.active = false }
  }, [scope])
  useLayoutEffect(() => {
    const token = lifetime.current
    if (token?.active && token.scope === scope) Object.assign(token, { userId: user.id, context, key, serverDraft })
  }, [scope, user.id, context, key, serverDraft])
  const capture = () => { const token = lifetime.current; return () => token === lifetime.current && token?.active && token.hydrated === true && token.scope === scope }
  const unsaved = ready && !developmentInputIsSaved(input, draft)
  useEffect(() => {
    const token = lifetime.current
    const { userId, context, key, serverDraft } = token
    const current = () => token === lifetime.current && token.active && token.scope === scope
    inputRef.current = { values: {}, notes: '' }
    setInput(inputRef.current); setDraft(null); setSaving(0); setError(''); setSyncError(''); setFinalising(false); setFinaliseError('')
    const read = async (hydrate = false) => {
      try {
        let next = (await readCoachDevelopmentDrafts(userId, context))[key] || null
        if (!current()) return
        if (!next && hydrate && serverDraft) {
          const saved = serverDraft
          next = await updateCoachDevelopmentDraft(userId, context, key, current => current || {
            ...saved, notes: saved.notes || '', revision: 0, serverVersion: saved.clientSaveVersion,
            status: 'synced', savedAt: saved.lastSavedAt, syncedAt: saved.lastSavedAt,
          })
        }
        if (!current()) return
        setDraft(previous => previous && next && (previous.revision > next.revision
          || (previous.revision === next.revision && previous.serverVersion > next.serverVersion)) ? previous : next)
        if (next?.status === 'synced' && developmentInputIsSaved(inputRef.current, next)) setSyncError('')
        if (hydrate) {
          inputRef.current = { values: next?.values || {}, notes: next?.notes || '' }
          setInput(inputRef.current)
          token.hydrated = true
          setReadyScope(scope)
        }
      } catch {
        if (current()) setError('Saved work could not be opened safely. Reopen Development to try again.')
      }
    }
    void read(true)
    const unsubscribe = subscribeDevelopmentSync(() => void read())
    return () => { token.active = false; unsubscribe() }
  }, [scope])

  const persist = async next => {
    const current = capture()
    if (!current()) return null
    const token = lifetime.current, edit = ++token.edit
    inputRef.current = next
    setInput(next)
    setSaving(count => count + 1)
    setError('')
    try {
      const saved = await saveLocalCoachDevelopmentDraft(user.id, context, { playerId: player.id, formId: form.id, formFingerprint: developmentFormFingerprint(form), ...next })
      if (!current()) return null
      setDraft(previous => previous && previous.revision > saved.revision ? previous : saved)
      notifyDevelopmentSync()
      return saved
    } catch (failure) {
      if (current() && token.edit === edit) setError(failure.message || 'This change has not been saved. Keep this screen open and try saving again.')
      return null
    } finally { if (current()) setSaving(count => Math.max(0, count - 1)) }
  }
  const changeValue = (id, value) => void persist({ ...inputRef.current, values: { ...inputRef.current.values, [id]: value } })
  const sync = () => {
    const current = capture()
    if (!current()) return Promise.resolve()
    setSyncError('')
    return syncCoachDevelopmentDrafts(user, suppliedContext, current).catch(failure => { if (current()) setSyncError(failure.message) })
  }
  const finalise = (requestedShare = true) => {
    const current = capture()
    if (!current()) return
    const shareWithParent = draft?.finalisation ? draft.finalisation.shareWithParent !== false : requestedShare
    return Alert.alert(shareWithParent ? 'Finalise and share this Development record?' : 'Finalise this private Development record?', shareWithParent
      ? 'The final record will be available to authorised linked Parents. It cannot be edited from this mobile workflow.'
      : 'The final record will be available to authorised staff. It will not be shared with Parents. It cannot be edited from this mobile workflow.', [
    { text: 'Cancel', style: 'cancel' },
    { text: shareWithParent ? 'Finalise and share' : 'Finalise privately', onPress: async () => {
      if (!current() || unsaved || error || draft?.status !== 'synced') return
      setFinalisingShare(shareWithParent)
      setFinalising(true)
      setFinaliseError('')
      try {
        if (!draft.finalisation && draft.formFingerprint && draft.formFingerprint !== developmentFormFingerprint(form)) {
          throw new Error('This form changed since the draft was saved. Review its fields and save the private draft again before finalising.')
        }
        const pending = await updateCoachDevelopmentDraft(user.id, context, key, saved => saved ? {
          ...saved, finalisation: saved.finalisation || { requestedAt: new Date().toISOString(), serverVersion: saved.serverVersion, form, player, values: saved.values, notes: saved.notes, shareWithParent },
        } : null)
        if (!current()) return
        if (!pending) throw new Error('The saved draft could not be found. Your visible work has been kept.')
        setDraft(pending)
        await finalizeCoachDevelopmentRecord(user, { draftId: pending.id, clientSaveVersion: pending.finalisation.serverVersion,
          player: pending.finalisation.player, form: pending.finalisation.form, values: pending.finalisation.values, notes: pending.finalisation.notes, shareWithParent: pending.finalisation.shareWithParent !== false })
        if (!current()) return
        await updateCoachDevelopmentDraft(user.id, context, key, () => null)
        if (!current()) return
        inputRef.current = { values: {}, notes: '' }
        setInput(inputRef.current); setDraft(null)
        notifyDevelopmentSync()
        onFinalised?.({ shared: pending.finalisation.shareWithParent !== false })
      } catch (failure) { if (current()) setFinaliseError(`Finalising has not been confirmed. Your saved work is kept on this phone. Retry to finish the same record. ${failure.message || ''}`) }
      finally { if (current()) setFinalising(false) }
    } },
  ])
  }
  const button = (label, onPress, disabled = false, selected = false) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, selected }} disabled={disabled} onPress={onPress} style={[selected ? styles.primary : styles.secondary, disabled && styles.disabled]}><Text style={selected ? styles.primaryText : styles.secondaryText}>{label}</Text></Pressable>
  return <View style={styles.panel}>
    <Text style={styles.heading}>{form.name}</Text>
    <Text accessibilityLiveRegion="polite" style={styles.body}>{developmentSaveStatus({ ready, saving, draft, unsaved, error, syncError })}</Text>
    {draft?.finalisation ? <Text accessibilityLiveRegion="polite" style={styles.body}>{finalising ? finalisingShare ? 'Finishing the saved record and parent sharing...' : 'Finishing the private record...' : 'Finalising is waiting for confirmation. Retry to finish the same saved record.'}</Text> : null}
    {finaliseError ? <Text accessibilityLiveRegion="assertive" style={styles.danger}>{finaliseError}</Text> : null}
    {error || syncError || draft?.error ? <Text style={styles.danger}>{error || syncError || draft.error}</Text> : null}
    {ready ? (form.fields || []).filter(field => Number(user.roleRank || 0) >= field.roleRank).map(field => <View key={field.id} style={styles.stack}>
      <Text style={styles.label}>{field.label}{field.required ? ' (required)' : ''}{field.staffPrivate ? ' | Coach private' : field.parentVisible ? ' | Parent-shareable' : ''}</Text>
      {['boolean', 'checkbox'].includes(field.type) ? button(input.values[field.id] ? 'Yes' : 'No', () => changeValue(field.id, !input.values[field.id]), finalising || !!draft?.finalisation)
        : field.options.length ? <View style={styles.row}>{field.options.map(option => button(option.label, () => changeValue(field.id, option.value), finalising || !!draft?.finalisation, input.values[field.id] === option.value))}</View>
          : <TextInput accessibilityLabel={field.label} editable={!finalising && !draft?.finalisation} keyboardType={['number', 'numeric', 'rating', 'score', 'score_1_5', 'score_1_10'].includes(field.type) ? 'numeric' : 'default'} multiline={field.type === 'textarea'} onChangeText={value => changeValue(field.id, value)} style={[styles.input, field.type === 'textarea' && styles.inputMultiline]} value={String(input.values[field.id] ?? '')} />}
    </View>) : null}
    <Text style={styles.label}>Coach summary note</Text>
    <TextInput accessibilityLabel="Coach summary note" editable={ready && !finalising && !draft?.finalisation} multiline onChangeText={notes => void persist({ ...inputRef.current, notes })} style={[styles.input, styles.inputMultiline]} value={input.notes} />
    <View style={styles.row}>
      {button('Save private draft', () => void persist(inputRef.current).then(saved => { if (saved) return sync() }), !ready || finalising || !!draft?.finalisation || saving > 0)}
      {button('Sync now', sync, !draft || unsaved || user.isOfflineProfile || finalising || !!draft?.finalisation || saving > 0)}
      {button(finalising && !finalisingShare ? 'Saving record...' : 'Finalise privately', () => finalise(false), !ready || stale || user.isOfflineProfile || finalising || saving > 0 || unsaved || !!error || draft?.status !== 'synced' || (draft?.finalisation && draft.finalisation.shareWithParent !== false))}
      {button(finalising && finalisingShare ? 'Sharing...' : 'Finalise and share', () => finalise(true), !ready || stale || user.isOfflineProfile || finalising || saving > 0 || unsaved || !!error || draft?.status !== 'synced' || draft?.finalisation?.shareWithParent === false)}
    </View>
    <Text style={styles.helper}>Private drafts sync when you reconnect. Finalising and sharing requires a connection.</Text>
  </View>
}
