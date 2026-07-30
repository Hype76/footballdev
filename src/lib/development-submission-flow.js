function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeMeaningfulValue(value) {
  if (Array.isArray(value)) {
    return value
      .map(normalizeMeaningfulValue)
      .filter((item) => {
        if (Array.isArray(item)) {
          return item.length > 0
        }

        if (item && typeof item === 'object') {
          return Object.keys(item).length > 0
        }

        return item !== ''
      })
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, normalizeMeaningfulValue(item)])
        .filter(([, item]) => {
          if (Array.isArray(item)) {
            return item.length > 0
          }

          if (item && typeof item === 'object') {
            return Object.keys(item).length > 0
          }

          return item !== ''
        })
        .sort(([left], [right]) => left.localeCompare(right)),
    )
  }

  if (typeof value === 'boolean' || typeof value === 'number') {
    return value
  }

  return normalizeText(value)
}

function uniqueSortedStrings(values = []) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map(normalizeText)
        .filter(Boolean),
    ),
  ].sort()
}

export function createDevelopmentMeaningfulState({
  archiveAfterNoPlace = false,
  emailSendMode = 'now',
  emailTemplateKey = '',
  formData = {},
  includeAttendanceSummary = true,
  inviteDate = '',
  isPdfAttachmentApproved = false,
  nextAssessmentReminderChoice = 'skip',
  nextAssessmentReminderDate = '',
  previewMode = 'scored',
  responseValues = {},
  scheduledEmailDateTime = '',
  selectedDevelopmentParentLinkIds = [],
  selectedExportLabels = null,
  selectedParentContactIndexes = [],
} = {}) {
  const meaningfulFormData = {
    contactType: formData.contactType,
    parentContacts: formData.parentContacts,
    parentEmail: formData.parentEmail,
    parentName: formData.parentName,
    reportDate: formData.reportDate,
    reviewDate: formData.reviewDate,
    section: formData.section,
    session: formData.session,
  }
  const isEmailRequested = previewMode === 'email'
  const reminderDate = nextAssessmentReminderChoice === 'set'
    ? normalizeText(nextAssessmentReminderDate)
    : ''

  return normalizeMeaningfulValue({
    archiveAfterNoPlace: archiveAfterNoPlace === true,
    formData: meaningfulFormData,
    inviteDate,
    output: {
      emailRequested: isEmailRequested,
      emailSendMode: isEmailRequested ? emailSendMode : 'none',
      emailTemplateKey: isEmailRequested ? emailTemplateKey : '',
      includeAttendanceSummary: isEmailRequested && includeAttendanceSummary === true,
      isPdfAttachmentApproved: isEmailRequested && isPdfAttachmentApproved === true,
      scheduledEmailDateTime:
        isEmailRequested && emailSendMode === 'scheduled'
          ? scheduledEmailDateTime
          : '',
      selectedDevelopmentParentLinkIds:
        isEmailRequested
          ? uniqueSortedStrings(selectedDevelopmentParentLinkIds)
          : [],
      selectedExportLabels:
        isEmailRequested && Array.isArray(selectedExportLabels)
          ? uniqueSortedStrings(selectedExportLabels)
          : [],
      selectedParentContactIndexes:
        isEmailRequested
          ? [...new Set(selectedParentContactIndexes)].sort((left, right) => left - right)
          : [],
    },
    reminder: {
      choice: nextAssessmentReminderChoice === 'set' ? 'set' : 'skip',
      date: reminderDate,
    },
    responseValues,
  })
}

export function createDevelopmentMeaningfulStateSignature(value = {}) {
  return JSON.stringify(createDevelopmentMeaningfulState(value))
}

export function getDevelopmentSubmissionActionLabel({
  emailSendMode = 'now',
  previewMode = 'scored',
} = {}) {
  if (previewMode !== 'email') {
    return 'Save record without email'
  }

  return emailSendMode === 'scheduled'
    ? 'Save record and schedule email'
    : 'Save record and send email'
}

export function buildDevelopmentSubmissionReviewItems({
  emailSendMode = 'now',
  includeAttendanceSummary = true,
  isPdfAttachmentApproved = false,
  nextAssessmentReminderChoice = 'skip',
  nextAssessmentReminderDate = '',
  playerName = '',
  previewMode = 'scored',
  recordDate = '',
  recipients = [],
  selectedResponseCount = 0,
  teamName = '',
} = {}) {
  const isEmailRequested = previewMode === 'email'
  const recipientLabel = isEmailRequested
    ? recipients
        .map((recipient) => normalizeText(recipient?.name || recipient?.email))
        .filter(Boolean)
        .join(', ') || 'No eligible recipient selected'
    : 'Not requested'

  return [
    `Player: ${normalizeText(playerName) || 'Not selected'}`,
    `Team: ${normalizeText(teamName) || 'Not selected'}`,
    `Record date: ${normalizeText(recordDate) || 'Not entered'}`,
    `Recipients: ${recipientLabel}`,
    `Parent email: ${
      !isEmailRequested
        ? 'Not requested'
        : emailSendMode === 'scheduled'
          ? 'Scheduled'
          : 'Send now'
    }`,
    `PDF: ${isEmailRequested && isPdfAttachmentApproved ? 'Attach' : 'Not attached'}`,
    `Attendance: ${isEmailRequested && includeAttendanceSummary ? 'Included' : 'Not included'}`,
    `Selected responses: ${Math.max(0, Number(selectedResponseCount) || 0)}`,
    `Reminder: ${
      nextAssessmentReminderChoice === 'set' && nextAssessmentReminderDate
        ? nextAssessmentReminderDate
        : 'No reminder'
    }`,
  ]
}

export function buildDevelopmentCompletionItems({
  emailOutcome = 'saved',
  isPdfAttachmentApproved = false,
  previewMode = 'scored',
  reminderDate = '',
  reminderCreated = false,
  reminderFailed = false,
} = {}) {
  const isEmailRequested = previewMode === 'email'
  const emailFailed = ['no_recipient', 'recipient_review', 'schedule_failed', 'send_failed'].includes(emailOutcome)
  const pdfStatus = !isEmailRequested || !isPdfAttachmentApproved
    ? 'Not requested'
    : emailOutcome === 'recipient_review'
      ? 'Not generated, retry available'
    : emailFailed
      ? 'Failed, retry available'
      : 'Attached'
  const emailStatus = !isEmailRequested
    ? 'Not requested'
    : emailOutcome === 'scheduled'
      ? 'Scheduled'
      : emailOutcome === 'sent'
        ? 'Sent'
        : emailOutcome === 'recipient_review'
          ? 'Not sent, review recipients'
        : isPdfAttachmentApproved
          ? 'Not sent because requested PDF failed'
          : 'Failed, retry available'

  return [
    'Development record: Saved',
    `PDF: ${pdfStatus}`,
    `Parent email: ${emailStatus}`,
    `Reminder: ${
      reminderCreated && reminderDate
        ? `Created for ${reminderDate}`
        : reminderFailed
          ? 'Failed, retry available'
          : 'Not requested'
    }`,
  ]
}
