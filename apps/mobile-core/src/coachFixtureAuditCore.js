export async function settleCoachFixtureAudit(auditPromise, eventLogPromise) {
  const results = await Promise.allSettled([
    auditPromise,
    eventLogPromise.then(({ error }) => { if (error) throw error }),
  ])
  return results.some(result => result.status === 'rejected')
    ? 'Fixture created, but its activity record could not be confirmed.' : ''
}
