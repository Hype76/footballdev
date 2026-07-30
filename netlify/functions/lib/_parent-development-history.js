import { createDevelopmentOutputKey, createDevelopmentOutputQueueId } from './_development-parent-email-output.js'
import {
  normalizeDevelopmentScorePresentation,
} from '../../../src/lib/development-score-contract.js'

const VISIBLE_COMMUNICATION_ACTIONS = new Set([
  'parent_email_scheduled',
  'parent_email_sent',
])

export class ParentDevelopmentHistoryError extends Error {
  constructor(message, status = 403, code = 'PARENT_DEVELOPMENT_NOT_AVAILABLE') {
    super(message)
    this.code = code
    this.status = status
  }
}

function normalizeText(value) {
  return String(value ?? '').trim()
}

function normalizeDate(value) {
  const normalizedValue = normalizeText(value)
  const parsedDate = new Date(normalizedValue)

  return normalizedValue && !Number.isNaN(parsedDate.getTime())
    ? parsedDate.toISOString()
    : ''
}

function normalizeScore(value) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : null
}

function normalizeResponseItem(item = {}) {
  if (item.parentVisible === false || item.selected === false) {
    return null
  }

  const label = normalizeText(item.label)
  const scorePresentation = normalizeDevelopmentScorePresentation(item)
  const displayValue = scorePresentation.displayValue ||
    normalizeText(item.displayValue ?? item.value)

  if (!label || !displayValue) {
    return null
  }

  return {
    fieldId: normalizeText(item.fieldId),
    label,
    type: scorePresentation.type,
    displayValue,
    numericScore: scorePresentation.numericScore,
    maxScore: scorePresentation.maxScore,
    ratingLabel: scorePresentation.ratingLabel,
    order: Number(item.order) || 0,
  }
}

function normalizeChartPoint(point = {}) {
  const label = normalizeText(point.label)
  const value = normalizeScore(point.value)

  return label && value !== null ? { label, value } : null
}

function normalizeSection(section = {}) {
  const title = normalizeText(section.title)
  const body = normalizeText(section.body)
  const chartPoints = (Array.isArray(section.chartPoints) ? section.chartPoints : [])
    .map(normalizeChartPoint)
    .filter(Boolean)

  if (!title || (!body && chartPoints.length < 2)) {
    return null
  }

  return {
    key: normalizeText(section.key),
    title,
    body,
    chartPoints,
  }
}

function getSnapshotRecipients(snapshot = {}) {
  return Array.isArray(snapshot.recipients) ? snapshot.recipients : []
}

function isSnapshotForParentLink(snapshot, parentLink) {
  const clubId = normalizeText(snapshot?.club?.id)
  const teamId = normalizeText(snapshot?.team?.id)
  const playerId = normalizeText(snapshot?.player?.id)

  return clubId === normalizeText(parentLink.club_id)
    && playerId === normalizeText(parentLink.player_id)
    && (!normalizeText(parentLink.team_id) || teamId === normalizeText(parentLink.team_id))
    && getSnapshotRecipients(snapshot).some(
      (recipient) => normalizeText(recipient?.linkId) === normalizeText(parentLink.id),
    )
}

function getCommunicationEvidence({
  communicationLogs,
  evaluationId,
  outputKey,
  parentLinkId,
} = {}) {
  return (Array.isArray(communicationLogs) ? communicationLogs : [])
    .filter((log) => normalizeText(log.evaluation_id) === evaluationId)
    .filter((log) => normalizeText(log.channel) === 'email')
    .filter((log) => VISIBLE_COMMUNICATION_ACTIONS.has(normalizeText(log.action)))
    .filter((log) => normalizeText(log.metadata?.recipientLinkId) === parentLinkId)
    .filter((log) => normalizeText(log.metadata?.developmentOutputKey) === outputKey)
}

function resolveDeliveryState({ communicationEvidence, queue } = {}) {
  const sentLog = communicationEvidence.find(
    (log) => normalizeText(log.action) === 'parent_email_sent',
  )

  if (sentLog) {
    return {
      deliveryState: 'sent',
      deliveryLabel: 'Sent',
      deliveredAt: normalizeDate(sentLog.created_at),
    }
  }

  if (!communicationEvidence.some(
    (log) => normalizeText(log.action) === 'parent_email_scheduled',
  )) {
    return null
  }

  if (normalizeText(queue?.status) === 'failed') {
    return {
      deliveryState: 'failed',
      deliveryLabel: 'Delivery failed',
      deliveredAt: '',
    }
  }

  if (!queue) {
    return {
      deliveryState: 'unknown',
      deliveryLabel: 'Delivery status unavailable',
      deliveredAt: '',
    }
  }

  return {
    deliveryState: 'scheduled',
    deliveryLabel: 'Scheduled',
    deliveredAt: '',
  }
}

function normalizeReport({
  communicationEvidence,
  delivery,
  reportRow,
} = {}) {
  const snapshot = reportRow.report_snapshot
  const responseItems = (Array.isArray(snapshot.responseItems) ? snapshot.responseItems : [])
    .map(normalizeResponseItem)
    .filter(Boolean)
    .sort((left, right) => left.order - right.order)
  const sections = (Array.isArray(snapshot.emailSections) ? snapshot.emailSections : [])
    .map(normalizeSection)
    .filter(Boolean)
  const pdfAttached = communicationEvidence.some(
    (log) => log.metadata?.hasAttachment === true,
  )

  return {
    id: normalizeText(snapshot.evaluationId || reportRow.evaluation_id),
    finalizedAt: normalizeDate(reportRow.finalized_at || snapshot.finalizedAt),
    recordDate: normalizeText(snapshot.recordDate),
    club: {
      id: normalizeText(snapshot.club?.id),
      name: normalizeText(snapshot.club?.name),
    },
    team: {
      id: normalizeText(snapshot.team?.id),
      name: normalizeText(snapshot.team?.name),
    },
    player: {
      id: normalizeText(snapshot.player?.id),
      name: normalizeText(snapshot.player?.name),
    },
    author: {
      name: normalizeText(snapshot.author?.name),
    },
    section: normalizeText(snapshot.section) || 'Development',
    form: {
      id: normalizeText(snapshot.form?.id),
      name: normalizeText(snapshot.form?.name) || 'Development report',
      version: Number(snapshot.form?.version) || null,
      templateKey: normalizeText(snapshot.form?.templateKey),
    },
    overallScore: normalizeScore(snapshot.overallScore),
    overallMaxScore: normalizeScore(snapshot.overallMaxScore) ||
      responseItems.find((item) => item.maxScore)?.maxScore ||
      10,
    attendanceIncluded: snapshot.attendanceIncluded === true,
    progressionIncluded: snapshot.progressionIncluded === true,
    responseItems,
    sections,
    deliveryState: delivery.deliveryState,
    deliveryLabel: delivery.deliveryLabel,
    deliveredAt: delivery.deliveredAt,
    pdfState: pdfAttached ? 'attached' : 'not_requested',
    pdfLabel: pdfAttached ? 'PDF attached' : 'No PDF requested',
    canDownloadPdf: pdfAttached,
  }
}

export function validateParentDevelopmentScope({
  authUserId,
  parentLink,
  player,
} = {}) {
  const unavailableMessage = 'Development history is not available for the selected child.'

  if (
    !normalizeText(authUserId)
    || !parentLink
    || normalizeText(parentLink.auth_user_id) !== normalizeText(authUserId)
    || normalizeText(parentLink.status) !== 'active'
  ) {
    throw new ParentDevelopmentHistoryError(unavailableMessage)
  }

  if (
    !player
    || normalizeText(player.id) !== normalizeText(parentLink.player_id)
    || normalizeText(player.club_id) !== normalizeText(parentLink.club_id)
    || normalizeText(player.status || 'active') === 'archived'
    || player.archived_at
  ) {
    throw new ParentDevelopmentHistoryError(unavailableMessage)
  }

  if (
    normalizeText(parentLink.team_id)
    && normalizeText(player.team_id) !== normalizeText(parentLink.team_id)
  ) {
    throw new ParentDevelopmentHistoryError(unavailableMessage)
  }

  return true
}

export function buildParentDevelopmentHistory({
  communicationLogs = [],
  parentLink,
  queues = [],
  reportRows = [],
} = {}) {
  const parentLinkId = normalizeText(parentLink?.id)
  const queueById = new Map(
    queues.map((queue) => [normalizeText(queue.id), queue]),
  )

  return reportRows
    .filter((reportRow) => reportRow?.report_snapshot)
    .filter((reportRow) => isSnapshotForParentLink(reportRow.report_snapshot, parentLink))
    .map((reportRow) => {
      const evaluationId = normalizeText(
        reportRow.report_snapshot.evaluationId || reportRow.evaluation_id,
      )
      const outputKey = createDevelopmentOutputKey(evaluationId, parentLinkId)
      const communicationEvidence = getCommunicationEvidence({
        communicationLogs,
        evaluationId,
        outputKey,
        parentLinkId,
      })
      const queue = queueById.get(createDevelopmentOutputQueueId(outputKey))
      const delivery = resolveDeliveryState({ communicationEvidence, queue })

      return delivery
        ? normalizeReport({
            communicationEvidence,
            delivery,
            reportRow,
          })
        : null
    })
    .filter(Boolean)
    .sort((left, right) => {
      const leftDate = Date.parse(left.recordDate || left.finalizedAt) || 0
      const rightDate = Date.parse(right.recordDate || right.finalizedAt) || 0
      return rightDate - leftDate
    })
}

export function getParentDevelopmentReport(history, reportId) {
  const normalizedReportId = normalizeText(reportId)
  const report = (Array.isArray(history) ? history : [])
    .find((item) => normalizeText(item.id) === normalizedReportId)

  if (!report) {
    throw new ParentDevelopmentHistoryError(
      'This Development report is not available for the selected child.',
      404,
      'PARENT_DEVELOPMENT_REPORT_NOT_FOUND',
    )
  }

  return report
}
