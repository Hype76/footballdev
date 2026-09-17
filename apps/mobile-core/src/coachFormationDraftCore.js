import { createMobileFormationDraft } from './coachFormationBoardCore.js'

const text = (value) => String(value ?? '').trim()

export function formationDraftKey(boardId = '', matchId = '') {
  return boardId ? `board:${boardId}` : matchId ? `match:${matchId}` : 'standalone:new'
}

// Compare the editable content, not transport version numbers or object key order.
export function formationContentKey(draft, title) {
  const player = (item) => [item.playerId, item.displayName, text(item.shirtNumber)]
  const unplaced = Array.isArray(draft?.unplaced)
    ? draft.unplaced
    : (draft?.bench || []).filter((item) => item?.state === 'unplaced')
  return JSON.stringify([
    text(title), draft?.gameFormat, draft?.presetKey, Number(draft?.registryVersion || 1),
    (draft?.placements || []).map((item) => [...player(item), item.slotId || '', item.positionGroup || '', Number(item.x), Number(item.y)]).sort(),
    (draft?.bench || []).map(player).sort(),
    unplaced.map(player).sort(),
  ])
}

export function formationMatchesBoard(draft, title, board) {
  return Boolean(board && formationContentKey(draft, title) === formationContentKey(createMobileFormationDraft({ board }), board.title))
}

export function getFormationSaveLabel({ board, dirty, localState, publication }) {
  if (dirty) return localState === 'saved' ? 'Saved on this device' : localState === 'failed' ? 'Not saved on this device' : 'Unsaved changes'
  if (!board) return 'Not saved'
  if (!publication) return 'Saved to team'
  const publishedVersion = publication.board_version_id ?? publication.boardVersionId
  return publishedVersion === board.currentVersionId ? 'Published to Parents' : 'Parent update needed'
}

export function findFormationLocalDraft(formation, matchId = '', boardId = '') {
  const entries = Object.entries(formation?.localDrafts || {})
  if (boardId) return entries.find(([key]) => key === formationDraftKey(boardId)) || null
  const candidates = entries.filter(([, entry]) => text(entry.matchDayId) === text(matchId))
  return candidates.sort((a, b) => text(b[1].savedAt).localeCompare(text(a[1].savedAt)))[0] || null
}

export function updateFormationLocalDraft(formation, key, entry) {
  const localDrafts = { ...(formation?.localDrafts || {}) }
  if (entry) localDrafts[key] = entry
  else delete localDrafts[key]
  return { ...(formation || {}), localDrafts }
}

// A withdrawn newest publication must not revive an older shared version.
export function getActiveFormationPublication(publications = [], matchId = '') {
  const latest = publications
    .filter((item) => !matchId || text(item.match_day_id ?? item.matchDayId) === text(matchId))
    .slice()
    .sort((a, b) => Number(b.publication_number ?? b.publicationNumber ?? 0) - Number(a.publication_number ?? a.publicationNumber ?? 0))[0]
  return latest && !(latest.withdrawn_at ?? latest.withdrawnAt) ? latest : null
}
