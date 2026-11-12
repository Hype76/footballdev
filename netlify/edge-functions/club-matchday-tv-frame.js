export const config = { path: '/club-matchday-tv/embed/*' }

export default async function clubMatchdayTvFrame(request, context) {
  if (new URL(request.url).hostname !== 'v1.fpmd.online') return

  const response = await context.next()
  const headers = new Headers(response.headers)
  const policy = headers.get('Content-Security-Policy')
  if (response.status !== 200 || !headers.get('Content-Type')?.startsWith('text/html')
    || !policy || !/(^|;\s*)frame-ancestors 'none'(?=;|$)/.test(policy)) return response

  headers.set('Content-Security-Policy', policy.replace("frame-ancestors 'none'", 'frame-ancestors https://fpmd.online'))
  headers.delete('X-Frame-Options')
  headers.set('Cache-Control', 'no-store')
  return new Response(response.body, { status: response.status, headers })
}
