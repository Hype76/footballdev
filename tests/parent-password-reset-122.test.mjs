import assert from 'node:assert/strict'
import test from 'node:test'

process.env.VITE_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key'

test('staff Parent password reset uses authoritative account email, branding, rate limiting, and audit', async () => {
  const {
    buildParentPasswordResetEmail,
    createParentPasswordResetHandler,
  } = await import('../netlify/functions/send-parent-password-reset.js')
  const sent = []
  const audits = []
  const link = {
    id: 'link-1',
    auth_user_id: 'parent-auth-1',
    club_id: 'club-1',
    team_id: 'team-1',
    player_id: 'player-1',
    email: 'old-contact@example.test',
    status: 'active',
    players: { archived_at: null, player_name: 'Alex Example', status: 'active' },
    teams: { name: 'U14 Green' },
    clubs: {
      contact_email: 'club@example.test',
      logo_url: 'https://cdn.example.test/club.png',
      name: 'Example FC',
    },
  }
  const adminClient = {
    auth: {
      admin: {
        generateLink: async ({ email, options, type }) => {
          assert.equal(email, 'parent-account@example.test')
          assert.equal(type, 'recovery')
          assert.equal(options.redirectTo, 'https://parent.footballplayer.online/reset-password')
          return { data: { properties: { action_link: 'https://auth.example.test/recover?token=secret' } }, error: null }
        },
        getUserById: async (id) => ({
          data: { user: { email: 'parent-account@example.test', id } },
          error: null,
        }),
      },
    },
    from(table) {
      assert.equal(table, 'parent_player_links')
      const chain = {
        eq: () => chain,
        maybeSingle: async () => ({ data: link, error: null }),
        select: () => chain,
      }
      return chain
    },
    rpc: async (name, args) => {
      assert.equal(name, 'consume_password_recovery_rate_limit')
      assert.match(args.p_email_digest, /^[0-9a-f]{64}$/)
      assert.match(args.p_ip_digest, /^[0-9a-f]{64}$/)
      return { data: { allowed: true }, error: null }
    },
  }
  const handler = createParentPasswordResetHandler({
    adminClient,
    auditLogger: async (entry) => audits.push(entry),
    emailSender: async (payload) => sent.push(payload),
    logoResolver: async () => ({ url: 'https://cdn.example.test/club.png' }),
    profileLoader: async () => ({
      clubId: 'club-1',
      email: 'staff@example.test',
      id: 'staff-1',
      planKey: 'club',
      role: 'admin',
      roleRank: 100,
      teamId: 'team-1',
      activeTeamId: 'team-1',
    }),
  })

  const malformed = await handler({ httpMethod: 'POST', body: '{' })
  assert.equal(malformed.statusCode, 400)

  const response = await handler({
    body: JSON.stringify({ parentLinkId: link.id }),
    headers: { Authorization: 'Bearer test-token' },
    httpMethod: 'POST',
  })
  assert.equal(response.statusCode, 200)
  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0].to, ['parent-account@example.test'])
  assert.equal(sent[0].replyTo, 'club@example.test')
  assert.match(sent[0].subject, /Example FC Parent app password reset/)
  assert.match(sent[0].html, /Alex Example/)
  assert.match(sent[0].html, /U14 Green/)
  assert.match(sent[0].html, /Reset password/)
  assert.doesNotMatch(response.body, /secret|parent-account@example\.test/)
  assert.equal(audits[0].action, 'parent_password_reset_sent')
  assert.equal(audits[0].metadata.playerId, 'player-1')

  const escaped = buildParentPasswordResetEmail({
    actionLink: 'https://auth.example.test/reset?a=1&b=2',
    clubName: '<Example FC>',
    playerName: '<script>alert(1)</script>',
    teamName: 'U14 & U15',
  })
  assert.doesNotMatch(escaped, /<script>/)
  assert.match(escaped, /&lt;script&gt;/)
  assert.match(escaped, /U14 &amp; U15/)
})
