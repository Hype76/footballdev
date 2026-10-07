import { Modal, Pressable, SafeAreaView, ScrollView, Text } from 'react-native'
import { LEGAL_NOTICES } from '../../../src/lib/legal-notices.js'

export function MobileLegalNotice({ notice, tokens, onClose }) {
  const value = LEGAL_NOTICES[notice]
  if (!value) return null
  return <Modal visible animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={{ flex: 1, backgroundColor: tokens.portalBackground }}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to account" onPress={onClose} style={{ minHeight: 48, justifyContent: 'center' }}>
          <Text style={{ color: tokens.accentText, fontSize: 16, fontWeight: '700' }}>Back to account</Text>
        </Pressable>
        <Text accessibilityRole="header" style={{ color: tokens.textPrimary, fontSize: 26, fontWeight: '800' }}>{value.title}</Text>
        <Text style={{ color: tokens.textSecondary, fontSize: 16, lineHeight: 24 }}>{value.intro}</Text>
        {value.sections.map(section => <Text key={section.title} style={{ color: tokens.textPrimary, fontSize: 16, lineHeight: 24 }}>
          <Text style={{ fontWeight: '700' }}>{section.title}{'\n'}</Text>
          {section.paragraphs.join('\n\n')}
        </Text>)}
      </ScrollView>
    </SafeAreaView>
  </Modal>
}
