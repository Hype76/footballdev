import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../src/pages/DataTransferPage.jsx', import.meta.url), 'utf8')

test('Data Transfer presentation uses shared light, dark, and accent theme tokens', () => {
  for (const token of [
    '--panel-bg',
    '--panel-alt',
    '--border-color',
    '--text-primary',
    '--text-muted',
    '--text-secondary',
    '--accent',
    '--accent-soft',
    '--accent-text',
    '--button-primary',
    '--button-primary-text',
    '--danger-border',
    '--danger-soft',
    '--danger-text',
  ]) {
    assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }

  assert.doesNotMatch(source, /#[\da-f]{3,8}/i)
  assert.doesNotMatch(source, /\b(?:bg|text|border|ring)-(?:white|black|emerald|rose|amber)-?\d*\b/)
})

test('Data Transfer controls expose token-aware hover, focus, selected, and disabled states', () => {
  assert.match(source, /focus-visible:ring-\[var\(--accent\)\]/)
  assert.match(source, /focus:ring-\[var\(--accent-soft\)\]/)
  assert.match(source, /hover:border-\[var\(--accent\)\]/)
  assert.match(source, /hover:bg-\[var\(--accent-soft\)\]/)
  assert.match(source, /ring-\[var\(--accent\)\]/)
  assert.match(source, /accent-\[var\(--accent\)\]/)
  assert.match(source, /disabled:cursor-not-allowed/)
  assert.match(source, /disabled:opacity-50/)
})

test('Data Transfer tables and file controls remain readable within narrow viewports', () => {
  assert.match(source, /const tableShellClass = 'overflow-x-auto/)
  assert.match(source, /min-w-\[72rem\]/)
  assert.match(source, /min-w-\[64rem\]/)
  assert.match(source, /file:bg-\[var\(--accent-soft\)\]/)
  assert.match(source, /data-testid="data-transfer-page"/)
})

test('Data Transfer theme work preserves the established functional action surface', () => {
  for (const action of [
    'confirmDataTransfer',
    'downloadDataTransferErrorReport',
    'downloadDataTransferRawWorkbook',
    'downloadOrdinaryDataTransferExport',
    'downloadSimpleDataTransferTemplate',
    'downloadDataTransferWorkbook',
    'inspectDataTransferSource',
    'inspectDataTransferWorkbook',
    'loadDataTransferDetails',
    'loadDataTransferHistory',
    'loadDataTransferScope',
    'rollbackDataTransfer',
  ]) {
    assert.match(source, new RegExp(`\\b${action}\\b`))
  }

  assert.match(source, /importMode: 'additive'/)
  assert.match(source, /confirmationPhrase !== 'IMPORT'/)
  assert.match(source, /rollbackPhrase !== 'ROLLBACK'/)
  assert.match(source, /Guardian invitations are not sent\./)
})
