import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const inputUrl = new URL('../src/components/evaluations/EvaluationFieldInput.jsx', import.meta.url)
const hintPopoverUrl = new URL('../src/components/ui/HintPopover.jsx', import.meta.url)
const sectionCardUrl = new URL('../src/components/ui/SectionCard.jsx', import.meta.url)

test('score hints use the shared portal popover and central scoring guide', async () => {
  const [inputSource, popoverSource] = await Promise.all([
    readFile(inputUrl, 'utf8'),
    readFile(hintPopoverUrl, 'utf8'),
  ])

  assert.match(inputSource, /import \{ HintPopover \}/)
  assert.match(inputSource, /DEFAULT_ASSESSMENT_SCORE_GUIDE/)
  assert.match(inputSource, /buttonLabel=\{`Show scoring guide for \$\{field\.label\}`\}/)
  assert.match(inputSource, /<ScoreInfo field=\{field\} \/>/)
  assert.doesNotMatch(inputSource, /absolute right-0 top-12/)
  assert.doesNotMatch(inputSource, /group-hover:block/)

  assert.match(popoverSource, /createPortal/)
  assert.match(popoverSource, /data-score-hint-popover="true"/)
  assert.match(popoverSource, /position:.*fixed|className="fixed/)
  assert.match(popoverSource, /const viewportWidth = window\.innerWidth/)
  assert.match(popoverSource, /const isMobile = viewportWidth < 640/)
})

test('hint popover has dismissal, collision, and one-open-at-a-time behaviour', async () => {
  const source = await readFile(hintPopoverUrl, 'utf8')

  assert.match(source, /football-hint-popover-open/)
  assert.match(source, /event\.key === 'Escape'/)
  assert.match(source, /document\.addEventListener\('pointerdown'/)
  assert.match(source, /document\.addEventListener\('focusin'/)
  assert.match(source, /window\.addEventListener\('resize'/)
  assert.match(source, /window\.addEventListener\('scroll'/)
  assert.match(source, /aria-expanded=\{isOpen\}/)
  assert.match(source, /aria-controls=\{isOpen \? popoverId : undefined\}/)
  assert.match(source, /clamp\(buttonRect\.right - width/)
})

test('score hint popover uses light theme tokens while preserving dark mode classes', async () => {
  const [inputSource, popoverSource] = await Promise.all([
    readFile(inputUrl, 'utf8'),
    readFile(hintPopoverUrl, 'utf8'),
  ])

  assert.match(popoverSource, /bg-\[var\(--panel-bg\)\]/)
  assert.match(popoverSource, /border-\[var\(--border-color\)\]/)
  assert.match(popoverSource, /text-\[var\(--text-muted\)\]/)
  assert.match(popoverSource, /text-\[var\(--text-primary\)\]/)
  assert.match(popoverSource, /text-\[var\(--text-secondary\)\]/)
  assert.match(popoverSource, /hover:bg-\[var\(--accent-soft\)\]/)
  assert.match(popoverSource, /focus:ring-\[var\(--accent-soft\)\]/)
  assert.match(popoverSource, /dark:bg-\[#101828\]/)
  assert.match(popoverSource, /dark:text-\[#d7e5dc\]/)
  assert.match(popoverSource, /dark:text-\[#8ee6bd\]/)

  assert.match(inputSource, /bg-\[var\(--panel-alt\)\]/)
  assert.match(inputSource, /border-\[var\(--border-color\)\]/)
  assert.match(inputSource, /text-\[var\(--text-muted\)\]/)
  assert.match(inputSource, /text-\[var\(--text-primary\)\]/)
  assert.match(inputSource, /dark:bg-\[#172033\]/)
  assert.match(inputSource, /dark:text-\[#d7e5dc\]/)
})

test('score hint fix is not dependent on changing SectionCard overflow', async () => {
  const source = await readFile(sectionCardUrl, 'utf8')

  assert.match(source, /overflow-hidden/)
  assert.match(source, /SectionCard/)
})

test('evaluation fields can render compact read-only previous value hints', async () => {
  const source = await readFile(inputUrl, 'utf8')

  assert.match(source, /function PreviousValueHint/)
  assert.match(source, /Previous:/)
  assert.match(source, /previousValue\.valueLabel/)
  assert.match(source, /previousValue\.dateLabel/)
  assert.match(source, /previousValue\.coach/)
  assert.doesNotMatch(source, /onChange\(field\.id, previousValue/)
})
