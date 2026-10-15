// Returning accounts can pay for their new club, but cannot reclaim orphaned old payments.
export async function isReturningCoachSignupActor(db, actorId) {
  const { data, error } = await db.rpc('is_returning_coach_signup_actor', { p_actor: actorId })
  if (error) throw error
  if (typeof data !== 'boolean') throw new Error('Account billing history could not be checked safely.')
  return data
}
