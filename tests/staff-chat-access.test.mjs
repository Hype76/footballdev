import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canUseClubStaffChat, canUseStaffChat } from '../src/lib/auth-permissions.js'

const activeStaffBase = {
  clubId: '11111111-1111-4111-8111-111111111111',
  planKey: 'small_club',
  planStatus: 'active',
}

test('Staff Chat allows active authorised club and team staff only', () => {
  assert.equal(canUseStaffChat({ ...activeStaffBase, role: 'admin', roleRank: 90 }), true)
  assert.equal(canUseStaffChat({ ...activeStaffBase, role: 'manager', roleRank: 50 }), true)
  assert.equal(canUseStaffChat({ ...activeStaffBase, role: 'coach', roleRank: 30 }), true)
  assert.equal(canUseStaffChat({ ...activeStaffBase, role: 'assistant_coach', roleRank: 20 }), true)
})

test('Club Staff Chat is limited to club-wide staff roles', () => {
  assert.equal(canUseClubStaffChat({ ...activeStaffBase, role: 'admin', roleRank: 90 }), true)
  assert.equal(canUseClubStaffChat({ ...activeStaffBase, role: 'head_manager', roleRank: 70 }), true)
  assert.equal(canUseClubStaffChat({ ...activeStaffBase, role: 'manager', roleRank: 50 }), false)
  assert.equal(canUseClubStaffChat({ ...activeStaffBase, role: 'coach', roleRank: 30 }), false)
  assert.equal(canUseClubStaffChat({ ...activeStaffBase, role: 'assistant_coach', roleRank: 20 }), false)
})

test('Staff Chat denies parents, platform admins, players, missing clubs, and inactive plans', () => {
  assert.equal(canUseStaffChat({ ...activeStaffBase, role: 'parent_portal', roleRank: 0 }), false)
  assert.equal(canUseStaffChat({ ...activeStaffBase, role: 'super_admin', roleRank: 100 }), false)
  assert.equal(canUseStaffChat({ ...activeStaffBase, role: 'player', roleRank: 0 }), false)
  assert.equal(canUseStaffChat({ ...activeStaffBase, clubId: '', role: 'coach', roleRank: 30 }), false)
  assert.equal(canUseStaffChat({ ...activeStaffBase, role: 'coach', roleRank: 30, planStatus: 'cancelled' }), false)
})
