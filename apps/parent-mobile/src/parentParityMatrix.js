export const PARENT_PARITY_MATRIX = Object.freeze([
  { capability: 'Overview', mobileEquivalent: 'Home', read: true, write: false, childScope: 'selected child', offline: 'encrypted cache', deepLink: 'home', states: 'loading empty error stale', authority: 'Parent read models', status: 'implemented' },
  { capability: 'Calendar', mobileEquivalent: 'Calendar', read: true, write: false, childScope: 'selected child', offline: 'encrypted cache', deepLink: 'calendar', states: 'upcoming history cancelled', authority: 'get_parent_portal_shared_calendar_events', status: 'implemented' },
  { capability: 'Invites', mobileEquivalent: 'Invites', read: true, write: true, childScope: 'selected child', offline: 'read cache, writes online only', deepLink: 'invites', states: 'pending upcoming history locked', authority: 'Parent invitation RPCs', status: 'implemented' },
  { capability: 'Match cards', mobileEquivalent: 'Matchday', read: true, write: false, childScope: 'selected child', offline: 'encrypted cache', deepLink: 'matchday', states: 'scheduled live full time cancelled', authority: 'Parent Match Day RPC aggregate', status: 'implemented' },
  { capability: 'Parent Game Day', mobileEquivalent: 'Matchday detail', read: true, write: true, childScope: 'accepted Parent scorer only', offline: 'read cache, mutations online only', deepLink: 'matchday target', states: 'clock score goals shootout', authority: 'server scorer RPCs', status: 'implemented' },
  { capability: 'Results', mobileEquivalent: 'Results', read: true, write: false, childScope: 'selected child', offline: 'encrypted cache', deepLink: 'results', states: 'empty result shootout', authority: 'Parent Match Day RPC aggregate', status: 'implemented' },
  { capability: 'Development', mobileEquivalent: 'Development', read: true, write: false, childScope: 'selected child', offline: 'metadata cache, document online only', deepLink: 'development', states: 'empty available unavailable', authority: 'test API plus delivered snapshot scope', status: 'implemented' },
  { capability: 'Resources', mobileEquivalent: 'Resources', read: true, write: false, childScope: 'selected child', offline: 'metadata cache, file online only', deepLink: 'resources', states: 'empty available unavailable', authority: 'Parent resource RPC plus test access adapter', status: 'implemented' },
  { capability: 'Parent Chat', mobileEquivalent: 'Chat', read: true, write: true, childScope: 'selected child', offline: 'room history cache, mutations online only', deepLink: 'chat room', states: 'rooms empty messages send delete', authority: 'Parent Chat RPCs', status: 'implemented' },
  { capability: 'Club announcements', mobileEquivalent: 'Chat announcement room', read: true, write: false, childScope: 'selected child', offline: 'cache plus queued read receipt', deepLink: 'announcement target', states: 'read unread empty', authority: 'Parent communication RPCs', status: 'implemented' },
  { capability: 'Polls', mobileEquivalent: 'Polls', read: true, write: true, childScope: 'selected child', offline: 'cache plus idempotent queued vote', deepLink: 'poll target', states: 'open closed voted locked', authority: 'Parent poll RPCs', status: 'implemented' },
  { capability: 'Child switching', mobileEquivalent: 'Header switcher', read: true, write: false, childScope: 'active links only', offline: 'selection cached', deepLink: 'preserves authorised scope', states: 'one child multiple children removed link', authority: 'active parent_player_links', status: 'implemented' },
  { capability: 'Settings and security', mobileEquivalent: 'Settings', read: true, write: true, childScope: 'account', offline: 'device preferences only', deepLink: 'settings', states: 'biometric notifications password theme', authority: 'Supabase Auth plus device controls', status: 'implemented' },
  { capability: 'Notifications', mobileEquivalent: 'Settings and route resolver', read: true, write: true, childScope: 'installation and target validation', offline: 'local preference', deepLink: 'all Parent destinations', states: 'minimal detailed denied registered', authority: 'test push API', status: 'implemented' },
])

export function getParentParitySummary(matrix = PARENT_PARITY_MATRIX) {
  return {
    complete: matrix.every((row) => row.status === 'implemented'),
    implemented: matrix.filter((row) => row.status === 'implemented').length,
    total: matrix.length,
  }
}
