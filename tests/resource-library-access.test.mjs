import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  canManageResourceLibrary,
  canUseResourceLibrary,
} from '../src/lib/auth-permissions.js'
import {
  RESOURCE_LIBRARY_MAX_FILE_SIZE_BYTES,
  validateResourceLibraryFile,
} from '../src/lib/domain/resource-library.js'

const activeStaffBase = {
  clubId: '11111111-1111-4111-8111-111111111111',
  planKey: 'small_club',
  planStatus: 'active',
}

function createFile({ name = 'resource.pdf', size = 1024, type = 'application/pdf' } = {}) {
  return { name, size, type }
}

test('Resource Library allows active authorised staff to view', () => {
  assert.equal(canUseResourceLibrary({ ...activeStaffBase, role: 'admin', roleRank: 90 }), true)
  assert.equal(canUseResourceLibrary({ ...activeStaffBase, role: 'manager', roleRank: 50 }), true)
  assert.equal(canUseResourceLibrary({ ...activeStaffBase, role: 'coach', roleRank: 30 }), true)
  assert.equal(canUseResourceLibrary({ ...activeStaffBase, role: 'assistant_coach', roleRank: 20 }), true)
})

test('Resource Library denies parents, platform admins, players, missing clubs, and inactive plans', () => {
  assert.equal(canUseResourceLibrary({ ...activeStaffBase, role: 'parent_portal', roleRank: 0 }), false)
  assert.equal(canUseResourceLibrary({ ...activeStaffBase, role: 'super_admin', roleRank: 100 }), false)
  assert.equal(canUseResourceLibrary({ ...activeStaffBase, role: 'player', roleRank: 0 }), false)
  assert.equal(canUseResourceLibrary({ ...activeStaffBase, clubId: '', role: 'coach', roleRank: 30 }), false)
  assert.equal(canUseResourceLibrary({ ...activeStaffBase, role: 'coach', roleRank: 30, planStatus: 'cancelled' }), false)
})

test('Resource Library management is limited to rank 50 and above', () => {
  assert.equal(canManageResourceLibrary({ ...activeStaffBase, role: 'admin', roleRank: 90 }), true)
  assert.equal(canManageResourceLibrary({ ...activeStaffBase, role: 'head_manager', roleRank: 70 }), true)
  assert.equal(canManageResourceLibrary({ ...activeStaffBase, role: 'manager', roleRank: 50 }), true)
  assert.equal(canManageResourceLibrary({ ...activeStaffBase, role: 'coach', roleRank: 30 }), false)
  assert.equal(canManageResourceLibrary({ ...activeStaffBase, role: 'assistant_coach', roleRank: 20 }), false)
})

test('Resource Library file validation allows approved V1 files only', () => {
  assert.equal(validateResourceLibraryFile(createFile()).mimeType, 'application/pdf')
  assert.equal(validateResourceLibraryFile(createFile({
    name: 'plan.docx',
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })).mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  assert.equal(validateResourceLibraryFile(createFile({ name: 'notes.txt', type: 'text/plain' })).mimeType, 'text/plain')
  assert.equal(validateResourceLibraryFile(createFile({ name: 'image.jpg', type: 'image/jpeg' })).mimeType, 'image/jpeg')
})

test('Resource Library file validation blocks risky or oversized uploads', () => {
  assert.throws(() => validateResourceLibraryFile(createFile({ name: 'script.js', type: 'text/javascript' })), /not allowed|Upload a PDF/)
  assert.throws(() => validateResourceLibraryFile(createFile({ name: 'page.html', type: 'text/html' })), /not allowed|Upload a PDF/)
  assert.throws(() => validateResourceLibraryFile(createFile({ name: 'archive.zip', type: 'application/zip' })), /not allowed|Upload a PDF/)
  assert.throws(() => validateResourceLibraryFile(createFile({ name: 'macro.docm', type: 'application/vnd.ms-word.document.macroEnabled.12' })), /not allowed|Upload a PDF/)
  assert.throws(() => validateResourceLibraryFile(createFile({ name: 'plan.pdf', type: 'text/plain' })), /not allowed/)
  assert.throws(() => validateResourceLibraryFile(createFile({ size: RESOURCE_LIBRARY_MAX_FILE_SIZE_BYTES + 1 })), /20 MB/)
})
