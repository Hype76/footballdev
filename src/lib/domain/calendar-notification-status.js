function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

export function getCalendarNotificationToast(result = {}, {
  action = 'updated',
  entity = 'Event',
} = {}) {
  const deliveredCount = Number(result.deliveredCount ?? 0)
  const processingCount = Number(result.processingCount ?? 0)
  const failedCount = Number(result.failedCount ?? 0)
  const duplicateCount = Number(result.duplicateCount ?? 0)
  const eligibleRecipientCount = Number(result.eligibleRecipientCount ?? 0)
  const portalRecordCount = Number(result.portalRecordCount ?? 0)
  const savedPrefix = `${entity} ${action}`
  const isActionableMatchDay = result.responseRequirement === 'response_required'
    || result.eventActionType === 'match_day_action_required'
  const playerRequestCount = Number(result.playerRequestCreatedCount ?? 0)
    + Number(result.playerRequestPreservedCount ?? 0)
  const volunteerRequestCount = Number(result.volunteerRequestCreatedCount ?? 0)
    + Number(result.volunteerRequestPreservedCount ?? 0)

  if (isActionableMatchDay && (result.actionReconciliationState !== 'ready' || playerRequestCount === 0)) {
    return {
      title: `${entity} saved, family invitations failed`,
      message: `The ${entity.toLowerCase()} was saved, but actionable player invitations were not created. Families were not reported as invited.`,
      tone: 'error',
    }
  }

  if (isActionableMatchDay) {
    const actionSummary = [
      pluralize(playerRequestCount, 'player invitation'),
      volunteerRequestCount > 0 ? pluralize(volunteerRequestCount, 'volunteer request') : '',
    ].filter(Boolean).join(' and ')

    if (eligibleRecipientCount === 0) {
      return {
        title: `${savedPrefix} with parent actions ready`,
        message: `${savedPrefix}. ${actionSummary} available in the Parent Portal, but no eligible parent email addresses were available.`,
        tone: 'error',
      }
    }

    if (failedCount > 0 && processingCount === 0) {
      return {
        title: `${savedPrefix} with parent actions ready`,
        message: `${savedPrefix} and ${actionSummary} available in the Parent Portal, but the email notifications could not be sent.`,
        tone: 'error',
      }
    }

    if (deliveredCount > 0 && failedCount > 0) {
      return {
        title: `${savedPrefix} with partial email delivery`,
        message: `${savedPrefix} and ${actionSummary} available in the Parent Portal. ${pluralize(deliveredCount, 'email')} sent and ${failedCount} failed.`,
        tone: 'error',
      }
    }

    if (duplicateCount > 0 && deliveredCount > 0) {
      return {
        title: `${savedPrefix} with parent actions ready`,
        message: `${savedPrefix} and ${actionSummary} available in the Parent Portal. The previous delivery is confirmed and no duplicate email was sent.`,
      }
    }

    if (deliveredCount > 0) {
      return {
        title: `${savedPrefix} and parent emails sent`,
        message: `${savedPrefix}. ${actionSummary} available in the Parent Portal. ${pluralize(deliveredCount, 'parent email')} sent.`,
      }
    }

    return {
      title: `${savedPrefix} with parent actions ready`,
      message: `${savedPrefix}. ${actionSummary} available in the Parent Portal. ${pluralize(processingCount, 'parent email')} ${processingCount === 1 ? 'is' : 'are'} being delivered.`,
    }
  }

  if (portalRecordCount === 0) {
    return {
      title: `${entity} saved, Parent Portal update failed`,
      message: `The ${entity.toLowerCase()} was saved, but it could not be added to the Parent Portal. Parents were not notified.`,
      tone: 'error',
    }
  }

  if (eligibleRecipientCount === 0) {
    return {
      title: `${savedPrefix} in the Parent Portal`,
      message: `${savedPrefix} in the Parent Portal, but no eligible parent email addresses were available.`,
      tone: 'error',
    }
  }

  if (deliveredCount > 0 && failedCount > 0) {
    return {
      title: `${savedPrefix} with partial email delivery`,
      message: `${savedPrefix} in the Parent Portal. ${pluralize(deliveredCount, 'email')} ${deliveredCount === 1 ? 'was' : 'were'} sent and ${failedCount} could not be sent.`,
      tone: 'error',
    }
  }

  if (duplicateCount > 0 && deliveredCount > 0 && failedCount === 0) {
    return {
      title: `${savedPrefix} in the Parent Portal`,
      message: `${savedPrefix} in the Parent Portal. The previous email delivery is confirmed and no duplicate email was sent.`,
    }
  }

  if (failedCount > 0 && processingCount === 0) {
    return {
      title: `${savedPrefix} in the Parent Portal`,
      message: `${savedPrefix} in the Parent Portal, but the parent emails could not be sent. Please try again.`,
      tone: 'error',
    }
  }

  if (deliveredCount > 0) {
    return {
      title: `${savedPrefix} and parent emails sent`,
      message: `${savedPrefix} and ${pluralize(deliveredCount, 'parent email')} sent.`,
    }
  }

  if (processingCount > 0) {
    return {
      title: `${savedPrefix} in the Parent Portal`,
      message: `${savedPrefix} in the Parent Portal. ${pluralize(processingCount, 'parent email')} ${processingCount === 1 ? 'is' : 'are'} being delivered.`,
    }
  }

  return {
    title: `${savedPrefix} in the Parent Portal`,
    message: `${savedPrefix} in the Parent Portal, but the parent emails could not be sent. Please try again.`,
    tone: 'error',
  }
}
