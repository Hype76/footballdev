import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'

export function CoachSquadTemplates({ store, rows, locked, onApply, palette, styles }) {
  const [templates, setTemplates] = useState([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState('')
  const [remove, setRemove] = useState('')
  const request = useRef(0)
  const saving = useRef(true)
  const cancelLoad = useCallback(() => { request.current++ }, [])
  useEffect(() => {
    const current = ++request.current
    store().then(items => { if (current === request.current) setTemplates(items) })
      .catch(() => { if (current === request.current) setMessage('Templates could not be loaded. Tap Refresh templates to try again.') })
      .finally(() => { if (current === request.current) { saving.current = false; setBusy(false) } })
    return cancelLoad
  }, [store, cancelLoad])
  const selectedIds = rows.filter(row => row.decision === 'selected').map(row => row.id)
  const action = async (kind, targetName = name.trim()) => {
    if (saving.current || (kind !== 'list' && locked)) return
    saving.current = true; setBusy(true); setMessage('')
    const current = request.current
    try {
      const items = await store(kind, targetName, kind === 'save' ? selectedIds : [])
      if (current !== request.current) return
      setTemplates(items); setRemove('')
      setMessage(kind === 'save' ? 'Template saved to your Coach account. Fixture selections and notifications have not been sent.' : kind === 'delete' ? 'Template deleted.' : 'Templates refreshed.')
    } catch { if (current === request.current) setMessage('Templates could not be confirmed. Check your connection and refresh before trying again.') }
    finally { saving.current = false; if (current === request.current) setBusy(false) }
  }
  const button = (label, onPress, disabled = locked || busy) => <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={{ minHeight: 44, justifyContent: 'center', padding: 8, opacity: disabled ? 0.4 : 1 }}><Text style={[styles.body, { color: palette.accentText }]}>{label}</Text></Pressable>
  return <View style={{ gap: 6, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: palette.border }}>
    <Text style={styles.cardTitle}>Squad templates</Text>
    <Text style={styles.meta}>Your saved groups for this team, synced to your Coach account. Applying a template replaces the current choices. Review them, then Save selections.</Text>
    <TextInput accessibilityLabel="Template name" placeholder="e.g. Regular match squad" placeholderTextColor={palette.textMuted} maxLength={60} editable={!locked && !busy} value={name} onChangeText={setName} style={{ color: palette.textPrimary, borderColor: palette.border, borderWidth: 1, borderRadius: 8, minHeight: 44, padding: 10 }} />
    {button(templates.some(item => item.name === name.trim()) ? 'Update named template' : 'Save selected players as template', () => void action('save'), locked || busy || !name.trim() || !selectedIds.length)}
    {templates.map(template => <View key={template.name} style={{ borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 6 }}>
      <Text style={styles.body}>{template.name} ({template.playerIds.length} players)</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {button(`Apply ${template.name}`, () => { onApply(template); setMessage('Template applied to draft selections. Review availability and save when ready.') }, locked || busy || !rows.some(row => template.playerIds.includes(row.id)))}
        {button(`Delete ${template.name}`, () => setRemove(template.name))}
      </View>
      {remove === template.name ? <View><Text style={styles.body}>Delete this saved template?</Text>{button('Confirm delete template', () => void action('delete', template.name))}{button('Keep template', () => setRemove(''), busy)}</View> : null}
    </View>)}
    {button(busy ? 'Updating templates...' : 'Refresh templates', () => void action('list'), busy)}
    {message ? <Text accessibilityLiveRegion="polite" style={styles.body}>{message}</Text> : null}
  </View>
}
