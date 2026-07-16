function normalizeId(value) {
  return String(value ?? '').trim()
}

function normalizeSection(value) {
  return String(value ?? '').trim().toLowerCase()
}

function uniqueIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(normalizeId).filter(Boolean))]
}

export function getWholeSquadScopePlayerIds(invitePlayers = [], { includeTrialPlayers = false } = {}) {
  return uniqueIds((Array.isArray(invitePlayers) ? invitePlayers : [])
    .filter((player) => {
      const section = normalizeSection(player?.section)
      return section === 'squad' || (includeTrialPlayers && section === 'trial')
    })
    .map((player) => player?.id))
}

export function getWholeSquadSelectionState({
  includeTrialPlayers = false,
  invitePlayers = [],
  selectedPlayerIds = [],
} = {}) {
  const scopeIds = getWholeSquadScopePlayerIds(invitePlayers, { includeTrialPlayers })
  const selectedIds = new Set(uniqueIds(selectedPlayerIds))
  const selectedScopeCount = scopeIds.filter((playerId) => selectedIds.has(playerId)).length

  return {
    checked: scopeIds.length > 0 && selectedScopeCount === scopeIds.length,
    indeterminate: selectedScopeCount > 0 && selectedScopeCount < scopeIds.length,
    scopeCount: scopeIds.length,
    selectedScopeCount,
  }
}

export function applyWholeSquadSelection({
  checked,
  includeTrialPlayers = false,
  invitePlayers = [],
} = {}) {
  if (checked) {
    return getWholeSquadScopePlayerIds(invitePlayers, { includeTrialPlayers })
  }

  return includeTrialPlayers
    ? getWholeSquadScopePlayerIds(invitePlayers, { includeTrialPlayers: true })
      .filter((playerId) => {
        const player = invitePlayers.find((candidate) => normalizeId(candidate?.id) === playerId)
        return normalizeSection(player?.section) === 'trial'
      })
    : []
}

export function applyTrialPlayerSelection({
  checked,
  invitePlayers = [],
  selectedPlayerIds = [],
  wholeSquadSelected = false,
} = {}) {
  const selectedIds = new Set(uniqueIds(selectedPlayerIds))
  const trialIds = getWholeSquadScopePlayerIds(invitePlayers, { includeTrialPlayers: true })
    .filter((playerId) => {
      const player = invitePlayers.find((candidate) => normalizeId(candidate?.id) === playerId)
      return normalizeSection(player?.section) === 'trial'
    })

  trialIds.forEach((playerId) => {
    if (checked) {
      selectedIds.add(playerId)
    } else {
      selectedIds.delete(playerId)
    }
  })

  if (wholeSquadSelected) {
    getWholeSquadScopePlayerIds(invitePlayers, { includeTrialPlayers: checked })
      .forEach((playerId) => selectedIds.add(playerId))
  }

  return [...selectedIds]
}

export function getSelectedInvitePlayers(invitePlayers = [], selectedPlayerIds = []) {
  const selectedIds = new Set(uniqueIds(selectedPlayerIds))
  return (Array.isArray(invitePlayers) ? invitePlayers : [])
    .filter((player) => selectedIds.has(normalizeId(player?.id)))
}
