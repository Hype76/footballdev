export function buildUserFeedback({ type, title, message, app = 'web', device = '' }) {
  const subject = String(title || '').trim()
  const summary = String(message || '').trim()
  if (!subject || !summary) throw new Error('Add a subject and message before submitting.')
  if (subject.length > 240 || summary.length > 4000) throw new Error('Keep the subject within 240 characters and the message within 4,000 characters.')
  return {
    feedbackType: type === 'bug' ? 'bug' : 'suggestion',
    title: subject,
    summary,
    phase: 'production',
    severity: 'medium',
    module: app === 'coach' ? 'Mobile coach app' : app === 'parent' ? 'Mobile parent app' : 'Other',
    route: `/more/${type === 'bug' ? 'bug' : 'feedback'}`,
    browserDevice: device,
  }
}
