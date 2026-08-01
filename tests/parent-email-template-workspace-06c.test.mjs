import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const pageUrl = new URL('../src/pages/ParentEmailTemplatesPage.jsx', import.meta.url)
const editorUrl = new URL('../src/components/parent-email-templates/TemplateEditorSection.jsx', import.meta.url)

test('email template workspace uses a route-addressable list and one focused editor', async () => {
  const pageSource = await readFile(pageUrl, 'utf8')
  const editorSource = await readFile(editorUrl, 'utf8')

  assert.match(pageSource, /useSearchParams\(\)/)
  assert.match(pageSource, /searchParams\.get\('templateId'\)/)
  assert.match(pageSource, /template\?\.key \|\| template\?\.id/)
  assert.match(pageSource, /nextSearchParams\.set\('templateId'/)
  assert.match(editorSource, /data-testid="email-template-list"/)
  assert.match(editorSource, /data-testid="email-template-editor"/)
  assert.equal(editorSource.match(/templates\.map\(/g)?.length, 1)
})

test('mobile stays list first and exposes a focused Back flow', async () => {
  const editorSource = await readFile(editorUrl, 'utf8')

  assert.match(editorSource, /hasExplicitSelection \? 'hidden lg:block' : 'block'/)
  assert.match(editorSource, /hasExplicitSelection \? 'block' : 'hidden lg:block'/)
  assert.match(editorSource, />\s*Back to templates\s*</)
  assert.match(editorSource, /onBackToList/)
})

test('focused editor separates content settings and preview while keeping save visible', async () => {
  const editorSource = await readFile(editorUrl, 'utf8')

  assert.match(editorSource, /key: 'content', label: 'Content'/)
  assert.match(editorSource, /key: 'settings', label: 'Settings'/)
  assert.match(editorSource, /key: 'preview', label: 'Preview'/)
  assert.match(editorSource, /onSaveTemplate\(selectedTemplate\)/)
  assert.match(editorSource, /<EmailPreview/)
  assert.match(editorSource, /renderParentEmailTemplate/)
})

test('template content settings fields defaults and delete controls remain available', async () => {
  const editorSource = await readFile(editorUrl, 'utf8')

  assert.match(editorSource, /EMAIL_TEMPLATE_FIELDS\.map/)
  assert.match(editorSource, /EMAIL_TEMPLATE_SECTIONS\.map/)
  assert.match(editorSource, /onTemplateChange\(selectedTemplate\.key, 'subject'/)
  assert.match(editorSource, /onTemplateChange\(selectedTemplate\.key, 'body'/)
  assert.match(editorSource, /onResetTemplate\(selectedTemplate\.key\)/)
  assert.match(editorSource, /onDeleteTemplate\(selectedTemplate\)/)
})

test('unsaved template changes block route and browser exits without adding a send path', async () => {
  const pageSource = await readFile(pageUrl, 'utf8')

  assert.match(pageSource, /useBlocker\(hasUnsavedChanges\)/)
  assert.match(pageSource, /window\.addEventListener\('beforeunload'/)
  assert.match(pageSource, /You have unsaved template changes\. Leave without saving\?/)
  assert.match(pageSource, /upsertParentEmailTemplate\(\{ user, template \}\)/)
  assert.doesNotMatch(pageSource, /sendParentEmail|sendPreparedParentEmail|sendEmail|send now/i)
})
