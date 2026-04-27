import { getClubSettings, normalizeParentContacts } from '../../lib/supabase.js'

export function buildEvaluationSummary(evaluation, mode = 'scored') {
  if (mode === 'email') {
    return (
      evaluation.comments?.overall ||
      evaluation.comments?.strengths ||
      evaluation.comments?.improvements ||
      'No written summary provided.'
    )
  }

  const responseEntries = Object.entries(evaluation.formResponses ?? {})

  if (responseEntries.length > 0) {
    return responseEntries
      .slice(0, 4)
      .map(([label, value]) => `${label}: ${value}`)
      .join(', ')
  }

  return (
    evaluation.comments?.overall ||
    evaluation.comments?.strengths ||
    evaluation.comments?.improvements ||
    'No written summary provided.'
  )
}

export function formatTrendDate(evaluation) {
  if (evaluation.date) {
    return evaluation.date
  }

  return evaluation.createdAt ? new Date(evaluation.createdAt).toLocaleDateString() : 'No date entered'
}

export function buildRatingTrend(evaluations) {
  return [...evaluations]
    .filter((evaluation) => evaluation.averageScore !== null)
    .sort((left, right) => left.createdAt - right.createdAt)
}

export function buildFieldMovement(evaluations) {
  const chronologicalEvaluations = [...evaluations].sort((left, right) => left.createdAt - right.createdAt)
  const fieldValues = new Map()

  chronologicalEvaluations.forEach((evaluation) => {
    Object.entries(evaluation.formResponses ?? {}).forEach(([label, value]) => {
      const numericValue = Number(value)

      if (Number.isNaN(numericValue)) {
        return
      }

      if (!fieldValues.has(label)) {
        fieldValues.set(label, [])
      }

      fieldValues.get(label).push(numericValue)
    })
  })

  return Array.from(fieldValues.entries())
    .map(([label, values]) => {
      const firstValue = values[0]
      const latestValue = values[values.length - 1]

      return {
        label,
        firstValue,
        latestValue,
        change: latestValue - firstValue,
      }
    })
    .filter((item) => item.firstValue !== undefined && item.latestValue !== undefined)
}

export async function getLatestClubLogoUrl(user) {
  if (!user?.clubId) {
    return user?.clubLogoUrl || ''
  }

  try {
    const clubSettings = await getClubSettings(user.clubId)
    return clubSettings.logoUrl || user.clubLogoUrl || ''
  } catch (error) {
    console.error(error)
    return user.clubLogoUrl || ''
  }
}

export function getEditableParentContacts(player) {
  const contacts = normalizeParentContacts(player?.parentContacts, {
    parentName: player?.parentName,
    parentEmail: player?.parentEmail,
  })

  return contacts.length > 0 ? contacts : [{ name: '', email: '' }]
}

export function createPlayerDraft(player) {
  return {
    ...player,
    parentContacts: getEditableParentContacts(player),
  }
}
