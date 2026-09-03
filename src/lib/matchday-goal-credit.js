export function oppositeMatchSide(side) {
  return side === 'opponent' ? 'club' : 'opponent'
}

export function getGoalScorerSide(goal = {}) {
  const side = goal.teamSide === 'opponent' ? 'opponent' : 'club'
  return goal.isOwnGoal ? oppositeMatchSide(side) : side
}

export function setGoalOwnGoal(goal = {}, isOwnGoal) {
  const nextOwnGoal = isOwnGoal === true
  return {
    ...goal,
    isOwnGoal: nextOwnGoal,
    teamSide: Boolean(goal.isOwnGoal) === nextOwnGoal ? (goal.teamSide || 'club') : oppositeMatchSide(goal.teamSide),
    assistName: nextOwnGoal ? '' : (goal.assistName || ''),
    assistShirtNumber: nextOwnGoal ? '' : (goal.assistShirtNumber || ''),
    isPenaltyGoal: nextOwnGoal ? false : goal.isPenaltyGoal === true,
  }
}
