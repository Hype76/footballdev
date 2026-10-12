export async function deliverCoachMatchReviewOnce({ client, match, actorUserId, review }) {
  const { data: claim, error } = await client.rpc('claim_match_day_review_push_operation', {
    match_day_id_value: match.id, actor_user_id_value: actorUserId,
  })
  if (error) throw error
  if (['completed', 'obsolete'].includes(claim?.status)) return { sent: 0, failed: 0, skipped: true }
  if (claim?.status !== 'claimed' || !claim.operationKey) throw new Error('Coach review delivery is still being confirmed. It will be retried.')
  const complete = async (succeeded, message = '') => {
    const { error } = await client.rpc('complete_match_day_push_operation', {
      operation_key_value: claim.operationKey, succeeded_value: succeeded, error_message_value: message,
    })
    if (error) throw error
  }
  try {
    review ||= (await import('../send-coach-mobile-push.js')).sendCoachMatchReviewPush
    const result = await review({ match, adminClient: client, operationKey: claim.operationKey })
    if (result.failed) throw new Error('The Coach review notification was not accepted. Delivery will be retried.')
    await complete(true)
    return result
  } catch (error) {
    await complete(false, error.message || 'Coach review delivery failed.')
    throw error
  }
}
