import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const coachHomeUrl = new URL('../src/pages/CoachHomePage.jsx', import.meta.url)
const sidebarUrl = new URL('../src/components/layout/Sidebar.jsx', import.meta.url)

test('Manager Home uses shared theme tokens and keeps teal for purposeful states', async () => {
  const source = await readFile(coachHomeUrl, 'utf8')

  assert.match(source, /const surfaceClass = '[^']*border-\[var\(--border-color\)\][^']*bg-\[var\(--panel-bg\)\]/)
  assert.match(source, /const sectionHeaderClass = '[^']*bg-\[var\(--panel-alt\)\]/)
  assert.match(source, /const primaryButtonClass = '[^']*bg-\[var\(--button-primary\)\][^']*text-\[var\(--button-primary-text\)\]/)
  assert.match(source, /const secondaryButtonClass = '[^']*bg-\[var\(--panel-alt\)\][^']*text-\[var\(--text-primary\)\]/)
  assert.match(source, /data-testid="manager-home" className="manager-home-theme space-y-5"/)

  const managerHome = source.slice(
    source.lastIndexOf('data-testid="manager-home"'),
    source.indexOf('{voiceNotePickerNote ?'),
  )
  assert.doesNotMatch(managerHome, /bg-\[#047857\]|bg-\[#ecfdf5\]|bg-\[#bbf7d0\]/)
})

test('Manager header is compact and preserves the segmented Coach and Full controls', async () => {
  const source = await readFile(coachHomeUrl, 'utf8')

  assert.match(source, /data-testid="manager-home-header"/)
  assert.match(source, /bg-\[var\(--shell-card\)\]/)
  assert.match(source, /aria-label="Coach mode display"/)
  assert.match(source, /\{ label: 'Coach Mode', value: true \}/)
  assert.match(source, /\{ label: 'Full Mode', value: false \}/)
  assert.match(source, /aria-pressed=\{isCoachMode === option\.value\}/)
  assert.match(source, /saveCoachModePreference\(value\)/)
})

test('Next Session and compact quick actions preserve destinations and permissions', async () => {
  const source = await readFile(coachHomeUrl, 'utf8')
  const actionsStart = source.indexOf('const secondaryActions =')
  const actionsEnd = source.indexOf('const loadCoachHome', actionsStart)
  const actions = source.slice(actionsStart, actionsEnd)

  assert.match(source, /data-testid="manager-home-next-session"/)
  assert.match(source, /to=\{activeSession \? '\/sessions\/start' : '\/calendar\?action=add-event'\}/)
  assert.match(source, /data-testid="manager-home-quick-actions"/)
  assert.match(actions, /label: 'View squad'[\s\S]*path: '\/players\/current'/)
  assert.match(actions, /label: 'Add player note'[\s\S]*path: '\/assess-player\/new\?choosePlayer=1'/)
  assert.match(actions, /label: 'Add assessment'[\s\S]*path: '\/assess-player\/new\?choosePlayer=1'/)
  assert.match(actions, /label: 'Open calendar'[\s\S]*path: '\/calendar'/)
  assert.match(actions, /\.filter\(\(action\) => canUseCoachActions && isRecoveryPathVisible\(action\.path, \{ user \}\)\)/)
})

test('Manager metrics are flattened and Latest notes use accessible rows and an empty state', async () => {
  const source = await readFile(coachHomeUrl, 'utf8')
  const metricsStart = source.indexOf('data-testid="manager-home-metrics"')
  const notesStart = source.indexOf('data-testid="manager-home-latest-notes"', metricsStart)
  const notesEnd = source.indexOf('{voiceNotePickerNote ?', notesStart)
  const metrics = source.slice(metricsStart, notesStart)
  const notes = source.slice(notesStart, notesEnd)

  assert.match(metrics, /divide-x divide-y divide-\[var\(--border-color\)\]/)
  assert.match(metrics, /<CoachMetric/)
  assert.doesNotMatch(metrics, /shadow-md|shadow-lg/)

  assert.match(notes, /divide-y divide-\[var\(--border-color\)\]/)
  assert.match(notes, /to=\{`\/player\/\$\{encodeURIComponent\(evaluation\.playerName\)\}`\}/)
  assert.match(notes, /\{evaluation\.playerName\}/)
  assert.match(notes, /\{getEvaluationContextLabel\(evaluation, user\)\}/)
  assert.match(notes, /\{getEvaluationSummary\(evaluation\)\}/)
  assert.match(notes, /Open player profile/)
  assert.match(notes, /focus:ring-2/)
  assert.match(notes, /Coach notes and assessments will appear here after the first session\./)
})

test('Sidebar groups are quiet while labels, active state, focus, permissions and mobile behavior remain', async () => {
  const source = await readFile(sidebarUrl, 'utf8')
  const primaryStart = source.indexOf('function PrimaryNavSection')
  const groupStart = source.indexOf('function NavGroup', primaryStart)
  const groupEnd = source.indexOf('function SidebarFooter', groupStart)
  const primary = source.slice(primaryStart, groupStart)
  const group = source.slice(groupStart, groupEnd)

  assert.match(source, /bg-\[var\(--sidebar-bg\)\]/)
  assert.match(source, /border-\[var\(--border-color\)\]/)
  assert.doesNotMatch(primary, /rounded-xl border/)
  assert.doesNotMatch(group, /rounded-xl border/)
  assert.match(group, /border-t border-\[var\(--border-color\)\]/)
  assert.match(primary, /var\(--sidebar-active-bg\)/)
  assert.match(primary, /focus:ring-\[var\(--focus-ring\)\]/)
  assert.match(group, /<details open=\{defaultOpen\}/)
  assert.match(source, /getVisibleNavigationItems/)
  assert.match(source, /fixed inset-y-0 left-0/)
  assert.match(source, /overflow-y-auto/)
})
