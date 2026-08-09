import assert from 'node:assert/strict'
import { test } from 'node:test'

import { loadActiveAuthorityProfile } from '../netlify/functions/lib/_authority-profile.js'
import { BILLING_ACTION_CATEGORIES, isBillingActionAllowed, resolveBillingAccess } from '../src/lib/billing-access.js'

function createSupabase(fixtures) {
  return {
    from(table) {
      const filters = new Map()
      return {
        select() {
          return this
        },
        eq(column, value) {
          filters.set(column, value)
          return this
        },
        async maybeSingle() {
          const rows = fixtures[table] || []
          const data = rows.find((row) => [...filters].every(([column, value]) => row[column] === value)) || null
          return { data, error: null }
        },
      }
    },
  }
}

const member = {
  id: 'user-1',
  email: 'member@example.test',
  role: 'manager',
  role_rank: 50,
  club_id: 'club-1',
  status: 'active',
}

test('server authority loader accepts only an active exact profile and membership match', async () => {
  const supabase = createSupabase({
    users: [member],
    user_club_memberships: [{ auth_user_id: 'user-1', club_id: 'club-1', role: 'manager', role_rank: 50 }],
    clubs: [{ id: 'club-1', status: 'active' }],
  })

  const loaded = await loadActiveAuthorityProfile(supabase, { id: 'user-1' })
  assert.equal(loaded, member)
})

test('server authority loader rejects removed, mismatched and inactive membership authority', async () => {
  const variants = [
    [],
    [{ auth_user_id: 'user-1', club_id: 'club-1', role: 'coach', role_rank: 30 }],
  ]

  for (const memberships of variants) {
    const supabase = createSupabase({
      users: [member],
      user_club_memberships: memberships,
      clubs: [{ id: 'club-1', status: 'active' }],
    })
    await assert.rejects(loadActiveAuthorityProfile(supabase, { id: 'user-1' }), /active access/i)
  }

  const inactiveSupabase = createSupabase({
    users: [{ ...member, status: 'suspended' }],
  })
  await assert.rejects(loadActiveAuthorityProfile(inactiveSupabase, { id: 'user-1' }), /active access/i)
})

test('server authority loader requires an active exact platform administrator record', async () => {
  const platformProfile = {
    ...member,
    id: 'platform-1',
    role: 'super_admin',
    role_rank: 100,
    club_id: null,
  }
  const activeSupabase = createSupabase({
    users: [platformProfile],
    platform_admins: [{ id: 'platform-1', status: 'active' }],
  })
  const revokedSupabase = createSupabase({
    users: [platformProfile],
    platform_admins: [{ id: 'platform-1', status: 'suspended' }],
  })

  assert.equal(await loadActiveAuthorityProfile(activeSupabase, { id: 'platform-1' }), platformProfile)
  await assert.rejects(loadActiveAuthorityProfile(revokedSupabase, { id: 'platform-1' }), /active access/i)
})

test('server authority loader never falls back from identity id to email', async () => {
  const supabase = createSupabase({
    users: [{ ...member, id: 'different-user' }],
  })

  await assert.rejects(
    loadActiveAuthorityProfile(supabase, { id: 'missing-user', email: member.email }),
    /active access/i,
  )
})

test('client-reported Platform Admin fields cannot replace canonical customer staff authority', async () => {
  const supabase = createSupabase({
    users: [member],
    user_club_memberships: [{ auth_user_id: 'user-1', club_id: 'club-1', role: 'manager', role_rank: 50 }],
    clubs: [{ id: 'club-1', status: 'active' }],
  })
  const reported = { id: 'user-1', role: 'super_admin', roleRank: 100, clubId: 'selected-customer' }
  const canonical = await loadActiveAuthorityProfile(supabase, reported)
  const context = {
    planKey: 'small_club',
    planStatus: 'past_due',
    billingArrangement: 'immediate',
    role: canonical.role,
    roleRank: canonical.role_rank,
  }

  assert.equal(canonical.role, 'manager')
  assert.equal(resolveBillingAccess(context).accessState, 'payment_required')
  assert.equal(isBillingActionAllowed(context, BILLING_ACTION_CATEGORIES.staffMutation), false)
})
