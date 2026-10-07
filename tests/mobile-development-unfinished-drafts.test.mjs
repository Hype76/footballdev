import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isUnfinishedDevelopmentDraft, mergeUnfinishedDevelopmentDrafts } from '../apps/mobile-core/src/developmentOfflineCore.js'

const draft = { id: 'saved', playerId: 'player', formId: 'form', status: 'draft', values: { finishing: 7 } }

test('unfinished drafts include saved private work and exclude finalisation intent or completed states', () => {
  for (const status of ['draft', 'pending', 'synced']) assert.equal(isUnfinishedDevelopmentDraft({ ...draft, status }), true)
  for (const status of ['finalised', 'completed', 'sent', undefined]) assert.equal(isUnfinishedDevelopmentDraft({ ...draft, status }), false)
  assert.equal(isUnfinishedDevelopmentDraft({ ...draft, finalisation: { shareWithParent: true } }), false)
  assert.equal(isUnfinishedDevelopmentDraft({ ...draft, playerId: '' }), false)
})

test('local edits override the corresponding server draft, retaining exact values and notes', () => {
  const local = { ...draft, id: 'local', status: 'pending', values: { finishing: 9 }, notes: 'Local edit' }
  assert.deepEqual(mergeUnfinishedDevelopmentDrafts([draft], [local]), [local])
  assert.deepEqual(mergeUnfinishedDevelopmentDrafts([draft], [{ ...local, finalisation: {} }]), [])
  assert.deepEqual(mergeUnfinishedDevelopmentDrafts([draft], [{ ...local, status: 'sent' }]), [])
})

test('matching persisted record ids cannot count or restore as two unfinished drafts', () => {
  const moved = { ...draft, formId: 'updated-form', status: 'synced' }
  assert.deepEqual(mergeUnfinishedDevelopmentDrafts([draft], [moved]), [moved])
})

test('newest server draft wins for the same selection regardless of incoming ordering', () => {
  const older = { ...draft, id: 'older', lastSavedAt: '2026-10-06T12:00:00Z' }
  const newer = { ...draft, id: 'newer', lastSavedAt: '2026-10-07T12:00:00Z' }
  assert.deepEqual(mergeUnfinishedDevelopmentDrafts([newer, older]), [newer])
})
