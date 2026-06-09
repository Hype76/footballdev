const FORBIDDEN_ASSESSMENT_TERMS = [
  { pattern: /voice notes?/gi, replacement: 'coach notes' },
  { pattern: /voice/gi, replacement: 'communication' },
  { pattern: /audio/gi, replacement: 'media' },
  { pattern: /recordings?/gi, replacement: 'notes' },
  { pattern: /transcripts?/gi, replacement: 'written notes' },
]

export function sanitizeAssessmentOutputText(value) {
  return FORBIDDEN_ASSESSMENT_TERMS.reduce(
    (text, item) => text.replace(item.pattern, item.replacement),
    String(value ?? ''),
  )
}

export function sanitizeAssessmentEmailSections(emailSections = []) {
  if (!Array.isArray(emailSections)) {
    return []
  }

  return emailSections
    .map((section) => ({
      ...section,
      title: sanitizeAssessmentOutputText(section?.title),
      body: sanitizeAssessmentOutputText(section?.body),
    }))
    .filter((section) => String(section.body ?? '').trim())
}
