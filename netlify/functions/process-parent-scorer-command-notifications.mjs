import { deliverParentScorerCommands } from './lib/_parent-scorer-command-notifications.js'

export default async () => Response.json(await deliverParentScorerCommands())
export const config = { schedule: '* * * * *' }
