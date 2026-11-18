export function getCoachOfflineFormationView(resources, context, { matchId = '', boardId = '' } = {}) {
  if (!Array.isArray(resources?.formations) || !Array.isArray(resources?.formationPresets)) return null
  const boards = resources.formations.filter(board => board.clubId === context.clubId && board.teamId === context.teamId)
  const board = boardId ? boards.find(item => item.id === boardId && (!matchId || item.linkedMatchDayId === matchId))
    : matchId ? boards.find(item => item.linkedMatchDayId === matchId) : boards[0]
  return { boards, board: board || null, presets: resources.formationPresets,
    publications: (resources.formationPublications || []).filter(item => boards.some(candidate => candidate.id === item.board_id)) }
}
