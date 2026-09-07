import { deliverCoachMatchDayCommands } from './lib/_coach-match-day-command-notifications.js'

export default async () => Response.json(await deliverCoachMatchDayCommands())
export const config = { schedule: '* * * * *' }
