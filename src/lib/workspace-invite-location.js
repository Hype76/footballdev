// Keep invitation credentials in the fragment so reload and history navigation
// retain them without including them in HTTP requests or referrer URLs.
export function readWorkspaceInviteLocation(location, legacyToken = '') {
  const query = new URLSearchParams(location.search)
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ''))
  const token = query.get('token') || fragment.get('token') || legacyToken || ''

  if (!token) return { token, replacement: null }

  query.delete('token')
  fragment.set('token', token)
  const pathname = legacyToken
    ? location.pathname.replace(/\/[^/]+\/?$/, '')
    : location.pathname
  const search = query.toString() ? `?${query}` : ''
  const hash = `#${fragment}`
  const replacement = pathname !== location.pathname || search !== location.search || hash !== location.hash
    ? { pathname, search, hash }
    : null

  return { token, replacement }
}

export function clearWorkspaceInviteLocation(location, legacyToken = '') {
  const query = new URLSearchParams(location.search)
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ''))
  query.delete('token')
  fragment.delete('token')
  return {
    pathname: legacyToken ? location.pathname.replace(/\/[^/]+\/?$/, '') : location.pathname,
    search: query.toString() ? `?${query}` : '',
    hash: fragment.toString() ? `#${fragment}` : '',
  }
}
