import { supabaseAdmin } from './lib/_supabase.js'
import { createTeamBrandingManagementHandler } from './lib/_team-branding-management.js'

export const handler = createTeamBrandingManagementHandler({ client: supabaseAdmin })
