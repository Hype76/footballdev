import { supabaseAdmin } from './lib/_supabase.js'

export default async () => {
  const { error } = await supabaseAdmin.rpc('cleanup_partner_data')
  if (error) throw new Error('Partner retention cleanup failed')
}
export const config = { schedule: '15 3 * * *' }
