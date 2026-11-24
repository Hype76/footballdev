import { deliverParentScorerCommands } from './lib/_parent-scorer-command-notifications.js'
import { deliverShootoutNotifications } from './lib/_match-day-shootout-notifications.js'

export default async () => {
  const [commands, shootout] = await Promise.all([deliverParentScorerCommands(), deliverShootoutNotifications()])
  return Response.json({ ...commands, shootout })
}
export const config = { schedule: '* * * * *' }
