import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  buildAuthoritativeParentInviteEmail,
} from '../src/lib/parent-invite-email.js'

const sendInviteFunctionUrl = new URL('../netlify/functions/send-parent-portal-invite.js', import.meta.url)
const createParentAccountUrl = new URL('../netlify/functions/create-parent-account.js', import.meta.url)
const emailBuilderUrl = new URL('../src/lib/email-builder.js', import.meta.url)

function inviteFixture({
  clubLogoUrl,
  clubName,
  inviteToken,
  playerName,
  teamName,
}) {
  return {
    invite_token: inviteToken,
    clubs: {
      logo_url: clubLogoUrl,
      name: clubName,
    },
    players: {
      player_name: playerName,
    },
    teams: {
      name: teamName,
    },
  }
}

function reachableImageResponse() {
  return {
    body: { cancel: async () => {} },
    headers: { get: () => 'image/png' },
    ok: true,
    status: 200,
  }
}

test('authoritative Parent invite branding stays scoped to each invite club', async () => {
  const fetchImpl = async () => reachableImageResponse()
  const clubA = await buildAuthoritativeParentInviteEmail({
    fetchImpl,
    inviteLink: inviteFixture({
      clubLogoUrl: 'https://cdn.example.com/club-a.png',
      clubName: 'Club A',
      inviteToken: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      playerName: 'Player A',
      teamName: 'Team A',
    }),
  })
  const clubB = await buildAuthoritativeParentInviteEmail({
    fetchImpl,
    inviteLink: inviteFixture({
      clubLogoUrl: 'https://cdn.example.com/club-b.png',
      clubName: 'Club B',
      inviteToken: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      playerName: 'Player B',
      teamName: 'Team B',
    }),
  })

  assert.equal(clubA.logoSource, 'club')
  assert.match(clubA.html, /src="https:\/\/cdn\.example\.com\/club-a\.png"/)
  assert.match(clubA.html, /alt="Club A logo"/)
  assert.match(clubA.html, /Club A has invited you/)
  assert.doesNotMatch(clubA.html, /club-b|Club B/)

  assert.equal(clubB.logoSource, 'club')
  assert.match(clubB.html, /src="https:\/\/cdn\.example\.com\/club-b\.png"/)
  assert.match(clubB.html, /alt="Club B logo"/)
  assert.match(clubB.html, /Club B has invited you/)
  assert.doesNotMatch(clubB.html, /club-a|Club A/)
})

test('invalid, unavailable, and unresolvable club logos use the Football Player fallback', async () => {
  const cases = [
    {
      clubLogoUrl: '',
      fetchImpl: async () => {
        throw new Error('fetch should not run for an absent URL')
      },
    },
    {
      clubLogoUrl: 'http://insecure.example.com/club.png',
      fetchImpl: async () => {
        throw new Error('fetch should not run for an invalid URL')
      },
    },
    {
      clubLogoUrl: 'https://cdn.example.com/unavailable.png',
      fetchImpl: async () => ({
        body: { cancel: async () => {} },
        headers: { get: () => 'text/html' },
        ok: false,
        status: 404,
      }),
    },
    {
      clubLogoUrl: 'https://missing.example.invalid/club.png',
      fetchImpl: async () => {
        throw new Error('DNS lookup failed')
      },
    },
  ]

  for (const [index, testCase] of cases.entries()) {
    const email = await buildAuthoritativeParentInviteEmail({
      fetchImpl: testCase.fetchImpl,
      inviteLink: inviteFixture({
        clubLogoUrl: testCase.clubLogoUrl,
        clubName: `Fallback Club ${index}`,
        inviteToken: `00000000-0000-4000-8000-00000000000${index}`,
        playerName: 'Fallback Player',
        teamName: 'Fallback Team',
      }),
    })

    assert.equal(email.logoSource, 'football-player')
    assert.match(email.html, /src="https:\/\/footballplayer\.online\/football-player-logo\.png"/)
    assert.match(email.html, /alt="Football Player logo"/)
    assert.match(email.html, /data-logo-source="football-player"/)
  }
})

test('existing Parent access keeps the trusted token and routes to Parent sign-in', async () => {
  const email = await buildAuthoritativeParentInviteEmail({
    existingParentPortalUser: true,
    fetchImpl: async () => reachableImageResponse(),
    inviteLink: inviteFixture({
      clubLogoUrl: 'https://cdn.example.com/club.png',
      clubName: 'Existing Parent Club',
      inviteToken: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      playerName: 'Existing Player',
      teamName: 'Existing Team',
    }),
  })

  assert.equal(
    email.inviteUrl,
    'https://parent.footballplayer.online/parent-invite/cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  )
  assert.match(
    email.html,
    /https:\/\/parent\.footballplayer\.online\/parent-login\?parentInvite=cccccccc-cccc-4ccc-8ccc-cccccccccccc/,
  )
  assert.match(email.html, /Sign in to parent portal/)
})

test('Parent invite delivery renders only server-authoritative relationship and branding fields', async () => {
  const [sendInviteFunction, createParentAccount, emailBuilder] = await Promise.all([
    readFile(sendInviteFunctionUrl, 'utf8'),
    readFile(createParentAccountUrl, 'utf8'),
    readFile(emailBuilderUrl, 'utf8'),
  ])

  assert.match(
    sendInviteFunction,
    /invite_token, players:player_id \(player_name, section\), teams:team_id \(name\), clubs:club_id \(name, contact_email, logo_url\)/,
  )
  assert.match(sendInviteFunction, /buildAuthoritativeParentInviteEmail\(\{/)
  assert.match(sendInviteFunction, /recipient = normaliseEmail\(inviteLink\.email\)/)
  assert.doesNotMatch(sendInviteFunction, /const emailHtml = String\(html/)
  assert.doesNotMatch(sendInviteFunction, /body\.(?:clubName|clubLogoUrl|inviteUrl|playerName|teamName)/)
  assert.match(
    emailBuilder,
    /body: JSON\.stringify\(\{\s*copySender: data\.copySender === true,\s*inviteLinkId: data\.inviteLinkId,\s*senderEmail: data\.senderEmail,\s*\}\)/,
  )
  assert.match(createParentAccount, /resolveReachableEmailLogo\(\{/)
  assert.match(createParentAccount, /clubs:club_id \(name, logo_url\)/)
})
