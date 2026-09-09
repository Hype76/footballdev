import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Pressable, Text, TextInput, View } from 'react-native'
import { developmentDraftKey, developmentFormFingerprint } from '../../mobile-core/src/developmentOfflineCore'
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
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(0)
  const [error, setError] = useState('')
  const [finalising, setFinalising] = useState(false)
  const key = developmentDraftKey(player.id, form.id)
  const alive = useRef(true)
  const initialServerDraft = useRef(serverDraft)
  useEffect(() => {
    alive.current = true
    const read = async (hydrate = false) => {
      try {
        let next = (await readCoachDevelopmentDrafts(user.id, context))[key] || null
        if (!next && hydrate && initialServerDraft.current) {
          const saved = initialServerDraft.current
          next = await updateCoachDevelopmentDraft(user.id, context, key, current => current || {
            ...saved, notes: saved.notes || '', revision: 0, serverVersion: saved.clientSaveVersion,
            status: 'synced', savedAt: saved.lastSavedAt, syncedAt: saved.lastSavedAt,
          })
        }
        if (!alive.current) return
        setDraft(next)
        if (hydrate) {
          inputRef.current = { values: next?.values || {}, notes: next?.notes || '' }
          setInput(inputRef.current)
          setReady(true)
        }
      } catch {
        if (alive.current) setError('Saved work could not be opened safely. Reopen Development to try again.')
      }
    }
    void read(true)
    const unsubscribe = subscribeDevelopmentSync(() => void read())
    return () => { alive.current = false; unsubscribe() }
  }, [context, key, user.id])

  const persist = async next => {
    inputRef.current = next
    setInput(next)
    setSaving(count => count + 1)
    setError('')
    try {
      const saved = await saveLocalCoachDevelopmentDraft(user.id, context, { playerId: player.id, formId: form.id, formFingerprint: developmentFormFingerprint(form), ...next })
      if (alive.current) setDraft(saved)
      notifyDevelopmentSync()
    } catch (failure) {
      if (alive.current) setError(failure.message || 'This change has not been saved. Keep this screen open and try saving again.')
    } finally { if (alive.current) setSaving(count => count - 1) }
  }
  const changeValue = (id, value) => void persist({ ...inputRef.current, values: { ...inputRef.current.values, [id]: value } })
  const sync = () => void syncCoachDevelopmentDrafts(user, suppliedContext).catch(failure => setError(failure.message))
  const finalise = () => Alert.alert('Finalise and share this Development record?', 'The final record will be available to authorised linked Parents. It cannot be edited from this mobile workflow.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Finalise and share', onPress: async () => {
      setFinalising(true)
      try {
        await finalizeCoachDevelopmentRecord(user, { draftId: draft.id, player, form, ...inputRef.current, shareWithParent: true })
        await updateCoachDevelopmentDraft(user.id, context, key, () => null)
        inputRef.current = { values: {}, notes: '' }
        setInput(inputRef.current); setDraft(null)
        notifyDevelopmentSync()
        onFinalised?.()
      } catch (failure) { setError(failure.message) }
      finally { setFinalising(false) }
    } },
  ])
  const button = (label, onPress, disabled = false, selected = false) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, selected }} disabled={disabled} onPress={onPress} style={[selected ? styles.primary : styles.secondary, disabled && styles.disabled]}><Text style={selected ? styles.primaryText : styles.secondaryText}>{label}</Text></Pressable>
  return <View style={styles.panel}>
    <Text style={styles.heading}>{form.name}</Text>
    <Text accessibilityLiveRegion="polite" style={styles.body}>{!ready ? 'Opening saved work...' : saving ? 'Saving on this phone...' : error ? 'Some changes have not been saved.' : draft?.status === 'synced' ? 'Synced. Private draft saved to your account.' : draft ? 'Saved on this phone. Waiting to sync.' : 'Changes save on this phone as you work.'}</Text>
    {error || draft?.error ? <Text style={styles.danger}>{error || draft.error}</Text> : null}
    {ready ? (form.fields || []).filter(field => Number(user.roleRank || 0) >= field.roleRank).map(field => <View key={field.id} style={styles.stack}>
      <Text style={styles.label}>{field.label}{field.required ? ' (required)' : ''}{field.staffPrivate ? ' | Coach private' : field.parentVisible ? ' | Parent-shareable' : ''}</Text>
      {['boolean', 'checkbox'].includes(field.type) ? button(input.values[field.id] ? 'Yes' : 'No', () => changeValue(field.id, !input.values[field.id]), finalising)
        : field.options.length ? <View style={styles.row}>{field.options.map(option => button(option.label, () => changeValue(field.id, option.value), finalising, input.values[field.id] === option.value))}</View>
          : <TextInput accessibilityLabel={field.label} editable={!finalising} keyboardType={['number', 'numeric', 'rating', 'score', 'score_1_5', 'score_1_10'].includes(field.type) ? 'numeric' : 'default'} multiline={field.type === 'textarea'} onChangeText={value => changeValue(field.id, value)} style={[styles.input, field.type === 'textarea' && styles.inputMultiline]} value={String(input.values[field.id] ?? '')} />}
    </View>) : null}
    <Text style={styles.label}>Coach summary note</Text>
    <TextInput accessibilityLabel="Coach summary note" editable={ready && !finalising} multiline onChangeText={notes => void persist({ ...inputRef.current, notes })} style={[styles.input, styles.inputMultiline]} value={input.notes} />
    <View style={styles.row}>
      {button('Save private draft', () => void persist(inputRef.current).then(sync), !ready || finalising || saving > 0)}
      {button('Sync now', sync, !draft || user.isOfflineProfile || finalising || saving > 0)}
      {button(finalising ? 'Sharing...' : 'Finalise and share', finalise, !ready || stale || user.isOfflineProfile || finalising || saving > 0 || !!error || draft?.status !== 'synced')}
    </View>
    <Text style={styles.helper}>Private drafts sync when you reconnect. Finalising and sharing requires a connection.</Text>
  </View>
}
