import { readFile } from 'node:fs/promises'
const source = await readFile(new URL('../supabase/migrations/20261005085925_mobile_attendance_durable_commands.sql', import.meta.url), 'utf8')
const first = "-- BEGIN REVIEWED ATTENDANCE COMMAND CONTRACT"
const second = "-- BEGIN REVIEWED LEGACY INTENT CONTRACT"
const end = "-- END REVIEWED ATTENDANCE CONTRACTS"
if (!(source.indexOf(first) < source.indexOf(second) && source.indexOf(second) < source.indexOf(end))) throw new Error('Attendance migration contract order is invalid')
export const commandSql = source.slice(source.indexOf(first) + first.length + 1, source.indexOf(second)).trimEnd() + '\n'
export const intentSql = source.slice(source.indexOf(second) + second.length + 1, source.indexOf(end)).trimEnd() + '\n'
export const transactionSql = source
