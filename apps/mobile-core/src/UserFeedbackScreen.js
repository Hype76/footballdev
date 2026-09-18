import { useRef, useState } from 'react'
import { ActivityIndicator, Platform, Pressable, Text, TextInput, View } from 'react-native'
import { buildUserFeedback } from '../../../src/lib/user-feedback'
import { getAccessToken } from './supabase'
import { getMobileRuntimeConfig } from './config'
import { fetchJsonWithTimeout, joinApiPath } from './http'

export function UserFeedbackScreen({ type, appRole, textStyle, headingStyle }) {
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const submitting = useRef(false)
  async function submit() {
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    setError('')
    try {
      const report = buildUserFeedback({ type, title, message, app: appRole, device: `${Platform.OS} ${Platform.Version}` })
      const token = await getAccessToken()
      if (!token) throw new Error('Sign in again before submitting.')
      const { ok, result } = await fetchJsonWithTimeout(joinApiPath(getMobileRuntimeConfig(appRole).apiBaseUrl, '.netlify/functions/submit-tester-feedback'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ report }),
        timeoutMs: 30000,
      })
      if (!ok || !result?.success) throw new Error(result?.message || 'Your message could not be submitted. Please try again.')
      setSent(true)
    } catch (failure) {
      setError(failure.message || 'Your message could not be submitted. Please try again.')
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }
  if (sent) return <View accessibilityLiveRegion="polite" style={{ paddingVertical: 24 }}><Text accessibilityRole="header" style={headingStyle}>Thank you</Text></View>
  const inputStyle = { color: '#172b22', backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#80978b', minHeight: 48, padding: 12, fontSize: 16 }
  return <View style={{ gap: 16, paddingVertical: 12 }}>
    <Text accessibilityRole="header" style={headingStyle}>{type === 'bug' ? 'Report a Bug' : 'Feedback & Suggestions'}</Text>
    <Text style={textStyle}>{type === 'bug' ? 'Tell us what went wrong and what you were doing.' : 'Tell us what you think or what you would like to see.'}</Text>
    <Text style={textStyle}>Subject</Text>
    <TextInput accessibilityLabel="Subject" editable={!busy} maxLength={240} value={title} onChangeText={setTitle} style={inputStyle} />
    <Text style={textStyle}>Message</Text>
    <TextInput accessibilityLabel="Message" editable={!busy} maxLength={4000} multiline textAlignVertical="top" value={message} onChangeText={setMessage} style={[inputStyle, { minHeight: 160 }]} />
    {error ? <Text accessibilityRole="alert" style={{ color: '#c0392b', fontSize: 16 }}>{error}</Text> : null}
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => void submit()} style={{ minHeight: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: '#047857', opacity: busy ? 0.6 : 1 }}>
      {busy ? <ActivityIndicator accessibilityLabel="Submitting" color="#ffffff" /> : <Text style={{ color: '#ffffff', fontSize: 16, fontWeight: '700' }}>Submit</Text>}
    </Pressable>
  </View>
}
