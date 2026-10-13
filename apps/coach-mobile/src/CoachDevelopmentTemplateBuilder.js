import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import * as Crypto from 'expo-crypto'
import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { MobileSwitch } from '../../mobile-core/src/MobileSwitch.js'
import { useMobileActivity } from '../../mobile-core/src/MobileActivityContext.js'
import { COACH_TEMPLATE_MARKING_TYPES, buildCoachDevelopmentTemplateField, canBuildCoachDevelopmentTemplate } from '../../mobile-core/src/coachDevelopmentTemplateCore.js'
import { saveCoachDevelopmentTemplate, setCoachDevelopmentTemplateAccess } from '../../mobile-core/src/coachPhase31EData.js'
import { CoachKeyboardFocusContext } from './CoachKeyboardFocusContext.js'
import { createCoachOfflineResourceSaver, readCoachOfflineResources } from './offline.js'
import { getCoachFriendlyError } from './coachFriendlyErrors.js'

const newField = () => ({ id: Crypto.randomUUID(), label: '', type: 'score_1_10', options: '', parentVisible: true, required: false })
const newDraft = () => ({ id: Crypto.randomUUID(), name: '', fields: [] })

export function CoachDevelopmentTemplateBuilder({ context, onBack, onSaved, onUse, stale, styles, user }) {
  const scope = JSON.stringify([user.id, context.id, context.authorityId, context.authoritySource, context.clubId, context.teamId, user.role, user.roleRank, user.hasActivePlanAccess, user.status, user.planKey, user.planStatus, user.isPlanComped])
  const session = useMemo(() => ({ active: false, scope }), [scope])
  const saveLocal = useMemo(() => createCoachOfflineResourceSaver(user, context), [user, context])
  const sessionContextRef = useRef({ context, userId: user.id })
  const [draft, setDraft] = useState(newDraft)
  const [field, setField] = useState(newField)
  const [savedTemplate, setSavedTemplate] = useState(null)
  const [accessScope, setAccessScope] = useState('creator')
  const [hydrated, setHydrated] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const revealFocused = useContext(CoachKeyboardFocusContext)
  useMobileActivity(busy || !hydrated)
  useLayoutEffect(() => { session.active = true; return () => { session.active = false } }, [session])
  useLayoutEffect(() => { sessionContextRef.current = { context, userId: user.id } }, [context, user.id])
  useEffect(() => {
    const captured = sessionContextRef.current
    void readCoachOfflineResources(captured.userId, captured.context).then(cache => {
      if (!session.active) return
      const saved = cache?.resources?.developmentTemplateDraft
      if (saved?.draft?.id) { setDraft(saved.draft); setField(saved.field || null); setSavedTemplate(saved.savedTemplate || null); setAccessScope(saved.savedTemplate?.accessScope || 'creator') }
      setHydrated(true)
    }).catch(() => { if (session.active) setHydrated(true) })
  }, [session])
  const persist = async (nextDraft, nextField, template) => {
    try { await saveLocal({ developmentTemplateDraft: { draft: nextDraft, field: nextField, savedTemplate: template || null } }) }
    catch { throw new Error('The changes could not be saved on this phone. Keep this screen open and retry.') }
  }
  const action = async (run, networkCopy = '') => {
    if (!hydrated || inFlight.current || !session.active) return
    inFlight.current = true; setBusy(true); setError('')
    try { await run() } catch (failure) {
      if (session.active) {
        const friendly = getCoachFriendlyError(failure, 'The template could not be saved. Your fields are still here.')
        setError(networkCopy && friendly.startsWith('We could not connect') ? networkCopy : friendly)
      }
    }
    finally { inFlight.current = false; if (session.active) setBusy(false) }
  }
  const saveField = () => action(async () => {
    const nextField = buildCoachDevelopmentTemplateField(field, draft.fields.length)
    const next = { ...draft, fields: [...draft.fields, nextField] }
    if (next.fields.length > 50) throw new Error('A template can contain up to 50 fields.')
    await persist(next, null, null)
    if (session.active) { setDraft(next); setField(null) }
  })
  const saveTemplate = () => action(async () => {
    if (stale) throw new Error('Connect before saving the template for use.')
    let saved, warning = ''
    try { saved = await saveCoachDevelopmentTemplate(user, draft) }
    catch (failure) {
      if (!failure.savedTemplate) throw failure
      saved = failure.savedTemplate
      warning = 'Template saved. Activity logging could not be confirmed. Retry activity confirmation when connected.'
    }
    if (!session.active) return
    setSavedTemplate(saved); setField(null); setAccessScope(saved.accessScope); onSaved?.(saved)
    try { await persist(draft, null, saved) }
    catch { warning = 'Template saved. Its phone copy could not be updated. The saved template is available online.' }
    if (session.active && warning) setError(warning)
  }, 'The template save could not be confirmed. Your fields are still on this phone. Retry saving when connected.')
  const saveAccess = () => action(async () => {
    if (stale) throw new Error('Connect before changing template access.')
    if (savedTemplate.auditPending) {
      try { await saveCoachDevelopmentTemplate(user, draft) }
      catch (failure) {
        if (!failure.savedTemplate) throw failure
        if (session.active) setError('Template saved. Activity logging could not be confirmed. Retry activity confirmation when connected.')
        return
      }
      if (!session.active) return
    }
    const saved = { ...(savedTemplate.accessScope === accessScope ? savedTemplate : await setCoachDevelopmentTemplateAccess(user, savedTemplate, accessScope)), auditPending: false }
    if (!session.active) return
    setSavedTemplate(saved); onSaved?.(saved)
    let phoneWarning = ''
    try { await persist(draft, null, saved) }
    catch { phoneWarning = 'Access saved. Its phone copy could not be updated. The saved template is available online.' }
    if (session.active) onUse?.({ ...saved, saveWarning: phoneWarning })
  })
  const accent = styles.status?.color || styles.label.color
  const rowStyle = { alignItems: 'center', borderBottomColor: styles.developmentSelector.borderBottomColor, borderBottomWidth: 1, flexDirection: 'row', gap: 10, minHeight: 48, paddingVertical: 10 }
  const inputStyle = [styles.input, { borderWidth: 0, borderBottomWidth: 1, borderRadius: 0, minHeight: 48 }]
  const rowAction = (label, onPress, disabled = false, icon = 'chevron-right') => <Pressable accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[rowStyle, disabled && { opacity: 0.5 }]}><MaterialIcons accessible={false} color={accent} name={icon} size={24} /><Text style={[styles.heading, { flex: 1 }]}>{label}</Text></Pressable>
  if (!canBuildCoachDevelopmentTemplate(user)) return <Text style={styles.body}>Template management is not available in this Coach context.</Text>
  return <View style={styles.stack}>
    {rowAction('Back to Development', onBack, false, 'arrow-back')}
    <Text accessibilityRole="header" style={styles.heading}>Build a new assessment template</Text>
    {savedTemplate ? <>
      <Text style={styles.body}>{savedTemplate.name} saved. Choose who can use it.</Text>
      {savedTemplate.auditPending ? rowAction('Retry activity confirmation', saveTemplate, busy || stale || !hydrated, 'refresh') : null}
      <View accessibilityRole="radiogroup" accessibilityLabel="Who can use this template">{[['creator', 'Only me'], ['team', 'Whole coaching team']].map(([value, label]) => <Pressable key={value} accessibilityLabel={label} accessibilityRole="radio" accessibilityState={{ checked: accessScope === value, disabled: busy }} aria-checked={accessScope === value} disabled={busy} onPress={() => setAccessScope(value)} style={rowStyle}><MaterialIcons accessible={false} color={accent} name={accessScope === value ? 'radio-button-checked' : 'radio-button-unchecked'} size={24} /><Text style={styles.body}>{label}</Text></Pressable>)}</View>
      <Text style={styles.helper}>{accessScope === 'team' ? 'Available to authorised staff in this team.' : 'Available only to you in this team.'}</Text>
      {rowAction('Save access and use template', saveAccess, busy || stale || !hydrated, 'check')}
      {rowAction('Build another template', () => void action(async () => { const next = newDraft(), nextField = newField(); await persist(next, nextField, null); if (session.active) { setDraft(next); setField(nextField); setSavedTemplate(null); setAccessScope('creator') } }), busy, 'add')}
    </> : <>
      <Text style={styles.label}>Name</Text>
      <TextInput accessibilityLabel="Template name" editable={hydrated && !busy} maxLength={120} onFocus={revealFocused} onChangeText={name => setDraft(current => ({ ...current, name }))} style={inputStyle} value={draft.name} />
      {draft.fields.map((item, index) => <View key={item.id} style={rowStyle}><Text style={[styles.body, { flex: 1 }]}>{index + 1}. {item.label} | {COACH_TEMPLATE_MARKING_TYPES.find(type => type.value === item.type)?.label}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Remove field ${item.label}`} disabled={busy} style={{ alignItems: 'center', justifyContent: 'center', minHeight: 44, minWidth: 44 }} onPress={() => void action(async () => { const next = { ...draft, fields: draft.fields.filter(saved => saved.id !== item.id) }; await persist(next, field, null); if (session.active) setDraft(next) })}><MaterialIcons color={accent} name="delete-outline" size={24} /></Pressable></View>)}
      {field ? <>
        <Text style={styles.label}>Field</Text><TextInput accessibilityLabel="Field name" editable={hydrated && !busy} maxLength={120} onFocus={revealFocused} onChangeText={label => setField(current => ({ ...current, label }))} style={inputStyle} value={field.label} />
        <Text style={styles.label}>Marking type</Text>
        <View accessibilityRole="radiogroup" accessibilityLabel="Marking type">{COACH_TEMPLATE_MARKING_TYPES.map(type => <Pressable key={type.value} accessibilityLabel={type.label} accessibilityRole="radio" accessibilityState={{ checked: field.type === type.value, disabled: busy }} aria-checked={field.type === type.value} disabled={busy} onPress={() => setField(current => ({ ...current, type: type.value }))} style={rowStyle}><MaterialIcons accessible={false} color={accent} name={field.type === type.value ? 'radio-button-checked' : 'radio-button-unchecked'} size={24} /><Text style={styles.body}>{type.label}</Text></Pressable>)}</View>
        {field.type === 'select' ? <><Text style={styles.label}>One dropdown option per line</Text><TextInput accessibilityLabel="Dropdown options" editable={!busy} multiline onFocus={revealFocused} onChangeText={options => setField(current => ({ ...current, options }))} style={inputStyle} value={field.options} /></> : null}
        <View style={rowStyle}><Text style={[styles.body, { flex: 1 }]}>Parent-shareable</Text><MobileSwitch accessibilityLabel="Parent-shareable field" disabled={busy} onValueChange={parentVisible => setField(current => ({ ...current, parentVisible }))} value={field.parentVisible} /></View>
        <View style={rowStyle}><Text style={[styles.body, { flex: 1 }]}>Required</Text><MobileSwitch accessibilityLabel="Required field" disabled={busy} onValueChange={required => setField(current => ({ ...current, required }))} value={field.required} /></View>
        {rowAction('Save field', saveField, busy || !hydrated, 'check')}
      </> : rowAction('Add another field', () => setField(newField()), busy || draft.fields.length >= 50, 'add')}
      {draft.fields.length && !field ? rowAction('Save template', saveTemplate, busy || stale || !hydrated, 'save') : null}
      {stale ? <Text style={styles.helper}>You can save fields on this phone. Connect to save the template for use.</Text> : null}
    </>}
    {error ? <Text accessibilityRole="alert" style={styles.danger}>{error}</Text> : null}
  </View>
}
