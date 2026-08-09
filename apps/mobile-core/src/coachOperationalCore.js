export const COACH_OPERATIONAL_BACKEND_DELTAS = Object.freeze([
  Object.freeze({ category: 'B', capability: 'Calendar reads and writes', decision: 'Reuse canonical calendar_events, Match Day, assessment_sessions, training availability, RLS, and feature gates.' }),
  Object.freeze({ category: 'B', capability: 'Parent event scope', decision: 'Reuse sync_calendar_event_parent_scope_v2. External notification delivery remains disabled.' }),
  Object.freeze({ category: 'B', capability: 'Player reads and writes', decision: 'Reuse get_team_players, players, evaluations, form_fields, server plan enforcement, and RLS.' }),
  Object.freeze({ category: 'B', capability: 'Session reads and writes', decision: 'Reuse assessment_sessions, assessment_session_players, completion authority, and RLS.' }),
  Object.freeze({ category: 'C', capability: 'Separate Session attendance status', decision: 'Unnecessary because the authoritative model records roster inclusion, Player notes, Development links, and completion.' }),
  Object.freeze({ category: 'D', capability: 'Production communication delivery', decision: 'Intentionally omitted from test-only Coach mobile. No external email, push, or schedule is created.' }),
  Object.freeze({ category: 'E', capability: 'Player archive, restore, Team transfer, and hard delete', decision: 'Web-only due retention, membership history, family-link revocation, limits, confirmation, and audit governance.' }),
  Object.freeze({ category: 'E', capability: 'Session deletion', decision: 'Web-only because the canonical workflow checks linked Development records before choosing cancellation or deletion.' }),
])
