import assert from 'node:assert/strict'
import test from 'node:test'
import { buildUserFeedback } from '../src/lib/user-feedback.js'
import {
  getCoachNavigationModel,
  resolveCoachRoute,
} from '../apps/coach-mobile/src/coachNavigationCore.js'

const staffContexts = [
  { role: 'coach', roleRank: 20, teamId: 'team-a' },
  { role: 'head_manager', roleRank: 70, teamId: 'team-a', workspaceScope: 'team' },
  { role: 'admin', roleRank: 90, teamId: '', workspaceScope: 'club' },
]

test('buildUserFeedback normalises feedback and bug reports for mobile submission', () => {
  const feedback = buildUserFeedback({ type: 'feedback', title: '  Add drill search ', message: '  Please add search. ', app: 'coach', device: 'ios 19' })
  assert.deepEqual(feedback, {
    feedbackType: 'suggestion',
    title: 'Add drill search',
    summary: 'Please add search.',
    phase: 'production',
    severity: 'medium',
    module: 'Mobile coach app',
    route: '/more/feedback',
    browserDevice: 'ios 19',
  })

  const bug = buildUserFeedback({ type: 'bug', title: 'Crash', message: 'Opening calendar crashes.', app: 'parent' })
  assert.equal(bug.feedbackType, 'bug')
  assert.equal(bug.module, 'Mobile parent app')
  assert.equal(bug.route, '/more/bug')
})

test('buildUserFeedback rejects missing and overlong fields', () => {
  assert.throws(() => buildUserFeedback({ type: 'bug', title: '', message: 'Message' }), /subject and message/)
  assert.throws(() => buildUserFeedback({ type: 'feedback', title: 'Title', message: '' }), /subject and message/)
  assert.throws(() => buildUserFeedback({ type: 'feedback', title: 'x'.repeat(241), message: 'Message' }), /240 characters/)
  assert.throws(() => buildUserFeedback({ type: 'feedback', title: 'Title', message: 'x'.repeat(4001) }), /4,000 characters/)
})

test('Coach More navigation exposes feedback and bug routes for every active staff context', () => {
  for (const context of staffContexts) {
    const navigation = getCoachNavigationModel(context)
    assert.equal(navigation.more.some((route) => route.key === 'feedback'), true)
    assert.equal(navigation.more.some((route) => route.key === 'bug'), true)
    assert.equal(resolveCoachRoute('feedback', context), 'feedback')
    assert.equal(resolveCoachRoute('bug', context), 'bug')
  }
})
