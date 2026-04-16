const EVALUATIONS_STORAGE_KEY = 'evaluations'

export const players = [
  { id: 'leo-martins', name: 'Leo Martins', ageGroup: 'U21', position: 'Winger', team: 'First Team' },
  { id: 'ibrahim-sesay', name: 'Ibrahim Sesay', ageGroup: 'U19', position: 'Centre Back', team: 'U19' },
  { id: 'noah-fletcher', name: 'Noah Fletcher', ageGroup: 'U23', position: 'Central Midfielder', team: 'U23' },
  { id: 'tariq-bennett', name: 'Tariq Bennett', ageGroup: 'U21', position: 'Full Back', team: 'U21' },
  { id: 'marco-silva', name: 'Marco Silva', ageGroup: 'U23', position: 'Attacking Midfielder', team: 'U23' },
  { id: 'samir-kone', name: 'Samir Kone', ageGroup: 'U21', position: 'Holding Midfielder', team: 'U21' },
  { id: 'ryan-doyle', name: 'Ryan Doyle', ageGroup: 'U23', position: 'Striker', team: 'First Team' },
]

export const evaluations = [
  {
    id: 'eval-001',
    playerId: 'leo-martins',
    playerName: 'Leo Martins',
    team: 'First Team',
    session: 'Saturday Trial - 8th April',
    coach: 'Daniel Foster',
    parentEmail: 'parent.leo@example.com',
    date: '08 Apr 2026',
    scores: { technical: 8.5, tactical: 8.1, physical: 8.6 },
    comments: 'Direct runner with strong one v one ability and improved final delivery in the last month.',
    decision: 'Yes',
    status: 'Approved',
  },
  {
    id: 'eval-002',
    playerId: 'leo-martins',
    playerName: 'Leo Martins',
    team: 'First Team',
    session: 'Development Match - 14th March',
    coach: 'Daniel Foster',
    parentEmail: 'parent.leo@example.com',
    date: '14 Mar 2026',
    scores: { technical: 8.2, tactical: 7.9, physical: 8.4 },
    comments: 'Very dangerous in transition. Needs more consistency when tracking the full back.',
    decision: 'Progress',
    status: 'Pending',
  },
  {
    id: 'eval-003',
    playerId: 'ibrahim-sesay',
    playerName: 'Ibrahim Sesay',
    team: 'U19',
    session: 'Saturday Trial - 7th April',
    coach: 'Maya Sutton',
    parentEmail: 'parent.ibrahim@example.com',
    date: '07 Apr 2026',
    scores: { technical: 7.6, tactical: 8.0, physical: 8.2 },
    comments: 'Strong duel defender who reads second balls well. Passing under pressure can still improve.',
    decision: 'Progress',
    status: 'Pending',
  },
  {
    id: 'eval-004',
    playerId: 'ibrahim-sesay',
    playerName: 'Ibrahim Sesay',
    team: 'U19',
    session: 'Training Block Review - 22nd March',
    coach: 'Maya Sutton',
    parentEmail: 'parent.ibrahim@example.com',
    date: '22 Mar 2026',
    scores: { technical: 7.4, tactical: 7.8, physical: 8.1 },
    comments: 'Reliable defender over ninety minutes with good recovery pace.',
    decision: 'Yes',
    status: 'Approved',
  },
  {
    id: 'eval-005',
    playerId: 'noah-fletcher',
    playerName: 'Noah Fletcher',
    team: 'U23',
    session: 'Transition Game - 6th April',
    coach: 'Chris Walton',
    parentEmail: 'parent.noah@example.com',
    date: '06 Apr 2026',
    scores: { technical: 8.0, tactical: 8.4, physical: 7.9 },
    comments: 'Connects play well and scans early. Can be more aggressive in final third actions.',
    decision: 'Yes',
    status: 'Approved',
  },
  {
    id: 'eval-006',
    playerId: 'noah-fletcher',
    playerName: 'Noah Fletcher',
    team: 'U23',
    session: 'Midfield Circuit - 18th March',
    coach: 'Chris Walton',
    parentEmail: 'parent.noah@example.com',
    date: '18 Mar 2026',
    scores: { technical: 7.8, tactical: 8.2, physical: 7.7 },
    comments: 'Good tempo setter with consistent positioning between lines.',
    decision: 'Progress',
    status: 'Approved',
  },
  {
    id: 'eval-007',
    playerId: 'tariq-bennett',
    playerName: 'Tariq Bennett',
    team: 'U21',
    session: 'Wide Play Trial - 5th April',
    coach: 'Jordan Price',
    parentEmail: 'parent.tariq@example.com',
    date: '05 Apr 2026',
    scores: { technical: 7.4, tactical: 7.8, physical: 8.1 },
    comments: 'Energetic runner with strong overlap timing. Cross quality is mixed.',
    decision: 'Progress',
    status: 'Pending',
  },
  {
    id: 'eval-008',
    playerId: 'tariq-bennett',
    playerName: 'Tariq Bennett',
    team: 'U21',
    session: 'Match Review - 12th March',
    coach: 'Jordan Price',
    parentEmail: 'parent.tariq@example.com',
    date: '12 Mar 2026',
    scores: { technical: 7.2, tactical: 7.5, physical: 8.0 },
    comments: 'Reliable engine and strong repeat sprint output across the match.',
    decision: 'No',
    status: 'Rejected',
  },
  {
    id: 'eval-009',
    playerId: 'marco-silva',
    playerName: 'Marco Silva',
    team: 'U23',
    session: 'Final Third Assessment - 4th April',
    coach: 'Elena Hughes',
    parentEmail: 'parent.marco@example.com',
    date: '04 Apr 2026',
    scores: { technical: 8.8, tactical: 8.5, physical: 8.6 },
    comments: 'Creative final third player with elite receiving quality and good game rhythm control.',
    decision: 'Yes',
    status: 'Approved',
  },
  {
    id: 'eval-010',
    playerId: 'marco-silva',
    playerName: 'Marco Silva',
    team: 'U23',
    session: 'Creative Play Review - 20th March',
    coach: 'Elena Hughes',
    parentEmail: 'parent.marco@example.com',
    date: '20 Mar 2026',
    scores: { technical: 8.6, tactical: 8.2, physical: 8.3 },
    comments: 'Consistently creates chances and combines well around the box.',
    decision: 'Yes',
    status: 'Approved',
  },
  {
    id: 'eval-011',
    playerId: 'samir-kone',
    playerName: 'Samir Kone',
    team: 'U21',
    session: 'Midfield Screen Trial - 3rd April',
    coach: 'Liam Cooper',
    parentEmail: 'parent.samir@example.com',
    date: '03 Apr 2026',
    scores: { technical: 7.7, tactical: 8.0, physical: 7.8 },
    comments: 'Good balance player who protects space well and gives structure in possession.',
    decision: 'Progress',
    status: 'Pending',
  },
  {
    id: 'eval-012',
    playerId: 'samir-kone',
    playerName: 'Samir Kone',
    team: 'U21',
    session: 'Possession Review - 11th March',
    coach: 'Liam Cooper',
    parentEmail: 'parent.samir@example.com',
    date: '11 Mar 2026',
    scores: { technical: 7.5, tactical: 7.9, physical: 7.7 },
    comments: 'Positionally sound and secure in short passing combinations.',
    decision: 'Yes',
    status: 'Approved',
  },
  {
    id: 'eval-013',
    playerId: 'ryan-doyle',
    playerName: 'Ryan Doyle',
    team: 'First Team',
    session: 'Finishing Session - 2nd April',
    coach: 'Daniel Foster',
    parentEmail: 'parent.ryan@example.com',
    date: '02 Apr 2026',
    scores: { technical: 8.0, tactical: 7.8, physical: 8.2 },
    comments: 'Sharp movement in the box with strong finishing mechanics off both feet.',
    decision: 'Yes',
    status: 'Approved',
  },
  {
    id: 'eval-014',
    playerId: 'ryan-doyle',
    playerName: 'Ryan Doyle',
    team: 'First Team',
    session: 'Box Movement Review - 15th March',
    coach: 'Daniel Foster',
    parentEmail: 'parent.ryan@example.com',
    date: '15 Mar 2026',
    scores: { technical: 7.8, tactical: 7.6, physical: 8.1 },
    comments: 'Can stretch the line and attack crosses with conviction.',
    decision: 'Progress',
    status: 'Pending',
  },
]

export function getPlayers() {
  return players
}

export function getEvaluations() {
  return evaluations
}

export function getPlayerById(id) {
  return players.find((player) => player.id === id)
}

export function getEvaluationsByPlayer(id) {
  return evaluations.filter((evaluation) => evaluation.playerId === id)
}

export function getSavedEvaluations() {
  try {
    const savedEvaluations = JSON.parse(localStorage.getItem(EVALUATIONS_STORAGE_KEY) ?? '[]')
    return Array.isArray(savedEvaluations) ? savedEvaluations : []
  } catch {
    return []
  }
}

export function saveEvaluation(evaluation) {
  const savedEvaluations = getSavedEvaluations()
  const updatedEvaluations = [...savedEvaluations, evaluation]
  localStorage.setItem(EVALUATIONS_STORAGE_KEY, JSON.stringify(updatedEvaluations))
  return updatedEvaluations
}

export function updateEvaluationStatus(id, status) {
  const savedEvaluations = getSavedEvaluations()
  const updatedEvaluations = savedEvaluations.map((evaluation) =>
    evaluation.id === id
      ? {
          ...evaluation,
          decision: evaluation.decision ?? 'Progress',
          parentEmail: evaluation.parentEmail ?? '',
          status,
        }
      : evaluation,
  )

  localStorage.setItem(EVALUATIONS_STORAGE_KEY, JSON.stringify(updatedEvaluations))
  return updatedEvaluations
}

function parseMockDate(dateString) {
  const [day, month, year] = dateString.split(' ')
  const monthMap = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
  }

  return new Date(Number(year), monthMap[month], Number(day))
}

export function compareMockDatesDesc(left, right) {
  return parseMockDate(right).getTime() - parseMockDate(left).getTime()
}

export function getEvaluationAverageScore(evaluation) {
  const scoreValues = Object.values(evaluation.scores)
  return scoreValues.reduce((sum, score) => sum + score, 0) / scoreValues.length
}

export function getEvaluationScoreList(evaluation) {
  return Object.entries(evaluation.scores).map(
    ([label, score]) => `${label.charAt(0).toUpperCase() + label.slice(1)}: ${score}`,
  )
}

export function getEvaluationScoreSummary(evaluation) {
  return getEvaluationScoreList(evaluation)
    .map((item) => item.replace(':', ''))
    .join(' | ')
}
