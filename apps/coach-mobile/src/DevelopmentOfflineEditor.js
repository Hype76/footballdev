import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Alert, Keyboard, Pressable, Text, TextInput, View } from 'react-native'
import { developmentDraftKey, developmentFormFingerprint } from '../../mobile-core/src/developmentOfflineCore'
import { developmentInputIsSaved, developmentSaveStatus } from '../../mobile-core/src/developmentSaveStatusCore'
import { createCoachDevelopmentDraftSaver, readCoachDevelopmentDrafts, updateCoachDevelopmentDraft } from './offline'
import { createDevelopmentAutosaveQueue, getPendingDevelopmentAutosave } from './developmentAutosaveQueue'
import { notifyDevelopmentSync, subscribeDevelopmentSync, syncCoachDevelopmentDrafts } from './coachDevelopmentSync'

export function DevelopmentOfflineEditor({ context: suppliedContext, form, player, serverDraft, styles, user, stale, onFinalised, onQueued }) {
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
  const [focusedField, setFocusedField] = useState('')
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
    if (token?.active && token.scope === scope) Object.assign(token, { userId: user.id, context, key, serverDraft, onFinalised, onQueued, playerId: player.id, formId: form.id })
  }, [scope, user.id, context, key, serverDraft, onFinalised, onQueued, player.id, form.id])
  const capture = () => { const token = lifetime.current; return () => token === lifetime.current && token?.active && token.hydrated === true && token.scope === scope }
  const unsaved = ready && !developmentInputIsSaved(input, draft)
  const cancelling = Boolean(draft?.discardRequested)
  useEffect(() => {
    const token = lifetime.current
    const { userId, context, key, serverDraft } = token
    const current = () => token === lifetime.current && token.active && token.scope === scope
    inputRef.current = { values: {}, notes: '' }
    setInput(inputRef.current); setDraft(null); setSaving(0); setError(''); setSyncError(''); setFinalising(false); setFinaliseError(''); setFocusedField('')
    const read = async (hydrate = false) => {
      const generation = token.completedGeneration || 0
      try {
        const pendingSave = hydrate && getPendingDevelopmentAutosave(scope)
        if (pendingSave) await pendingSave.catch(() => {})
        if (!current()) return
        let next = (await readCoachDevelopmentDrafts(userId, context))[key] || null
        if (!current() || generation !== (token.completedGeneration || 0)) return
        if (next?.discardRequested && hydrate) token.onQueued?.({ kind: 'discard', draftId: next.id, playerId: token.playerId, formId: token.formId })
        if (!next && hydrate && serverDraft) {
          const saved = serverDraft
          next = await updateCoachDevelopmentDraft(userId, context, key, current => current || {
            ...saved, notes: saved.notes || '', revision: 0, serverVersion: saved.clientSaveVersion,
            status: 'synced', savedAt: saved.lastSavedAt, syncedAt: saved.lastSavedAt,
          })
        }
        if (!current() || generation !== (token.completedGeneration || 0)) return
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
    const unsubscribe = subscribeDevelopmentSync(event => {
      if (!current()) return
      if (event?.kind === 'finalised' && event.userId === userId && event.contextId === context.id && event.key === key) {
        token.completedGeneration = (token.completedGeneration || 0) + 1
        inputRef.current = { values: {}, notes: '' }
        setInput(inputRef.current); setDraft(null); setFinaliseError('')
        token.onFinalised?.({ shared: event.shared })
      } else void read()
    })
    return () => { token.active = false; unsubscribe() }
  }, [scope])

  const persist = async next => {
    const current = capture()
    if (!current()) return null
    const token = lifetime.current, edit = ++token.edit
    inputRef.current = next
    setInput(next)
    setSaving(1)
    setError('')
    try {
      if (!token.autosave) {
        token.autosave = createDevelopmentAutosaveQueue(createCoachDevelopmentDraftSaver(user.id, context), {
          scope,
          onSaved(saved) {
            if (!current()) return
            setDraft(previous => previous && previous.revision > saved.revision ? previous : saved)
            setSaving(0)
            setError('')
            notifyDevelopmentSync({ kind: 'queued', userId: user.id, contextId: context.id, key })
          },
          onError(failure) {
            if (!current()) return
            setSaving(0)
            setError(failure.message || 'This change has not been saved. Keep this screen open and try saving again.')
          },
        })
      }
      const saved = await token.autosave.enqueue({ playerId: player.id, formId: form.id, formFingerprint: developmentFormFingerprint(form), ...next })
      return current() && token.edit === edit ? saved : null
    } catch (failure) {
      if (current() && token.edit === edit) {
        setSaving(0)
        setError(failure.message || 'This change has not been saved. Keep this screen open and try saving again.')
      }
      return null
    }
  }
  const changeValue = (id, value) => void persist({ ...inputRef.current, values: { ...inputRef.current.values, [id]: value } })
  const sync = () => {
    const current = capture()
    if (!current()) return Promise.resolve()
    setSyncError('')
    return syncCoachDevelopmentDrafts(user, suppliedContext, current).catch(failure => { if (current()) setSyncError(failure.message) })
  }
  const save = async () => {
    const current = capture()
    if (!current() || lifetime.current.savingRequested) return
    const token = lifetime.current
    token.savingRequested = true
    try {
      const alreadySaved = !token.autosave?.isSaving() && draft && !error && developmentInputIsSaved(inputRef.current, draft)
        && draft.formFingerprint === developmentFormFingerprint(form)
      const saved = token.autosave?.isSaving() ? await token.autosave.flush()
        : alreadySaved ? draft : await persist(inputRef.current)
      if (!saved || !current() || !developmentInputIsSaved(inputRef.current, saved)) return
      if (alreadySaved && saved.status !== 'synced') notifyDevelopmentSync({ kind: 'queued', userId: user.id, contextId: context.id, key })
      onQueued?.({ kind: 'draft', draftId: saved.id, playerId: player.id, formId: form.id })
    } catch { /* The autosave queue keeps the visible input and reports its failure. */ }
    finally { token.savingRequested = false }
  }
  const cancel = () => {
    const current = capture()
    if (!current() || lifetime.current.autosave?.isSaving() || saving || finalising || draft?.finalisation || cancelling) return
    Alert.alert('Cancel this assessment?', 'Clear this started assessment from this phone and your saved drafts.', [
      { text: 'Keep assessment', style: 'cancel' },
      { text: 'Cancel assessment', style: 'destructive', onPress: async () => {
        if (!current() || lifetime.current.cancelling) return
        lifetime.current.cancelling = true
        try {
          const pending = await updateCoachDevelopmentDraft(user.id, context, key, saved => {
            if (!current()) throw new Error('The selected account or team changed.')
            if (saved?.finalisation) throw new Error('This assessment is already finishing.')
            return saved ? { ...saved, discardRequested: true, status: 'pending', error: '' } : null
          })
          if (!current()) return
          setDraft(pending); inputRef.current = { values: {}, notes: '' }; setInput(inputRef.current)
          onQueued?.({ kind: pending ? 'discard' : 'discarded', draftId: pending?.id, playerId: player.id, formId: form.id })
          notifyDevelopmentSync({ kind: 'queued' })
        } catch (failure) { if (current()) setError(failure.message || 'Cancellation could not be saved. Try again.') }
        finally { if (current()) lifetime.current.cancelling = false }
      } },
    ])
  }
  const retrySending = async () => {
    const current = capture()
    if (!current() || !draft?.finalisation) return
    setDraft(previous => previous ? { ...previous, finalisationError: '' } : previous)
    try {
      const pending = await updateCoachDevelopmentDraft(user.id, context, key, saved => {
        if (!current()) throw new Error('The selected account or team changed.')
        return saved?.id === draft.id && saved.finalisation ? { ...saved, finalisationError: '' } : saved
      })
      if (!current() || !pending?.finalisation) return
      notifyDevelopmentSync({ kind: 'queued' })
      onQueued?.({ kind: 'finalisation', shared: pending.finalisation.shareWithParent !== false,
        draftId: pending.id, playerId: player.id, formId: form.id })
    } catch (failure) {
      if (current()) setFinaliseError(`Your saved record is kept on this phone. ${failure.message || 'Retry sending when connected.'}`)
    }
  }
  const finalise = (requestedShare = true) => {
    const current = capture()
    if (!current() || lifetime.current.autosave?.isSaving()) return
    const shareWithParent = draft?.finalisation ? draft.finalisation.shareWithParent !== false : requestedShare
    return Alert.alert(shareWithParent ? 'Finalise and share this Development record?' : 'Finalise this private Development record?', shareWithParent
      ? 'The final record will be available to authorised linked Parents. It cannot be edited from this mobile workflow.'
      : 'The final record will be available to authorised staff. It will not be shared with Parents. It cannot be edited from this mobile workflow.', [
    { text: 'Cancel', style: 'cancel' },
    { text: shareWithParent ? 'Finalise and share' : 'Finalise privately', onPress: async () => {
      if (!current() || lifetime.current.autosave?.isSaving() || lifetime.current.finalising || unsaved || error || draft?.status !== 'synced') return
      lifetime.current.finalising = true
      setFinalisingShare(shareWithParent)
      setFinalising(true)
      setFinaliseError('')
      try {
        if (!draft.finalisation && draft.formFingerprint && draft.formFingerprint !== developmentFormFingerprint(form)) {
          throw new Error('This form changed since the draft was saved. Review its fields and save the private draft again before finalising.')
        }
        const pending = await updateCoachDevelopmentDraft(user.id, context, key, saved => {
          if (!current()) throw new Error('The selected account or team changed. Reopen the saved draft to continue.')
          if (!saved) return null
          if (!saved.finalisation && (saved.status !== 'synced' || !developmentInputIsSaved(inputRef.current, saved))) {
            throw new Error('Your latest changes are still saving. Keep this screen open until they are saved, then retry.')
          }
          return { ...saved, finalisationError: '', finalisation: saved.finalisation || {
            requestedAt: new Date().toISOString(), revision: saved.revision, serverVersion: saved.serverVersion,
            form, player, values: saved.values, notes: saved.notes, shareWithParent,
          } }
        })
        if (!current()) return
        if (!pending) throw new Error('The saved draft could not be found. Your visible work has been kept.')
        setDraft(pending)
        notifyDevelopmentSync({ kind: 'queued' })
        onQueued?.({ kind: 'finalisation', shared: pending.finalisation.shareWithParent !== false,
          draftId: pending.id, playerId: player.id, formId: form.id })
      } catch (failure) { if (current()) setFinaliseError(`Your saved work is kept on this phone. ${failure.message || 'Retry to finish the same record.'}`) }
      finally { if (current()) { lifetime.current.finalising = false; setFinalising(false) } }
    } },
  ])
  }
  const button = (label, onPress, disabled = false, selected = false) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, selected }} disabled={disabled} onPress={onPress} style={[selected ? styles.primary : styles.secondary, disabled && styles.disabled]}><Text style={selected ? styles.primaryText : styles.secondaryText}>{label}</Text></Pressable>
  const fieldLabel = (id, label, textInput = true) => <View style={[styles.row, { flexDirection: 'row', flexWrap: 'nowrap' }, textInput && { minHeight: 44, alignItems: 'center' }]}>
    <Text style={[styles.label, { flex: 1 }]}>{label}</Text>
    {textInput ? <View style={{ width: 106, minHeight: 44 }}>
      {focusedField === id ? <Pressable accessibilityRole="button" accessibilityLabel="Hide keyboard" onPress={() => Keyboard.dismiss()} style={{ minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' }}><Text style={styles.secondaryText}>Hide keyboard</Text></Pressable> : null}
    </View> : null}
  </View>
  return <View style={styles.panel}>
    <Text style={styles.heading}>{form.name}</Text>
    <Text accessibilityLiveRegion="polite" style={styles.body}>{developmentSaveStatus({ ready, saving, draft, unsaved, error, syncError })}</Text>
    {draft?.finalisation ? <Text accessibilityLiveRegion="polite" style={styles.body}>{draft.finalisationError || (draft.finalisation.shareWithParent !== false ? 'Saved on this phone. Sharing in the background. You can leave this screen.' : 'Saved on this phone. Finishing in the background. You can leave this screen.')}</Text> : null}
    {finaliseError ? <Text accessibilityLiveRegion="assertive" style={styles.danger}>{finaliseError}</Text> : null}
    {error || syncError || draft?.error ? <Text style={styles.danger}>{error || syncError || draft.error}</Text> : null}
    {ready ? (form.fields || []).filter(field => Number(user.roleRank || 0) >= field.roleRank).map(field => <View key={field.id} style={styles.stack}>
      {fieldLabel(field.id, `${field.label}${field.required ? ' (required)' : ''}${field.staffPrivate ? ' | Coach private' : field.parentVisible ? ' | Parent-shareable' : ''}`, !['boolean', 'checkbox'].includes(field.type) && !field.options.length)}
      {['boolean', 'checkbox'].includes(field.type) ? button(input.values[field.id] ? 'Yes' : 'No', () => changeValue(field.id, !input.values[field.id]), finalising || !!draft?.finalisation)
        : field.options.length ? <View style={styles.row}>{field.options.map(option => button(option.label, () => changeValue(field.id, option.value), finalising || !!draft?.finalisation, input.values[field.id] === option.value))}</View>
          : <TextInput accessibilityLabel={field.label} editable={!finalising && !draft?.finalisation} keyboardType={['number', 'numeric', 'rating', 'score', 'score_1_5', 'score_1_10'].includes(field.type) ? 'numeric' : 'default'} multiline={field.type === 'textarea'} onFocus={() => setFocusedField(field.id)} onBlur={() => setFocusedField('')} onChangeText={value => changeValue(field.id, value)} style={[styles.input, field.type === 'textarea' && styles.inputMultiline]} value={String(input.values[field.id] ?? '')} />}
    </View>) : null}
    {fieldLabel('summary', 'Coach summary note')}
    <TextInput accessibilityLabel="Coach summary note" editable={ready && !finalising && !draft?.finalisation} multiline onFocus={() => setFocusedField('summary')} onBlur={() => setFocusedField('')} onChangeText={notes => void persist({ ...inputRef.current, notes })} style={[styles.input, styles.inputMultiline]} value={input.notes} />
    <View style={styles.row}>
      {button('Cancel assessment', cancel, !ready || finalising || saving > 0 || !!draft?.finalisation || cancelling)}
      {button('Save private draft', () => void save(), !ready || finalising || !!draft?.finalisation)}
      {button(draft?.finalisation ? 'Retry sending' : 'Sync now', () => { if (draft?.finalisation) void retrySending(); else void sync() }, !draft || unsaved || user.isOfflineProfile || finalising || saving > 0)}
      {button(finalising && !finalisingShare ? 'Saving record...' : 'Finalise privately', () => finalise(false), !ready || stale || user.isOfflineProfile || finalising || saving > 0 || unsaved || !!error || draft?.status !== 'synced' || !!draft?.finalisation)}
      {button(finalising && finalisingShare ? 'Sharing...' : 'Finalise and share', () => finalise(true), !ready || stale || user.isOfflineProfile || finalising || saving > 0 || unsaved || !!error || draft?.status !== 'synced' || !!draft?.finalisation)}
    </View>
    <Text style={styles.helper}>Saved work syncs in the background. Keep the app signed in so it can finish when connected.</Text>
  </View>
}
