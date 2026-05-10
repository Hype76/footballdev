export const DEMO_MUTATION_ERROR_MESSAGE = 'Demo accounts cannot save changes.'
export const STAFF_VOICE_NOTES_BUCKET = 'staff-voice-notes'

export const USER_PROFILE_SELECT = [
  'id',
  'email',
  'username',
  'name',
  'role',
  'role_label',
  'role_rank',
  'club_id',
  'status',
  'suspended_at',
  'force_password_change',
  'theme_mode',
  'theme_accent',
  'display_name',
  'team_name',
  'club_name',
  'reply_to_email',
].join(', ')

export const CLUB_SELECT = 'id, name, logo_url, contact_email, contact_phone, require_approval, status, suspended_at, plan_key, plan_status, is_plan_comped, stripe_customer_id, stripe_subscription_id, stripe_price_id, current_period_end, plan_updated_at, tester_access_code_id, tester_access_code, tester_access_email, tester_access_redeemed_at, tester_access_expires_at'
export const MEMBERSHIP_CLUB_SELECT = '*, clubs:club_id (name, logo_url, contact_email, contact_phone, require_approval, status, suspended_at, plan_key, plan_status, is_plan_comped, stripe_customer_id, stripe_subscription_id, stripe_price_id, current_period_end, plan_updated_at, tester_access_code_id, tester_access_code, tester_access_email, tester_access_redeemed_at, tester_access_expires_at)'
